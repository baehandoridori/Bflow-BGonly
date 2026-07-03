import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, FolderOpen, Image as ImageIcon, Move, Palette } from 'lucide-react';
import type { Character, CharacterCostume, CharacterImageBackground } from '@/types';
import { cn } from '@/utils/cn';
import { CHARACTER_LAYER_CLASS } from '@/constants/characterLayers';
import { copyCharacterImage, openStoredCharacterPath } from '@/services/characterPathActions';

const BACKGROUND_OPTIONS: { value: CharacterImageBackground; label: string }[] = [
  { value: 'transparent', label: '투명' },
  { value: 'black', label: '검정' },
  { value: 'white', label: '흰색' },
  { value: 'checker', label: '체커' },
];

function MenuButton({
  icon,
  label,
  title,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-border/60 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

type MenuImageCostume = Pick<CharacterCostume, 'id' | 'featuredImageUrl' | 'imageBackground' | 'workFilePath'>;

export function CharacterImageContextMenu({
  x,
  y,
  variant = 'full',
  character,
  imageCostume,
  fileCostume = imageCostume,
  onClose,
  onBackground,
  onEditFit,
}: {
  x: number;
  y: number;
  variant?: 'full' | 'card';
  character: Pick<Character, 'workFolderPath'>;
  imageCostume: MenuImageCostume | null | undefined;
  fileCostume?: Pick<CharacterCostume, 'workFilePath'> | null | undefined;
  onClose: () => void;
  onBackground?: (costumeId: string, background: CharacterImageBackground) => void;
  onEditFit?: (costumeId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const hasImage = !!imageCostume?.featuredImageUrl;
  const hasFolder = !!character.workFolderPath;
  const hasFile = !!fileCostume?.workFilePath;
  const folderTitle = character.workFolderPath ?? '작업 폴더 미등록';
  const fileTitle = fileCostume?.workFilePath ?? '작업 파일 미등록';
  const canSetBackground = !!imageCostume && !!onBackground;
  const background = imageCostume?.imageBackground;

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
    const width = element?.offsetWidth ?? 224;
    const height = element?.offsetHeight ?? (variant === 'card' ? 132 : 290);
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y, variant]);

  return (
    <div
      ref={ref}
      role="menu"
      className={`fixed ${CHARACTER_LAYER_CLASS.menu} w-56 overflow-hidden rounded-lg border border-bg-border bg-bg-card shadow-2xl`}
      style={{ left: position.left, top: position.top }}
    >
      {variant === 'full' && (
        <>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-text-secondary border-b border-bg-border/60 flex items-center gap-1.5">
            <Palette size={12} />
            배경 표기
          </div>
          <div className="grid grid-cols-2 gap-1 p-2">
            {BACKGROUND_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="menuitem"
                disabled={!canSetBackground}
                onClick={() => {
                  if (imageCostume) onBackground?.(imageCostume.id, item.value);
                  onClose();
                }}
                className={cn(
                  'px-2 py-1.5 rounded-md text-xs border transition-colors',
                  background === item.value
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-bg-border text-text-secondary hover:text-text-primary hover:border-text-secondary/40',
                  !canSetBackground && 'opacity-40 hover:text-text-secondary hover:border-bg-border',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className={cn('py-1', variant === 'full' && 'border-t border-bg-border/60')}>
        {variant === 'full' && (
          <MenuButton
            icon={<Move size={14} />}
            label="썸네일 맞추기"
            disabled={!hasImage}
            onClick={() => {
              if (imageCostume) onEditFit?.(imageCostume.id);
              onClose();
            }}
          />
        )}
        {variant === 'card' ? (
          <>
            <MenuButton icon={<FolderOpen size={14} />} label="작업 폴더 열기" title={folderTitle} disabled={!hasFolder} onClick={() => { void openStoredCharacterPath(character.workFolderPath, '작업 폴더'); onClose(); }} />
            <MenuButton icon={<ImageIcon size={14} />} label="작업 파일 열기" title={fileTitle} disabled={!hasFile} onClick={() => { void openStoredCharacterPath(fileCostume?.workFilePath, '작업 파일'); onClose(); }} />
            <MenuButton icon={<Copy size={14} />} label="이미지 복사" disabled={!hasImage} onClick={() => { void copyCharacterImage(imageCostume?.featuredImageUrl); onClose(); }} />
          </>
        ) : (
          <>
            <MenuButton icon={<Copy size={14} />} label="이미지 복사" disabled={!hasImage} onClick={() => { void copyCharacterImage(imageCostume?.featuredImageUrl); onClose(); }} />
            <MenuButton icon={<FolderOpen size={14} />} label="작업 폴더 열기" title={folderTitle} disabled={!hasFolder} onClick={() => { void openStoredCharacterPath(character.workFolderPath, '작업 폴더'); onClose(); }} />
            <MenuButton icon={<ImageIcon size={14} />} label="작업 파일 열기" title={fileTitle} disabled={!hasFile} onClick={() => { void openStoredCharacterPath(fileCostume?.workFilePath, '작업 파일'); onClose(); }} />
          </>
        )}
      </div>
    </div>
  );
}
