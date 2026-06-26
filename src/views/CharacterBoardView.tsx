/**
 * 캐릭터 현황판.
 *
 * - 캐릭터 카드 그리드(이름 검색 + 태그 AND 필터) + 에피소드 에셋 탭.
 * - 카드 클릭 → 전체화면급 오버레이 모달: 좌측 캐릭터 목록 / 우측 상세(마스터-디테일).
 *   상세 = 큰 대표 이미지(클릭=크게보기, 별도 버튼으로 교체) + 복장명·메모 + 복장 썸네일 갤러리
 *          + 버전·담당자 + 디자인/리깅 단계 레일 + 구조/에셋 태그(태그별 고유색).
 *
 * 모든 변경은 낙관적 업데이트 + 실시간 동기화 (useCharacterBoardStore).
 * 접근 권한은 사이드바에서 게이팅 (useCharacterBoardAccess).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus, X, Image as ImageIcon, Trash2, Pencil, Search, User, Check, Maximize2, Upload } from 'lucide-react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { useDataStore } from '@/stores/useDataStore';
import {
  COSTUME_DESIGN_STAGES,
  COSTUME_RIGGING_STAGES,
  type Character,
  type CharacterCostume,
  type CostumeDesignStage,
  type CostumeRiggingStage,
} from '@/types';
import { uploadCharacterImage } from '@/services/supabaseService';
import { deleteImage } from '@/services/storageService';
import { resizeBlob } from '@/utils/imageUtils';
import { cn } from '@/utils/cn';
import { EpisodeAssetBoard } from './EpisodeAssetBoard';
import { tagColor } from '@/utils/tagColor';
import { CommentPanel } from '@/components/scenes/CommentPanel';
import { CommentPanelErrorBoundary } from '@/components/common/CommentPanelErrorBoundary';

type BoardTab = 'board' | 'episode-assets';

// 단계별 색 (씬 단계색 재사용):
//   대기 #8B8DA3 / 진행·벡터화 #74B9FF / 리깅 #6C5CE7 / 피드백 #FDCB6E / 완료 #A29BFE / 완성 #00B894
const DESIGN_STAGE_META: Record<CostumeDesignStage, { label: string; color: string }> = {
  waiting: { label: '대기', color: '#8B8DA3' },
  in_progress: { label: '진행 중', color: '#74B9FF' },
  feedback: { label: '피드백', color: '#FDCB6E' },
  done: { label: '완료', color: '#A29BFE' },
};
const RIGGING_STAGE_META: Record<CostumeRiggingStage, { label: string; color: string }> = {
  waiting: { label: '대기', color: '#8B8DA3' },
  vectorized: { label: '벡터화', color: '#74B9FF' },
  rigging: { label: '리깅', color: '#6C5CE7' },
  feedback: { label: '피드백', color: '#FDCB6E' },
  done: { label: '완성', color: '#00B894' },
};

// 미리 정의된 태그 팔레트 — 토글 칩으로 노출.
const STRUCTURE_TAG_PALETTE = ['얼굴각도 컨트롤러', '책가방 세트', '뒷모습', '앞모습 없음', '측면'] as const;
const ASSET_TAG_PALETTE = ['담배', '핸드폰', '가방', '안경', '모자'] as const;

/** 태그별 고유색 토글 칩. on 이면 색 채움(틴트), off 면 회색 + 색 점. */
function TagPill({
  tag,
  on,
  onClick,
}: {
  tag: string;
  on: boolean;
  onClick: () => void;
}) {
  const c = tagColor(tag);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="px-2.5 py-1 rounded-full text-xs border flex items-center gap-1.5 transition-all duration-150 cursor-pointer"
      style={
        on
          ? { background: `${c}26`, borderColor: `${c}99`, color: c }
          : { background: 'transparent', borderColor: 'rgb(var(--color-bg-border))', color: 'rgb(var(--color-text-secondary))' }
      }
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c, opacity: on ? 1 : 0.55 }} />
      {tag}
    </button>
  );
}

// ─── 단계 레일 ──────────────────────────────────
// 채움형 스텝 레일: 지난 단계=채운 점(체크), 현재=색 강조+글로우, 이후=빈 점. 클릭으로 설정.
function StageRail<T extends string>({
  label,
  stages,
  meta,
  current,
  onSelect,
}: {
  label: string;
  stages: readonly T[];
  meta: Record<T, { label: string; color: string }>;
  current: T;
  onSelect: (s: T) => void;
}) {
  const curIdx = Math.max(0, stages.indexOf(current));
  const curColor = meta[current].color;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">{label}</span>
        <span className="text-xs font-medium" style={{ color: curColor }}>{meta[current].label}</span>
      </div>
      <div className="flex items-start">
        {stages.map((s, i) => {
          const m = meta[s];
          const passed = i < curIdx;
          const isCur = i === curIdx;
          const reached = i <= curIdx;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onSelect(s)}
              aria-label={`${label} ${m.label}`}
              aria-pressed={isCur}
              className="group relative flex-1 flex flex-col items-center gap-1.5 cursor-pointer"
            >
              {/* 연결선 (이전 노드 → 이 노드) */}
              {i > 0 && (
                <span
                  aria-hidden
                  className="absolute top-[9px] h-[2px] -z-0"
                  style={{
                    left: '-50%',
                    width: '100%',
                    background: reached ? meta[stages[i - 1]].color : 'rgb(var(--color-bg-border))',
                  }}
                />
              )}
              {/* 노드 */}
              <span
                className="relative z-[1] w-[18px] h-[18px] rounded-full flex items-center justify-center transition-all duration-200"
                style={{
                  background: reached ? m.color : 'rgb(var(--color-bg-card))',
                  border: `2px solid ${reached ? m.color : 'rgb(var(--color-bg-border))'}`,
                  boxShadow: isCur ? `0 0 0 4px ${m.color}33` : 'none',
                }}
              >
                {passed && <Check size={10} className="text-white" strokeWidth={3} />}
                {isCur && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              <span
                className="text-[11px] leading-tight text-center transition-colors"
                style={{ color: isCur ? m.color : reached ? 'rgb(var(--color-text-secondary))' : 'rgb(var(--color-text-secondary) / 0.5)' }}
              >
                {m.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CharacterCard({
  character,
  costumes,
  onOpen,
}: {
  character: Character;
  costumes: CharacterCostume[];
  onOpen: () => void;
}) {
  const featured = costumes.find((c) => c.featuredImageUrl)?.featuredImageUrl ?? null;
  const designDone = costumes.filter((c) => c.designStage === 'done').length;
  const riggingDone = costumes.filter((c) => c.riggingStage === 'done').length;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left bg-bg-card border border-bg-border rounded-xl overflow-hidden hover:border-accent/50 transition-colors duration-200 flex flex-col cursor-pointer"
    >
      <div className="aspect-[4/3] bg-bg-border/30 flex items-center justify-center overflow-hidden">
        {featured ? (
          <img src={featured} alt={character.name} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon size={28} className="text-text-secondary/40" />
        )}
      </div>
      <div className="p-3 flex flex-col gap-2">
        <div className="font-semibold text-text-primary truncate">{character.name}</div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span>복장 {costumes.length}</span>
          {character.episodeIds.length > 0 && (
            <span className="text-text-secondary/70">· EP {character.episodeIds.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="px-1.5 py-0.5 rounded-md" style={{ backgroundColor: '#A29BFE22', color: '#A29BFE' }}>
            디자인 {designDone}/{costumes.length}
          </span>
          <span className="px-1.5 py-0.5 rounded-md" style={{ backgroundColor: '#00B89422', color: '#00B894' }}>
            리깅 {riggingDone}/{costumes.length}
          </span>
        </div>
      </div>
    </button>
  );
}

/** 미리 정의된 토글 칩(태그별 고유색) + 자유 추가. */
function TagChipSection({
  label,
  palette,
  tags,
  onChange,
}: {
  label: string;
  palette: readonly string[];
  tags: string[];
  onChange: (next: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const chips = useMemo(() => {
    const extra = tags.filter((t) => !palette.includes(t));
    return [...palette, ...extra];
  }, [palette, tags]);

  const toggle = (tag: string) => {
    if (tags.includes(tag)) onChange(tags.filter((t) => t !== tag));
    else onChange([...tags, tag]);
  };

  const addCustom = () => {
    const t = input.trim();
    if (!t || tags.includes(t)) { setInput(''); return; }
    onChange([...tags, t]);
    setInput('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((tag) => (
          <TagPill key={tag} tag={tag} on={tags.includes(tag)} onClick={() => toggle(tag)} />
        ))}
        <div className="flex items-center gap-1">
          <Plus size={12} className="text-text-secondary/60" aria-hidden />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
            onBlur={addCustom}
            placeholder="직접 추가"
            aria-label={`${label} 직접 추가`}
            className="bg-transparent border border-bg-border rounded-full px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/50 w-20"
          />
        </div>
      </div>
    </div>
  );
}

/** 이미지 크게 보기 라이트박스. */
function ImageLightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-8 cursor-zoom-out"
      onClick={onClose}
    >
      <img src={url} alt={alt} className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute top-5 right-5 text-white/80 hover:text-white cursor-pointer"
      >
        <X size={24} />
      </button>
    </div>
  );
}

/** 큰 대표 이미지 — 클릭=크게보기, 아래 별도 버튼으로 교체/추가. */
function FeaturedImageSlot({
  character,
  costume,
  shownUrl,
  onView,
}: {
  character: Character;
  costume: CharacterCostume | null;
  shownUrl: string | null;
  onView: (url: string) => void;
}) {
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback(async (file: File) => {
    if (!costume) { toast.error('먼저 디자인(복장)을 추가해주세요'); return; }
    setUploading(true);
    try {
      const base64 = await resizeBlob(file, 800, 0.8);
      const res = await uploadCharacterImage(character.id, costume.id, base64);
      if (!res.ok || !res.url) throw new Error(res.error ?? '업로드 실패');
      // 이전 대표 이미지 정리는 서버(updateCharacterCostume)가 DB 업데이트 성공 후 처리 — 롤백 시 깨진 URL 방지.
      await updateCostumeField(costume.id, { featuredImageUrl: res.url });
      // 업로드는 됐는데 DB 반영이 실패(롤백)하면 방금 올린 파일이 고아가 됨 → 정리.
      const saved = useCharacterBoardStore.getState().costumes.find((c) => c.id === costume.id)?.featuredImageUrl;
      if (saved !== res.url) {
        deleteImage(res.url).catch((e) => console.warn('[character-board] 실패한 업로드 정리:', e));
      }
    } catch (err) {
      console.error('[character-board] 이미지 업로드 실패:', err);
      toast.error('이미지 업로드에 실패했어요');
    } finally {
      setUploading(false);
    }
  }, [character.id, costume, updateCostumeField]);

  return (
    <div className="w-[240px] shrink-0 flex flex-col gap-2">
      <div
        role={shownUrl ? 'button' : undefined}
        tabIndex={shownUrl ? 0 : undefined}
        aria-label={shownUrl ? '대표 이미지 크게 보기' : undefined}
        className={cn(
          'group relative aspect-[3/4] w-full rounded-xl bg-bg-border/30 border border-bg-border overflow-hidden flex items-center justify-center',
          shownUrl ? 'cursor-zoom-in hover:border-accent/50 transition-colors' : '',
        )}
        onClick={() => { if (shownUrl) onView(shownUrl); }}
        onKeyDown={(e) => { if (shownUrl && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onView(shownUrl); } }}
      >
        {shownUrl ? (
          <>
            <img src={shownUrl} alt={costume?.name ?? character.name} className="w-full h-full object-contain" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <Maximize2 size={20} className="text-white/90" />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-text-secondary/50">
            <ImageIcon size={28} />
            <span className="text-[11px]">이미지 없음</span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-bg-border text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50 transition-colors cursor-pointer disabled:opacity-50"
      >
        <Upload size={13} />
        {uploading ? '업로드 중…' : shownUrl ? '이미지 바꾸기' : '이미지 추가'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
      />
    </div>
  );
}

/** 복장 메모 — 키 입력마다 저장 말고 blur 때 한 번만(동시 쓰기 경합·텍스트 유실 방지). */
function CostumeMemoInput({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; if (draft !== value) onCommit(draft); }}
      placeholder="이 디자인 메모…"
      aria-label="디자인 메모"
      rows={3}
      className="w-full bg-bg-border/20 border border-bg-border rounded-lg px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent/50 resize-none leading-relaxed"
    />
  );
}

/** 담당자 — 키 입력마다 저장 말고 blur/Enter 때 한 번만(동시 쓰기 경합·이름 잘림 방지). */
function CostumeAssigneeInput({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="담당자"
      aria-label="담당자"
      className="bg-transparent border border-bg-border rounded-md px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50 w-44"
    />
  );
}

/** 이미지 아래 — 이 복장이 무슨 디자인인지(이름, 편집 가능) + 디자인별 메모. */
function CostumeIdentity({ costume }: { costume: CharacterCostume }) {
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(costume.name);

  useEffect(() => { setEditing(false); setDraft(costume.name); }, [costume.id, costume.name]);

  return (
    <div className="w-[240px] shrink-0 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); const t = draft.trim(); if (t && t !== costume.name) updateCostumeField(costume.id, { name: t }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(costume.name); setEditing(false); } }}
            aria-label="복장 이름"
            className="flex-1 min-w-0 bg-transparent border border-accent/50 rounded-md px-1.5 py-0.5 text-sm font-medium text-text-primary outline-none"
          />
        ) : (
          <>
            <span className="text-sm font-medium text-text-primary truncate">{costume.name}</span>
            <span className="text-[11px] text-text-secondary/70 shrink-0">v{costume.versionNo}</span>
            <button
              type="button"
              aria-label="복장 이름 편집"
              onClick={() => { setDraft(costume.name); setEditing(true); }}
              className="text-text-secondary/70 hover:text-text-primary cursor-pointer shrink-0"
            >
              <Pencil size={12} />
            </button>
          </>
        )}
      </div>
      <CostumeMemoInput
        value={costume.memo ?? ''}
        onCommit={(next) => updateCostumeField(costume.id, { memo: next.trim() ? next : null })}
      />
    </div>
  );
}

/** 선택 복장의 진행 상세 — 버전·담당자·단계 레일·태그. */
function CostumeDetail({ costume }: { costume: CharacterCostume }) {
  const updateCostumeStage = useCharacterBoardStore((s) => s.updateCostumeStage);
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const setCostumeTags = useCharacterBoardStore((s) => s.setCostumeTags);
  const setVersion = useCharacterBoardStore((s) => s.setVersion);

  return (
    <div className="flex flex-col gap-5">
      {/* 버전 + 담당자 */}
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-text-secondary">버전</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="버전 내리기"
              className="w-7 h-7 rounded-md border border-bg-border text-text-primary hover:bg-bg-border/40 cursor-pointer"
              onClick={() => setVersion(costume.id, Math.max(1, Math.floor(costume.versionNo) - 1))}
            >
              −
            </button>
            <input
              type="number"
              min={1}
              value={costume.versionNo}
              aria-label="버전 번호"
              onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 1) setVersion(costume.id, Math.floor(n)); }}
              className="w-14 text-center bg-transparent border border-bg-border rounded-md px-1 py-1 text-text-primary outline-none focus:border-accent/50"
            />
            <button
              type="button"
              aria-label="버전 올리기"
              className="w-7 h-7 rounded-md border border-bg-border text-text-primary hover:bg-bg-border/40 cursor-pointer"
              onClick={() => setVersion(costume.id, Math.floor(costume.versionNo) + 1)}
            >
              +
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-text-secondary">담당자</div>
          <CostumeAssigneeInput
            value={costume.assignee ?? ''}
            onCommit={(next) => updateCostumeField(costume.id, { assignee: next.trim() ? next : null })}
          />
        </div>
      </div>

      {/* 단계 레일 */}
      <div className="flex flex-col gap-5 rounded-xl border border-bg-border/60 bg-bg-border/10 p-4">
        <StageRail
          label="디자인 단계"
          stages={COSTUME_DESIGN_STAGES}
          meta={DESIGN_STAGE_META}
          current={costume.designStage}
          onSelect={(s) => updateCostumeStage(costume.id, 'design', s)}
        />
        <div className="h-px bg-bg-border/50" />
        <StageRail
          label="리깅 단계"
          stages={COSTUME_RIGGING_STAGES}
          meta={RIGGING_STAGE_META}
          current={costume.riggingStage}
          onSelect={(s) => updateCostumeStage(costume.id, 'rigging', s)}
        />
      </div>

      {/* 태그 */}
      <TagChipSection
        label="구조 태그"
        palette={STRUCTURE_TAG_PALETTE}
        tags={costume.structureTags}
        onChange={(next) => setCostumeTags(costume.id, 'structure', next)}
      />
      <TagChipSection
        label="에셋 태그"
        palette={ASSET_TAG_PALETTE}
        tags={costume.assetTags}
        onChange={(next) => setCostumeTags(costume.id, 'asset', next)}
      />
    </div>
  );
}

function riggingRatio(costumes: CharacterCostume[]): number {
  if (costumes.length === 0) return 0;
  return costumes.filter((c) => c.riggingStage === 'done').length / costumes.length;
}

function CharacterListRow({
  character,
  costumes,
  selected,
  onSelect,
}: {
  character: Character;
  costumes: CharacterCostume[];
  selected: boolean;
  onSelect: () => void;
}) {
  const thumb = costumes.find((c) => c.featuredImageUrl)?.featuredImageUrl ?? null;
  const ratio = riggingRatio(costumes);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-left border-l-2 transition-colors cursor-pointer',
        selected ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-bg-border/30',
      )}
    >
      <div className="w-8 h-8 rounded-md bg-bg-border/40 overflow-hidden flex items-center justify-center shrink-0">
        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <User size={15} className="text-text-secondary/50" />}
      </div>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className={cn('text-sm truncate', selected ? 'text-text-primary font-medium' : 'text-text-secondary')}>{character.name}</div>
        <div className="h-1 rounded-full bg-bg-border/60 overflow-hidden">
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: '#00B894' }} />
        </div>
      </div>
    </button>
  );
}

function CostumeThumbCard({
  costume,
  selected,
  onSelect,
  onDelete,
}: {
  costume: CharacterCostume;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      aria-pressed={selected}
      className={cn(
        'group relative w-[104px] shrink-0 flex flex-col rounded-lg overflow-hidden border transition-colors cursor-pointer',
        selected ? 'border-accent ring-1 ring-accent/40' : 'border-bg-border hover:border-text-secondary/50',
      )}
    >
      <div className="aspect-[3/4] w-full bg-bg-border/30 flex items-center justify-center overflow-hidden">
        {costume.featuredImageUrl ? (
          <img src={costume.featuredImageUrl} alt={costume.name} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon size={18} className="text-text-secondary/40" />
        )}
      </div>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 bg-bg-card">
        <span className={cn('text-xs truncate', selected ? 'text-text-primary' : 'text-text-secondary')}>{costume.name}</span>
        <span className="text-[10px] text-text-secondary/70 shrink-0">v{costume.versionNo}</span>
      </div>
      <span
        role="button"
        tabIndex={-1}
        aria-label={`${costume.name} 삭제`}
        onClick={(e) => { e.stopPropagation(); if (window.confirm(`'${costume.name}' 복장을 삭제할까요?`)) onDelete(); }}
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded-md bg-black/40 text-white/80 hover:text-[#FF6B6B] transition-opacity cursor-pointer"
      >
        <X size={12} />
      </span>
    </div>
  );
}

/** 우측 상세 패널. */
function CharacterDetailPanel({
  character,
  onClose,
}: {
  character: Character;
  onClose: () => void;
}) {
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const addCostume = useCharacterBoardStore((s) => s.addCostume);
  const deleteCostume = useCharacterBoardStore((s) => s.deleteCostume);
  const deleteCharacter = useCharacterBoardStore((s) => s.deleteCharacter);
  const renameCharacter = useCharacterBoardStore((s) => s.renameCharacter);
  const linkEpisode = useCharacterBoardStore((s) => s.linkEpisode);
  const unlinkEpisode = useCharacterBoardStore((s) => s.unlinkEpisode);
  const episodes = useDataStore((s) => s.episodes);
  const getEpisodeDisplayName = useDataStore((s) => s.getEpisodeDisplayName);

  const costumes = byCharacter.get(character.id) ?? [];
  const [activeCostumeId, setActiveCostumeId] = useState<string | null>(costumes[0]?.id ?? null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(character.name);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // 갤러리 휠 → 가로 스크롤.
  const galleryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = galleryRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (costumes.length === 0) { setActiveCostumeId(null); return; }
    if (!costumes.some((c) => c.id === activeCostumeId)) setActiveCostumeId(costumes[0].id);
  }, [costumes, activeCostumeId]);

  useEffect(() => { setEditingName(false); setNameDraft(character.name); }, [character.id, character.name]);

  const activeCostume = costumes.find((c) => c.id === activeCostumeId) ?? null;
  const fallbackImage = costumes.find((c) => c.featuredImageUrl)?.featuredImageUrl ?? null;
  const shownImage = activeCostume?.featuredImageUrl ?? fallbackImage;

  const handleAddCostume = async () => {
    // 중간 복장 삭제 후에도 UNIQUE(character_id, name) 충돌하지 않도록 안 쓰는 번호 생성.
    const used = new Set(costumes.map((c) => c.name));
    let n = costumes.length + 1;
    while (used.has(`복장 ${n}`)) n++;
    const created = await addCostume(character.id, `복장 ${n}`);
    if (created) setActiveCostumeId(created.id);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 헤더 (글래스) */}
      <div
        className="flex items-center justify-between gap-3 px-5 py-3 border-b border-bg-border/40 shrink-0"
        style={{ background: 'rgba(255,255,255,0.015)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => { setEditingName(false); if (nameDraft.trim() && nameDraft !== character.name) renameCharacter(character.id, nameDraft.trim()); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              aria-label="캐릭터 이름"
              className="bg-transparent border border-accent/50 rounded-md px-2 py-1 text-lg font-semibold text-text-primary outline-none"
            />
          ) : (
            <>
              <h2 className="text-lg font-semibold text-text-primary truncate">{character.name}</h2>
              <button type="button" aria-label="이름 편집" onClick={() => { setNameDraft(character.name); setEditingName(true); }} className="text-text-secondary hover:text-text-primary cursor-pointer">
                <Pencil size={14} />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => { if (window.confirm(`'${character.name}' 캐릭터를 삭제할까요? 복장도 함께 삭제됩니다.`)) deleteCharacter(character.id); }}
            className="text-text-secondary hover:text-[#FF6B6B] flex items-center gap-1 text-sm cursor-pointer"
          >
            <Trash2 size={14} /> 삭제
          </button>
          <button type="button" aria-label="닫기" onClick={onClose} className="text-text-secondary hover:text-text-primary cursor-pointer">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 본문 (스크롤) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        <div className="flex gap-6 flex-col lg:flex-row">
          {/* 좌측: 큰 이미지 + 복장명 + 메모 */}
          <div className="flex flex-col gap-3">
            <FeaturedImageSlot character={character} costume={activeCostume} shownUrl={shownImage} onView={(u) => setLightbox(u)} />
            {activeCostume && <CostumeIdentity costume={activeCostume} />}
          </div>

          {/* 우측: 에피소드 + 갤러리 + 진행 상세 */}
          <div className="flex flex-col gap-5 min-w-0 flex-1">
            {/* 출연 에피소드 */}
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-text-secondary">출연 에피소드</div>
              <div className="flex flex-wrap gap-1.5">
                {episodes.map((ep) => {
                  const linked = character.episodeIds.includes(ep.episodeNumber);
                  return (
                    <button
                      key={ep.episodeNumber}
                      type="button"
                      onClick={() => (linked ? unlinkEpisode(character.id, ep.episodeNumber) : linkEpisode(character.id, ep.episodeNumber))}
                      className={cn(
                        'px-2 py-0.5 rounded-md text-xs border transition-colors cursor-pointer',
                        linked ? 'bg-accent/20 text-accent border-accent/40' : 'text-text-secondary border-bg-border hover:text-text-primary',
                      )}
                    >
                      {getEpisodeDisplayName(ep)}
                    </button>
                  );
                })}
                {episodes.length === 0 && <span className="text-xs text-text-secondary/60">등록된 에피소드가 없어요</span>}
              </div>
            </div>

            {/* 복장 갤러리 */}
            <div className="flex flex-col gap-2">
              <div className="text-xs text-text-secondary">디자인 (복장)</div>
              <div ref={galleryRef} className="flex items-stretch gap-2.5 overflow-x-auto pb-1">
                {costumes.map((c) => (
                  <CostumeThumbCard
                    key={c.id}
                    costume={c}
                    selected={activeCostumeId === c.id}
                    onSelect={() => setActiveCostumeId(c.id)}
                    onDelete={() => deleteCostume(c.id)}
                  />
                ))}
                <button
                  type="button"
                  onClick={handleAddCostume}
                  aria-label="디자인 추가"
                  className="w-[104px] shrink-0 aspect-[3/4] flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-bg-border text-text-secondary hover:text-accent hover:border-accent/50 transition-colors cursor-pointer"
                >
                  <Plus size={20} />
                  <span className="text-xs">디자인 추가</span>
                </button>
              </div>
            </div>

            {/* 선택 복장 진행 상세 */}
            {activeCostume ? (
              <CostumeDetail costume={activeCostume} />
            ) : (
              <div className="text-center text-text-secondary text-sm py-10 border border-dashed border-bg-border rounded-lg">
                복장이 없습니다. "디자인 추가"로 첫 복장을 만들어보세요.
              </div>
            )}
          </div>
        </div>

        {/* 이 캐릭터에 대한 이야기 — 캐릭터 단위 댓글 스레드 (씬 댓글 시스템 재사용). */}
        <div className="mt-6">
          <div className="text-xs text-text-secondary mb-2">이 캐릭터에 대한 이야기</div>
          <div className="rounded-xl border border-bg-border bg-bg-card/40 overflow-hidden" style={{ height: 460 }}>
            <CommentPanelErrorBoundary panelId="character" key={character.id}>
              <CommentPanel
                sceneKey={`char:${character.id}`}
                characterThread={{ characterId: character.id, characterName: character.name }}
                sceneLabel={character.name}
              />
            </CommentPanelErrorBoundary>
          </div>
        </div>
      </div>

      {lightbox && <ImageLightbox url={lightbox} alt={character.name} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/** 카드 클릭 → 오버레이 + 좌측 목록 / 우측 상세. */
function CharacterDetailModal({
  initialCharacterId,
  onClose,
}: {
  initialCharacterId: string;
  onClose: () => void;
}) {
  const characters = useCharacterBoardStore((s) => s.characters);
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);

  const activeCharacters = useMemo(() => characters.filter((c) => c.status !== 'archived'), [characters]);
  const [selectedId, setSelectedId] = useState(initialCharacterId);

  const selected = activeCharacters.find((c) => c.id === selectedId) ?? null;
  useEffect(() => {
    if (selected) return;
    if (activeCharacters.length > 0) setSelectedId(activeCharacters[0].id);
    else onClose();
  }, [selected, activeCharacters, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative flex bg-bg-card border border-bg-border overflow-hidden w-full max-w-5xl h-[88vh]"
        style={{ borderRadius: 18, boxShadow: '0 40px 80px rgba(0,0,0,0.5)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 배경 글로우 */}
        <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute" style={{ top: -100, left: -100, width: 400, height: 400, borderRadius: 999, background: 'radial-gradient(circle, rgb(var(--color-accent) / 0.16) 0%, transparent 60%)', filter: 'blur(40px)' }} />
          <div className="absolute" style={{ bottom: -150, right: -100, width: 500, height: 500, borderRadius: 999, background: 'radial-gradient(circle, rgb(var(--color-accent-sub) / 0.12) 0%, transparent 60%)', filter: 'blur(50px)' }} />
        </div>

        {/* 좌측 목록 */}
        <aside className="relative z-[1] w-[200px] shrink-0 border-r border-bg-border/60 flex flex-col min-h-0">
          <div className="px-3 py-3 border-b border-bg-border/40 shrink-0">
            <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary cursor-pointer">
              <X size={15} /> 닫기
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto py-1.5">
            {activeCharacters.map((c) => (
              <CharacterListRow key={c.id} character={c} costumes={byCharacter.get(c.id) ?? []} selected={c.id === selectedId} onSelect={() => setSelectedId(c.id)} />
            ))}
          </div>
        </aside>

        {/* 우측 상세 */}
        <main className="relative z-[1] flex-1 min-w-0">
          {selected && <CharacterDetailPanel character={selected} onClose={onClose} />}
        </main>
      </div>
    </div>
  );
}

function AddCharacterModal({ onClose }: { onClose: () => void }) {
  const addCharacter = useCharacterBoardStore((s) => s.addCharacter);
  const [name, setName] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const created = await addCharacter(name.trim(), memo.trim() || undefined);
    setSaving(false);
    if (created) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div className="bg-bg-card border border-bg-border rounded-2xl w-full max-w-md p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-text-primary">캐릭터 추가</h2>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">이름</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="캐릭터 이름" className="bg-transparent border border-bg-border rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent/50" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">메모 (선택)</span>
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="메모" className="bg-transparent border border-bg-border rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent/50 resize-none" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-border/40 cursor-pointer">취소</button>
          <button type="button" onClick={submit} disabled={!name.trim() || saving} className="px-3 py-1.5 rounded-lg text-sm bg-accent text-white disabled:opacity-50 cursor-pointer">추가</button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer', active ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-bg-border/40')}
    >
      {children}
    </button>
  );
}

function CharacterGrid({ onAdd, pendingOpenId, onConsumeOpen }: { onAdd: () => void; pendingOpenId?: string | null; onConsumeOpen?: () => void }) {
  const characters = useCharacterBoardStore((s) => s.characters);
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const loaded = useCharacterBoardStore((s) => s.loaded);
  const loadError = useCharacterBoardStore((s) => s.loadError);
  const reload = useCharacterBoardStore((s) => s.load);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const detailCharacter = useMemo(() => characters.find((c) => c.id === detailId) ?? null, [characters, detailId]);
  useEffect(() => { if (detailId && !detailCharacter) setDetailId(null); }, [detailId, detailCharacter]);

  // 에피소드 에셋 탭의 '캐릭터 현황판에서 보기' → 해당 캐릭터 상세 자동 오픈.
  useEffect(() => {
    if (pendingOpenId) { setDetailId(pendingOpenId); onConsumeOpen?.(); }
  }, [pendingOpenId, onConsumeOpen]);

  const activeCharacters = useMemo(() => characters.filter((c) => c.status !== 'archived'), [characters]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const arr of byCharacter.values()) for (const c of arr) { for (const t of c.structureTags) set.add(t); for (const t of c.assetTags) set.add(t); }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [byCharacter]);

  function characterTags(characterId: string): Set<string> {
    const set = new Set<string>();
    for (const c of byCharacter.get(characterId) ?? []) { for (const t of c.structureTags) set.add(t); for (const t of c.assetTags) set.add(t); }
    return set;
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activeCharacters.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (activeTags.length > 0) { const tags = characterTags(c.id); if (!activeTags.every((t) => tags.has(t))) return false; }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCharacters, query, activeTags, byCharacter]);

  function toggleTag(tag: string) {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  if (!loaded) {
    if (loadError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 h-40 text-center">
          <span className="text-sm text-text-secondary">캐릭터 현황판을 불러오지 못했어요.</span>
          <button
            type="button"
            onClick={() => { void reload(); }}
            className="px-3 py-1.5 rounded-lg border border-bg-border text-xs text-text-primary hover:border-accent/50 hover:bg-bg-border/30 transition-colors cursor-pointer"
          >
            다시 시도
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative w-full max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary/60" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름으로 검색" className="w-full bg-bg-card border border-bg-border rounded-lg pl-8 pr-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50" />
          </div>
          <button type="button" onClick={onAdd} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90 shrink-0 cursor-pointer">
            <Plus size={16} /> 캐릭터 추가
          </button>
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {allTags.map((t) => <TagPill key={t} tag={t} on={activeTags.includes(t)} onClick={() => toggleTag(t)} />)}
            {activeTags.length > 0 && (
              <button type="button" onClick={() => setActiveTags([])} className="text-xs text-text-secondary/70 hover:text-text-primary px-1.5 cursor-pointer">필터 해제</button>
            )}
          </div>
        )}
      </div>

      {activeCharacters.length === 0 ? (
        <div className="text-center text-text-secondary py-16">아직 캐릭터가 없습니다. "캐릭터 추가"로 시작해보세요.</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-text-secondary py-16">조건에 맞는 캐릭터가 없어요. 검색어나 태그 필터를 바꿔보세요.</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {filtered.map((c) => (
            <CharacterCard key={c.id} character={c} costumes={byCharacter.get(c.id) ?? []} onOpen={() => setDetailId(c.id)} />
          ))}
        </div>
      )}

      {detailCharacter && <CharacterDetailModal initialCharacterId={detailCharacter.id} onClose={() => setDetailId(null)} />}
    </div>
  );
}

export function CharacterBoardView() {
  const load = useCharacterBoardStore((s) => s.load);
  const startRealtime = useCharacterBoardStore((s) => s.startRealtime);

  const [tab, setTab] = useState<BoardTab>('board');
  const [addOpen, setAddOpen] = useState(false);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  useEffect(() => {
    void load();
    const stop = startRealtime();
    return () => { stop(); };
  }, [load, startRealtime]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">캐릭터 현황판</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {tab === 'board' ? '캐릭터별 복장 디자인·리깅 진행 상황' : '에피소드별 등장 캐릭터·이 편 주의점·복장'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 border-b border-bg-border pb-2">
          <TabButton active={tab === 'board'} onClick={() => setTab('board')}>캐릭터 현황판</TabButton>
          <TabButton active={tab === 'episode-assets'} onClick={() => setTab('episode-assets')}>에피소드 에셋</TabButton>
        </div>
      </div>

      {tab === 'board' ? (
        <CharacterGrid onAdd={() => setAddOpen(true)} pendingOpenId={pendingOpenId} onConsumeOpen={() => setPendingOpenId(null)} />
      ) : (
        <EpisodeAssetBoard onOpenCharacter={(id) => { setTab('board'); setPendingOpenId(id); }} />
      )}

      {addOpen && <AddCharacterModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}

export default CharacterBoardView;
