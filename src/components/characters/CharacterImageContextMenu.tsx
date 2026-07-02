import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, FolderOpen, Image as ImageIcon, Move, Palette } from 'lucide-react';
import type { CharacterImageBackground } from '@/types';
import { cn } from '@/utils/cn';

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

export function CharacterImageContextMenu({
  x,
  y,
  variant = 'full',
  background,
  hasImage,
  hasFolder,
  hasFile,
  folderTitle,
  fileTitle,
  onClose,
  onBackground,
  onEditFit,
  onCopyImage,
  onOpenFolder,
  onOpenFile,
}: {
  x: number;
  y: number;
  variant?: 'full' | 'card';
  background?: CharacterImageBackground;
  hasImage: boolean;
  hasFolder: boolean;
  hasFile: boolean;
  folderTitle?: string;
  fileTitle?: string;
  onClose: () => void;
  onBackground?: (background: CharacterImageBackground) => void;
  onEditFit?: () => void;
  onCopyImage: () => void;
  onOpenFolder: () => void;
  onOpenFile: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
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
      className="fixed z-[80] w-56 overflow-hidden rounded-lg border border-bg-border bg-bg-card shadow-2xl"
      style={{ left: position.left, top: position.top }}
    >
      {variant === 'full' && (
        <>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-text-secondary/70 border-b border-bg-border/60 flex items-center gap-1.5">
            <Palette size={12} />
            배경 표기
          </div>
          <div className="grid grid-cols-2 gap-1 p-2">
            {BACKGROUND_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => { onBackground?.(item.value); onClose(); }}
                className={cn(
                  'px-2 py-1.5 rounded-md text-xs border transition-colors',
                  background === item.value
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-bg-border text-text-secondary hover:text-text-primary hover:border-text-secondary/40',
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
          <MenuButton icon={<Move size={14} />} label="썸네일 맞추기" disabled={!hasImage} onClick={() => { onEditFit?.(); onClose(); }} />
        )}
        {variant === 'card' ? (
          <>
            <MenuButton icon={<FolderOpen size={14} />} label="작업 폴더 열기" title={folderTitle} disabled={!hasFolder} onClick={() => { onOpenFolder(); onClose(); }} />
            <MenuButton icon={<ImageIcon size={14} />} label="작업 파일 열기" title={fileTitle} disabled={!hasFile} onClick={() => { onOpenFile(); onClose(); }} />
            <MenuButton icon={<Copy size={14} />} label="이미지 복사" disabled={!hasImage} onClick={() => { onCopyImage(); onClose(); }} />
          </>
        ) : (
          <>
            <MenuButton icon={<Copy size={14} />} label="이미지 복사" disabled={!hasImage} onClick={() => { onCopyImage(); onClose(); }} />
            <MenuButton icon={<FolderOpen size={14} />} label="작업 폴더 열기" title={folderTitle} disabled={!hasFolder} onClick={() => { onOpenFolder(); onClose(); }} />
            <MenuButton icon={<ImageIcon size={14} />} label="작업 파일 열기" title={fileTitle} disabled={!hasFile} onClick={() => { onOpenFile(); onClose(); }} />
          </>
        )}
      </div>
    </div>
  );
}
