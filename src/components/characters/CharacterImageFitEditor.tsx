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

function imageBoxToFit(box: Box, base: Box, lockAspect: boolean): CharacterImageFit {
  const safeBaseWidth = Math.max(1, base.width);
  const safeBaseHeight = Math.max(1, base.height);
  const scaleX = clampScale(box.width / safeBaseWidth);
  const scaleY = clampScale(box.height / safeBaseHeight);
  const x = clampMove(((box.left + box.width / 2) - (base.left + base.width / 2)) / safeBaseWidth * 100);
  const y = clampMove(((box.top + box.height / 2) - (base.top + base.height / 2)) / safeBaseHeight * 100);
  const scale = lockAspect ? scaleX : (scaleX + scaleY) / 2;
  return {
    scale: clampScale(scale),
    scaleX,
    scaleY,
    x,
    y,
    lockAspect,
  };
}

function resizeImageBox(start: Box, base: Box, handle: ResizeHandle, dx: number, dy: number, lockAspect: boolean): Box {
  if (handle === 'move') {
    return { ...start, left: start.left + dx, top: start.top + dy };
  }

  const baseMinWidth = Math.max(18, base.width * MIN_SCALE);
  const baseMinHeight = Math.max(18, base.height * MIN_SCALE);
  const baseMaxWidth = Math.max(baseMinWidth, base.width * MAX_SCALE);
  const baseMaxHeight = Math.max(baseMinHeight, base.height * MAX_SCALE);
  const fromWest = handle.includes('w');
  const fromEast = handle.includes('e');
  const fromNorth = handle.includes('n');
  const fromSouth = handle.includes('s');

  if (lockAspect) {
    const aspect = Math.max(0.1, start.width / Math.max(1, start.height));
    let nextWidth = start.width;
    let nextHeight = start.height;

    if (fromEast || fromWest) nextWidth = start.width + (fromEast ? dx : -dx);
    if (fromNorth || fromSouth) nextHeight = start.height + (fromSouth ? dy : -dy);

    const widthFromHeight = nextHeight * aspect;
    const widthDelta = Math.abs(nextWidth - start.width);
    const heightDelta = Math.abs(widthFromHeight - start.width);
    const chosenWidth = clamp(widthDelta >= heightDelta ? nextWidth : widthFromHeight, baseMinWidth, baseMaxWidth);
    const chosenHeight = clamp(chosenWidth / aspect, baseMinHeight, baseMaxHeight);

    return {
      width: chosenWidth,
      height: chosenHeight,
      left: fromWest ? start.left + start.width - chosenWidth : fromEast ? start.left : start.left + (start.width - chosenWidth) / 2,
      top: fromNorth ? start.top + start.height - chosenHeight : fromSouth ? start.top : start.top + (start.height - chosenHeight) / 2,
    };
  }

  let left = start.left;
  let top = start.top;
  let width = start.width;
  let height = start.height;

  if (fromEast) width = start.width + dx;
  if (fromWest) width = start.width - dx;
  if (fromSouth) height = start.height + dy;
  if (fromNorth) height = start.height - dy;

  width = clamp(width, baseMinWidth, baseMaxWidth);
  height = clamp(height, baseMinHeight, baseMaxHeight);
  if (fromWest) left = start.left + start.width - width;
  if (fromNorth) top = start.top + start.height - height;

  return { left, top, width, height };
}

const HANDLE_META: Array<{ id: ResizeHandle; label: string; className: string }> = [
  { id: 'n', label: '위쪽 늘리기', className: 'left-1/2 top-0 h-9 w-14 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize' },
  { id: 's', label: '아래쪽 늘리기', className: 'bottom-0 left-1/2 h-9 w-14 -translate-x-1/2 translate-y-1/2 cursor-ns-resize' },
  { id: 'w', label: '왼쪽 늘리기', className: 'left-0 top-1/2 h-14 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
  { id: 'e', label: '오른쪽 늘리기', className: 'right-0 top-1/2 h-14 w-9 translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
  { id: 'nw', label: '왼쪽 위 모서리 늘리기', className: 'left-0 top-0 h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
  { id: 'ne', label: '오른쪽 위 모서리 늘리기', className: 'right-0 top-0 h-10 w-10 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
  { id: 'sw', label: '왼쪽 아래 모서리 늘리기', className: 'bottom-0 left-0 h-10 w-10 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
  { id: 'se', label: '오른쪽 아래 모서리 늘리기', className: 'bottom-0 right-0 h-10 w-10 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },
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
    startBox: Box;
    baseBox: Box;
    lockAspect: boolean;
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
  const scaleX = draft.lockAspect ? draft.scale : (draft.scaleX ?? draft.scale);
  const scaleY = draft.lockAspect ? draft.scale : (draft.scaleY ?? draft.scale);

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
      startBox: imageBox,
      baseBox,
      lockAspect: draft.lockAspect,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const nextBox = resizeImageBox(
      interaction.startBox,
      interaction.baseBox,
      interaction.handle,
      event.clientX - interaction.startX,
      event.clientY - interaction.startY,
      interaction.lockAspect,
    );
    setDraft(imageBoxToFit(nextBox, interaction.baseBox, interaction.lockAspect));
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
      const nextScale = clampScale(((normalized.scaleX ?? normalized.scale) + (normalized.scaleY ?? normalized.scale)) / 2);
      return {
        ...normalized,
        lockAspect: true,
        scale: nextScale,
        scaleX: nextScale,
        scaleY: nextScale,
      };
    });
  };

  const dimStyle = 'absolute bg-black/40 backdrop-blur-[2px]';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-5" onMouseDown={(e) => e.stopPropagation()}>
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-bg-card shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center justify-between border-b border-bg-border/70 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-text-primary">썸네일 맞추기</div>
            <div className="text-xs text-text-secondary">이미지 박스의 위치와 크기를 실제 썸네일 영역에 맞춥니다.</div>
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
            <div
              ref={cropFrameRef}
              className="absolute left-1/2 top-1/2 h-[78%] max-h-[430px] aspect-[3/4] -translate-x-1/2 -translate-y-1/2"
            />
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
              className="absolute z-10 select-none object-fill outline outline-1 -outline-offset-1 outline-white/10"
              style={{
                left: workspaceImageBox.left,
                top: workspaceImageBox.top,
                width: workspaceImageBox.width,
                height: workspaceImageBox.height,
              }}
            />

            <div className={dimStyle} style={{ left: 0, top: 0, right: 0, height: cropRect.top }} />
            <div className={dimStyle} style={{ left: 0, top: cropRect.top + cropRect.height, right: 0, bottom: 0 }} />
            <div className={dimStyle} style={{ left: 0, top: cropRect.top, width: cropRect.left, height: cropRect.height }} />
            <div className={dimStyle} style={{ left: cropRect.left + cropRect.width, top: cropRect.top, right: 0, height: cropRect.height }} />

            <div
              className="pointer-events-none absolute z-30 rounded-xl shadow-[0_0_0_2px_rgba(255,255,255,0.9),0_0_0_9999px_rgba(0,0,0,0.08)]"
              style={{ left: cropRect.left, top: cropRect.top, width: cropRect.width, height: cropRect.height }}
            />

            <div
              className="absolute z-40 cursor-move rounded-lg border-2 border-accent bg-accent/5 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
              style={{
                left: workspaceImageBox.left,
                top: workspaceImageBox.top,
                width: workspaceImageBox.width,
                height: workspaceImageBox.height,
              }}
              onPointerDown={(event) => beginInteraction('move', event)}
            >
              <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white/85 tabular-nums">
                {scaleX.toFixed(2)}x{draft.lockAspect ? '' : ` / ${scaleY.toFixed(2)}x`}
              </div>
              {HANDLE_META.map((handle) => (
                <button
                  key={handle.id}
                  type="button"
                  aria-label={handle.label}
                  data-fit-handle={handle.id}
                  onPointerDown={(event) => beginInteraction(handle.id, event)}
                  className={`absolute z-50 flex items-center justify-center ${handle.className}`}
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
