/**
 * 캐릭터 이미지 표시 프레임 — fit 적용 규칙 (R2):
 *   - 축소 요약 표면(그리드 카드·복장 썸네일·상세 대표·좌측 목록 행·라이트박스 하단 스트립)은
 *     fit(썸네일 구도)과 배경을 모두 적용한다.
 *   - 원본 확인 표면(라이트박스 메인)은 fit 을 적용하지 않고(원본 그대로) 배경만 적용한다.
 *   fit 은 3:4 크롭 프레임 기준으로 저작되므로, fit 을 적용하는 표면은 반드시 3:4 비율 컨테이너여야
 *   편집기에서 맞춘 구도가 그대로 재현된다 (다른 비율에 적용하면 구도가 다르게 잘림).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Image as ImageIcon, RefreshCw } from 'lucide-react';
import type { CharacterImageBackground, CharacterImageFit } from '@/types';
import { useMotionPref } from '@/hooks/useMotionPref';
import {
  CONTENT_SWAP_MS,
  imageLayersOnReady,
  imageLayersOnSettled,
  imageLayersOnTarget,
  imageLayersWithTopLook,
  imageSwapKeyframes,
  initialImageLayers,
  type ImageSwapLayer,
  type SwapDirection,
} from '@/utils/contentSwap';
import { EASE_CSS, animateEl } from '@/utils/motion';
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

/* ─── 그림 겹쳐 바꾸기 (움직임 폴리싱 11번, swapDirection 을 넘긴 표면만) ─────────────
   옛 그림을 아래층에 그대로 두고, 새 그림은 보이지 않게 받아 decode 까지 끝낸 다음 누른 쪽에서 6px 밀려 들어오며
   160ms 에 떠오른다. 다 떠오르면 아래층을 지운다 — 빈 칸이 번쩍이지 않는다. 동작 줄이기는 opacity 만 100ms.
   층마다 자기 배경·구도를 가진다(복장마다 배경이 달라도 옛 그림은 옛 모습 그대로 아래에 남는다). */

interface ImageLook {
  background: CharacterImageBackground;
  fitStyle: CSSProperties;
}

const sameLook = (a: ImageLook, b: ImageLook) => a.background === b.background
  && a.fitStyle.transform === b.fitStyle.transform
  && a.fitStyle.transformOrigin === b.fitStyle.transformOrigin;

function SwapImageLayer({
  layer,
  top,
  alt,
  imgClassName,
  eager,
  reduce,
  onReady,
  onSettled,
  onError,
}: {
  layer: ImageSwapLayer<ImageLook>;
  top: boolean;
  alt: string;
  imgClassName?: string;
  eager: boolean;
  reduce: boolean;
  onReady: (src: string) => void;
  onSettled: (src: string) => void;
  onError: () => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // 받는 중: 다 받아 decode 까지 끝나면 떠오르기 시작.
  useEffect(() => {
    if (layer.phase !== 'loading') return;
    const img = imgRef.current;
    if (!img) return;
    let live = true;
    const ready = () => { if (live) onReady(layer.src); };
    const loaded = () => img.complete && img.naturalWidth > 0;
    if (typeof img.decode === 'function') {
      img.decode().then(ready, () => { if (loaded()) ready(); });
    } else if (loaded()) {
      ready();
    } else {
      img.addEventListener('load', ready, { once: true });
    }
    return () => { live = false; img.removeEventListener('load', ready); };
  }, [layer.phase, layer.src, onReady]);

  // 떠오르기: 그리기 전에 시작해 새 그림이 한 번 비쳤다가 사라지는 깜빡임이 없다.
  useLayoutEffect(() => {
    if (layer.phase !== 'entering') return;
    const animation = animateEl(
      layerRef.current,
      imageSwapKeyframes(layer.direction),
      { duration: reduce ? CONTENT_SWAP_MS.reduced : CONTENT_SWAP_MS.image, easing: EASE_CSS.out },
      reduce,
    );
    if (!animation) {
      onSettled(layer.src);
      return;
    }
    let live = true;
    animation.finished.then(() => { if (live) onSettled(layer.src); }, () => undefined);
    return () => {
      live = false;
      animation.cancel();
    };
    // 단계가 바뀔 때만 — 다른 값이 바뀌어도 떠오르던 움직임을 다시 시작하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.phase]);

  return (
    <div
      ref={layerRef}
      aria-hidden={top ? undefined : true}
      className="absolute inset-0 flex items-center justify-center"
      style={{ ...backgroundStyle(layer.look.background), ...(layer.phase === 'loading' ? { opacity: 0 } : null) }}
    >
      <img
        ref={imgRef}
        src={layer.src}
        alt={top ? alt : ''}
        draggable={false}
        loading={eager ? 'eager' : 'lazy'}
        decoding={eager ? 'auto' : 'async'}
        className={cn('max-w-full max-h-full object-contain select-none will-change-transform', imgClassName)}
        style={layer.look.fitStyle}
        onError={top ? onError : undefined}
      />
    </div>
  );
}

function SwapImageLayers({
  src,
  look,
  direction,
  alt,
  imgClassName,
  eager,
  onError,
}: {
  src: string;
  look: ImageLook;
  direction: SwapDirection;
  alt: string;
  imgClassName?: string;
  eager: boolean;
  onError: () => void;
}) {
  const { reduce } = useMotionPref();
  const [layers, setLayers] = useState(() => initialImageLayers(src, look));
  const [target, setTarget] = useState(src);
  // 그림이 바뀐 그 렌더에서 바로 층을 고친다(이펙트를 기다리면 옛 그림이 새 모습으로 한 번 그려진다).
  if (target !== src) {
    setTarget(src);
    setLayers((current) => imageLayersOnTarget(current, src, direction, look));
  } else if (!sameLook(layers[layers.length - 1].look, look)) {
    setLayers((current) => imageLayersWithTopLook(current, look, sameLook));
  }
  const onReadyRef = useRef((ready: string) => setLayers((current) => imageLayersOnReady(current, ready)));
  const onSettledRef = useRef((settled: string) => setLayers((current) => imageLayersOnSettled(current, settled)));

  return (
    <>
      {layers.map((layer, index) => (
        <SwapImageLayer
          key={layer.src}
          layer={layer}
          top={index === layers.length - 1}
          alt={alt}
          imgClassName={imgClassName}
          eager={eager}
          reduce={reduce}
          onReady={onReadyRef.current}
          onSettled={onSettledRef.current}
          onError={onError}
        />
      ))}
    </>
  );
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
  swapDirection,
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
  /**
   * 넘기면 그림이 바뀔 때 옛 그림 위로 새 그림이 겹쳐 떠오른다(움직임 폴리싱 11번).
   * -1: 왼쪽(‹)에서, 1: 오른쪽(›)에서, 0: 제자리에서. 넘기지 않으면 지금처럼 그 자리에서 바뀐다.
   * 이 프레임의 크기가 바깥(className)으로 정해진 표면에서만 쓴다 — 그림이 겹친 층이 프레임을 꽉 채운다.
   */
  swapDirection?: SwapDirection;
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

  // 겹쳐 바꾸기 중에는 층마다 자기 배경을 칠한다 — 틀이 새 배경을 먼저 칠하면 옛 그림이 새 배경 위에 비친다.
  const layered = Boolean(url && !failed && swapDirection !== undefined);

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
      style={layered ? undefined : backgroundStyle(background)}
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
      {url && layered ? (
        <SwapImageLayers
          src={withRetryNonce(url, retryNonce)}
          look={{ background, fitStyle }}
          direction={swapDirection ?? 0}
          alt={alt}
          imgClassName={imgClassName}
          eager={eager}
          onError={() => setFailed(true)}
        />
      ) : url && !failed ? (
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
