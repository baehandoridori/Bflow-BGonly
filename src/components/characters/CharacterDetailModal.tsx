import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { toast } from 'sonner';
import { Archive, Film, Plus, X, Image as ImageIcon, Trash2, Pencil, Search, User, MessageSquare, RotateCcw, GripVertical } from 'lucide-react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { moveCostumeInOrder } from '@/stores/characterBoardStoreHelpers';
import { useDataStore } from '@/stores/useDataStore';
import { useModalFocus } from '@/hooks/useModalFocus';
import type { Character, CharacterCostume, CharacterImageBackground, CharacterImageFit } from '@/types';
import { createAndLinkCharacterFolder } from '@/services/characterFolderService';
import { cn } from '@/utils/cn';
import { CommentPanelResizable } from '@/components/scenes/CommentPanelResizable';
import { CharacterImageFrame } from '@/components/characters/CharacterImageFrame';
import { CharacterImageContextMenu } from '@/components/characters/CharacterImageContextMenu';
import { CharacterImageFitEditor } from '@/components/characters/CharacterImageFitEditor';
import { CharacterImageLightbox, type CharacterImageLightboxEntry } from '@/components/characters/CharacterImageLightbox';
import { EMPTY_COSTUMES } from '@/components/characters/CharacterCard';
import { FeaturedImageSlot, CostumeIdentity } from '@/components/characters/FeaturedImageSlot';
import { CostumeDetail } from '@/components/characters/CostumeDetail';
import { chooseWorkFile, chooseWorkFolder } from '@/services/sceneWorkLinkService';
import { claimReactKey } from '@/utils/claimReactKey';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { RIGGING_STAGE_META, characterStageColor } from '@/constants/characterStages';
import { CHARACTER_LAYER_CLASS } from '@/constants/characterLayers';
import {
  copyCharacterImage,
  resolveFolderAfterCharacterFilePick,
} from '@/services/characterPathActions';
import { openOrRegisterEpisodeReel } from '@/services/episodeReelActions';
import { costumeNameForNew } from '@/utils/characterCostumeName';

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
  dragging,
  onSelect,
  onDelete,
  onImageContextMenu,
  onDragStartCostume,
  onDropCostume,
  onDragEndCostume,
}: {
  costume: CharacterCostume;
  selected: boolean;
  dragging: boolean;
  onSelect: (costumeId: string) => void;
  onDelete: (costumeId: string) => void | Promise<void>;
  onImageContextMenu: (costumeId: string, event: ReactMouseEvent<HTMLDivElement>) => void;
  onDragStartCostume: (costumeId: string) => void;
  onDropCostume: (costumeId: string) => void;
  onDragEndCostume: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStartCostume(costume.id); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDrop={(e) => { e.preventDefault(); onDropCostume(costume.id); }}
      onDragEnd={onDragEndCostume}
      onClick={() => onSelect(costume.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(costume.id); } }}
      aria-pressed={selected}
      title="드래그해서 순서 바꾸기"
      className={cn(
        'group relative w-[104px] shrink-0 flex flex-col rounded-lg overflow-hidden border transition-colors cursor-pointer',
        selected ? 'border-accent ring-1 ring-accent/40' : 'border-bg-border hover:border-text-secondary/50',
        dragging && 'opacity-40',
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1 top-1 z-[1] rounded bg-black/40 p-0.5 text-white/80 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <GripVertical size={12} />
      </div>
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
  initialCostumeId,
  onClose,
  commentOpen,
  onToggleComment,
  commentCount,
}: {
  character: Character;
  initialCostumeId?: string;
  onClose: () => void;
  commentOpen: boolean;
  onToggleComment: () => void;
  commentCount: number;
}) {
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const imagesByCostume = useCharacterBoardStore((s) => s.imagesByCostume);
  const updateCostumeImageField = useCharacterBoardStore((s) => s.updateCostumeImageField);
  const addCostume = useCharacterBoardStore((s) => s.addCostume);
  const deleteCostume = useCharacterBoardStore((s) => s.deleteCostume);
  const reorderCostumes = useCharacterBoardStore((s) => s.reorderCostumes);
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
  // B8: 카드에서 휠로 넘겨 보던 복장이 있으면 그 복장으로 열린다(초기 캐릭터 한정 — 이후 다른 캐릭터로 바꾸면 아래 효과가 첫 복장으로 리셋).
  const [activeCostumeId, setActiveCostumeId] = useState<string | null>(() => (
    initialCostumeId && costumes.some((c) => c.id === initialCostumeId) ? initialCostumeId : costumes[0]?.id ?? null
  ));
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(character.name);
  const [lightboxCostumeId, setLightboxCostumeId] = useState<string | null>(null);
  // 갤러리에서 고른 (비대표일 수 있는) 이미지로 라이트박스를 열기 위한 오버라이드 (코덱스 P2).
  const [lightboxImage, setLightboxImage] = useState<{ id: string; url: string; background: CharacterImageBackground; fit: CharacterImageFit } | null>(null);
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
    .map((c) => {
      // 갤러리에서 고른 비대표 이미지로 열렸으면 그 이미지로 표시(코덱스 P2). 그 외엔 대표(featured).
      const override = c.id === lightboxCostumeId ? lightboxImage : null;
      const costumeImgs = imagesByCostume.get(c.id) ?? [];
      const primaryImg = costumeImgs.find((i) => i.isPrimary) ?? costumeImgs[0] ?? null;
      return {
        costumeId: c.id,
        // 썸네일 맞추기가 대표가 아닌 '표시 중인 그 이미지'의 fit 을 갱신하도록 imageId 를 실는다(코덱스 P2).
        imageId: override?.id ?? primaryImg?.id,
        name: `${character.name} · ${c.name}`,
        costumeName: c.name,
        versionNo: c.versionNo,
        url: override?.url ?? c.featuredImageUrl!,
        background: override?.background ?? c.imageBackground,
        fit: override?.fit ?? c.imageFit,
      };
    });
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
    const created = await addCostume(character.id, costumeNameForNew(costumes));
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
    const created = await addCostume(character.id, costumeNameForNew(costumes));
    if (created) setActiveCostumeId(created.id);
  };

  // CostumeThumbCard(memo) 용 안정 콜백 — 갤러리 map 안 인라인 클로저는 memo 를 무력화한다 (CQ-6).
  const openCostumeImageMenu = useCallback((costumeId: string, event: ReactMouseEvent<HTMLDivElement>) => {
    setActiveCostumeId(costumeId);
    setImageMenu({ costumeId, x: event.clientX, y: event.clientY });
  }, []);

  // B10: 복장 드래그 재배치 — 콜백을 안정 참조로(memo 유지), 최신 순서는 store 에서 재조회.
  const [draggingCostumeId, setDraggingCostumeId] = useState<string | null>(null);
  const draggingCostumeIdRef = useRef<string | null>(null);
  const handleCostumeDragStart = useCallback((costumeId: string) => {
    draggingCostumeIdRef.current = costumeId;
    setDraggingCostumeId(costumeId);
  }, []);
  const handleCostumeDragEnd = useCallback(() => {
    draggingCostumeIdRef.current = null;
    setDraggingCostumeId(null);
  }, []);
  const handleCostumeDrop = useCallback((targetId: string) => {
    const dragId = draggingCostumeIdRef.current;
    draggingCostumeIdRef.current = null;
    setDraggingCostumeId(null);
    if (!dragId || dragId === targetId) return;
    const currentIds = (useCharacterBoardStore.getState().byCharacter.get(character.id) ?? []).map((c) => c.id);
    // 드래그 방향에 따라 대상 앞/뒤로 삽입 — 바로 다음 항목 드롭이 no-op 되지 않게.
    void reorderCostumes(character.id, moveCostumeInOrder(currentIds, dragId, targetId));
  }, [character.id, reorderCostumes]);

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
              onView={(costumeId, image) => { setLightboxCostumeId(costumeId); setLightboxImage(image ?? null); }}
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
                    dragging={draggingCostumeId === c.id}
                    onSelect={setActiveCostumeId}
                    onDelete={deleteCostume}
                    onImageContextMenu={openCostumeImageMenu}
                    onDragStartCostume={handleCostumeDragStart}
                    onDropCostume={handleCostumeDrop}
                    onDragEndCostume={handleCostumeDragEnd}
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
          onClose={() => { setLightboxCostumeId(null); setLightboxImage(null); }}
          onFitCommit={(imageId, fit) => updateCostumeImageField(imageId, { imageFit: fit })}
          onCopyImage={(url) => copyCharacterImage(url)}
        />
      )}
    </div>
  );
}

/** 카드 클릭 → 오버레이 + 좌측 목록 / 우측 상세. */
export function CharacterDetailModal({
  initialCharacterId,
  initialCostumeId,
  archivedMode = false,
  filteredIds,
  onClose,
}: {
  initialCharacterId: string;
  /** 카드에서 휠로 넘겨 보던 복장 — 열릴 때 이 복장을 선택 (B8). */
  initialCostumeId?: string;
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
                initialCostumeId={selected.id === initialCharacterId ? initialCostumeId : undefined}
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
