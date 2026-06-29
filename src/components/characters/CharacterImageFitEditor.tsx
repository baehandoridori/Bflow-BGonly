import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { RotateCcw, X } from 'lucide-react';
import type { CharacterImageBackground, CharacterImageFit } from '@/types';
import {
  DEFAULT_CHARACTER_IMAGE_FIT,
  normalizeCharacterImageFit,
} from '@/utils/characterAssets';
import { CharacterImageFrame } from './CharacterImageFrame';

function clampMove(value: number): number {
  return Math.min(100, Math.max(-100, value));
}

function clampScale(value: number): number {
  return Math.min(8, Math.max(0.25, value));
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
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number; width: number; height: number } | null>(null);

  useEffect(() => {
    setDraft(normalizeCharacterImageFit(fit));
  }, [fit]);

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

  const setScale = (value: number) => {
    const next = clampScale(value);
    setDraft((prev) => ({ ...prev, scale: next, scaleX: next, scaleY: next }));
  };

  const setScaleAxis = (axis: 'x' | 'y', value: number) => {
    const next = clampScale(value);
    setDraft((prev) => axis === 'x'
      ? { ...prev, scaleX: next, scale: prev.lockAspect ? next : prev.scale }
      : { ...prev, scaleY: next, scale: prev.lockAspect ? next : prev.scale });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = frameRef.current?.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: draft.x,
      baseY: draft.y,
      width: Math.max(1, rect?.width ?? 1),
      height: Math.max(1, rect?.height ?? 1),
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDraft((prev) => ({
      ...prev,
      x: clampMove(drag.baseX + ((event.clientX - drag.startX) / drag.width) * 100),
      y: clampMove(drag.baseY + ((event.clientY - drag.startY) / drag.height) * 100),
    }));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const scaleX = draft.scaleX ?? draft.scale;
  const scaleY = draft.scaleY ?? draft.scale;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-5" onMouseDown={(e) => e.stopPropagation()}>
      <div className="w-full max-w-3xl rounded-2xl border border-bg-border bg-bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border/70">
          <div>
            <div className="text-sm font-semibold text-text-primary">썸네일 맞추기</div>
            <div className="text-xs text-text-secondary">드래그로 이동하고, 슬라이더로 확대/비율을 조정합니다.</div>
          </div>
          <button type="button" aria-label="닫기" onClick={onClose} className="p-1.5 text-text-secondary hover:text-text-primary rounded-md">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[minmax(260px,1fr)_260px]">
          <div
            ref={frameRef}
            className="relative aspect-[3/4] min-h-[360px] overflow-hidden rounded-xl border border-bg-border cursor-grab active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <CharacterImageFrame
              url={url}
              alt={alt}
              background={background}
              fit={draft}
              className="absolute inset-0"
            />
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-0 right-0 top-0 h-[12%] bg-black/35 backdrop-blur-[2px]" />
              <div className="absolute left-0 right-0 bottom-0 h-[12%] bg-black/35 backdrop-blur-[2px]" />
              <div className="absolute left-0 top-[12%] bottom-[12%] w-[12%] bg-black/35 backdrop-blur-[2px]" />
              <div className="absolute right-0 top-[12%] bottom-[12%] w-[12%] bg-black/35 backdrop-blur-[2px]" />
              <div className="absolute inset-[12%] rounded-lg border border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={draft.lockAspect}
                onChange={(e) => {
                  const lockAspect = e.target.checked;
                  setDraft((prev) => ({
                    ...prev,
                    lockAspect,
                    scale: lockAspect ? ((prev.scaleX ?? prev.scale) + (prev.scaleY ?? prev.scale)) / 2 : prev.scale,
                  }));
                }}
              />
              비율 잠금
            </label>

            {draft.lockAspect ? (
              <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                확대 {draft.scale.toFixed(2)}x
                <input
                  type="range"
                  min={0.25}
                  max={8}
                  step={0.05}
                  value={draft.scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                />
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                  가로 비율 {scaleX.toFixed(2)}x
                  <input
                    type="range"
                    min={0.25}
                    max={8}
                    step={0.05}
                    value={scaleX}
                    onChange={(e) => setScaleAxis('x', Number(e.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                  세로 비율 {scaleY.toFixed(2)}x
                  <input
                    type="range"
                    min={0.25}
                    max={8}
                    step={0.05}
                    value={scaleY}
                    onChange={(e) => setScaleAxis('y', Number(e.target.value))}
                  />
                </label>
              </>
            )}

            <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
              가로 이동 {Math.round(draft.x)}%
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={draft.x}
                onChange={(e) => setDraft((prev) => ({ ...prev, x: clampMove(Number(e.target.value)) }))}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
              세로 이동 {Math.round(draft.y)}%
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={draft.y}
                onChange={(e) => setDraft((prev) => ({ ...prev, y: clampMove(Number(e.target.value)) }))}
              />
            </label>

            <div className="mt-auto flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setDraft({ ...DEFAULT_CHARACTER_IMAGE_FIT })}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-bg-border text-sm text-text-secondary hover:text-text-primary hover:border-text-secondary/50"
              >
                <RotateCcw size={14} /> 초기화
              </button>
              <button
                type="button"
                onClick={() => { onCommit(normalizeCharacterImageFit(draft)); onClose(); }}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90"
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
