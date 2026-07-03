import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Image as ImageIcon, RefreshCw } from 'lucide-react';
import type { CharacterImageBackground, CharacterImageFit } from '@/types';
import {
  DEFAULT_CHARACTER_IMAGE_BACKGROUND,
  DEFAULT_CHARACTER_IMAGE_FIT,
  getCharacterImageFitTransformStyle,
  normalizeCharacterImageFit,
} from '@/utils/characterAssets';
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

function withRetryNonce(url: string, retryNonce: number): string {
  if (retryNonce <= 0 || url.startsWith('data:') || url.startsWith('blob:')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}characterImageRetry=${retryNonce}`;
}

export function CharacterImageFrame({
  url,
  alt,
  background = DEFAULT_CHARACTER_IMAGE_BACKGROUND,
  fit = DEFAULT_CHARACTER_IMAGE_FIT,
  className,
  imgClassName,
  placeholder,
  eager = false,
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
  eager?: boolean;
  onClick?: () => void;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
}) {
  const normalized = normalizeCharacterImageFit(fit);
  const fitStyle = getCharacterImageFitTransformStyle(normalized);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setFailed(false);
    setRetryNonce(0);
  }, [url]);

  const retryImage = () => {
    setFailed(false);
    setRetryNonce((next) => next + 1);
  };

  const handleFrameClick = () => {
    if (url && failed) {
      retryImage();
      return;
    }
    onClick?.();
  };

  return (
    <div
      role={onClick || failed ? 'button' : undefined}
      tabIndex={onClick || failed ? 0 : undefined}
      className={cn('relative overflow-hidden flex items-center justify-center', (onClick || failed) && 'cursor-pointer', className)}
      style={backgroundStyle(background)}
      onClick={onClick || failed ? handleFrameClick : undefined}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (!onClick && !failed) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleFrameClick();
        }
      }}
    >
      {url && !failed ? (
        <img
          src={withRetryNonce(url, retryNonce)}
          alt={alt}
          draggable={false}
          loading={eager ? 'eager' : 'lazy'}
          decoding={eager ? 'auto' : 'async'}
          className={cn('max-w-full max-h-full object-contain select-none will-change-transform', imgClassName)}
          style={fitStyle}
          onError={() => setFailed(true)}
        />
      ) : url && failed ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-text-secondary/75">
          <ImageIcon size={28} className="text-text-secondary/55" />
          <div className="text-[11px] leading-relaxed">
            이미지를 불러오지 못했어요
            <span className="mt-1 flex items-center justify-center gap-1 text-[10px] text-text-secondary/60">
              <RefreshCw size={10} /> 클릭해서 다시 시도
            </span>
          </div>
        </div>
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
