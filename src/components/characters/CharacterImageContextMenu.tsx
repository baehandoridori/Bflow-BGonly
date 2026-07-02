import { useEffect, useRef, type ReactNode } from 'react';
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
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
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
  background,
  hasImage,
  hasFolder,
  hasFile,
  onClose,
  onBackground,
  onEditFit,
  onCopyImage,
  onOpenFolder,
  onOpenFile,
}: {
  x: number;
  y: number;
  background: CharacterImageBackground;
  hasImage: boolean;
  hasFolder: boolean;
  hasFile: boolean;
  onClose: () => void;
  onBackground: (background: CharacterImageBackground) => void;
  onEditFit: () => void;
  onCopyImage: () => void;
  onOpenFolder: () => void;
  onOpenFile: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div
      ref={ref}
      className="fixed z-[80] w-56 overflow-hidden rounded-lg border border-bg-border bg-bg-card shadow-2xl"
      style={{ left: Math.min(x, window.innerWidth - 232), top: Math.min(y, window.innerHeight - 290) }}
    >
      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-text-secondary/70 border-b border-bg-border/60 flex items-center gap-1.5">
        <Palette size={12} />
        배경 표기
      </div>
      <div className="grid grid-cols-2 gap-1 p-2">
        {BACKGROUND_OPTIONS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => { onBackground(item.value); onClose(); }}
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
      <div className="border-t border-bg-border/60 py-1">
        <MenuButton icon={<Move size={14} />} label="썸네일 맞추기" disabled={!hasImage} onClick={() => { onEditFit(); onClose(); }} />
        <MenuButton icon={<Copy size={14} />} label="이미지 복사" disabled={!hasImage} onClick={() => { onCopyImage(); onClose(); }} />
        <MenuButton icon={<FolderOpen size={14} />} label="작업 폴더 열기" disabled={!hasFolder} onClick={() => { onOpenFolder(); onClose(); }} />
        <MenuButton icon={<ImageIcon size={14} />} label="작업 파일 열기" disabled={!hasFile} onClick={() => { onOpenFile(); onClose(); }} />
      </div>
    </div>
  );
}
