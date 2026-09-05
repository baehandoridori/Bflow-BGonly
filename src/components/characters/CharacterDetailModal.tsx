import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { toast } from 'sonner';
import { Archive, Film, Plus, X, Image as ImageIcon, Trash2, Pencil, Search, User, MessageSquare, RotateCcw, GripVertical } from 'lucide-react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { moveCostumeInOrder, dropEdgeFor } from '@/stores/characterBoardStoreHelpers';
import { applyDragGhost } from '@/utils/dragGhost';
import { useDataStore } from '@/stores/useDataStore';
import { useModalFocus } from '@/hooks/useModalFocus';
import type { Character, CharacterCostume, CharacterImageFit } from '@/types';
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
import { AddCharacterModal } from '@/components/characters/AddCharacterModal';
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
import { buildCostumeCandidates } from '@/utils/hashtagCandidates';
import { useCostumeEditingPresence, useCostumeCollisionWarn } from '@/stores/useEditingPresenceStore';
import { editingModalBeamClass } from '@/utils/editingPresence';
import { EditingPresenceBanner } from '@/components/scenes/EditingPresenceBanner';
import { navigateToHashTarget } from '@/utils/hashNavigation';
import type { HashTarget } from '@/utils/hashEntity';

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
  dropEdge,
  onSelect,
  onDelete,
  onImageContextMenu,
  onDragStartCostume,
  onDragOverCostume,
  onDropCostume,
  onDragEndCostume,
}: {
  costume: CharacterCostume;
  selected: boolean;
  dragging: boolean;
  /** 드래그 중 이 복장의 어느 쪽에 삽입선을 그릴지 — 대상이 아니면 null. */
  dropEdge: 'before' | 'after' | null;
  onSelect: (costumeId: string) => void;
  onDelete: (costumeId: string) => void | Promise<void>;
  onImageContextMenu: (costumeId: string, event: ReactMouseEvent<HTMLDivElement>) => void;
  onDragStartCostume: (costumeId: string) => void;
  onDragOverCostume: (costumeId: string) => void;
  onDropCostume: (costumeId: string) => void;
  onDragEndCostume: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        applyDragGhost(e.dataTransfer, { label: costume.name, imageUrl: costume.featuredImageUrl });
        onDragStartCostume(costume.id);
      }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOverCostume(costume.id); }}
      onDrop={(e) => { e.preventDefault(); onDropCostume(costume.id); }}
      onDragEnd={onDragEndCostume}
      onClick={() => onSelect(costume.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(costume.id); } }}
      aria-pressed={selected}
      title="드래그해서 순서 바꾸기"
      className={cn(
        'group relative w-[104px] shrink-0 flex flex-col rounded-lg border cursor-pointer',
        'transition-[transform,opacity,border-color] duration-150 ease-out motion-reduce:transition-none',
        selected ? 'border-accent ring-1 ring-accent/40' : 'border-bg-border hover:border-text-secondary/50',
        // 드래그 중 소스는 살짝 작아지며 흐려져 "칩으로 들려 나갔다"는 느낌을 준다.
        dragging ? 'opacity-30 scale-[0.96] motion-reduce:scale-100' : 'scale-100',
      )}
    >
      {dropEdge && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-0.5 bottom-0.5 z-[3] w-[3px] rounded-full bg-accent',
            'shadow-[0_0_8px_1px_rgb(var(--color-accent)/0.7)] animate-pulse motion-reduce:animate-none',
            dropEdge === 'before' ? '-left-[7px]' : '-right-[7px]',
          )}
        />
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1 top-1 z-[1] rounded bg-black/40 p-0.5 text-white/80 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <GripVertical size={12} />
      </div>
      <div className="aspect-[3/4] w-full bg-bg-border/30 flex items-center justify-center overflow-hidden rounded-t-lg">
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
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 bg-bg-card rounded-b-lg">
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
  costumeRequest,
  onClose,
  commentOpen,
  onToggleComment,
  commentCount,
}: {
  character: Character;
  initialCostumeId?: string;
  /** 외부(댓글 복장 태그)에서 특정 복장을 열라는 요청 — nonce 변경마다 소비 (피드백 49). */
  costumeRequest?: { costumeId: string; nonce: number } | null;
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
  // 피드백 54: 이 캐릭터의 복장 파일 열림 배너(씬 상세 모달의 배너와 동일 위상 — 헤더 아래·본문 위).
  const panelPresenceEditors = useCostumeEditingPresence(costumes.map((c) => c.id));
  const panelPresenceWarn = useCostumeCollisionWarn(costumes.map((c) => c.id));
  // B8: 카드에서 휠로 넘겨 보던 복장이 있으면 그 복장으로 열린다(초기 캐릭터 한정 — 이후 다른 캐릭터로 바꾸면 아래 효과가 첫 복장으로 리셋).
  const [activeCostumeId, setActiveCostumeId] = useState<string | null>(() => (
    initialCostumeId && costumes.some((c) => c.id === initialCostumeId) ? initialCostumeId : costumes[0]?.id ?? null
  ));
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(character.name);
  const [lightboxCostumeId, setLightboxCostumeId] = useState<string | null>(null);
  // 갤러리에서 고른 (비대표일 수 있는) 이미지로 라이트박스를 열기 위한 오버라이드 (코덱스 P2).
  // 라이트박스에서 고른(비대표) 이미지의 id 만 보관하고, 값은 live imagesByCostume 에서 해석한다.
  //   스냅샷을 들고 있으면 fit 을 편집·저장한 뒤에도 낡은 값이 남아 다음 편집이 덮어쓴다(코덱스 P2).
  const [lightboxImageId, setLightboxImageId] = useState<string | null>(null);
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

  // 피드백 49: 복장 전환 요청 소비 — 캐릭터 전환 직후 costumes 가 아직 이전 것일 수 있어 존재 확인 후 반영.
  //   nonce 를 1회만 소비한다: 소비하지 않으면 이후 복장 편집·Realtime 수신으로 costumes 배열이 새로 만들어질 때마다
  //   이 이펙트가 다시 돌아, 사용자가 수동으로 고른 복장을 옛 요청으로 되돌린다(코덱스 2차 P2).
  const consumedCostumeNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!costumeRequest || consumedCostumeNonceRef.current === costumeRequest.nonce) return;
    if (costumes.some((c) => c.id === costumeRequest.costumeId)) {
      consumedCostumeNonceRef.current = costumeRequest.nonce;
      setActiveCostumeId(costumeRequest.costumeId);
    }
  }, [costumeRequest, costumes]);

  useEffect(() => { setEditingName(false); setNameDraft(character.name); }, [character.id, character.name]);

  const activeCostume = costumes.find((c) => c.id === activeCostumeId) ?? null;
  const imageEntries: CharacterImageLightboxEntry[] = costumes
    .filter((c) => !!c.featuredImageUrl)
    .map((c) => {
      const costumeImgs = imagesByCostume.get(c.id) ?? [];
      const primaryImg = costumeImgs.find((i) => i.isPrimary) ?? costumeImgs[0] ?? null;
      // 갤러리에서 고른 비대표 이미지로 열렸으면 그 이미지로 표시(코덱스 P2). id 로 live 상태에서 해석해
      //   fit 편집 직후에도 최신 값을 쓰게 한다. 그 외엔 대표(featured).
      const override = c.id === lightboxCostumeId && lightboxImageId
        ? costumeImgs.find((i) => i.id === lightboxImageId) ?? null
        : null;
      return {
        costumeId: c.id,
        // 썸네일 맞추기가 대표가 아닌 '표시 중인 그 이미지'의 fit 을 갱신하도록 imageId 를 실는다(코덱스 P2).
        imageId: override?.id ?? primaryImg?.id,
        name: `${character.name} · ${c.name}`,
        costumeName: c.name,
        versionNo: c.versionNo,
        url: override?.url ?? c.featuredImageUrl!,
        background: override?.imageBackground ?? c.imageBackground,
        fit: override?.imageFit ?? c.imageFit,
      };
    });
  const menuCostume = imageMenu ? costumes.find((c) => c.id === imageMenu.costumeId) ?? null : null;
  const fitEditorCostume = fitEditorCostumeId ? costumes.find((c) => c.id === fitEditorCostumeId) ?? null : null;
  // 썸네일 컨텍스트메뉴의 배경/맞추기는 이미지 행이 진실(트리거가 대표 이미지 기준으로 featured 를 확정)이므로
  //   복장이 아니라 대표 이미지 행으로 저장한다(코덱스 P2 — 안 그러면 편집이 즉시 어긋나고 다음 동기화에 덮인다).
  const primaryImageOf = (costumeId: string) => {
    const imgs = imagesByCostume.get(costumeId) ?? [];
    return imgs.find((i) => i.isPrimary) ?? imgs[0] ?? null;
  };
  const fitEditorImage = fitEditorCostumeId ? primaryImageOf(fitEditorCostumeId) : null;

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
  const [dropTargetCostumeId, setDropTargetCostumeId] = useState<string | null>(null);
  const draggingCostumeIdRef = useRef<string | null>(null);
  const handleCostumeDragStart = useCallback((costumeId: string) => {
    draggingCostumeIdRef.current = costumeId;
    setDraggingCostumeId(costumeId);
  }, []);
  const handleCostumeDragOver = useCallback((costumeId: string) => {
    // 드롭 대상만 기록 — 삽입선 방향은 렌더 시 현재 순서로 계산한다(dropEdgeFor).
    setDropTargetCostumeId((prev) => (prev === costumeId ? prev : costumeId));
  }, []);
  const handleCostumeDragEnd = useCallback(() => {
    draggingCostumeIdRef.current = null;
    setDraggingCostumeId(null);
    setDropTargetCostumeId(null);
  }, []);
  const handleCostumeDrop = useCallback((targetId: string) => {
    const dragId = draggingCostumeIdRef.current;
    draggingCostumeIdRef.current = null;
    setDraggingCostumeId(null);
    setDropTargetCostumeId(null);
    if (!dragId || dragId === targetId) return;
    const currentIds = (useCharacterBoardStore.getState().byCharacter.get(character.id) ?? []).map((c) => c.id);
    // 드래그 방향에 따라 대상 앞/뒤로 삽입 — 바로 다음 항목 드롭이 no-op 되지 않게.
    void reorderCostumes(character.id, moveCostumeInOrder(currentIds, dragId, targetId));
  }, [character.id, reorderCostumes]);

  // 삽입선 표시용 — 현재 복장 순서(id 배열). 드롭 대상 카드에만 방향성 바를 그린다.
  const costumeOrderIds = useMemo(() => costumes.map((c) => c.id), [costumes]);

  const handleArchiveCharacter = async () => {
    const ok = await ConfirmDialog.show({
      message: `'${character.name}' 캐릭터를 보관할까요?\n보관된 캐릭터는 기본 목록과 검색에서 숨겨지고, 보관 목록에서 다시 복원할 수 있어요.\n완전히 지우려면 보관 후 '보관 N' 목록에서 열어 '영구 삭제'를 누르면 돼요.`,
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

      {/* 실시간 편집 프레즌스 — 배너(헤더 아래·본문 밖: .editing-banner 자체 마진이 이 자리 기준으로 저작됨). */}
      <EditingPresenceBanner editors={panelPresenceEditors} warn={panelPresenceWarn} />

      {/* 본문 (스크롤) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        <div className="flex gap-6 flex-col lg:flex-row">
          {/* 좌측: 큰 이미지 + 복장명 + 메모 */}
          <div className="flex flex-col gap-3">
            <FeaturedImageSlot
              character={character}
              costume={activeCostume}
              onView={(costumeId, image) => { setLightboxCostumeId(costumeId); setLightboxImageId(image?.id ?? null); }}
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
              {/* px-2: 첫 썸네일의 '앞(before)' 삽입선(-left-[7px])이 overflow-x-auto 스크롤 원점 왼쪽으로 잘리지 않도록 좌우 여백 확보. */}
              <div ref={galleryRef} className="flex items-stretch gap-2.5 overflow-x-auto px-2 pb-1">
                {costumes.map((c) => (
                  <CostumeThumbCard
                    key={c.id}
                    costume={c}
                    selected={activeCostumeId === c.id}
                    dragging={draggingCostumeId === c.id}
                    dropEdge={dropTargetCostumeId === c.id ? dropEdgeFor(costumeOrderIds, draggingCostumeId, c.id) : null}
                    onSelect={setActiveCostumeId}
                    onDelete={deleteCostume}
                    onImageContextMenu={openCostumeImageMenu}
                    onDragStartCostume={handleCostumeDragStart}
                    onDragOverCostume={handleCostumeDragOver}
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
          onBackground={(costumeId, background) => {
            const img = primaryImageOf(costumeId);
            if (img) updateCostumeImageField(img.id, { imageBackground: background });
          }}
          onEditFit={(costumeId) => setFitEditorCostumeId(costumeId)}
        />
      )}
      {fitEditorImage && fitEditorCostume && (
        <CharacterImageFitEditor
          url={fitEditorImage.url}
          alt={fitEditorCostume.name}
          background={fitEditorImage.imageBackground}
          fit={fitEditorImage.imageFit}
          onCommit={(fit: CharacterImageFit) => updateCostumeImageField(fitEditorImage.id, { imageFit: fit })}
          onClose={() => setFitEditorCostumeId(null)}
        />
      )}
      {lightboxCostumeId && imageEntries.length > 0 && (
        <CharacterImageLightbox
          entries={imageEntries}
          initialCostumeId={lightboxCostumeId}
          onClose={() => { setLightboxCostumeId(null); setLightboxImageId(null); }}
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

  // 재진입 시 도는 조용한 재조회 — 이 동안의 복장 태그 클릭은 낡은 목록으로 판정하지 않는다(코덱스 6차 P2).
  const boardLoading = useCharacterBoardStore((s) => s.loading);

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
  const [addOpen, setAddOpen] = useState(false);
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
  // 피드백 54: 선택된 캐릭터의 복장 파일 열림 — 모달 본체 링 + 우측 상세 배너용.
  const selectedCostumeUuids = selected ? (byCharacter.get(selected.id) ?? []).map((c) => c.id) : [];
  const modalPresenceEditors = useCostumeEditingPresence(selectedCostumeUuids);
  const modalPresenceWarn = useCostumeCollisionWarn(selectedCostumeUuids);

  // 피드백 49: 댓글 복장 태그 클릭 → 좌측 패널의 활성 복장 전환 요청 (nonce 로 같은 복장 재클릭도 소비).
  const [costumeRequest, setCostumeRequest] = useState<{ costumeId: string; nonce: number } | null>(null);

  const costumeHashCandidates = useCallback(
    (filter: string) => {
      if (!selected) return [];
      return buildCostumeCandidates(
        (byCharacter.get(selected.id) ?? []).map((c) => ({ id: c.id, characterId: c.characterId, name: c.name, versionNo: c.versionNo })),
        selected.name,
        filter,
      );
    },
    [byCharacter, selected],
  );

  const resolveCostumeHashTarget = useCallback((target: Extract<HashTarget, { kind: 'costume' }>) => {
    if (!selected) return;
    const costumes = byCharacter.get(target.characterId) ?? [];
    const found = costumes.find((c) => c.id === target.costumeId) ?? null;
    if (target.characterId !== selected.id) {
      // 다른 캐릭터의 태그(붙여넣기 등) — 이 모달이 다룰 수 있는 목록(보관/활성 구분)에 있을 때만 전환한다.
      //   목록 필터 밖이면 기존 자동 보정 이펙트가 '전체 보기'로 전환해 유지하므로 스냅되지 않는다.
      if (!allVisibleCharacters.some((c) => c.id === target.characterId)) {
        toast.info('이 태그의 캐릭터는 지금 목록에 없어요 — 검색·필터를 해제하고 다시 열어 주세요');
        return;
      }
      setSelectedId(target.characterId);
    }
    if (!found) {
      toast.info('태그된 복장을 찾을 수 없어요 — 삭제되었을 수 있어요');
      return;
    }
    setCostumeRequest((prev) => ({ costumeId: target.costumeId, nonce: (prev?.nonce ?? 0) + 1 }));
    if (target.versionNo !== undefined && found.versionNo !== target.versionNo) {
      toast.info(`이 태그는 v${target.versionNo} 때 남긴 기록이에요 — 지금은 v${found.versionNo}`);
    }
  }, [byCharacter, selected, allVisibleCharacters]);

  // 조용한 재조회 중에는 복장 목록이 아직 낡았을 수 있다 — 클릭을 보류했다가 재조회가 끝나면 그때 판정한다
  //   (안 그러면 원격에서 지운 복장이 잠깐 열리거나, 올라간 버전의 안내가 누락된다. 코덱스 6차 P2).
  const [pendingHashTarget, setPendingHashTarget] = useState<Extract<HashTarget, { kind: 'costume' }> | null>(null);
  useEffect(() => {
    if (!pendingHashTarget || boardLoading) return;
    resolveCostumeHashTarget(pendingHashTarget);
    setPendingHashTarget(null);
  }, [pendingHashTarget, boardLoading, resolveCostumeHashTarget]);

  const handleCommentHashClick = (target: HashTarget) => {
    if (target.kind !== 'costume') { navigateToHashTarget(target); return; }
    if (boardLoading) { setPendingHashTarget(target); return; }
    resolveCostumeHashTarget(target);
  };
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
      if (addOpen) return; // 추가 모달이 열려 있으면 그쪽 리스너가 닫는다 — 상세까지 같이 닫히지 않게.
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, addOpen]);

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
          className={cn(
            'relative flex h-full w-[min(1024px,calc(100vw-2rem))] shrink-0 overflow-hidden rounded-modal border border-bg-border bg-bg-card',
            // 실시간 편집 프레즌스 — 모달 본체 안쪽 무지개 링(본체는 비스크롤 — 스크롤은 내부 aside/main 소유).
            editingModalBeamClass(modalPresenceEditors.length > 0, modalPresenceWarn),
          )}
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
            {!archivedMode && (
              <div className="shrink-0 border-t border-bg-border/40 p-1.5">
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-sm text-text-secondary hover:bg-bg-border/30 hover:text-accent transition-colors cursor-pointer"
                >
                  <Plus size={15} /> 캐릭터 추가
                </button>
              </div>
            )}
          </aside>

          {/* 우측 상세 */}
          <main className="relative z-[1] flex-1 min-w-0">
            {selected && (
              <CharacterDetailPanel
                character={selected}
                initialCostumeId={selected.id === initialCharacterId ? initialCostumeId : undefined}
                costumeRequest={costumeRequest}
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
            onHashClick={handleCommentHashClick}
            extraHashCandidates={costumeHashCandidates}
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

      {/* dialog div 닫는 태그 뒤, 오버레이 루트 div 닫는 태그 앞 — 포커스 트랩 충돌 방지(§F27). */}
      {addOpen && (
        <AddCharacterModal
          onClose={() => setAddOpen(false)}
          onCreated={(c) => setSelectedId(c.id)}
          onOpenExisting={(c) => setSelectedId(c.id)}
        />
      )}
    </div>
  );
}
