/**
 * NewRevisionModal — v1.19.5: 컴포지팅 뷰 헤더에서 직접 새 리비전을 등록하는 중앙 모달.
 *
 * 4단계 흐름 (mockup `docs/mockups/new-revision-flow.html` 그대로):
 *   1. 에피소드 선택 (커스텀 제목 chip — "두근두근 첫 등교")
 *   2. 파트 선택 (A / B / C / D 단위 — v1.19.6 부서 노출 제거)
 *   3. 씬 검색·선택 (검색 input + 자동완성 드롭다운 → 선택 칩)
 *   4. 본문 textarea + 이미지 첨부 + RevisionRecipientPicker (자동 체크 뱃지)
 *
 * 기존 씬 모달 RevisionPanel / 컴포지팅 AddRevisionForm 의 createRevision 호출 패턴과 동일하게
 * `useRevisionStore.createRevision({sceneKey, description, imageUrl, notifyUserIds, requesterId,
 *  requesterName, department, lookupDepartment})` 를 호출한다 (v1.18.0 신표준).
 *
 * v1.19.6: 한솔 결정으로 부서(BG/ACT) UI 분리 폐기.
 * - 같은 part 라벨(예: "A")에 BG sheet + ACT sheet 두 개 있으면 BG sheet 우선 채택 (fallback ACT).
 * - sceneKey 자체는 부서 무관(buildSceneKey 결과)이라 BG/ACT 어느 쪽으로 저장해도 같은 씬으로 합산됨.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, MessageSquare, Search, X } from 'lucide-react';

import { useRevisionStore } from '@/stores/useRevisionStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { buildSceneKey } from '@/services/revisionService';
import { calcDefaultRecipients } from '@/utils/revisionRecipients';
import { resizeBlob } from '@/utils/imageUtils';
import { RevisionRecipientPicker } from '@/components/scenes/RevisionRecipientPicker';
import type { Episode, Part, Scene } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

// ─── 헬퍼 ────────────────────────────────────────

function sceneMatchesQuery(scene: Scene, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    String(scene.no).toLowerCase().includes(q)
    || (scene.sceneId || '').toLowerCase().includes(q)
    || (scene.memo || '').toLowerCase().includes(q)
    || (scene.assignee || '').toLowerCase().includes(q)
  );
}

// ─── 컴포넌트 ─────────────────────────────────────

export default function NewRevisionModal({ open, onClose }: Props) {
  const episodes = useDataStore((s) => s.episodes);
  const getEpisodeDisplayName = useDataStore((s) => s.getEpisodeDisplayName);
  const { currentUser, users: allUsers } = useAuthStore();
  const { createRevision, getOpenCount } = useRevisionStore();

  const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState<number | null>(null);
  const [selectedSheetName, setSelectedSheetName] = useState<string | null>(null);
  const [sceneSearchQuery, setSceneSearchQuery] = useState('');
  const [sceneDropdownOpen, setSceneDropdownOpen] = useState(false);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [description, setDescription] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [notifyIds, setNotifyIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const sceneInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownContainerRef = useRef<HTMLDivElement>(null);

  // ── 파생 상태 ────
  const selectedEpisode: Episode | null = useMemo(() => {
    if (selectedEpisodeNumber == null) return null;
    return episodes.find((ep) => ep.episodeNumber === selectedEpisodeNumber) ?? null;
  }, [episodes, selectedEpisodeNumber]);

  // v1.19.6: 같은 EP 의 parts 를 partId 단위로 group — BG sheet 우선, 없으면 ACT.
  // (sceneKey 자체가 부서 무관이라 어느 sheet 를 선택하든 결과는 같은 씬으로 합산됨)
  const partLabels = useMemo(() => {
    if (!selectedEpisode) return [] as { partId: string; part: Part }[];
    const map = new Map<string, Part>();
    for (const part of selectedEpisode.parts) {
      const existing = map.get(part.partId);
      if (!existing || part.department === 'bg') {
        map.set(part.partId, part);
      }
    }
    return Array.from(map.entries())
      .map(([partId, part]) => ({ partId, part }))
      .sort((a, b) => a.partId.localeCompare(b.partId));
  }, [selectedEpisode]);

  const selectedPart: Part | null = useMemo(() => {
    if (!selectedEpisode || !selectedSheetName) return null;
    return selectedEpisode.parts.find((p) => p.sheetName === selectedSheetName) ?? null;
  }, [selectedEpisode, selectedSheetName]);

  const filteredScenes = useMemo(() => {
    if (!selectedPart) return [] as Scene[];
    const list = selectedPart.scenes.filter((s) => sceneMatchesQuery(s, sceneSearchQuery));
    return list.slice().sort((a, b) => a.no - b.no);
  }, [selectedPart, sceneSearchQuery]);

  const defaultRecipients = useMemo(() => {
    if (!currentUser) return [] as string[];
    return calcDefaultRecipients(
      selectedScene ? { assignee: selectedScene.assignee } : null,
      allUsers,
      currentUser.id,
    );
  }, [selectedScene, allUsers, currentUser]);

  // 단계 진행도 (mockup 의 인디케이터)
  const stepStates = useMemo(() => {
    return {
      ep: !!selectedEpisode,
      part: !!selectedPart,
      scene: !!selectedScene,
      content: description.trim().length > 0,
    };
  }, [selectedEpisode, selectedPart, selectedScene, description]);

  const currentStepNumber = !stepStates.ep
    ? 1
    : !stepStates.part
      ? 2
      : !stepStates.scene
        ? 3
        : 4;

  const canSubmit = !!(currentUser
    && selectedPart
    && selectedScene
    && description.trim()
    && !submitting);

  // ── 자동 추론: 단일 EP/Part 자동 선택 ────
  useEffect(() => {
    if (!open) return;
    if (selectedEpisodeNumber == null && episodes.length === 1) {
      setSelectedEpisodeNumber(episodes[0].episodeNumber);
    }
  }, [open, episodes, selectedEpisodeNumber]);

  useEffect(() => {
    if (!selectedEpisode) return;
    if (selectedSheetName == null && partLabels.length === 1) {
      setSelectedSheetName(partLabels[0].part.sheetName);
    }
  }, [selectedEpisode, selectedSheetName, partLabels]);

  // ── 모달 닫힐 때 상태 리셋 ────
  useEffect(() => {
    if (open) return;
    setSelectedEpisodeNumber(null);
    setSelectedSheetName(null);
    setSceneSearchQuery('');
    setSceneDropdownOpen(false);
    setSelectedScene(null);
    setDescription('');
    setImagePreview(null);
    setNotifyIds([]);
    setSubmitting(false);
  }, [open]);

  // ── ESC → 닫기 ────
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ── 외부 클릭 → 씬 드롭다운 닫기 ────
  useEffect(() => {
    if (!sceneDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownContainerRef.current) return;
      if (!dropdownContainerRef.current.contains(e.target as Node)) {
        setSceneDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [sceneDropdownOpen]);

  if (!open) return null;

  // ── 이벤트 핸들러 ────
  const handleEpisodeSelect = (epNumber: number) => {
    if (selectedEpisodeNumber === epNumber) return;
    setSelectedEpisodeNumber(epNumber);
    setSelectedSheetName(null);
    setSelectedScene(null);
    setSceneSearchQuery('');
  };

  const handlePartSelect = (sheetName: string) => {
    if (selectedSheetName === sheetName) return;
    setSelectedSheetName(sheetName);
    setSelectedScene(null);
    setSceneSearchQuery('');
  };

  const handleSceneSelect = (scene: Scene) => {
    setSelectedScene(scene);
    setSceneDropdownOpen(false);
    setSceneSearchQuery('');
    // 4단계로 자동 포커스
    setTimeout(() => textareaRef.current?.focus(), 30);
  };

  const handleSceneClear = () => {
    setSelectedScene(null);
    setSceneSearchQuery('');
    setSceneDropdownOpen(true);
    setTimeout(() => sceneInputRef.current?.focus(), 30);
  };

  const handleImageFile = async (file: File) => {
    try {
      const resized = await resizeBlob(file, 800, 0.8);
      setImagePreview(resized);
    } catch {
      // 무시 — 사용자에게 토스트 띄우는 건 향후 보강
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await handleImageFile(file);
        return;
      }
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !currentUser || !selectedPart || !selectedScene) return;
    setSubmitting(true);
    try {
      const sceneKey = buildSceneKey(selectedPart.sheetName, selectedScene.sceneId, {
        siblingSceneIds: selectedPart.scenes.map((s) => s.sceneId),
      });
      const department = selectedPart.department === 'bg' ? 'bg' : 'acting';
      await createRevision({
        sceneKey,
        description: description.trim(),
        imageUrl: imagePreview || undefined,
        department,
        lookupDepartment: department,
        requesterId: currentUser.id,
        requesterName: currentUser.name,
        notifyUserIds: notifyIds,
      });
      onClose();
    } catch (err) {
      console.error('[NewRevisionModal] 리비전 등록 실패:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // ── 렌더 ────
  // v1.19.6: 부서(BG/ACT) 표기 제거 — 통합 sceneKey 라 의미 없음.
  const summary = selectedEpisode && selectedPart && selectedScene
    ? `${getEpisodeDisplayName(selectedEpisode)} / ${selectedPart.partId} / #${selectedScene.no}`
    : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/50"
      onMouseDown={(e) => {
        // 백드롭 클릭 → 닫기 (모달 본체 클릭은 stopPropagation 으로 보호)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-bg-card border border-bg-border/60 rounded-2xl w-[640px] max-h-[88vh] overflow-y-auto shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-bg-border/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-accent" strokeWidth={2.4} />
            <span className="text-sm font-bold text-text-primary">새 리비전 등록</span>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary text-xl leading-none cursor-pointer w-7 h-7 flex items-center justify-center rounded hover:bg-bg-primary/40"
            title="닫기 (Esc)"
          >
            ×
          </button>
        </div>

        {/* 단계 인디케이터 */}
        <div className="px-5 py-3 border-b border-bg-border/40 flex items-center gap-2 bg-bg-primary/30">
          {([1, 2, 3, 4] as const).map((n, idx) => {
            const isDone = (n === 1 && stepStates.ep)
              || (n === 2 && stepStates.part)
              || (n === 3 && stepStates.scene)
              || (n === 4 && stepStates.content);
            const isActive = n === currentStepNumber;
            const dotClass = isActive
              ? 'bg-accent border-accent text-white'
              : isDone
                ? 'border-accent/60 text-accent-sub'
                : 'border-bg-border/50 text-text-secondary bg-bg-primary';
            const dotStyle = !isActive && isDone
              ? { backgroundColor: 'rgb(var(--color-accent) / 0.25)' }
              : undefined;
            return (
              <div key={n} className="flex items-center gap-2 flex-1 last:flex-none">
                <span
                  className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-[11px] font-bold border ${dotClass}`}
                  style={dotStyle}
                >
                  {isDone && !isActive ? '✓' : n}
                </span>
                {idx < 3 && (
                  <span
                    className="flex-1 h-px"
                    style={{
                      backgroundColor: isDone
                        ? 'rgb(var(--color-accent) / 0.5)'
                        : 'rgb(var(--color-bg-border) / 0.4)',
                    }}
                  />
                )}
              </div>
            );
          })}
          <span className="text-[11px] text-text-secondary ml-3">
            {currentStepNumber === 1 ? '에피소드 선택'
              : currentStepNumber === 2 ? '파트 선택'
              : currentStepNumber === 3 ? '씬 선택'
              : '내용 작성'}
          </span>
        </div>

        {/* 본문 */}
        <div className="p-5 space-y-4">
          {/* 1. 에피소드 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                1. 에피소드
              </label>
              {selectedEpisode && (
                <span className="text-[11px] text-accent-sub">
                  {getEpisodeDisplayName(selectedEpisode)} ✓
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {episodes.length === 0 ? (
                <span className="text-[11px] text-text-secondary/60">에피소드 없음</span>
              ) : (
                episodes.map((ep) => {
                  const active = ep.episodeNumber === selectedEpisodeNumber;
                  return (
                    <button
                      key={ep.episodeNumber}
                      onClick={() => handleEpisodeSelect(ep.episodeNumber)}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border transition-colors cursor-pointer ${
                        active
                          ? 'bg-accent border-accent text-white'
                          : 'bg-bg-primary/50 border-bg-border/50 text-text-secondary hover:text-text-primary hover:border-accent/50'
                      }`}
                    >
                      {getEpisodeDisplayName(ep)}
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* 2. 파트 — v1.19.6: 부서(BG/ACT) 노출 제거. 같은 partId 의 BG/ACT 두 sheet 가 있으면 BG 우선 채택. */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                2. 파트
              </label>
              {selectedPart && (
                <span className="text-[11px] text-accent-sub">{selectedPart.partId} ✓</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {!selectedEpisode ? (
                <span className="text-[11px] text-text-secondary/60">먼저 에피소드를 선택하세요</span>
              ) : partLabels.length === 0 ? (
                <span className="text-[11px] text-text-secondary/60">파트가 없습니다</span>
              ) : (
                partLabels.map(({ partId, part }) => {
                  const active = part.sheetName === selectedSheetName;
                  return (
                    <button
                      key={partId}
                      onClick={() => handlePartSelect(part.sheetName)}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border transition-colors cursor-pointer ${
                        active
                          ? 'bg-accent border-accent text-white'
                          : 'bg-bg-primary/50 border-bg-border/50 text-text-secondary hover:text-text-primary hover:border-accent/50'
                      }`}
                    >
                      {partId}
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* 3. 씬 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                3. 씬
              </label>
              {selectedScene ? (
                <span className="text-[11px] text-accent-sub">
                  {selectedPart?.partId} {selectedScene.no} ✓
                </span>
              ) : (
                <span className="text-[11px] text-text-secondary/50">검색해서 선택하세요</span>
              )}
            </div>

            {!selectedPart ? (
              <span className="text-[11px] text-text-secondary/60">먼저 파트를 선택하세요</span>
            ) : selectedScene ? (
              // 선택됨 상태 — 칩으로 표시
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-accent/40 bg-bg-primary/40">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-bold text-text-primary"
                    style={{ backgroundColor: 'rgb(var(--color-accent) / 0.2)' }}
                  >
                    {selectedPart.partId} {selectedScene.no}
                  </span>
                  <span className="text-[12px] text-text-primary truncate">
                    {selectedScene.memo || '메모 없음'}
                  </span>
                  {(() => {
                    const sceneKey = buildSceneKey(selectedPart.sheetName, selectedScene.sceneId, {
                      siblingSceneIds: selectedPart.scenes.map((s) => s.sceneId),
                    });
                    const open = getOpenCount(sceneKey);
                    if (open <= 0) return null;
                    return (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-white font-bold shrink-0">
                        미해결 {open}
                      </span>
                    );
                  })()}
                </div>
                <button
                  onClick={handleSceneClear}
                  className="text-text-secondary hover:text-text-primary text-base leading-none px-1 cursor-pointer"
                  title="다른 씬 선택"
                >
                  ×
                </button>
              </div>
            ) : (
              // 검색 중 상태
              <div className="relative" ref={dropdownContainerRef}>
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary/50 pointer-events-none" />
                <input
                  ref={sceneInputRef}
                  type="text"
                  value={sceneSearchQuery}
                  onChange={(e) => {
                    setSceneSearchQuery(e.target.value);
                    setSceneDropdownOpen(true);
                  }}
                  onFocus={() => setSceneDropdownOpen(true)}
                  placeholder="씬 검색 (예: 1, a001, 색감)..."
                  className="w-full pl-9 pr-3 py-2.5 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/70"
                />
                {sceneDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 max-h-[280px] overflow-y-auto bg-bg-card border border-bg-border/60 rounded-lg p-1 shadow-lg z-10">
                    {filteredScenes.length === 0 ? (
                      <div className="px-3 py-2 text-[11px] text-text-secondary/50">검색 결과 없음</div>
                    ) : (
                      filteredScenes.map((scene) => {
                        const sceneKey = buildSceneKey(selectedPart.sheetName, scene.sceneId, {
                          siblingSceneIds: selectedPart.scenes.map((s) => s.sceneId),
                        });
                        const openCount = getOpenCount(sceneKey);
                        return (
                          <button
                            key={scene.sceneId || scene.id || `${scene.no}`}
                            onClick={() => handleSceneSelect(scene)}
                            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left hover:bg-bg-primary/60 transition-colors cursor-pointer"
                          >
                            <span className="text-[11px] font-mono font-bold text-text-primary w-12 shrink-0">
                              {selectedPart.partId} {scene.no}
                            </span>
                            <span
                              className={`text-[11px] truncate flex-1 ${
                                scene.memo ? 'text-text-secondary' : 'text-text-secondary/50'
                              }`}
                            >
                              {scene.memo || '—'}
                            </span>
                            {openCount > 0 && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-accent text-white font-bold shrink-0">
                                {openCount}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 4. 내용 */}
          <section className="border-t border-bg-border/40 pt-4 space-y-3">
            <div className="flex items-baseline gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                4. 내용
              </label>
              {summary && (
                <span className="text-[11px] text-accent-sub">{summary} 에 추가</span>
              )}
            </div>

            <textarea
              ref={textareaRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onPaste={handlePaste}
              placeholder="어떤 부분을 수정해야 하는지, 또는 무엇이 변경되었는지 적어주세요."
              className="w-full px-3 py-2.5 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/70 resize-y min-h-[88px] leading-relaxed"
            />

            {imagePreview && (
              <div className="relative w-fit">
                <img
                  src={imagePreview}
                  alt="첨부 이미지 미리보기"
                  className="rounded-lg max-h-32 border border-bg-border/40"
                />
                <button
                  onClick={() => setImagePreview(null)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer hover:bg-red-400"
                  title="이미지 제거"
                >
                  <X size={10} />
                </button>
              </div>
            )}

            <div className="flex items-center gap-3">
              <label
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-bg-border/40 cursor-pointer hover:border-accent/40 text-[12px] text-text-secondary transition-colors"
              >
                <ImagePlus size={14} />
                이미지 첨부
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageFile(file);
                    e.target.value = '';
                  }}
                />
              </label>
              <span className="text-[11px] text-text-secondary/50">또는 본문에 Ctrl+V</span>
            </div>

            {/* 알림 받을 사람 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                    알림 받을 사람
                  </span>
                  <span className="text-[10px] text-text-secondary/50 normal-case font-normal">
                    자동 체크: 컴포지터 + 그 씬 담당자
                  </span>
                </div>
              </div>
              {currentUser ? (
                <RevisionRecipientPicker
                  allUsers={allUsers}
                  defaultCheckedIds={defaultRecipients}
                  excludeUserId={currentUser.id}
                  onChange={setNotifyIds}
                />
              ) : (
                <span className="text-[11px] text-text-secondary/50">로그인 정보를 확인할 수 없습니다.</span>
              )}
              <div className="text-[10px] text-text-secondary/50 mt-1.5">
                자동 체크된 사람도 클릭으로 해제할 수 있어요.
              </div>
            </div>
          </section>
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 border-t border-bg-border/40 flex items-center justify-between bg-bg-primary/30 rounded-b-2xl sticky bottom-0">
          <div className="text-[11px] text-text-secondary/70">
            등록자: {currentUser?.name ?? '—'} · 등록 즉시 알림 전송
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-semibold rounded-md text-text-secondary hover:text-text-primary cursor-pointer"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-4 py-1.5 text-xs font-bold rounded-md bg-accent text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? '등록 중...' : '리비전 등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
