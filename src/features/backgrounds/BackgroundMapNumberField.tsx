import { useId, useRef, useState } from 'react';
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent } from 'react';
import { MoveHorizontal } from 'lucide-react';
import type { MapFieldScrub } from './mapCanvas';
import { MAP_NUMBER_FIELDS, pressNumberTrack, slideNumber, trackFraction, trackNumber } from './mapNumberField';
import type { MapNumberKey, MapNumberSlide } from './mapNumberField';
import { useMapScrubPointer } from './useMapScrubPointer';

const SLIDE_TITLE = '좌우로 끌어 값 바꾸기 · Shift를 누르면 큰 걸음 · 끄는 도중 Esc는 취소';
const BAR_TITLE = '눌러서 바로 맞추거나 점을 끌어요 · Shift를 누르면 큰 걸음';
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A number field of the inspector. Typed in, it keeps what is being typed: a value inside the limits applies at once; an
 * unfinished or out-of-range entry ("-", or "1" on the way to "150") waits until the field is left. Its name and the grip
 * at the left end of its box slide the value as well, and a number with fixed ends has a bar under the box. Not wrapped
 * in `memo`: it is drawn again whenever the editor is, and that is how the look of a drag goes when the editor ends it.
 */
export function BackgroundMapNumberField({ label, field, value, disabled = false, onChange, onDone, scrub }: {
  /** `field`: which number of the node this is. Its limits, its steps and its bar come from MAP_NUMBER_FIELDS. */
  label: string; field: MapNumberKey; value: number; disabled?: boolean;
  /** A typed value. A slide does not come this way: it goes through `scrub`. */
  onChange(value: number): void; onDone?(): void; scrub: MapFieldScrub }): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const parse = (raw: string) => { const next = raw.trim() === '' ? Number.NaN : Number(raw); return Number.isFinite(next) ? next : null; };
  const id = useId(), box = useRef<HTMLInputElement>(null), { min, max, track } = MAP_NUMBER_FIELDS[field];
  const press = useMapScrubPointer(scrub, disabled);
  const [dragging, setDragging] = useState(false);
  // The editor can end a drag by itself (Escape, a save starting). It draws this again then, and the look goes at once: not at the next pointer event.
  const lit = dragging && scrub.alive();
  const slide = (event: ReactPointerEvent<Element>) => press(event, {
    field, axis: 'x', immediate: false,
    // The anchor is where the drag starts (the press moved by the slop), not where the pointer is by then. The arithmetic is slideNumber's.
    open: (origin, from): MapNumberSlide => { setDragging(true); return { anchorX: from.clientX, anchorValue: origin.start, big: from.shiftKey, value: origin.start }; },
    read: (drag, at) => slideNumber(drag, at.clientX, at.shiftKey, field),
    tap: () => box.current?.focus(),
    close: () => setDragging(false),
  });
  const slideBar = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(), bar = pressNumberTrack(value, field, event.clientX, rect.left, rect.width);
    if (!bar) return;
    press(event, { field, axis: 'x', immediate: bar.immediate,
      open: origin => { setDragging(true); return origin.start; },
      read: (start, at) => trackNumber(bar.fraction(at.clientX), field, at.shiftKey, start),
      close: () => setDragging(false) });
  };
  return <div className={`bg-field bmap-num${lit ? ' is-dragging' : ''}`} data-disabled={disabled || undefined}>
    <label className="bmap-num-label" htmlFor={id} title={disabled ? undefined : SLIDE_TITLE} onPointerDown={slide}>{label}</label>
    <div className="bmap-num-row">
      <input ref={box} id={id} type="number" step="any" value={text ?? round(value)} min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined} disabled={disabled}
        onChange={event => {
          const raw = event.target.value, next = parse(raw);
          setText(raw);
          if (next !== null && next >= min && next <= max && next !== value) onChange(next);
        }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onBlur={() => {
          const next = text === null ? null : parse(text), clamped = next === null ? value : Math.min(max, Math.max(min, next));
          // An entry outside the limits lands on the nearest limit; when that is the value it already has, nothing is edited.
          if (clamped !== next && clamped !== value) onChange(clamped);
          setText(null); onDone?.();
        }} />
      <span className="bmap-num-grip" aria-hidden="true" title={disabled ? undefined : SLIDE_TITLE} onPointerDown={slide}><MoveHorizontal size={14} strokeWidth={2} /></span>
    </div>
    {track && <div className="bmap-num-track" aria-hidden="true" title={disabled ? undefined : BAR_TITLE} onPointerDown={slideBar}>
      <span className="bmap-num-thumb" style={{ '--bmap-num-at': trackFraction(value, field) } as CSSProperties} />
    </div>}
  </div>;
}
