import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Lock, Minus, Move, Plus, RotateCcw, Unlock, X } from 'lucide-react';
import type { CharacterImageBackground, CharacterImageFit } from '@/types';
import {
  DEFAULT_CHARACTER_IMAGE_FIT,
  normalizeCharacterImageFit,
} from '@/utils/characterAssets';
import { getCharacterImageBackgroundStyle } from './CharacterImageFrame';
import { CHARACTER_LAYER_CLASS } from '@/constants/characterLayers';

type Box = { left: number; top: number; width: number; height: number };

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const SCALE_STEP = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampMove(value: number): number {
  return clamp(value, -100, 100);
}

function clampScale(value: number): number {
  return clamp(value, MIN_SCALE, MAX_SCALE);
}

function getContainedImageBox(frameWidth: number, frameHeight: number, naturalWidth: number, naturalHeight: number): Box {
  if (frameWidth <= 0 || frameHeight <= 0) return { left: 0, top: 0, width: 1, height: 1 };
  const aspect = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 1;
  let width = frameWidth;
  let height = width / aspect;
  if (height > frameHeight) {
    height = frameHeight;
    width = height * aspect;
  }
  return {
    left: (frameWidth - width) / 2,
    top: (frameHeight - height) / 2,
    width,
    height,
  };
}

function scalesOf(fit: CharacterImageFit): { scaleX: number; scaleY: number } {
  const normalized = normalizeCharacterImageFit(fit);
  return {
    scaleX: normalized.lockAspect ? normalized.scale : (normalized.scaleX ?? normalized.scale),
    scaleY: normalized.lockAspect ? normalized.scale : (normalized.scaleY ?? normalized.scale),
  };
}

function nextFitFromDrag(
  startFit: CharacterImageFit,
  dx: number,
  dy: number,
  base: Box,
): CharacterImageFit {
  const normalized = normalizeCharacterImageFit(startFit);
  const safeBaseWidth = Math.max(1, base.width);
  const safeBaseHeight = Math.max(1, base.height);

  return {
    ...normalized,
    x: clampMove(normalized.x + (dx / safeBaseWidth) * 100),
    y: clampMove(normalized.y + (dy / safeBaseHeight) * 100),
  };
}

function getFitImageTransformStyle(fit: CharacterImageFit) {
  const normalized = normalizeCharacterImageFit(fit);
  const { scaleX, scaleY } = scalesOf(normalized);
  return {
    transform: `translate(${normalized.x}%, ${normalized.y}%) scale(${scaleX}, ${scaleY})`,
    transformOrigin: 'center center',
  };
}

export function CharacterImageFitEditor({
  url,
  alt,
  background,
  fit,
  onCommit,
  onClose,
}: {
  url: string;
  alt: string;
  background: CharacterImageBackground;
  fit: CharacterImageFit;
  onCommit: (fit: CharacterImageFit) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CharacterImageFit>(() => normalizeCharacterImageFit(fit));
  const [naturalSize, setNaturalSize] = useState({ width: 1, height: 1 });
  const [cropRect, setCropRect] = useState<Box>({ left: 0, top: 0, width: 1, height: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const cropFrameRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startFit: CharacterImageFit;
    baseBox: Box;
  } | null>(null);

  useEffect(() => {
    setDraft(normalizeCharacterImageFit(fit));
  }, [fit]);

  useEffect(() => {
    const updateCropRect = () => {
      const workspace = workspaceRef.current?.getBoundingClientRect();
      const crop = cropFrameRef.current?.getBoundingClientRect();
      if (!workspace || !crop) return;
      setCropRect({
        left: crop.left - workspace.left,
        top: crop.top - workspace.top,
        width: Math.max(1, crop.width),
        height: Math.max(1, crop.height),
      });
    };
    updateCropRect();
    const observer = new ResizeObserver(updateCropRect);
    if (workspaceRef.current) observer.observe(workspaceRef.current);
    if (cropFrameRef.current) observer.observe(cropFrameRef.current);
    window.addEventListener('resize', updateCropRect);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateCropRect);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  const baseBox = useMemo(
    () => getContainedImageBox(cropRect.width, cropRect.height, naturalSize.width, naturalSize.height),
    [cropRect.height, cropRect.width, naturalSize.height, naturalSize.width],
  );
  const { scaleX, scaleY } = scalesOf(draft);
  const fitImageStyle = getFitImageTransformStyle(draft);
  const blurredFitImageStyle = {
    ...fitImageStyle,
    filter: 'blur(10px) saturate(0.8) brightness(0.58)',
  };

  const beginInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    workspaceRef.current?.setPointerCapture(event.pointerId);
    setIsDragging(true);
    interactionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startFit: normalizeCharacterImageFit(draft),
      baseBox,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    setDraft(nextFitFromDrag(
      interaction.startFit,
      event.clientX - interaction.startX,
      event.clientY - interaction.startY,
      interaction.baseBox,
    ));
  };

  const endInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (interactionRef.current?.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    setIsDragging(false);
    if (workspaceRef.current?.hasPointerCapture(event.pointerId)) {
      workspaceRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const setLockAspect = (lockAspect: boolean) => {
    setDraft((prev) => {
      const normalized = normalizeCharacterImageFit(prev);
      if (!lockAspect) return { ...normalized, lockAspect: false };
      const { scaleX: currentScaleX, scaleY: currentScaleY } = scalesOf(normalized);
      const nextScale = clampScale((currentScaleX + currentScaleY) / 2);
      return {
        ...normalized,
        lockAspect: true,
        scale: nextScale,
        scaleX: nextScale,
        scaleY: nextScale,
      };
    });
  };

  const updateScale = (axis: 'both' | 'x' | 'y', value: number) => {
    setDraft((prev) => {
      const normalized = normalizeCharacterImageFit(prev);
      const { scaleX: currentScaleX, scaleY: currentScaleY } = scalesOf(normalized);
      const nextScaleX = axis === 'both' || axis === 'x' ? clampScale(value) : currentScaleX;
      const nextScaleY = axis === 'both' || axis === 'y' ? clampScale(value) : currentScaleY;
      if (normalized.lockAspect || axis === 'both') {
        const nextScale = clampScale(value);
        return {
          ...normalized,
          scale: nextScale,
          scaleX: nextScale,
          scaleY: nextScale,
        };
      }
      return {
        ...normalized,
        scale: clampScale((nextScaleX + nextScaleY) / 2),
        scaleX: nextScaleX,
        scaleY: nextScaleY,
      };
    });
  };

  const nudgeScale = (delta: number) => {
    setDraft((prev) => {
      const normalized = normalizeCharacterImageFit(prev);
      const { scaleX: currentScaleX, scaleY: currentScaleY } = scalesOf(normalized);
      const nextScaleX = clampScale(currentScaleX + delta);
      const nextScaleY = clampScale(currentScaleY + delta);
      if (normalized.lockAspect) {
        return {
          ...normalized,
          scale: nextScaleX,
          scaleX: nextScaleX,
          scaleY: nextScaleX,
        };
      }
      return {
        ...normalized,
        scale: clampScale((nextScaleX + nextScaleY) / 2),
        scaleX: nextScaleX,
        scaleY: nextScaleY,
      };
    });
  };

  const updatePosition = (axis: 'x' | 'y', value: number) => {
    setDraft((prev) => ({
      ...normalizeCharacterImageFit(prev),
      [axis]: clampMove(value),
    }));
  };

  const onCropKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 5 : 1;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      updatePosition('x', draft.x - step);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      updatePosition('x', draft.x + step);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      updatePosition('y', draft.y - step);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      updatePosition('y', draft.y + step);
    }
  };

  const dimStyle = 'absolute z-20 bg-black/28 backdrop-blur-[5px]';
  const buttonChrome = 'flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-bg-border/70 bg-bg-card/80 text-text-secondary shadow-sm hover:border-text-secondary/50 hover:text-text-primary active:scale-[0.96]';
  const sliderClass = 'h-2 w-full cursor-pointer rounded-full accent-accent focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-card';
  const handleClass = 'pointer-events-none absolute h-7 w-7 border-black drop-shadow-[0_0_1px_rgba(255,255,255,0.95)]';
  const percentLabel = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <div className={`fixed inset-0 ${CHARACTER_LAYER_CLASS.editor} flex items-center justify-center bg-overlay/70 p-5`} onMouseDown={(e) => e.stopPropagation()}>
      <div className="max-h-[calc(100vh-32px)] w-full max-w-5xl overflow-hidden rounded-2xl bg-bg-card shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center justify-between border-b border-bg-border/70 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary">썸네일 맞추기</div>
            <div className="truncate text-xs text-text-secondary" title={alt}>{alt}</div>
          </div>
          <button type="button" aria-label="닫기" onClick={onClose} className="rounded-md p-1.5 text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="grid max-h-[calc(100vh-88px)] gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(420px,1fr)_280px]">
          <div
            ref={workspaceRef}
            className="relative min-h-[420px] touch-none overflow-hidden rounded-xl bg-black/40 shadow-inner"
            onPointerMove={onPointerMove}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
            style={getCharacterImageBackgroundStyle(background)}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute z-10 flex items-center justify-center overflow-visible"
              style={{ left: cropRect.left, top: cropRect.top, width: cropRect.width, height: cropRect.height }}
            >
              <img
                src={url}
                alt=""
                draggable={false}
                className="max-h-full max-w-full select-none object-contain opacity-80 will-change-transform"
                style={blurredFitImageStyle}
              />
            </div>

            <div className={dimStyle} style={{ left: 0, top: 0, right: 0, height: cropRect.top }} />
            <div className={dimStyle} style={{ left: 0, top: cropRect.top + cropRect.height, right: 0, bottom: 0 }} />
            <div className={dimStyle} style={{ left: 0, top: cropRect.top, width: cropRect.left, height: cropRect.height }} />
            <div className={dimStyle} style={{ left: cropRect.left + cropRect.width, top: cropRect.top, right: 0, height: cropRect.height }} />

            <div
              ref={cropFrameRef}
              className="absolute left-1/2 top-1/2 z-30 h-[72%] max-h-[390px] min-h-[280px] aspect-[3/4] -translate-x-1/2 -translate-y-1/2"
            >
              <div
                aria-label="썸네일 이미지 위치"
                tabIndex={0}
                onKeyDown={onCropKeyDown}
                className={`absolute inset-0 overflow-hidden rounded-xl bg-black/10 shadow-[0_0_0_2px_rgba(0,0,0,0.72),0_0_0_4px_rgba(255,255,255,0.78),0_18px_50px_rgba(0,0,0,0.34),0_0_0_1px_rgba(0,0,0,0.58)_inset] outline-none focus-visible:ring-2 focus-visible:ring-accent/80 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                onPointerDown={beginInteraction}
              >
                <div className="absolute inset-0 flex items-center justify-center overflow-visible">
                  <img
                    src={url}
                    alt={alt}
                    draggable={false}
                    onLoad={(event) => {
                      const image = event.currentTarget;
                      setNaturalSize({
                        width: Math.max(1, image.naturalWidth),
                        height: Math.max(1, image.naturalHeight),
                      });
                    }}
                    className="max-h-full max-w-full select-none object-contain outline outline-1 -outline-offset-1 outline-white/10 will-change-transform"
                    style={fitImageStyle}
                  />
                </div>
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.22)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.22)_1px,transparent_1px),linear-gradient(to_right,rgba(255,255,255,0.26)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.26)_1px,transparent_1px)] bg-[size:33.333%_33.333%]" />
              </div>
              <div className={`${handleClass} -left-1 -top-1 rounded-tl-xl border-l-2 border-t-2`} />
              <div className={`${handleClass} -right-1 -top-1 rounded-tr-xl border-r-2 border-t-2`} />
              <div className={`${handleClass} -bottom-1 -left-1 rounded-bl-xl border-b-2 border-l-2`} />
              <div className={`${handleClass} -bottom-1 -right-1 rounded-br-xl border-b-2 border-r-2`} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-bg-border/70 bg-bg-card/70 p-3">
              <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
                <span className="flex items-center gap-1.5 font-medium text-text-primary">
                  <Move size={14} />
                  확대
                </span>
                <span className="tabular-nums text-text-primary">
                  {draft.lockAspect ? percentLabel(scaleX) : `${percentLabel(scaleX)} / ${percentLabel(scaleY)}`}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" aria-label="축소" onClick={() => nudgeScale(-SCALE_STEP)} className={buttonChrome}>
                  <Minus size={15} />
                </button>
                {draft.lockAspect ? (
                  <input
                    aria-label="확대"
                    type="range"
                    min={MIN_SCALE}
                    max={MAX_SCALE}
                    step="0.01"
                    value={scaleX}
                    onChange={(event) => updateScale('both', Number(event.target.value))}
                    className={sliderClass}
                  />
                ) : (
                  <div className="grid flex-1 gap-2">
                    <input
                      aria-label="가로 확대"
                      type="range"
                      min={MIN_SCALE}
                      max={MAX_SCALE}
                      step="0.01"
                      value={scaleX}
                      onChange={(event) => updateScale('x', Number(event.target.value))}
                      className={sliderClass}
                    />
                    <input
                      aria-label="세로 확대"
                      type="range"
                      min={MIN_SCALE}
                      max={MAX_SCALE}
                      step="0.01"
                      value={scaleY}
                      onChange={(event) => updateScale('y', Number(event.target.value))}
                      className={sliderClass}
                    />
                  </div>
                )}
                <button type="button" aria-label="확대" onClick={() => nudgeScale(SCALE_STEP)} className={buttonChrome}>
                  <Plus size={15} />
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-bg-border/70 bg-bg-card/70 p-3">
              <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
                <span className="font-medium text-text-primary">위치</span>
                <span className="tabular-nums text-text-primary">{Math.round(draft.x)} / {Math.round(draft.y)}</span>
              </div>
              <div className="mt-3 grid gap-3 text-xs text-text-secondary">
                <label>
                  <div className="mb-1 flex items-center justify-between">
                    <span>X</span>
                    <span className="tabular-nums text-text-primary">{Math.round(draft.x)}</span>
                  </div>
                  <input
                    aria-label="가로 위치"
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={draft.x}
                    onChange={(event) => updatePosition('x', Number(event.target.value))}
                    className={sliderClass}
                  />
                </label>
                <label>
                  <div className="mb-1 flex items-center justify-between">
                    <span>Y</span>
                    <span className="tabular-nums text-text-primary">{Math.round(draft.y)}</span>
                  </div>
                  <input
                    aria-label="세로 위치"
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={draft.y}
                    onChange={(event) => updatePosition('y', Number(event.target.value))}
                    className={sliderClass}
                  />
                </label>
              </div>
            </div>

            <button
              type="button"
              aria-pressed={draft.lockAspect}
              onClick={() => setLockAspect(!draft.lockAspect)}
              className="flex min-h-10 items-center justify-between rounded-xl border border-bg-border/70 bg-bg-card/70 px-3 py-2 text-sm text-text-primary hover:border-text-secondary/50 active:scale-[0.96]"
            >
              <span>비율</span>
              <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                {draft.lockAspect ? <Lock size={14} /> : <Unlock size={14} />}
                {draft.lockAspect ? '잠금' : '해제'}
              </span>
            </button>

            <div className="mt-auto flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setDraft({ ...DEFAULT_CHARACTER_IMAGE_FIT })}
                className="flex min-h-10 items-center gap-1.5 rounded-lg border border-bg-border px-3 py-2 text-sm text-text-secondary hover:border-text-secondary/50 hover:text-text-primary active:scale-[0.96]"
              >
                <RotateCcw size={14} /> 초기화
              </button>
              <button
                type="button"
                onClick={() => { onCommit(normalizeCharacterImageFit(draft)); onClose(); }}
                className="min-h-10 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 active:scale-[0.96]"
              >
                적용
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
