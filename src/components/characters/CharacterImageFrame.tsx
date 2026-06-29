import type { CSSProperties, ReactNode } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { CharacterImageBackground, CharacterImageFit } from '@/types';
import { DEFAULT_CHARACTER_IMAGE_FIT, normalizeCharacterImageFit } from '@/utils/characterAssets';
import { cn } from '@/utils/cn';

function backgroundStyle(background: CharacterImageBackground): CSSProperties {
  if (background === 'white') return { background: '#ffffff' };
  if (background === 'transparent') return { background: 'transparent' };
  if (background === 'checker') {
    return {
      backgroundColor: '#ffffff',
      backgroundImage:
        'linear-gradient(45deg, #cfd3df 25%, transparent 25%), linear-gradient(-45deg, #cfd3df 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cfd3df 75%), linear-gradient(-45deg, transparent 75%, #cfd3df 75%)',
      backgroundSize: '18px 18px',
      backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0px',
    };
  }
  return { background: '#05060a' };
}

export function getCharacterImageBackgroundStyle(background: CharacterImageBackground): CSSProperties {
  return backgroundStyle(background);
}

export function CharacterImageFrame({
  url,
  alt,
  background = 'black',
  fit = DEFAULT_CHARACTER_IMAGE_FIT,
  className,
  imgClassName,
  placeholder,
  onClick,
  onContextMenu,
}: {
  url: string | null | undefined;
  alt: string;
  background?: CharacterImageBackground;
  fit?: CharacterImageFit;
  className?: string;
  imgClassName?: string;
  placeholder?: ReactNode;
  onClick?: () => void;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
}) {
  const normalized = normalizeCharacterImageFit(fit);
  const sx = normalized.lockAspect ? normalized.scale : (normalized.scaleX ?? normalized.scale);
  const sy = normalized.lockAspect ? normalized.scale : (normalized.scaleY ?? normalized.scale);

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn('relative overflow-hidden flex items-center justify-center', onClick && 'cursor-pointer', className)}
      style={backgroundStyle(background)}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {url ? (
        <img
          src={url}
          alt={alt}
          draggable={false}
          className={cn('max-w-full max-h-full object-contain select-none will-change-transform', imgClassName)}
          style={{
            transform: `translate(${normalized.x}%, ${normalized.y}%) scale(${sx}, ${sy})`,
            transformOrigin: 'center center',
          }}
        />
      ) : (
        placeholder ?? (
          <div className="flex flex-col items-center gap-1.5 text-text-secondary/50">
            <ImageIcon size={28} />
            <span className="text-[11px]">이미지 없음</span>
          </div>
        )
      )}
    </div>
  );
}
