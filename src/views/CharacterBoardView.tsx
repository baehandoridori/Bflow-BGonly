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

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Archive, Film, Plus, X, Image as ImageIcon, Trash2, Pencil, Search, User, Check, Upload, MessageSquare, Copy, Loader2, RotateCcw } from 'lucide-react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { useModalFocus } from '@/hooks/useModalFocus';
import {
  COSTUME_DESIGN_STAGES,
  COSTUME_RIGGING_STAGES,
  type Character,
  type CharacterCostume,
  type CharacterImageFit,
} from '@/types';
import { uploadCharacterImage } from '@/services/supabaseService';
import { deleteImage } from '@/services/storageService';
import { createAndLinkCharacterFolder } from '@/services/characterFolderService';
import { resizeBlob } from '@/utils/imageUtils';
import { cn } from '@/utils/cn';
import { EpisodeAssetBoard } from './EpisodeAssetBoard';
import { tagColor } from '@/utils/tagColor';
import { CommentPanelResizable } from '@/components/scenes/CommentPanelResizable';
import { CharacterImageFrame } from '@/components/characters/CharacterImageFrame';
import { CharacterImageContextMenu } from '@/components/characters/CharacterImageContextMenu';
import { CharacterImageFitEditor } from '@/components/characters/CharacterImageFitEditor';
import { CharacterImageLightbox, type CharacterImageLightboxEntry } from '@/components/characters/CharacterImageLightbox';
import { AssigneeNamePicker } from '@/components/characters/AssigneeNamePicker';
import { chooseWorkFile, chooseWorkFolder } from '@/services/sceneWorkLinkService';
import { DEFAULT_CHARACTER_IMAGE_BACKGROUND } from '@/utils/characterAssets';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { DESIGN_STAGE_META, RIGGING_STAGE_META, characterStageColor, type CharacterStageMeta } from '@/constants/characterStages';
import { CHARACTER_LAYER_CLASS } from '@/constants/characterLayers';
import {
  copyCharacterImage,
  displayCharacterPathName,
  openStoredCharacterPath,
  resolveFolderAfterCharacterFilePick,
} from '@/services/characterPathActions';
import { openOrRegisterEpisodeReel } from '@/services/episodeReelActions';

type BoardTab = 'board' | 'episode-assets';

function claimReactKey(event: ReactKeyboardEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation?.();
}

// 미리 정의된 태그 팔레트 — 토글 칩으로 노출.
const STRUCTURE_TAG_PALETTE = ['얼굴각도 컨트롤러', '책가방 세트', '뒷모습', '앞모습 없음', '측면'] as const;
const ASSET_TAG_PALETTE = ['담배', '핸드폰', '가방', '안경', '모자'] as const;
const costumeMemoDraftCache = new Map<string, string>();
// 복장 없는 캐릭터에 매 렌더 새 [] 를 만들면 memo 비교가 항상 실패한다 — 안정 참조 하나를 공유 (CQ-6).
const EMPTY_COSTUMES: CharacterCostume[] = [];

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
      className="px-2.5 py-1 rounded-full text-xs border flex items-center gap-1.5 transition-colors duration-200 ease-out cursor-pointer"
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

function nextCostumeName(costumes: CharacterCostume[]): string {
  const used = new Set(costumes.map((c) => c.name));
  let n = costumes.length + 1;
  while (used.has(`복장 ${n}`)) n++;
  return `복장 ${n}`;
}

// ─── 단계 레일 ──────────────────────────────────
// 채움형 스텝 레일: 지난 단계=채운 점(체크), 현재=색 강조+글로우, 이후=빈 점. 클릭으로 설정.
function StageRail<T extends string>({
  label,
  stages,
  meta,
  current,
  onSelect,
  headerRight,
}: {
  label: string;
  stages: readonly T[];
  meta: Record<T, CharacterStageMeta>;
  current: T;
  onSelect: (s: T) => void;
  headerRight?: ReactNode;
}) {
  const curIdx = Math.max(0, stages.indexOf(current));
  const curColor = characterStageColor(meta[current]);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">{label}</span>
          <span className="text-xs font-medium" style={{ color: curColor }}>{meta[current].label}</span>
        </div>
        {headerRight}
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
                    background: reached ? characterStageColor(meta[stages[i - 1]]) : 'rgb(var(--color-bg-border))',
                  }}
                />
              )}
              {/* 노드 */}
              <span
                className="relative z-[1] w-[18px] h-[18px] rounded-full flex items-center justify-center transition-[background-color,border-color,box-shadow] duration-200 ease-out"
                style={{
                  background: reached ? characterStageColor(m) : 'rgb(var(--color-bg-card))',
                  border: `2px solid ${reached ? characterStageColor(m) : 'rgb(var(--color-bg-border))'}`,
                  boxShadow: isCur ? `0 0 0 4px ${characterStageColor(m, 0.2)}` : 'none',
                }}
              >
                {passed && <Check size={10} className="text-white" strokeWidth={3} />}
                {isCur && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              <span
                className="text-[11px] leading-tight text-center transition-colors"
                style={{ color: isCur ? characterStageColor(m) : 'rgb(var(--color-text-secondary))' }}
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

// React.memo (CQ-6): store 가 미변경 캐릭터의 character/costumes 참조를 유지하므로(rebuildByCharacter 구조적 공유)
//   콜백을 id 인자 안정 참조로 받으면 복장 하나 변경 시 다른 카드가 리렌더되지 않는다.
const CharacterCard = memo(function CharacterCard({
  character,
  costumes,
  onOpen,
  onContextMenu,
}: {
  character: Character;
  costumes: CharacterCostume[];
  onOpen: (characterId: string) => void;
  onContextMenu: (characterId: string, event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const featured = costumes.find((c) => c.featuredImageUrl) ?? null;
  const designDone = costumes.filter((c) => c.designStage === 'done').length;
  const riggingDone = costumes.filter((c) => c.riggingStage === 'done').length;

  return (
    <button
      type="button"
      onClick={() => onOpen(character.id)}
      onContextMenu={(event) => onContextMenu(character.id, event)}
      className="text-left bg-bg-card border border-bg-border rounded-xl overflow-hidden hover:border-accent/50 transition-colors duration-200 flex flex-col cursor-pointer"
    >
      <div className="aspect-[3/4] bg-bg-border/30 flex items-center justify-center overflow-hidden">
        {featured ? (
          <CharacterImageFrame
            url={featured.featuredImageUrl}
            alt={character.name}
            background={featured.imageBackground}
            fit={featured.imageFit}
            className="w-full h-full"
          />
        ) : (
          <ImageIcon size={28} className="text-text-secondary/40" />
        )}
      </div>
      <div className="p-3 flex flex-col gap-2">
        <div className="font-semibold text-text-primary truncate">{character.name}</div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span>복장 {costumes.length}</span>
          {character.episodeIds.length > 0 && (
            <span className="text-text-secondary">· EP {character.episodeIds.length}</span>
          )}
        </div>
        {costumes.length > 0 ? (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span
              className="px-1.5 py-0.5 rounded-md"
              style={{
                backgroundColor: characterStageColor(DESIGN_STAGE_META.done, 0.14),
                color: characterStageColor(DESIGN_STAGE_META.done),
              }}
            >
              디자인 {designDone}/{costumes.length}
            </span>
            <span
              className="px-1.5 py-0.5 rounded-md"
              style={{
                backgroundColor: characterStageColor(RIGGING_STAGE_META.done, 0.14),
                color: characterStageColor(RIGGING_STAGE_META.done),
              }}
            >
              리깅 {riggingDone}/{costumes.length}
            </span>
          </div>
        ) : (
          <div className="inline-flex self-start rounded-md bg-bg-border/30 px-1.5 py-0.5 text-[11px] text-text-secondary">
            복장을 추가해주세요
          </div>
        )}
      </div>
    </button>
  );
});

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
          <Plus size={12} className="text-text-secondary" aria-hidden />
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

/** 큰 대표 이미지 — 클릭=크게보기, 아래 별도 버튼으로 교체/추가. */
function FeaturedImageSlot({
  character,
  costume,
  onView,
  onEnsureCostume,
}: {
  character: Character;
  costume: CharacterCostume | null;
  onView: (costumeId: string) => void;
  onEnsureCostume: () => Promise<CharacterCostume | null>;
}) {
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [fitEditorOpen, setFitEditorOpen] = useState(false);
  const [draggingImage, setDraggingImage] = useState(false);

  const handleUpload = useCallback(async (file: File) => {
    const targetCostume = costume ?? await onEnsureCostume();
    if (!targetCostume) return;
    if (targetCostume.featuredImageUrl) {
      const ok = await ConfirmDialog.show({
        message: '현재 이미지를 새 이미지로 바꿀까요?\n이전 이미지는 복구할 수 없어요.',
        confirmLabel: '바꾸기',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setUploading(true);
    try {
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      const base64 = await resizeBlob(file, 800, isPng ? 0.92 : 0.8, isPng ? 'image/png' : 'image/jpeg');
      const res = await uploadCharacterImage(character.id, targetCostume.id, base64);
      if (!res.ok || !res.url) throw new Error(res.error ?? '업로드 실패');
      // 이전 대표 이미지 정리는 서버(updateCharacterCostume)가 DB 업데이트 성공 후 처리 — 롤백 시 깨진 URL 방지.
      const saved = await updateCostumeField(targetCostume.id, { featuredImageUrl: res.url });
      // 업로드는 됐는데 DB 반영이 실패(롤백)하면 방금 올린 파일이 고아가 됨 → 정리.
      if (!saved) {
        deleteImage(res.url).catch((e) => console.warn('[character-board] 실패한 업로드 정리:', e));
      }
    } catch (err) {
      console.error('[character-board] 이미지 업로드 실패:', err);
      toast.error('이미지 업로드에 실패했어요');
    } finally {
      setUploading(false);
    }
  }, [character.id, costume, onEnsureCostume, updateCostumeField]);

  const uploadFileIfImage = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.info('이미지 파일만 올릴 수 있어요');
      return;
    }
    void handleUpload(file);
  }, [handleUpload]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      // 패널 레벨 오버레이(갤러리 우클릭 메뉴·썸네일 맞추기)는 로컬 상태로 알 수 없어 DOM 마커로 감지.
      if (
        uploading || contextMenu || fitEditorOpen
        || document.querySelector('[data-character-lightbox], [data-character-fit-editor], [data-character-context-menu]')
      ) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return;
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      event.preventDefault();
      uploadFileIfImage(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [contextMenu, fitEditorOpen, uploadFileIfImage, uploading]);

  const shownUrl = costume?.featuredImageUrl ?? null;
  const shownBackground = costume?.imageBackground ?? DEFAULT_CHARACTER_IMAGE_BACKGROUND;
  const shownFit = costume?.imageFit;

  return (
    <div className="w-[240px] shrink-0 flex flex-col gap-2">
      <div
        className={cn(
          'relative aspect-[3/4] w-full rounded-xl border border-bg-border transition-colors',
          shownUrl ? 'cursor-zoom-in hover:border-accent/50 transition-colors' : '',
          draggingImage && 'border-accent bg-accent/10',
        )}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return;
          event.preventDefault();
          setDraggingImage(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDraggingImage(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingImage(false);
          uploadFileIfImage(event.dataTransfer.files?.[0]);
        }}
      >
        <CharacterImageFrame
          url={shownUrl}
          alt={costume?.name ?? character.name}
          background={shownBackground}
          fit={shownFit}
          className="h-full w-full rounded-xl"
          onClick={shownUrl && costume ? () => onView(costume.id) : undefined}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ x: event.clientX, y: event.clientY });
          }}
        />
        {draggingImage && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-accent/15 text-xs font-medium text-accent ring-1 ring-accent/60">
            이미지 놓기
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center gap-1.5 rounded-md border border-bg-border px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
        >
          <Upload size={13} />
          {uploading ? '업로드 중...' : shownUrl ? '이미지 바꾸기' : '이미지 추가'}
        </button>
        <button
          type="button"
          disabled={!shownUrl}
          onClick={() => copyCharacterImage(shownUrl)}
          className="flex items-center justify-center gap-1.5 rounded-md border border-bg-border px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50 disabled:opacity-40 whitespace-nowrap"
        >
          <Copy size={13} /> 이미지 복사
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
      />
      {contextMenu && (
        <CharacterImageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          character={character}
          imageCostume={costume}
          fileCostume={costume}
          onClose={() => setContextMenu(null)}
          onBackground={(costumeId, background) => { void updateCostumeField(costumeId, { imageBackground: background }); }}
          onEditFit={() => setFitEditorOpen(true)}
        />
      )}
      {fitEditorOpen && shownUrl && costume && (
        <CharacterImageFitEditor
          url={shownUrl}
          alt={costume.name}
          background={shownBackground}
          fit={costume.imageFit}
          onCommit={(fit: CharacterImageFit) => updateCostumeField(costume.id, { imageFit: fit })}
          onClose={() => setFitEditorOpen(false)}
        />
      )}
    </div>
  );
}

/** 복장 메모 — 키 입력마다 저장 말고 blur 때 한 번만(동시 쓰기 경합·텍스트 유실 방지). */
function CostumeMemoInput({
  draftKey,
  value,
  onCommit,
}: {
  draftKey: string;
  value: string;
  /** false 를 resolve 하면 저장 실패 — 초안 캐시를 유지해 입력 텍스트를 보존한다 (GAP-B). */
  onCommit: (next: string) => void | boolean | Promise<boolean | void>;
}) {
  const [draft, setDraft] = useState(() => costumeMemoDraftCache.get(draftKey) ?? value);
  const focused = useRef(false);
  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  const onCommitRef = useRef(onCommit);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  useEffect(() => {
    if (focused.current) return;
    const cached = costumeMemoDraftCache.get(draftKey);
    setDraft(cached ?? value);
  }, [draftKey, value]);
  useEffect(() => () => {
    const latestDraft = draftRef.current;
    if (focused.current && latestDraft !== valueRef.current) {
      const result = onCommitRef.current(latestDraft);
      void Promise.resolve(result).then((ok) => {
        if (ok !== false && costumeMemoDraftCache.get(draftKey) === latestDraft) {
          costumeMemoDraftCache.delete(draftKey);
        }
      });
      return;
    }
    // 이전 커밋 실패로 남겨둔 초안은 유지 — 이미 저장된 값과 같은 캐시만 정리.
    const cached = costumeMemoDraftCache.get(draftKey);
    if (cached === undefined || cached === valueRef.current) costumeMemoDraftCache.delete(draftKey);
  }, [draftKey]);

  const commit = useCallback(() => {
    focused.current = false;
    const next = draftRef.current;
    if (next === valueRef.current) {
      costumeMemoDraftCache.delete(draftKey);
      return;
    }
    const result = onCommitRef.current(next);
    void Promise.resolve(result).then((ok) => {
      // 실패(false)나 더 최신 초안이 있으면 캐시를 유지 — 다시 포커스 아웃하면 재시도된다.
      if (ok !== false && costumeMemoDraftCache.get(draftKey) === next) {
        costumeMemoDraftCache.delete(draftKey);
      }
    });
  }, [draftKey]);

  const updateDraft = (next: string) => {
    setDraft(next);
    draftRef.current = next;
    if (focused.current) costumeMemoDraftCache.set(draftKey, next);
  };

  return (
    <textarea
      value={draft}
      onChange={(e) => updateDraft(e.target.value)}
      onFocus={() => { focused.current = true; }}
      onBlur={commit}
      placeholder="이 복장 메모…"
      aria-label="복장 메모"
      rows={3}
      className="w-full bg-bg-border/20 border border-bg-border rounded-lg px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent/50 resize-none leading-relaxed"
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                claimReactKey(e);
                setDraft(costume.name);
                setEditing(false);
              }
            }}
            aria-label="복장 이름"
            className="flex-1 min-w-0 bg-transparent border border-accent/50 rounded-md px-1.5 py-0.5 text-sm font-medium text-text-primary outline-none"
          />
        ) : (
          <>
            <span className="text-sm font-medium text-text-primary truncate">{costume.name}</span>
            <span className="text-[11px] text-text-secondary shrink-0">v{costume.versionNo}</span>
            <button
              type="button"
              aria-label="복장 이름 편집"
              onClick={() => { setDraft(costume.name); setEditing(true); }}
              className="-m-1.5 rounded-md p-1.5 text-text-secondary hover:bg-bg-border/30 hover:text-text-primary cursor-pointer shrink-0"
            >
              <Pencil size={12} />
            </button>
          </>
        )}
      </div>
      <CostumeMemoInput
        key={costume.id}
        draftKey={costume.id}
        value={costume.memo ?? ''}
        onCommit={(next) => updateCostumeField(costume.id, { memo: next.trim() ? next : null })}
      />
    </div>
  );
}

function PathActionRow({
  label,
  path,
  onPick,
  onOpen,
  onCreate,
  creating = false,
}: {
  label: string;
  path: string | null;
  onPick: () => void;
  onOpen: () => void;
  onCreate?: () => void;
  creating?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-bg-border/70 bg-bg-border/10 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs text-text-secondary">{label}</div>
        <div className="text-sm text-text-primary truncate" title={path ?? undefined}>{displayCharacterPathName(path)}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {!path && onCreate && (
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            title="기준 경로에 캐릭터 이름으로 폴더를 만들어 연결"
            className="inline-flex items-center gap-1 rounded-md border border-accent/40 px-2 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
          >
            {creating && <Loader2 size={11} className="animate-spin" />}
            만들기
          </button>
        )}
        <button
          type="button"
          onClick={onPick}
          disabled={creating}
          className="rounded-md border border-bg-border px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50 disabled:opacity-50"
        >
          선택
        </button>
        {path && (
          <button
            type="button"
            onClick={onOpen}
            className="rounded-md border border-bg-border px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50"
          >
            열기
          </button>
        )}
      </div>
    </div>
  );
}

function VersionNumberInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const commit = () => {
    focused.current = false;
    const n = Number(draft);
    const next = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      type="number"
      min={1}
      value={draft}
      aria-label="버전 번호"
      onFocus={() => { focused.current = true; }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          (event.target as HTMLInputElement).blur();
        }
        if (event.key === 'Escape') {
          claimReactKey(event);
          focused.current = false;
          setDraft(String(value));
          (event.target as HTMLInputElement).blur();
        }
      }}
      className="w-14 rounded-md border border-bg-border bg-transparent px-1 py-1 text-center text-text-primary outline-none focus:border-accent/50"
    />
  );
}

/** 선택 복장의 진행 상세 — 버전·작업 경로·단계별 담당자·태그. */
function CostumeDetail({
  character,
  costume,
  onPickFolder,
  onPickFile,
  onCreateFolder,
  creatingFolder,
}: {
  character: Character;
  costume: CharacterCostume;
  onPickFolder: () => void;
  onPickFile: () => void;
  onCreateFolder: () => void;
  creatingFolder: boolean;
}) {
  const updateCostumeStage = useCharacterBoardStore((s) => s.updateCostumeStage);
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const setCostumeTags = useCharacterBoardStore((s) => s.setCostumeTags);
  const setVersion = useCharacterBoardStore((s) => s.setVersion);

  return (
    <div className="flex flex-col gap-5">
      {/* 버전 */}
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-text-secondary">버전</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="버전 내리기"
              className="h-8 w-8 rounded-md border border-bg-border text-text-primary hover:bg-bg-border/40 cursor-pointer"
              onClick={() => setVersion(costume.id, Math.max(1, Math.floor(costume.versionNo) - 1))}
            >
              −
            </button>
            <VersionNumberInput value={costume.versionNo} onCommit={(next) => setVersion(costume.id, next)} />
            <button
              type="button"
              aria-label="버전 올리기"
              className="h-8 w-8 rounded-md border border-bg-border text-text-primary hover:bg-bg-border/40 cursor-pointer"
              onClick={() => setVersion(costume.id, Math.floor(costume.versionNo) + 1)}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* 작업 경로 */}
      <div className="grid gap-2 md:grid-cols-2">
        <PathActionRow
          label="작업 폴더"
          path={character.workFolderPath}
          onPick={onPickFolder}
          onOpen={() => openStoredCharacterPath(character.workFolderPath, '작업 폴더')}
          onCreate={onCreateFolder}
          creating={creatingFolder}
        />
        <PathActionRow
          label="작업 파일"
          path={costume.workFilePath}
          onPick={onPickFile}
          onOpen={() => openStoredCharacterPath(costume.workFilePath, '작업 파일')}
        />
      </div>

      {/* 단계 레일 + 담당자 */}
      <div className="flex flex-col gap-5 rounded-xl border border-bg-border/60 bg-bg-border/10 p-4">
        <StageRail
          label="디자인 단계"
          stages={COSTUME_DESIGN_STAGES}
          meta={DESIGN_STAGE_META}
          current={costume.designStage}
          onSelect={(s) => updateCostumeStage(costume.id, 'design', s)}
          headerRight={
            <AssigneeNamePicker
              label="디자인 담당자"
              value={costume.designAssignee}
              onChange={(next) => updateCostumeField(costume.id, { designAssignee: next })}
            />
          }
        />
        <div className="h-px bg-bg-border/50" />
        <StageRail
          label="리깅 단계"
          stages={COSTUME_RIGGING_STAGES}
          meta={RIGGING_STAGE_META}
          current={costume.riggingStage}
          onSelect={(s) => updateCostumeStage(costume.id, 'rigging', s)}
          headerRight={
            <AssigneeNamePicker
              label="리깅 담당자"
              value={costume.riggingAssignee}
              onChange={(next) => updateCostumeField(costume.id, { riggingAssignee: next })}
            />
          }
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

// React.memo (CQ-6): onSelect 는 setState 디스패처 같은 안정 참조를 그대로 받는다 — 행 단위 인라인 클로저 금지.
const CharacterListRow = memo(function CharacterListRow({
  character,
  costumes,
  selected,
  onSelect,
}: {
  character: Character;
  costumes: CharacterCostume[];
  selected: boolean;
  onSelect: (characterId: string) => void;
}) {
  const thumbCostume = costumes.find((c) => c.featuredImageUrl) ?? null;
  const ratio = riggingRatio(costumes);
  return (
    <button
      type="button"
      onClick={() => onSelect(character.id)}
      aria-pressed={selected}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-left border-l-2 transition-colors cursor-pointer',
        selected ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-bg-border/30',
      )}
    >
      <div className="w-8 h-8 rounded-md bg-bg-border/40 overflow-hidden flex items-center justify-center shrink-0">
        {thumbCostume ? (
          <CharacterImageFrame
            url={thumbCostume.featuredImageUrl}
            alt=""
            background={thumbCostume.imageBackground}
            fit={thumbCostume.imageFit}
            className="w-full h-full"
          />
        ) : (
          <User size={15} className="text-text-secondary" />
        )}
      </div>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className={cn('text-sm truncate', selected ? 'text-text-primary font-medium' : 'text-text-secondary')}>{character.name}</div>
        <div className="h-1 rounded-full bg-bg-border/60 overflow-hidden" title={`리깅 완료 ${Math.round(ratio * 100)}%`} aria-label={`리깅 완료 ${Math.round(ratio * 100)}%`}>
          {/* width 트랜지션은 레이아웃 속성 — transform(scaleX) 채움으로 대체, 둥근 모양은 컨테이너 overflow-hidden 이 유지 (MO-11). */}
          <div className="h-full w-full rounded-full origin-left transition-transform duration-200 ease-out" style={{ transform: `scaleX(${ratio})`, backgroundColor: characterStageColor(RIGGING_STAGE_META.done) }} />
        </div>
      </div>
    </button>
  );
});

// React.memo (CQ-6): 갤러리 map 의 복장별 인라인 클로저 대신 costumeId 인자 안정 콜백을 받는다.
const CostumeThumbCard = memo(function CostumeThumbCard({
  costume,
  selected,
  onSelect,
  onDelete,
  onImageContextMenu,
}: {
  costume: CharacterCostume;
  selected: boolean;
  onSelect: (costumeId: string) => void;
  onDelete: (costumeId: string) => void | Promise<void>;
  onImageContextMenu: (costumeId: string, event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(costume.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(costume.id); } }}
      aria-pressed={selected}
      className={cn(
        'group relative w-[104px] shrink-0 flex flex-col rounded-lg overflow-hidden border transition-colors cursor-pointer',
        selected ? 'border-accent ring-1 ring-accent/40' : 'border-bg-border hover:border-text-secondary/50',
      )}
    >
      <div className="aspect-[3/4] w-full bg-bg-border/30 flex items-center justify-center overflow-hidden">
        {costume.featuredImageUrl ? (
          <CharacterImageFrame
            url={costume.featuredImageUrl}
            alt={costume.name}
            background={costume.imageBackground}
            fit={costume.imageFit}
            className="w-full h-full"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onImageContextMenu(costume.id, event);
            }}
          />
        ) : (
          <ImageIcon size={18} className="text-text-secondary/40" />
        )}
      </div>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 bg-bg-card">
        <span className={cn('text-xs truncate', selected ? 'text-text-primary' : 'text-text-secondary')}>{costume.name}</span>
        <span className="text-[11px] text-text-secondary shrink-0">v{costume.versionNo}</span>
      </div>
      <button
        type="button"
        aria-label={`${costume.name} 삭제`}
        onClick={async (e) => {
          e.stopPropagation();
          const ok = await ConfirmDialog.show({
            message: `'${costume.name}' 복장을 삭제할까요?\n대표 이미지, 진행 단계, 담당자, 태그와 작업 파일 연결이 함께 사라집니다.\n실제 원본 작업 파일은 삭제하지 않아요.`,
            confirmLabel: '삭제',
            tone: 'danger',
          });
          if (ok) await onDelete(costume.id);
        }}
        className="absolute top-1 right-1 rounded-md bg-black/40 p-1.5 text-white/80 opacity-0 transition-opacity hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 cursor-pointer"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
});

/** 우측 상세 패널. */
function CharacterDetailPanel({
  character,
  onClose,
  commentOpen,
  onToggleComment,
  commentCount,
}: {
  character: Character;
  onClose: () => void;
  commentOpen: boolean;
  onToggleComment: () => void;
  commentCount: number;
}) {
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const addCostume = useCharacterBoardStore((s) => s.addCostume);
  const deleteCostume = useCharacterBoardStore((s) => s.deleteCostume);
  const deleteCharacter = useCharacterBoardStore((s) => s.deleteCharacter);
  const archiveCharacter = useCharacterBoardStore((s) => s.archiveCharacter);
  const restoreCharacter = useCharacterBoardStore((s) => s.restoreCharacter);
  const renameCharacter = useCharacterBoardStore((s) => s.renameCharacter);
  const updateCharacterFolder = useCharacterBoardStore((s) => s.updateCharacterFolder);
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const linkEpisode = useCharacterBoardStore((s) => s.linkEpisode);
  const unlinkEpisode = useCharacterBoardStore((s) => s.unlinkEpisode);
  const episodes = useDataStore((s) => s.episodes);
  const setEpisodes = useDataStore((s) => s.setEpisodes);
  const getEpisodeDisplayName = useDataStore((s) => s.getEpisodeDisplayName);

  const costumes = byCharacter.get(character.id) ?? [];
  const [activeCostumeId, setActiveCostumeId] = useState<string | null>(costumes[0]?.id ?? null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(character.name);
  const [lightboxCostumeId, setLightboxCostumeId] = useState<string | null>(null);
  const [imageMenu, setImageMenu] = useState<{ costumeId: string; x: number; y: number } | null>(null);
  const [fitEditorCostumeId, setFitEditorCostumeId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);

  // 갤러리 휠 → 가로 스크롤.
  const galleryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = galleryRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const canScroll = el.scrollWidth > el.clientWidth;
      if (!canScroll || e.deltaY === 0 || e.shiftKey) return;
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY;
      if (el.scrollLeft !== before) e.preventDefault();
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
  const imageEntries: CharacterImageLightboxEntry[] = costumes
    .filter((c) => !!c.featuredImageUrl)
    .map((c) => ({
      costumeId: c.id,
      name: `${character.name} · ${c.name}`,
      costumeName: c.name,
      versionNo: c.versionNo,
      url: c.featuredImageUrl!,
      background: c.imageBackground,
      fit: c.imageFit,
    }));
  const menuCostume = imageMenu ? costumes.find((c) => c.id === imageMenu.costumeId) ?? null : null;
  const fitEditorCostume = fitEditorCostumeId ? costumes.find((c) => c.id === fitEditorCostumeId) ?? null : null;

  const handlePickFolder = useCallback(async () => {
    const folder = await chooseWorkFolder();
    if (!folder) return;
    await updateCharacterFolder(character.id, folder);
  }, [character.id, updateCharacterFolder]);

  const handleCreateFolder = useCallback(async () => {
    if (creatingFolder) return;
    setCreatingFolder(true);
    try {
      await createAndLinkCharacterFolder(character, updateCharacterFolder);
    } finally {
      setCreatingFolder(false);
    }
  }, [character, creatingFolder, updateCharacterFolder]);

  const ensureCostume = useCallback(async () => {
    if (activeCostume) return activeCostume;
    const created = await addCostume(character.id, nextCostumeName(costumes));
    if (created) setActiveCostumeId(created.id);
    return created;
  }, [activeCostume, addCostume, character.id, costumes]);

  const handlePickFile = useCallback(async (targetCostume = activeCostume) => {
    targetCostume = targetCostume ?? await ensureCostume();
    if (!targetCostume) return;
    const filePath = await chooseWorkFile();
    if (!filePath) return;
    const saved = await updateCostumeField(targetCostume.id, { workFilePath: filePath });
    if (!saved) return;
    const latestFolderPath = useCharacterBoardStore.getState().characters.find((item) => item.id === character.id)?.workFolderPath ?? character.workFolderPath;
    if (!latestFolderPath?.trim()) {
      const folder = await resolveFolderAfterCharacterFilePick(latestFolderPath, filePath);
      if (folder) await updateCharacterFolder(character.id, folder);
    }
  }, [activeCostume, character.id, character.workFolderPath, ensureCostume, updateCharacterFolder, updateCostumeField]);

  const handleEpisodeReel = useCallback(async (episode: typeof episodes[number]) => {
    await openOrRegisterEpisodeReel({
      episode,
      getEpisodes: () => useDataStore.getState().episodes,
      setEpisodes,
      logLabel: 'character-board',
    });
  }, [setEpisodes]);

  const handleAddCostume = async () => {
    const created = await addCostume(character.id, nextCostumeName(costumes));
    if (created) setActiveCostumeId(created.id);
  };

  // CostumeThumbCard(memo) 용 안정 콜백 — 갤러리 map 안 인라인 클로저는 memo 를 무력화한다 (CQ-6).
  const openCostumeImageMenu = useCallback((costumeId: string, event: ReactMouseEvent<HTMLDivElement>) => {
    setActiveCostumeId(costumeId);
    setImageMenu({ costumeId, x: event.clientX, y: event.clientY });
  }, []);

  const handleArchiveCharacter = async () => {
    const ok = await ConfirmDialog.show({
      message: `'${character.name}' 캐릭터를 보관할까요?\n보관된 캐릭터는 기본 목록과 검색에서 숨겨지고, 보관 목록에서 다시 복원할 수 있어요.`,
      confirmLabel: '보관',
      tone: 'danger',
    });
    if (ok) await archiveCharacter(character.id);
  };

  const handleRestoreCharacter = async () => {
    await restoreCharacter(character.id);
  };

  const handleDeleteCharacter = async () => {
    const ok = await ConfirmDialog.show({
      message: `'${character.name}' 캐릭터를 영구 삭제할까요?\n복장, 대표 이미지, 작업 파일 연결, 댓글과 첨부 이미지도 함께 사라집니다.\n실제 작업 폴더와 원본 작업 파일은 삭제하지 않아요.`,
      confirmLabel: '영구 삭제',
      tone: 'danger',
    });
    if (ok) {
      await deleteCharacter(character.id);
      onClose();
    }
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  claimReactKey(e);
                  setNameDraft(character.name);
                  setEditingName(false);
                }
              }}
              aria-label="캐릭터 이름"
              className="bg-transparent border border-accent/50 rounded-md px-2 py-1 text-lg font-semibold text-text-primary outline-none"
            />
          ) : (
            <>
              <h2 className="text-lg font-semibold text-text-primary truncate">{character.name}</h2>
              <button type="button" aria-label="이름 편집" onClick={() => { setNameDraft(character.name); setEditingName(true); }} className="-m-1.5 rounded-md p-1.5 text-text-secondary hover:bg-bg-border/30 hover:text-text-primary cursor-pointer">
                <Pencil size={14} />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleComment}
            aria-pressed={commentOpen}
            title={commentOpen ? '댓글 닫기' : '댓글 열기'}
            className={cn(
              'flex items-center gap-1 text-sm px-2 py-1 rounded-md transition-colors cursor-pointer',
              commentOpen ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <MessageSquare size={14} /> 댓글{commentCount > 0 ? ` ${commentCount}` : ''}
          </button>
          {character.status === 'archived' ? (
            <>
              <button
                type="button"
                onClick={handleRestoreCharacter}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-text-secondary hover:bg-bg-border/30 hover:text-text-primary cursor-pointer"
              >
                <RotateCcw size={14} /> 복원
              </button>
              <button
                type="button"
                onClick={handleDeleteCharacter}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-text-secondary hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
              >
                <Trash2 size={14} /> 영구 삭제
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleArchiveCharacter}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-text-secondary hover:bg-bg-border/30 hover:text-[#FFB86B] cursor-pointer"
            >
              <Archive size={14} /> 보관
            </button>
          )}
          <button type="button" aria-label="닫기" onClick={onClose} className="-m-1.5 rounded-md p-1.5 text-text-secondary hover:bg-bg-border/30 hover:text-text-primary cursor-pointer">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 본문 (스크롤) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        <div className="flex gap-6 flex-col lg:flex-row">
          {/* 좌측: 큰 이미지 + 복장명 + 메모 */}
          <div className="flex flex-col gap-3">
            <FeaturedImageSlot
              character={character}
              costume={activeCostume}
              onView={(costumeId) => setLightboxCostumeId(costumeId)}
              onEnsureCostume={ensureCostume}
            />
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
                    <div key={ep.episodeNumber} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (linked) {
                            void unlinkEpisode(character.id, ep.episodeNumber);
                            toast.info('에피소드 연결을 해제했어요', {
                              action: {
                                label: '실행 취소',
                                onClick: () => { void linkEpisode(character.id, ep.episodeNumber); },
                              },
                            });
                          } else {
                            void linkEpisode(character.id, ep.episodeNumber);
                          }
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          void handleEpisodeReel(ep);
                        }}
                        title={linked ? '클릭: 연결 해제 · 우클릭: 릴 파일' : '클릭: 이 에피소드에 연결 · 우클릭: 릴 파일'}
                        className={cn(
                          'min-h-7 rounded-md border px-2 py-1 text-xs transition-colors cursor-pointer',
                          linked ? 'bg-accent/20 text-accent border-accent/40' : 'text-text-secondary border-bg-border hover:text-text-primary',
                        )}
                      >
                        {getEpisodeDisplayName(ep)}
                      </button>
                      <button
                        type="button"
                        aria-label={`${getEpisodeDisplayName(ep)} 릴 파일 ${ep.reelFilePath ? '보기' : '등록'}`}
                        title={ep.reelFilePath ? '릴 파일 보기' : '릴 파일 등록'}
                        onClick={() => { void handleEpisodeReel(ep); }}
                        className={cn(
                          'flex min-h-7 min-w-7 items-center justify-center rounded-md border text-text-secondary transition-colors hover:text-text-primary',
                          ep.reelFilePath ? 'border-bg-border bg-bg-border/15' : 'border-dashed border-bg-border/80',
                        )}
                      >
                        <Film size={13} />
                      </button>
                    </div>
                  );
                })}
                {episodes.length === 0 && <span className="text-xs text-text-secondary">등록된 에피소드가 없어요</span>}
              </div>
            </div>

            {/* 복장 갤러리 */}
            <div className="flex flex-col gap-2">
              <div className="text-xs text-text-secondary">복장</div>
              <div ref={galleryRef} className="flex items-stretch gap-2.5 overflow-x-auto pb-1">
                {costumes.map((c) => (
                  <CostumeThumbCard
                    key={c.id}
                    costume={c}
                    selected={activeCostumeId === c.id}
                    onSelect={setActiveCostumeId}
                    onDelete={deleteCostume}
                    onImageContextMenu={openCostumeImageMenu}
                  />
                ))}
                <button
                  type="button"
                  onClick={handleAddCostume}
                  aria-label="복장 추가"
                  className="w-[104px] shrink-0 aspect-[3/4] flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-bg-border text-text-secondary hover:text-accent hover:border-accent/50 transition-colors cursor-pointer"
                >
                  <Plus size={20} />
                  <span className="text-xs">복장 추가</span>
                </button>
              </div>
            </div>

            {/* 선택 복장 진행 상세 */}
            {activeCostume ? (
              <CostumeDetail
                character={character}
                costume={activeCostume}
                onPickFolder={handlePickFolder}
                onPickFile={() => handlePickFile(activeCostume)}
                onCreateFolder={handleCreateFolder}
                creatingFolder={creatingFolder}
              />
            ) : (
              <div className="text-center text-text-secondary text-sm py-10 border border-dashed border-bg-border rounded-lg">
                복장이 없습니다. "복장 추가"로 첫 복장을 만들어보세요.
              </div>
            )}
          </div>
        </div>
      </div>

      {imageMenu && menuCostume && (
        <CharacterImageContextMenu
          x={imageMenu.x}
          y={imageMenu.y}
          character={character}
          imageCostume={menuCostume}
          fileCostume={menuCostume}
          onClose={() => setImageMenu(null)}
          onBackground={(costumeId, background) => updateCostumeField(costumeId, { imageBackground: background })}
          onEditFit={(costumeId) => setFitEditorCostumeId(costumeId)}
        />
      )}
      {fitEditorCostume?.featuredImageUrl && (
        <CharacterImageFitEditor
          url={fitEditorCostume.featuredImageUrl}
          alt={fitEditorCostume.name}
          background={fitEditorCostume.imageBackground}
          fit={fitEditorCostume.imageFit}
          onCommit={(fit: CharacterImageFit) => updateCostumeField(fitEditorCostume.id, { imageFit: fit })}
          onClose={() => setFitEditorCostumeId(null)}
        />
      )}
      {lightboxCostumeId && imageEntries.length > 0 && (
        <CharacterImageLightbox
          entries={imageEntries}
          initialCostumeId={lightboxCostumeId}
          onClose={() => setLightboxCostumeId(null)}
          onFitCommit={(costumeId, fit) => updateCostumeField(costumeId, { imageFit: fit })}
          onCopyImage={(url) => copyCharacterImage(url)}
        />
      )}
    </div>
  );
}

/** 카드 클릭 → 오버레이 + 좌측 목록 / 우측 상세. */
function CharacterDetailModal({
  initialCharacterId,
  archivedMode = false,
  filteredIds,
  onClose,
}: {
  initialCharacterId: string;
  archivedMode?: boolean;
  /** 그리드의 검색·태그 필터 결과 — 있으면 좌측 목록이 같은 컨텍스트를 유지한다 (UX-6). */
  filteredIds?: string[];
  onClose: () => void;
}) {
  const characters = useCharacterBoardStore((s) => s.characters);
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);

  const allVisibleCharacters = useMemo(
    () => characters.filter((c) => (archivedMode ? c.status === 'archived' : c.status !== 'archived')),
    [archivedMode, characters],
  );
  const [showAllList, setShowAllList] = useState(false);
  const hasGridFilter = !!filteredIds && filteredIds.length > 0;
  const visibleCharacters = useMemo(() => {
    if (!hasGridFilter || showAllList) return allVisibleCharacters;
    const order = new Map(filteredIds!.map((id, i) => [id, i]));
    return allVisibleCharacters
      .filter((c) => order.has(c.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [allVisibleCharacters, filteredIds, hasGridFilter, showAllList]);
  const [selectedId, setSelectedId] = useState(initialCharacterId);
  const [listQuery, setListQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const modalFocus = useModalFocus(dialogRef, { autoFocus: true });

  const [commentOpen, setCommentOpen] = useState(() => window.innerWidth >= 1440);
  const [commentCount, setCommentCount] = useState(0);
  // 캐릭터를 바꾸면 댓글 수 배지를 리셋(새 캐릭터 패널이 onCountChange 로 다시 채움).
  useEffect(() => { setCommentCount(0); }, [selectedId]);

  const filteredListCharacters = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return visibleCharacters;
    return visibleCharacters.filter((character) => character.name.toLowerCase().includes(q));
  }, [listQuery, visibleCharacters]);
  const selected = visibleCharacters.find((c) => c.id === selectedId) ?? null;
  useEffect(() => {
    if (selected) return;
    // 선택 캐릭터가 그리드 필터 밖에 있으면(딥링크 진입 등) 목록을 전체 보기로 전환해 유지한다.
    if (hasGridFilter && !showAllList && allVisibleCharacters.some((c) => c.id === selectedId)) {
      setShowAllList(true);
      return;
    }
    if (visibleCharacters.length > 0) setSelectedId(visibleCharacters[0].id);
    else onClose();
  }, [selected, selectedId, visibleCharacters, allVisibleCharacters, hasGridFilter, showAllList, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      /* 진입 모션(MO-11): 오버레이 fade + 내용 박스 미세 scale. exit 모션 없음(언마운트 즉시 — 과잉 금지). */
      className={`fixed inset-0 ${CHARACTER_LAYER_CLASS.modal} flex items-center justify-center bg-overlay/60 backdrop-blur-sm p-4 animate-[char-overlay-in_200ms_ease-out] motion-reduce:animate-none`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={archivedMode ? '보관된 캐릭터 상세' : '캐릭터 상세'}
        tabIndex={-1}
        onKeyDown={modalFocus.onKeyDown}
        className="flex h-[88vh] max-h-full max-w-full items-stretch gap-3 overflow-x-auto overflow-y-hidden outline-none animate-[char-modal-in_200ms_ease-out] motion-reduce:animate-none"
      >
        <div
          className="relative flex h-full w-[min(1024px,calc(100vw-2rem))] shrink-0 overflow-hidden rounded-modal border border-bg-border bg-bg-card"
          style={{ boxShadow: '0 40px 80px rgba(0,0,0,0.5)' }}
        >
          {/* 배경 글로우 */}
          <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            <div className="absolute" style={{ top: -100, left: -100, width: 400, height: 400, borderRadius: 999, background: 'radial-gradient(circle, rgb(var(--color-accent) / 0.16) 0%, transparent 60%)', filter: 'blur(40px)' }} />
            <div className="absolute" style={{ bottom: -150, right: -100, width: 500, height: 500, borderRadius: 999, background: 'radial-gradient(circle, rgb(var(--color-accent-sub) / 0.12) 0%, transparent 60%)', filter: 'blur(50px)' }} />
          </div>

          {/* 좌측 목록 */}
          <aside className="relative z-[1] hidden w-[200px] shrink-0 border-r border-bg-border/60 lg:flex flex-col min-h-0">
            <div className="px-3 py-3 border-b border-bg-border/40 shrink-0">
              <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary cursor-pointer">
                <X size={18} /> 닫기
              </button>
              <div className="relative mt-3">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  value={listQuery}
                  onChange={(event) => setListQuery(event.target.value)}
                  placeholder="목록 검색"
                  className="w-full rounded-lg border border-bg-border bg-bg-border/15 py-1.5 pl-7 pr-2 text-xs text-text-primary outline-none placeholder:text-text-secondary focus:border-accent/50"
                />
              </div>
              {hasGridFilter && (
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-text-secondary truncate">
                    {showAllList ? `전체 ${allVisibleCharacters.length}명` : `필터 결과 ${visibleCharacters.length}명`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllList((v) => !v)}
                    className="shrink-0 text-accent hover:underline cursor-pointer whitespace-nowrap"
                  >
                    {showAllList ? '필터 결과만' : '전체 보기'}
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto py-1.5">
              {filteredListCharacters.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-text-secondary">검색 결과가 없어요.</div>
              ) : filteredListCharacters.map((c) => (
                <CharacterListRow key={c.id} character={c} costumes={byCharacter.get(c.id) ?? EMPTY_COSTUMES} selected={c.id === selectedId} onSelect={setSelectedId} />
              ))}
            </div>
          </aside>

          {/* 우측 상세 */}
          <main className="relative z-[1] flex-1 min-w-0">
            {selected && (
              <CharacterDetailPanel
                character={selected}
                onClose={onClose}
                commentOpen={commentOpen}
                onToggleComment={() => setCommentOpen((v) => !v)}
                commentCount={commentCount}
              />
            )}
          </main>
        </div>

        {/* 댓글 패널 — 씬 상세모달과 동일한 리사이즈 패널(char:{id} 스레드). 열기/닫기 + 드래그 너비 조절. */}
        {commentOpen && selected && (
          <CommentPanelResizable
            key={selected.id}
            sceneKey={`char:${selected.id}`}
            characterThread={{ characterId: selected.id, characterName: selected.name }}
            headerTitle="이 캐릭터에 대한 이야기"
            sceneLabel={selected.name}
            commentCount={commentCount}
            onCountChange={setCommentCount}
            heightClass="h-full"
            className="rounded-modal"
            headerRight={
              <button type="button" onClick={() => setCommentOpen(false)} aria-label="댓글 닫기" title="댓글 닫기" className="text-text-secondary hover:text-text-primary cursor-pointer">
                <X size={18} />
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}

function AddCharacterModal({ onClose }: { onClose: () => void }) {
  const addCharacter = useCharacterBoardStore((s) => s.addCharacter);
  const characters = useCharacterBoardStore((s) => s.characters);
  const [name, setName] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const modalFocus = useModalFocus(dialogRef, { autoFocus: false });
  // 동시/중복 생성으로 같은 이름의 카드가 2장 생기는 사고 예방 — 경고만 하고 추가는 막지 않는다 (GAP-D).
  const duplicateName = useMemo(() => {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return null;
    return characters.find((c) => c.name.trim().toLowerCase() === normalized) ?? null;
  }, [characters, name]);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const created = await addCharacter(name.trim(), memo.trim() || undefined);
    setSaving(false);
    if (created) onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`fixed inset-0 ${CHARACTER_LAYER_CLASS.modal} flex items-center justify-center bg-overlay/50 p-6`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="캐릭터 추가"
        tabIndex={-1}
        onKeyDown={modalFocus.onKeyDown}
        className="bg-bg-card border border-bg-border rounded-2xl w-full max-w-md p-5 flex flex-col gap-4 outline-none"
      >
        <h2 className="text-lg font-semibold text-text-primary">캐릭터 추가</h2>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">이름</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="캐릭터 이름" className="bg-transparent border border-bg-border rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent/50" />
          {duplicateName && (
            <span className="text-[11px]" style={{ color: 'rgb(var(--char-stage-feedback))' }}>
              {duplicateName.status === 'archived'
                ? '보관된 캐릭터 중에 같은 이름이 있어요 — 복원해서 쓸 수도 있어요.'
                : '같은 이름의 캐릭터가 이미 있어요 — 그래도 추가할 수 있어요.'}
            </span>
          )}
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

  const [detailRequest, setDetailRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [cardMenu, setCardMenu] = useState<{ characterId: string; x: number; y: number } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const detailCharacter = useMemo(() => characters.find((c) => c.id === detailRequest?.id) ?? null, [characters, detailRequest?.id]);
  useEffect(() => { if (detailRequest && !detailCharacter) setDetailRequest(null); }, [detailRequest, detailCharacter]);

  // 에피소드 에셋 탭의 '캐릭터 현황판에서 보기' → 해당 캐릭터 상세 자동 오픈.
  useEffect(() => {
    if (pendingOpenId) {
      const pendingCharacter = characters.find((c) => c.id === pendingOpenId);
      if (pendingCharacter?.status === 'archived') setShowArchived(true);
      setDetailRequest((prev) => ({ id: pendingOpenId, nonce: (prev?.nonce ?? 0) + 1 }));
      onConsumeOpen?.();
    }
  }, [characters, pendingOpenId, onConsumeOpen]);

  const activeCharacters = useMemo(() => characters.filter((c) => c.status !== 'archived'), [characters]);
  const archivedCharacters = useMemo(() => characters.filter((c) => c.status === 'archived'), [characters]);
  const visibleCharacters = showArchived ? archivedCharacters : activeCharacters;

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
    return visibleCharacters.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (activeTags.length > 0) { const tags = characterTags(c.id); if (!activeTags.every((t) => tags.has(t))) return false; }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCharacters, query, activeTags, byCharacter]);
  const cardMenuCharacter = cardMenu ? characters.find((c) => c.id === cardMenu.characterId) ?? null : null;
  const cardMenuCostumes = cardMenuCharacter ? byCharacter.get(cardMenuCharacter.id) ?? [] : [];
  const cardMenuFeatured = cardMenuCostumes.find((c) => c.featuredImageUrl) ?? null;
  const cardMenuFileCostume = cardMenuFeatured?.workFilePath
    ? cardMenuFeatured
    : cardMenuCostumes.find((c) => c.workFilePath) ?? null;

  function toggleTag(tag: string) {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  // CharacterCard(memo) 용 안정 콜백 — 그리드 map 안 캐릭터별 인라인 클로저는 memo 를 무력화한다 (CQ-6).
  const openCharacterDetail = useCallback((characterId: string) => {
    setDetailRequest((prev) => ({ id: characterId, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);
  const openCardContextMenu = useCallback((characterId: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setCardMenu({ characterId, x: event.clientX, y: event.clientY });
  }, []);

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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="overflow-hidden rounded-xl border border-bg-border bg-bg-card">
            <div className="aspect-[3/4] bg-bg-border/30 animate-pulse motion-reduce:animate-none" />
            <div className="space-y-2 p-3">
              <div className="h-4 w-3/4 rounded bg-bg-border/40 animate-pulse motion-reduce:animate-none" />
              <div className="h-3 w-1/2 rounded bg-bg-border/30 animate-pulse motion-reduce:animate-none" />
              <div className="flex gap-1.5">
                <div className="h-5 w-16 rounded-md bg-bg-border/30 animate-pulse motion-reduce:animate-none" />
                <div className="h-5 w-14 rounded-md bg-bg-border/30 animate-pulse motion-reduce:animate-none" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative w-full max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름으로 검색" className="w-full bg-bg-card border border-bg-border rounded-lg pl-8 pr-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50" />
          </div>
          <div className="flex items-center gap-1.5">
            {archivedCharacters.length > 0 && (
              <button
                type="button"
                onClick={() => setShowArchived((value) => !value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors shrink-0 cursor-pointer',
                  showArchived
                    ? 'border-accent/50 bg-accent/15 text-accent'
                    : 'border-bg-border text-text-secondary hover:border-text-secondary/40 hover:text-text-primary',
                )}
              >
                <Archive size={15} /> 보관 {archivedCharacters.length}
              </button>
            )}
            <button type="button" onClick={onAdd} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90 shrink-0 cursor-pointer">
              <Plus size={16} /> 캐릭터 추가
            </button>
          </div>
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {allTags.map((t) => <TagPill key={t} tag={t} on={activeTags.includes(t)} onClick={() => toggleTag(t)} />)}
            {activeTags.length > 0 && (
              <button type="button" onClick={() => setActiveTags([])} className="text-xs text-text-secondary hover:text-text-primary px-1.5 cursor-pointer">필터 해제</button>
            )}
          </div>
        )}
      </div>

      {visibleCharacters.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-text-secondary">
          <ImageIcon size={28} className="opacity-35" />
          <div className="text-sm">
            {showArchived ? '보관된 캐릭터가 없어요.' : '아직 캐릭터가 없습니다.'}
          </div>
          {!showArchived && (
            <button type="button" onClick={onAdd} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm text-white hover:opacity-90">
              <Plus size={15} /> 캐릭터 추가
            </button>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-text-secondary">
          <Search size={24} className="opacity-45" />
          <div className="text-sm">조건에 맞는 캐릭터가 없어요.</div>
          <button
            type="button"
            onClick={() => { setQuery(''); setActiveTags([]); }}
            className="rounded-lg border border-bg-border px-3 py-2 text-sm text-text-primary hover:border-accent/50 hover:bg-bg-border/30"
          >
            검색·필터 초기화
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {filtered.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              costumes={byCharacter.get(c.id) ?? EMPTY_COSTUMES}
              onOpen={openCharacterDetail}
              onContextMenu={openCardContextMenu}
            />
          ))}
        </div>
      )}

      {cardMenu && cardMenuCharacter && (
        <CharacterImageContextMenu
          variant="card"
          x={cardMenu.x}
          y={cardMenu.y}
          character={cardMenuCharacter}
          imageCostume={cardMenuFeatured}
          fileCostume={cardMenuFileCostume}
          onClose={() => setCardMenu(null)}
        />
      )}

      {detailCharacter && detailRequest && (
        <CharacterDetailModal
          key={`${detailCharacter.id}:${detailRequest.nonce}`}
          initialCharacterId={detailCharacter.id}
          archivedMode={showArchived}
          filteredIds={query.trim() || activeTags.length > 0 ? filtered.map((c) => c.id) : undefined}
          onClose={() => setDetailRequest(null)}
        />
      )}
    </div>
  );
}

export function CharacterBoardView() {
  const ensureLoadedAndRealtime = useCharacterBoardStore((s) => s.ensureLoadedAndRealtime);
  const loaded = useCharacterBoardStore((s) => s.loaded);
  const pendingCharacterBoardRequest = useAppStore((s) => s.pendingCharacterBoardRequest);
  const setPendingCharacterBoardRequest = useAppStore((s) => s.setPendingCharacterBoardRequest);

  const [tab, setTab] = useState<BoardTab>('board');
  const [addOpen, setAddOpen] = useState(false);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  useEffect(() => {
    const release = ensureLoadedAndRealtime();
    return () => { release(); };
  }, [ensureLoadedAndRealtime]);

  useEffect(() => {
    if (!pendingCharacterBoardRequest || !loaded) return;
    setTab('board');
    setPendingOpenId(pendingCharacterBoardRequest.characterId);
    setPendingCharacterBoardRequest(null);
  }, [loaded, pendingCharacterBoardRequest, setPendingCharacterBoardRequest]);

  // 미소비 딥링크 요청 청소는 useAppStore.setView(다른 뷰로 이동 시)와 goBackNavigation이 담당 —
  //   언마운트 cleanup 방식은 StrictMode 이중 마운트에서 정상 요청까지 지워 사용하지 않는다.

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
