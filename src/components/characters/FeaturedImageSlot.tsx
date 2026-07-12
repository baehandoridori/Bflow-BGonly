import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { Copy, Move, Palette, Pencil, Plus, Star, Trash2, Upload } from 'lucide-react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { moveCostumeInOrder } from '@/stores/characterBoardStoreHelpers';
import type {
  Character,
  CharacterCostume,
  CharacterCostumeImage,
  CharacterImageBackground,
  CharacterImageFit,
  CostumeImageRole,
} from '@/types';
import { COSTUME_IMAGE_ROLES } from '@/types';
import { uploadCharacterImage } from '@/services/supabaseService';
import { deleteImage } from '@/services/storageService';
import { resizeBlob } from '@/utils/imageUtils';
import { dataUrlToFile } from '@/utils/dataUrlToFile';
import { cn } from '@/utils/cn';
import { CharacterImageFrame } from '@/components/characters/CharacterImageFrame';
import { CharacterImageFitEditor } from '@/components/characters/CharacterImageFitEditor';
import { claimReactKey } from '@/utils/claimReactKey';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { copyCharacterImage } from '@/services/characterPathActions';
import { CHARACTER_LAYER_CLASS } from '@/constants/characterLayers';
import { deriveCharacterNameFromFileName, isTempCharacterName } from '@/utils/characterName';

const costumeMemoDraftCache = new Map<string, string>();

/** 이미지 역할 → 사람이 읽는 라벨. 배지·역할 선택에 공용. */
const ROLE_LABEL: Record<CostumeImageRole, string> = {
  design: '디자인',
  final: '최종',
  variant: '변형',
};

const BACKGROUND_OPTIONS: { value: CharacterImageBackground; label: string }[] = [
  { value: 'transparent', label: '투명' },
  { value: 'black', label: '검정' },
  { value: 'white', label: '흰색' },
  { value: 'checker', label: '체커' },
];

/** 화면 안으로 위치를 물리고 바깥 클릭/ESC/스크롤에 닫히는 공용 떠있는 메뉴. */
function FloatingMenu({
  x,
  y,
  width = 224,
  onClose,
  children,
}: {
  x: number;
  y: number;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose();
    };
    const close = () => onClose();
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('wheel', close, { capture: true, passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('wheel', close, { capture: true });
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const element = ref.current;
    const elWidth = element?.offsetWidth ?? width;
    const elHeight = element?.offsetHeight ?? 280;
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - elWidth - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - elHeight - 8)),
    });
  }, [x, y, width]);

  return (
    <div
      ref={ref}
      role="menu"
      data-character-context-menu
      className={`fixed ${CHARACTER_LAYER_CLASS.menu} overflow-hidden rounded-lg border border-bg-border bg-bg-card shadow-2xl`}
      style={{ left: position.left, top: position.top, width }}
    >
      {children}
    </div>
  );
}

function MenuButton({
  icon,
  label,
  danger,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent',
        danger ? 'text-red-400 hover:bg-red-500/10' : 'text-text-primary hover:bg-bg-border/60',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** 선택 이미지 하나에 대한 액션 메뉴 — 대표 지정/역할/배경/썸네일 맞추기/복사/삭제. */
function ImageActionMenu({
  x,
  y,
  image,
  onClose,
  onSetPrimary,
  onRole,
  onBackground,
  onEditFit,
  onCopy,
  onDelete,
}: {
  x: number;
  y: number;
  image: CharacterCostumeImage;
  onClose: () => void;
  onSetPrimary: () => void;
  onRole: (role: CostumeImageRole) => void;
  onBackground: (background: CharacterImageBackground) => void;
  onEditFit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  return (
    <FloatingMenu x={x} y={y} width={224} onClose={onClose}>
      <button
        type="button"
        role="menuitem"
        disabled={image.isPrimary}
        onClick={() => { onSetPrimary(); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-border/60 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
      >
        <Star size={14} className={image.isPrimary ? 'fill-current text-amber-300' : ''} />
        <span>{image.isPrimary ? '대표 이미지' : '대표로 지정'}</span>
      </button>

      <div className="border-t border-bg-border/60 px-3 py-2">
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-text-secondary">역할</div>
        <div className="grid grid-cols-3 gap-1">
          {COSTUME_IMAGE_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              role="menuitem"
              onClick={() => { onRole(role); onClose(); }}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs border transition-colors',
                image.role === role
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-bg-border text-text-secondary hover:text-text-primary hover:border-text-secondary/40',
              )}
            >
              {ROLE_LABEL[role]}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-bg-border/60 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-secondary">
          <Palette size={12} /> 배경 표기
        </div>
        <div className="grid grid-cols-2 gap-1">
          {BACKGROUND_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitem"
              onClick={() => { onBackground(item.value); onClose(); }}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs border transition-colors',
                image.imageBackground === item.value
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-bg-border text-text-secondary hover:text-text-primary hover:border-text-secondary/40',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-bg-border/60 py-1">
        <MenuButton icon={<Move size={14} />} label="썸네일 맞추기" onClick={() => { onEditFit(); onClose(); }} />
        <MenuButton icon={<Copy size={14} />} label="이미지 복사" onClick={() => { onCopy(); onClose(); }} />
        <MenuButton icon={<Trash2 size={14} />} label="이미지 삭제" danger onClick={() => { onClose(); onDelete(); }} />
      </div>
    </FloatingMenu>
  );
}

/** 새 이미지를 어떤 역할로 추가할지 고르는 작은 메뉴 — 고르면 파일 선택으로 이어진다. */
function AddRoleMenu({
  x,
  y,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  onPick: (role: CostumeImageRole) => void;
  onClose: () => void;
}) {
  return (
    <FloatingMenu x={x} y={y} width={176} onClose={onClose}>
      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-text-secondary border-b border-bg-border/60">
        어떤 이미지로 추가할까요
      </div>
      <div className="py-1">
        {COSTUME_IMAGE_ROLES.map((role) => (
          <MenuButton
            key={role}
            icon={<Upload size={14} />}
            label={`${ROLE_LABEL[role]}(으)로 추가`}
            onClick={() => { onClose(); onPick(role); }}
          />
        ))}
      </div>
    </FloatingMenu>
  );
}

/** 갤러리 아래 썸네일 스트립의 개별 타일. */
function ImageThumb({
  image,
  selected,
  dragging,
  onSelect,
  onContextMenu,
  onDelete,
  onDragStart,
  onDropOn,
  onDragEnd,
}: {
  image: CharacterCostumeImage;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDropOn: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropOn(); }}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      onContextMenu={onContextMenu}
      aria-pressed={selected}
      title="클릭해서 보기 · 드래그해서 순서 바꾸기"
      className={cn(
        'group/thumb relative w-14 shrink-0 rounded-md overflow-hidden border transition-colors cursor-pointer',
        selected ? 'border-accent ring-1 ring-accent/40' : 'border-bg-border hover:border-text-secondary/50',
        dragging && 'opacity-40',
      )}
    >
      <CharacterImageFrame
        url={image.url}
        alt={ROLE_LABEL[image.role]}
        background={image.imageBackground}
        fit={image.imageFit}
        className="aspect-[3/4] w-full"
      />
      {image.isPrimary && (
        <span
          aria-label="대표 이미지"
          className="absolute left-0.5 top-0.5 rounded bg-black/50 p-0.5 text-amber-300"
        >
          <Star size={10} className="fill-current" />
        </span>
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[9px] leading-none text-white/90">
        {ROLE_LABEL[image.role]}
      </span>
      <button
        type="button"
        aria-label="이미지 삭제"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute right-0.5 top-0.5 rounded bg-black/50 p-0.5 text-white/80 opacity-0 transition-opacity hover:text-red-400 focus-visible:opacity-100 group-hover/thumb:opacity-100"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

/** 복장의 여러 이미지를 담는 갤러리 — 큰 미리보기 + 썸네일 스트립 + 역할/대표/배경/순서 편집. */
export function FeaturedImageSlot({
  character,
  costume,
  onView,
  onEnsureCostume,
}: {
  character: Character;
  costume: CharacterCostume | null;
  onView: (costumeId: string, image?: { id: string; url: string; background: CharacterImageBackground; fit: CharacterImageFit }) => void;
  onEnsureCostume: () => Promise<CharacterCostume | null>;
}) {
  const imagesByCostume = useCharacterBoardStore((s) => s.imagesByCostume);
  const addCostumeImage = useCharacterBoardStore((s) => s.addCostumeImage);
  const setPrimaryImage = useCharacterBoardStore((s) => s.setPrimaryImage);
  const updateCostumeImageField = useCharacterBoardStore((s) => s.updateCostumeImageField);
  const reorderCostumeImages = useCharacterBoardStore((s) => s.reorderCostumeImages);
  const deleteCostumeImage = useCharacterBoardStore((s) => s.deleteCostumeImage);
  const renameCharacter = useCharacterBoardStore((s) => s.renameCharacter);

  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRoleRef = useRef<CostumeImageRole>('design');
  const [uploading, setUploading] = useState(false);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [imageMenu, setImageMenu] = useState<{ x: number; y: number } | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [fitEditorOpen, setFitEditorOpen] = useState(false);
  const [draggingImage, setDraggingImage] = useState(false);
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const draggingImageIdRef = useRef<string | null>(null);

  const images = (costume ? imagesByCostume.get(costume.id) : undefined) ?? [];
  const primary = images.find((i) => i.isPrimary) ?? images[0] ?? null;
  const selectedImage = images.find((i) => i.id === selectedImageId) ?? primary;

  // 복장이 바뀌면 선택을 초기화 — 파생 fallback 이 새 복장의 대표를 고른다.
  useEffect(() => { setSelectedImageId(null); }, [costume?.id]);

  const handleUpload = useCallback(async (
    file: File,
    opts?: { autoName?: boolean; role?: CostumeImageRole },
  ) => {
    const targetCostume = costume ?? await onEnsureCostume();
    if (!targetCostume) return;
    setUploading(true);
    try {
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      const base64 = await resizeBlob(file, 800, isPng ? 0.92 : 0.8, isPng ? 'image/png' : 'image/jpeg');
      const res = await uploadCharacterImage(character.id, targetCostume.id, base64);
      if (!res.ok || !res.url) throw new Error(res.error ?? '업로드 실패');
      // 대표 이미지 자동 지정·featured_* 동기화는 store(addCostumeImage)+DB 트리거가 담당 —
      //   앱이 featured 를 직접 쓰지 않으므로 예전 이미지 파일을 지우지 않는다(P1 해소).
      const created = await addCostumeImage(targetCostume.id, res.url, opts?.role ?? 'design');
      // store 가 롤백(null)하면 방금 올린 파일이 고아가 됨 → 정리.
      if (!created) {
        deleteImage(res.url).catch((e) => console.warn('[character-board] 실패한 업로드 정리:', e));
        return;
      }
      setSelectedImageId(created.id);
      // 임시 이름 캐릭터에 파일선택/드래그로 첫 이미지를 넣으면 파일 이름으로 자동 지정 (B4).
      //   붙여넣기(opts.autoName=false)는 image.png 같은 일반명이라 제외.
      //   최신 이름을 store 에서 재조회 — 업로드 대기 중 다른 사용자가 이름을 지었을 수 있다(stale-closure 방지).
      if (opts?.autoName) {
        const latestName = useCharacterBoardStore.getState().characters.find((c) => c.id === character.id)?.name ?? '';
        if (isTempCharacterName(latestName)) {
          const derived = deriveCharacterNameFromFileName(file.name);
          if (derived && derived !== latestName) void renameCharacter(character.id, derived);
        }
      }
    } catch (err) {
      console.error('[character-board] 이미지 업로드 실패:', err);
      toast.error('이미지 업로드에 실패했어요');
    } finally {
      setUploading(false);
    }
  }, [character.id, costume, onEnsureCostume, addCostumeImage, renameCharacter]);

  const uploadFileIfImage = useCallback((
    file: File | null | undefined,
    opts?: { autoName?: boolean; role?: CostumeImageRole },
  ) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.info('이미지 파일만 올릴 수 있어요');
      return;
    }
    void handleUpload(file, opts);
  }, [handleUpload]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      // 패널 레벨 오버레이(액션 메뉴·썸네일 맞추기·라이트박스)는 로컬 상태 + DOM 마커로 감지.
      if (
        uploading || imageMenu || addMenu || fitEditorOpen
        || document.querySelector('[data-character-lightbox], [data-character-fit-editor], [data-character-context-menu]')
      ) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return;
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        event.preventDefault();
        // 붙여넣기 이미지는 파일 이름이 대개 image.png 같은 일반명 → 자동 이름 지정 제외. 역할은 기본 '디자인'.
        uploadFileIfImage(file, { autoName: false });
        return;
      }
      // 탐색기 '파일 복사'는 clipboardData 에 안 실리는 환경이 있어 메인 프로세스에서 클립보드의 파일 경로('FileNameW')를 직접 읽는다.
      void (async () => {
        const pasted = await window.electronAPI.clipboardReadImageFile();
        if (!pasted) return;
        const pastedFile = dataUrlToFile(pasted.dataUrl, pasted.fileName);
        // 실제 파일명이 있으므로 파일선택/드래그와 동일하게 임시 이름 캐릭터의 자동 이름 지정을 허용한다.
        uploadFileIfImage(pastedFile, { autoName: true });
      })();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addMenu, imageMenu, fitEditorOpen, uploadFileIfImage, uploading]);

  const openAddMenu = useCallback((event: React.MouseEvent) => {
    setAddMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const pickAddRole = useCallback((role: CostumeImageRole) => {
    pendingRoleRef.current = role;
    fileRef.current?.click();
  }, []);

  // 썸네일 드래그 재배치 — 최신 순서는 store 에서 재조회(CostumeThumbCard 패턴 미러).
  const handleThumbDragStart = useCallback((imageId: string) => {
    draggingImageIdRef.current = imageId;
    setDraggingImageId(imageId);
  }, []);
  const handleThumbDragEnd = useCallback(() => {
    draggingImageIdRef.current = null;
    setDraggingImageId(null);
  }, []);
  const handleThumbDrop = useCallback((targetId: string) => {
    const dragId = draggingImageIdRef.current;
    draggingImageIdRef.current = null;
    setDraggingImageId(null);
    if (!dragId || dragId === targetId || !costume) return;
    const currentIds = (useCharacterBoardStore.getState().imagesByCostume.get(costume.id) ?? []).map((i) => i.id);
    void reorderCostumeImages(costume.id, moveCostumeInOrder(currentIds, dragId, targetId));
  }, [costume, reorderCostumeImages]);

  const handleDeleteImage = useCallback(async (image: CharacterCostumeImage) => {
    const ok = await ConfirmDialog.show({
      message: '이 이미지를 삭제할까요?\n삭제한 이미지는 복구할 수 없어요.',
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (ok) await deleteCostumeImage(image.id);
  }, [deleteCostumeImage]);

  return (
    <div className="w-[240px] shrink-0 flex flex-col gap-2">
      {selectedImage ? (
        <>
          {/* 큰 미리보기 — 클릭=크게보기, 우클릭=선택 이미지 액션, 붙여넣기/드래그=추가 */}
          <div
            className={cn(
              'group relative aspect-[3/4] w-full rounded-xl border border-bg-border transition-colors',
              'cursor-zoom-in hover:border-accent/50',
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
              if (!Array.from(event.dataTransfer.types).includes('Files')) return;
              event.preventDefault();
              setDraggingImage(false);
              uploadFileIfImage(event.dataTransfer.files?.[0], { autoName: true });
            }}
          >
            <CharacterImageFrame
              url={selectedImage.url}
              alt={costume?.name ?? character.name}
              background={selectedImage.imageBackground}
              fit={selectedImage.imageFit}
              className="h-full w-full rounded-xl"
              onClick={costume ? () => onView(costume.id, { id: selectedImage.id, url: selectedImage.url, background: selectedImage.imageBackground, fit: selectedImage.imageFit }) : undefined}
              onContextMenu={(event) => {
                event.preventDefault();
                setImageMenu({ x: event.clientX, y: event.clientY });
              }}
            />
            {draggingImage && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-accent/15 text-xs font-medium text-accent ring-1 ring-accent/60">
                이미지 놓기
              </div>
            )}
          </div>

          {/* 선택 이미지 액션 — 대표 지정 / 복사 / 더보기(배경·역할·맞춤·삭제) */}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <button
              type="button"
              disabled={selectedImage.isPrimary || uploading}
              onClick={() => { void setPrimaryImage(selectedImage.id); }}
              title={selectedImage.isPrimary ? '이 복장의 대표 이미지예요' : '이 이미지를 대표로 지정'}
              className="flex items-center justify-center gap-1.5 rounded-md border border-bg-border px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50 transition-colors cursor-pointer disabled:cursor-default disabled:opacity-60 whitespace-nowrap"
            >
              <Star size={13} className={selectedImage.isPrimary ? 'fill-current text-amber-300' : ''} />
              {selectedImage.isPrimary ? '대표' : '대표로'}
            </button>
            <button
              type="button"
              onClick={() => copyCharacterImage(selectedImage.url)}
              className="flex items-center justify-center gap-1.5 rounded-md border border-bg-border px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Copy size={13} /> 복사
            </button>
            <button
              type="button"
              aria-label="이미지 설정"
              title="배경·역할·썸네일 맞추기·삭제"
              onClick={(event) => setImageMenu({ x: event.clientX, y: event.clientY })}
              className="flex items-center justify-center rounded-md border border-bg-border px-2 py-1.5 text-text-secondary hover:text-text-primary hover:border-text-secondary/50 transition-colors cursor-pointer"
            >
              <Palette size={13} />
            </button>
          </div>

          {/* 썸네일 스트립 */}
          <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
            {images.map((img) => (
              <ImageThumb
                key={img.id}
                image={img}
                selected={selectedImage.id === img.id}
                dragging={draggingImageId === img.id}
                onSelect={() => setSelectedImageId(img.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelectedImageId(img.id);
                  setImageMenu({ x: event.clientX, y: event.clientY });
                }}
                onDelete={() => { void handleDeleteImage(img); }}
                onDragStart={() => handleThumbDragStart(img.id)}
                onDropOn={() => handleThumbDrop(img.id)}
                onDragEnd={handleThumbDragEnd}
              />
            ))}
            <button
              type="button"
              onClick={openAddMenu}
              disabled={uploading}
              aria-label="이미지 추가"
              title="이미지 추가 — 복사한 이미지를 Ctrl+V 로 붙여넣을 수도 있어요"
              className="w-14 shrink-0 aspect-[3/4] flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-bg-border text-text-secondary hover:text-accent hover:border-accent/50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Plus size={16} />
              <span className="text-[10px] leading-none">{uploading ? '추가 중' : '추가'}</span>
            </button>
          </div>
        </>
      ) : (
        /* 빈 상태 — 추가 버튼만 */
        <div
          className={cn(
            'relative aspect-[3/4] w-full rounded-xl border border-dashed border-bg-border transition-colors',
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
            if (!Array.from(event.dataTransfer.types).includes('Files')) return;
            event.preventDefault();
            setDraggingImage(false);
            uploadFileIfImage(event.dataTransfer.files?.[0], { autoName: true });
          }}
        >
          <button
            type="button"
            onClick={openAddMenu}
            disabled={uploading}
            className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl text-text-secondary hover:text-accent transition-colors cursor-pointer disabled:opacity-50"
          >
            <Plus size={26} />
            <span className="text-xs">{uploading ? '추가 중...' : '이미지 추가'}</span>
            {!uploading && <span className="text-[10px] text-text-secondary/70">클릭 · 드래그 · Ctrl+V</span>}
          </button>
          {draggingImage && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-accent/15 text-xs font-medium text-accent ring-1 ring-accent/60">
              이미지 놓기
            </div>
          )}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f, { autoName: true, role: pendingRoleRef.current });
          e.target.value = '';
        }}
      />

      {addMenu && (
        <AddRoleMenu
          x={addMenu.x}
          y={addMenu.y}
          onPick={pickAddRole}
          onClose={() => setAddMenu(null)}
        />
      )}
      {imageMenu && selectedImage && (
        <ImageActionMenu
          x={imageMenu.x}
          y={imageMenu.y}
          image={selectedImage}
          onClose={() => setImageMenu(null)}
          onSetPrimary={() => { void setPrimaryImage(selectedImage.id); }}
          onRole={(role) => { void updateCostumeImageField(selectedImage.id, { role }); }}
          onBackground={(background) => { void updateCostumeImageField(selectedImage.id, { imageBackground: background }); }}
          onEditFit={() => setFitEditorOpen(true)}
          onCopy={() => { void copyCharacterImage(selectedImage.url); }}
          onDelete={() => { void handleDeleteImage(selectedImage); }}
        />
      )}
      {fitEditorOpen && selectedImage && (
        <CharacterImageFitEditor
          url={selectedImage.url}
          alt={costume?.name ?? character.name}
          background={selectedImage.imageBackground}
          fit={selectedImage.imageFit}
          onCommit={(fit: CharacterImageFit) => updateCostumeImageField(selectedImage.id, { imageFit: fit })}
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
export function CostumeIdentity({ costume }: { costume: CharacterCostume }) {
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
