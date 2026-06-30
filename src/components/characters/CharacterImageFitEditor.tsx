import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { RotateCcw, X } from 'lucide-react';
import type { CharacterImageBackground, CharacterImageFit } from '@/types';
import {
  DEFAULT_CHARACTER_IMAGE_FIT,
  normalizeCharacterImageFit,
} from '@/utils/characterAssets';
import { getCharacterImageBackgroundStyle } from './CharacterImageFrame';

type Box = { left: number; top: number; width: number; height: number };
type ResizeHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;

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

function fitToImageBox(fit: CharacterImageFit, base: Box): Box {
  const normalized = normalizeCharacterImageFit(fit);
  const scaleX = normalized.lockAspect ? normalized.scale : (normalized.scaleX ?? normalized.scale);
  const scaleY = normalized.lockAspect ? normalized.scale : (normalized.scaleY ?? normalized.scale);
  const width = base.width * scaleX;
  const height = base.height * scaleY;
  const centerX = base.left + base.width / 2 + (base.width * normalized.x) / 100;
  const centerY = base.top + base.height / 2 + (base.height * normalized.y) / 100;
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
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
  handle: ResizeHandle,
  dx: number,
  dy: number,
  base: Box,
): CharacterImageFit {
  const normalized = normalizeCharacterImageFit(startFit);
  const safeBaseWidth = Math.max(1, base.width);
  const safeBaseHeight = Math.max(1, base.height);

  if (handle === 'move') {
    return {
      ...normalized,
      x: clampMove(normalized.x + (dx / safeBaseWidth) * 100),
      y: clampMove(normalized.y + (dy / safeBaseHeight) * 100),
    };
  }

  const fromWest = handle.includes('w');
  const fromEast = handle.includes('e');
  const fromNorth = handle.includes('n');
  const fromSouth = handle.includes('s');
  const { scaleX: startScaleX, scaleY: startScaleY } = scalesOf(normalized);
  const deltaX = fromEast ? dx / safeBaseWidth : fromWest ? -dx / safeBaseWidth : 0;
  const deltaY = fromSouth ? dy / safeBaseHeight : fromNorth ? -dy / safeBaseHeight : 0;

  if (normalized.lockAspect) {
    const primaryDelta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
    const nextScale = clampScale(normalized.scale + primaryDelta);
    return {
      ...normalized,
      scale: nextScale,
      scaleX: nextScale,
      scaleY: nextScale,
    };
  }

  const nextScaleX = fromEast || fromWest ? clampScale(startScaleX + deltaX) : startScaleX;
  const nextScaleY = fromNorth || fromSouth ? clampScale(startScaleY + deltaY) : startScaleY;
  return {
    ...normalized,
    scale: clampScale((nextScaleX + nextScaleY) / 2),
    scaleX: nextScaleX,
    scaleY: nextScaleY,
  };
}

const HANDLE_META: Array<{ id: ResizeHandle; label: string; className: string }> = [
  { id: 'n', label: '이미지 위쪽 확대', className: 'left-1/2 top-0 h-9 w-14 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize' },
  { id: 's', label: '이미지 아래쪽 확대', className: 'bottom-0 left-1/2 h-9 w-14 -translate-x-1/2 translate-y-1/2 cursor-ns-resize' },
  { id: 'w', label: '이미지 왼쪽 확대', className: 'left-0 top-1/2 h-14 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
  { id: 'e', label: '이미지 오른쪽 확대', className: 'right-0 top-1/2 h-14 w-9 translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
  { id: 'nw', label: '이미지 왼쪽 위 확대', className: 'left-0 top-0 h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
  { id: 'ne', label: '이미지 오른쪽 위 확대', className: 'right-0 top-0 h-10 w-10 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
  { id: 'sw', label: '이미지 왼쪽 아래 확대', className: 'bottom-0 left-0 h-10 w-10 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
  { id: 'se', label: '이미지 오른쪽 아래 확대', className: 'bottom-0 right-0 h-10 w-10 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },
];

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
  const workspaceRef = useRef<HTMLDivElement>(null);
  const cropFrameRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<{
    pointerId: number;
    handle: ResizeHandle;
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
  const imageBox = useMemo(() => fitToImageBox(draft, baseBox), [baseBox, draft]);
  const workspaceImageBox = {
    left: cropRect.left + imageBox.left,
    top: cropRect.top + imageBox.top,
    width: imageBox.width,
    height: imageBox.height,
  };
  const { scaleX, scaleY } = scalesOf(draft);

  const beginInteraction = (handle: ResizeHandle, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    workspaceRef.current?.setPointerCapture(event.pointerId);
    interactionRef.current = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startFit: normalizeCharacterImageFit(draft),
      baseBox,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    setDraft(nextFitFromDrag(
      interaction.startFit,
      interaction.handle,
      event.clientX - interaction.startX,
      event.clientY - interaction.startY,
      interaction.baseBox,
    ));
  };

  const endInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (interactionRef.current?.pointerId !== event.pointerId) return;
    interactionRef.current = null;
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

  const dimStyle = 'absolute bg-black/25 backdrop-blur-[3px]';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-5" onMouseDown={(e) => e.stopPropagation()}>
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-bg-card shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center justify-between border-b border-bg-border/70 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-text-primary">썸네일 맞추기</div>
            <div className="text-xs text-text-secondary">고정된 썸네일 박스 안에서 이미지를 이동하거나 확대합니다.</div>
          </div>
          <button type="button" aria-label="닫기" onClick={onClose} className="rounded-md p-1.5 text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[minmax(360px,1fr)_240px]">
          <div
            ref={workspaceRef}
            className="relative min-h-[460px] overflow-hidden rounded-2xl bg-black/35"
            onPointerMove={onPointerMove}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
            style={getCharacterImageBackgroundStyle(background)}
          >
            <img
              src={url}
              alt=""
              aria-hidden
              draggable={false}
              className="pointer-events-none absolute z-10 select-none object-fill opacity-80"
              style={{
                left: workspaceImageBox.left,
                top: workspaceImageBox.top,
                width: workspaceImageBox.width,
                height: workspaceImageBox.height,
                filter: 'blur(5px) brightness(0.62)',
                transform: 'scale(1.015)',
                transformOrigin: 'center center',
              }}
            />

            <div className={dimStyle} style={{ left: 0, top: 0, right: 0, height: cropRect.top }} />
            <div className={dimStyle} style={{ left: 0, top: cropRect.top + cropRect.height, right: 0, bottom: 0 }} />
            <div className={dimStyle} style={{ left: 0, top: cropRect.top, width: cropRect.left, height: cropRect.height }} />
            <div className={dimStyle} style={{ left: cropRect.left + cropRect.width, top: cropRect.top, right: 0, height: cropRect.height }} />

            <div
              ref={cropFrameRef}
              className="absolute left-1/2 top-1/2 z-30 h-[78%] max-h-[430px] aspect-[3/4] -translate-x-1/2 -translate-y-1/2"
            >
              <div
                className="absolute inset-0 cursor-move overflow-hidden rounded-xl bg-black/10 shadow-[0_0_0_2px_rgba(255,255,255,0.92),0_0_0_1px_rgba(0,0,0,0.55)_inset]"
                onPointerDown={(event) => beginInteraction('move', event)}
              >
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
                  className="absolute select-none object-fill outline outline-1 -outline-offset-1 outline-white/10"
                  style={{
                    left: imageBox.left,
                    top: imageBox.top,
                    width: imageBox.width,
                    height: imageBox.height,
                  }}
                />
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.16)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.16)_1px,transparent_1px)] bg-[size:33.333%_33.333%]" />
              </div>

              {HANDLE_META.filter((handle) => handle.id !== 'move').map((handle) => (
                <button
                  key={handle.id}
                  type="button"
                  aria-label={handle.label}
                  data-fit-handle={handle.id}
                  onPointerDown={(event) => beginInteraction(handle.id, event)}
                  className={`absolute z-40 flex items-center justify-center ${handle.className}`}
                >
                  <span className="h-3 w-3 rounded-full bg-white shadow-[0_0_0_2px_rgba(108,92,231,0.95),0_2px_8px_rgba(0,0,0,0.35)]" />
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <label className="flex min-h-10 items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={draft.lockAspect}
                onChange={(e) => setLockAspect(e.target.checked)}
              />
              비율 잠금
            </label>

            <div className="rounded-xl bg-bg-border/10 p-3 text-xs text-text-secondary">
              <div className="flex items-center justify-between gap-3">
                <span>가로</span>
                <span className="tabular-nums text-text-primary">{scaleX.toFixed(2)}x</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span>세로</span>
                <span className="tabular-nums text-text-primary">{scaleY.toFixed(2)}x</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span>위치</span>
                <span className="tabular-nums text-text-primary">{Math.round(draft.x)}%, {Math.round(draft.y)}%</span>
              </div>
            </div>

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
