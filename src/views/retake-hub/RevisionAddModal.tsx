/**
 * RevisionAddModal — 리테이크 허브 세트 상세 '항목 추가' 모달 (5단계 후속).
 *
 * 누구나 세트에 새 리비전 항목을 만든다. 대상 토글:
 *   - 씬 지정: 에피소드(세트 고정 또는 선택) → 파트 → 씬 → scene_id 채운 항목.
 *   - 전반: 씬 미지정 → scene_id 없는 항목(허브 '전반' 그룹에만 표시).
 * 내용 = EntityAwareInput(@멘션·#씬태그) + 이미지 첨부. 담당/알림 = RevisionRecipientPicker(담당 승격).
 * 생성 = useRevisionStore.createRevision({ sceneKey, setId, ... }) — setId = 현재 세트.
 * 부서(BG/ACT)는 노출하지 않는다. 셸은 허브 모달(RevisionSetCreateModal) 패턴(createPortal + motion).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ClipboardList, ImagePlus, X } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import type { AppUser, CompRevisionSet, Episode, Part, Scene } from '@/types';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { buildSceneKey } from '@/services/revisionService';
import { calcDefaultRecipients } from '@/utils/revisionRecipients';
import { resizeBlob } from '@/utils/imageUtils';
import { stripEntityTokens } from '@/utils/entityTokens';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';
import { RevisionRecipientPicker } from '@/components/scenes/RevisionRecipientPicker';
import {
  buildRevisionPartOptions,
  buildRevisionPartScenesUnion,
  formatRevisionPartId,
  getSourcePartForRevisionScene,
} from '@/views/compositing/newRevisionOptions';

interface Props {
  targetSet: CompRevisionSet;
  episodes: Episode[];
  episodeTitles: Record<number, string>;
  allUsers: AppUser[];
  currentUser: AppUser | null;
  onClose: () => void;
}

type Mode = 'scene' | 'general';

export function RevisionAddModal({ targetSet, episodes, episodeTitles, allUsers, currentUser, onClose }: Props) {
  const createRevision = useRevisionStore((s) => s.createRevision);

  const fixedEpisodeNumber = targetSet.episodeNumber ?? null;
  const [mode, setMode] = useState<Mode>('scene');
  const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState<number | null>(fixedEpisodeNumber);
  const [selectedSheetName, setSelectedSheetName] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [description, setDescription] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [notifyIds, setNotifyIds] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedEpisode: Episode | null = useMemo(() => {
    if (selectedEpisodeNumber == null) return null;
    return episodes.find((ep) => ep.episodeNumber === selectedEpisodeNumber) ?? null;
  }, [episodes, selectedEpisodeNumber]);

  const partLabels = useMemo(() => buildRevisionPartOptions(selectedEpisode), [selectedEpisode]);

  const selectedPart: Part | null = useMemo(() => {
    if (!selectedEpisode || !selectedSheetName) return null;
    return selectedEpisode.parts.find((p) => p.sheetName === selectedSheetName) ?? null;
  }, [selectedEpisode, selectedSheetName]);

  const selectedPartLabel = selectedPart ? formatRevisionPartId(selectedPart.partId) : '';

  const partScenesUnion = useMemo(
    () => buildRevisionPartScenesUnion(selectedEpisode, selectedPart),
    [selectedEpisode, selectedPart],
  );

  const scenes = useMemo(
    () => partScenesUnion.scenes.slice().sort((a, b) => a.no - b.no),
    [partScenesUnion.scenes],
  );

  const episodeOptions = useMemo(
    () => [...episodes]
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((e) => ({
        num: e.episodeNumber,
        label: episodeTitles[e.episodeNumber] || e.title || `EP.${String(e.episodeNumber).padStart(2, '0')}`,
      })),
    [episodes, episodeTitles],
  );

  const episodeLocked = fixedEpisodeNumber != null;
  const episodeLabel = selectedEpisode
    ? (episodeTitles[selectedEpisode.episodeNumber] || selectedEpisode.title
      || `EP.${String(selectedEpisode.episodeNumber).padStart(2, '0')}`)
    : null;

  const defaultRecipients = useMemo(() => {
    if (!currentUser) return [] as string[];
    return calcDefaultRecipients(
      mode === 'scene' && selectedScene ? { assignee: selectedScene.assignee } : null,
      allUsers,
      currentUser.id,
    );
  }, [mode, selectedScene, allUsers, currentUser]);

  const canSubmit = !!currentUser && description.trim().length > 0 && !submitting
    && (mode === 'general' || !!selectedScene);

  // 에피소드 미고정 + 단일 에피소드면 자동 선택.
  useEffect(() => {
    if (episodeLocked) return;
    if (selectedEpisodeNumber == null && episodes.length === 1) {
      setSelectedEpisodeNumber(episodes[0].episodeNumber);
    }
  }, [episodeLocked, episodes, selectedEpisodeNumber]);

  // ESC → 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleImageFile = async (file: File) => {
    try { setImagePreview(await resizeBlob(file, 800, 0.8)); } catch { /* 무시 */ }
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
    if (!canSubmit || !currentUser) return;
    setSubmitting(true);
    try {
      if (mode === 'scene') {
        if (!selectedPart || !selectedScene) { setSubmitting(false); return; }
        const sourcePart = getSourcePartForRevisionScene(
          partScenesUnion.sourceMap, selectedScene.sceneId, selectedPart,
        );
        const sceneKey = buildSceneKey(sourcePart.sheetName, selectedScene.sceneId, {
          siblingSceneIds: sourcePart.scenes.map((s) => s.sceneId),
        });
        const department = sourcePart.department === 'bg' ? 'bg' : 'acting';
        await createRevision({
          sceneKey,
          setId: targetSet.id,
          description: description.trim(),
          imageUrl: imagePreview || undefined,
          department,
          lookupDepartment: department,
          requesterId: currentUser.id,
          requesterName: currentUser.name,
          notifyUserIds: notifyIds,
          assigneeIds,
        });
      } else {
        await createRevision({
          setId: targetSet.id,
          description: description.trim(),
          imageUrl: imagePreview || undefined,
          requesterId: currentUser.id,
          requesterName: currentUser.name,
          notifyUserIds: notifyIds,
          assigneeIds,
        });
      }
      sonnerToast.success('세트에 항목을 추가했어요.');
      onClose();
    } catch (err) {
      console.error('[RevisionAddModal] 항목 추가 실패:', err);
      sonnerToast.error('항목을 추가하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-md max-h-[86vh] flex flex-col rounded-2xl border border-bg-border bg-bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border/60 shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardList size={18} className="text-accent" />
            <span className="text-[15px] font-bold text-text-primary">세트에 항목 추가</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
            title="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* 대상 토글 */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">대상</label>
            <div className="flex bg-bg-primary/60 border border-bg-border/60 rounded-lg p-0.5">
              {([['scene', '씬 지정'], ['general', '전반 (대상 씬 없음)']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 text-[12px] font-semibold py-1.5 rounded-md transition-colors cursor-pointer ${
                    mode === m ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === 'general' && (
              <p className="mt-1.5 text-[11px] text-text-secondary/70">
                특정 씬에 매이지 않고 허브 ‘전반’ 그룹에만 표시됩니다.
              </p>
            )}
          </div>

          {/* 씬 지정 — 에피소드/파트/씬 */}
          {mode === 'scene' && (
            <>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">에피소드</label>
                {episodeLocked ? (
                  <>
                    <div className="px-3 py-2 text-[13px] bg-bg-primary/50 border border-bg-border/60 rounded-lg text-text-secondary flex items-center gap-2">
                      {episodeLabel ?? '—'}
                      <span className="text-[10px] text-text-secondary/50">세트 고정</span>
                    </div>
                    {!selectedEpisode && (
                      <p className="mt-1.5 text-[11px] text-amber-400/90">
                        이 세트의 화를 지금 화면에서 찾을 수 없어 씬을 고를 수 없어요. ‘전반’으로 추가해주세요.
                      </p>
                    )}
                  </>
                ) : (
                  <select
                    value={selectedEpisodeNumber ?? ''}
                    onChange={(e) => {
                      setSelectedEpisodeNumber(e.target.value === '' ? null : Number(e.target.value));
                      setSelectedSheetName(null);
                      setSelectedScene(null);
                    }}
                    className="w-full px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary focus:outline-none focus:border-accent/60 cursor-pointer"
                  >
                    <option value="">에피소드 선택</option>
                    {episodeOptions.map((o) => <option key={o.num} value={o.num}>{o.label}</option>)}
                  </select>
                )}
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">파트</label>
                <select
                  value={selectedSheetName ?? ''}
                  disabled={!selectedEpisode}
                  onChange={(e) => { setSelectedSheetName(e.target.value || null); setSelectedScene(null); }}
                  className="w-full px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary focus:outline-none focus:border-accent/60 cursor-pointer disabled:opacity-40"
                >
                  <option value="">{selectedEpisode ? '파트 선택' : '먼저 에피소드 선택'}</option>
                  {partLabels.map(({ partId, part }) => <option key={partId} value={part.sheetName}>{partId}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">씬</label>
                <select
                  value={selectedScene?.sceneId ?? ''}
                  disabled={!selectedPart}
                  onChange={(e) => setSelectedScene(scenes.find((s) => s.sceneId === e.target.value) ?? null)}
                  className="w-full px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary focus:outline-none focus:border-accent/60 cursor-pointer disabled:opacity-40"
                >
                  <option value="">{selectedPart ? '씬 선택' : '먼저 파트 선택'}</option>
                  {scenes.map((s) => (
                    <option key={s.sceneId || s.id || s.no} value={s.sceneId}>
                      {selectedPartLabel} {s.no}{s.memo ? ` · ${stripEntityTokens(s.memo).slice(0, 18)}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* 내용 */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">내용</label>
            <EntityAwareInput
              multiline
              rows={3}
              value={description}
              onChange={setDescription}
              users={allUsers}
              enableHashtag
              onPaste={handlePaste}
              dropdownPositionClassName="left-2 right-2"
              placeholder="수정 내용을 적어주세요. (@이름 멘션, #씬 태그)"
              className="w-full px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary placeholder:text-text-secondary/50 resize-y focus:outline-none focus:border-accent/60"
            />
            {imagePreview && (
              <div className="relative w-fit mt-2">
                <img src={imagePreview} alt="첨부 미리보기" className="rounded-lg max-h-24 border border-bg-border/40" />
                <button
                  type="button"
                  onClick={() => setImagePreview(null)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer hover:bg-red-400"
                  title="이미지 제거"
                >
                  <X size={10} />
                </button>
              </div>
            )}
            <label className="inline-flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-lg border border-bg-border/40 cursor-pointer hover:border-accent/40 text-[11px] text-text-secondary transition-colors">
              <ImagePlus size={13} /> 이미지 첨부 · 붙여넣기
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }}
              />
            </label>
          </div>

          {/* 담당·알림 */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">담당 · 알림 지정</label>
            {currentUser ? (
              <RevisionRecipientPicker
                allUsers={allUsers}
                defaultCheckedIds={defaultRecipients}
                excludeUserId={currentUser.id}
                onChange={setNotifyIds}
                enableAssignee
                onAssigneesChange={setAssigneeIds}
              />
            ) : (
              <span className="text-[11px] text-text-secondary/50">로그인 정보를 확인할 수 없습니다.</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-bg-border/60 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-1.5 text-xs font-bold rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
          >
            {submitting ? '만드는 중…' : '만들기'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
