import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MapFieldScrub, MapScrubOrigin } from './mapCanvas.ts';
import { MAP_NUMBER_SCRUB } from './mapNumberField.ts';
import type { MapNumberKey } from './mapNumberField.ts';

export type MapScrubPoint = { clientX: number; clientY: number; shiftKey: boolean };
/** What one control makes of a pressed pointer. Built at the press. */
export type MapScrubDrive<S> = {
  field: MapNumberKey;
  /** The direction the drag runs in: movement along the other one never starts it. */
  axis: 'x' | 'y';
  /** True: the press itself starts the drag (a press on the bar away from its dot). False: the first move past the slop does. */
  immediate: boolean;
  /**
   * The drag starts. `from` is where it starts: the press itself when `immediate`, else the press moved by the slop along the
   * axis, towards the pointer. Never where the pointer is by then: a fast start reads the same as a slow one, and the first
   * value is the one the drag started from. What this returns is kept until the drag ends.
   */
  open(origin: MapScrubOrigin, from: MapScrubPoint): S;
  /** The value at a pointer position. May re-anchor `drag` (Shift pressed or released on the way). */
  read(drag: S, at: MapScrubPoint): number;
  /** The press was released without becoming a drag. */
  tap?(): void;
  /** The drag is over, however it ended. Not called for a press that never became a drag, nor as the control is taken down. */
  close?(): void;
};

/** One pressed pointer. `end` takes its listeners away; `giveUp` also cancels the drag it was running. */
type Session = { pointerId: number; press: MapScrubPoint; phase: 'pressed' | 'dragging' | 'dead'; last: number; end(): void; giveUp(): void };
export function useMapScrubPointer(scrub: MapFieldScrub, disabled: boolean): <S>(event: ReactPointerEvent<Element>, drive: MapScrubDrive<S>) => void {
  const latest = useRef({ scrub, disabled }), session = useRef<Session | null>(null);
  latest.current = { scrub, disabled };
  // Taken down with a press still on it (another node was picked, the pane was folded): the listeners go whatever the phase, and a drag still running is cancelled.
  useEffect(() => () => {
    const active = session.current;
    if (!active) return;
    if (active.phase === 'dragging' && latest.current.scrub.alive()) latest.current.scrub.cancel();
    active.end();
  }, []);
  return useCallback(<S>(event: ReactPointerEvent<Element>, drive: MapScrubDrive<S>) => {
    if (!event.isPrimary || event.button !== 0 || latest.current.disabled) return;
    // A session of this pointer that is still here was never released as far as this window heard: it is given up first. Another pointer waits.
    if (session.current) { if (session.current.pointerId !== event.pointerId) return; session.current.giveUp(); }
    event.preventDefault();
    const target = event.currentTarget, pointerId = event.pointerId;
    let drag: S;
    const active: Session = { pointerId, press: { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey }, phase: 'pressed', last: Number.NaN, end, giveUp };
    function end() {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel); target.removeEventListener('lostpointercapture', cancel);
      // After the listeners: the lostpointercapture this raises is no cancel.
      try { if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId); } catch { /* no capture here */ }
      if (session.current === active) session.current = null;
    }
    function giveUp() {
      if (active.phase === 'dragging') { if (latest.current.scrub.alive()) latest.current.scrub.cancel(); drive.close?.(); }
      end();
    }
    function read(at: MapScrubPoint) {
      // The editor has cancelled the drag (Escape, a save starting): nothing more comes of this press.
      if (!latest.current.scrub.alive()) { active.phase = 'dead'; drive.close?.(); return; }
      const value = drive.read(drag, at);
      if (Number.isFinite(value) && value !== active.last) { active.last = value; latest.current.scrub.preview(drive.field, value); }
    }
    function begin(at: MapScrubPoint, along: number) {
      const origin = latest.current.scrub.begin(drive.field);
      // Beginning moves the focus, and what that commits is drawn at once: this control may have been taken down meanwhile.
      if (session.current !== active) { if (origin && latest.current.scrub.alive()) latest.current.scrub.cancel(); return; }
      if (!origin) { end(); return; }
      const slop = Math.sign(along) * MAP_NUMBER_SCRUB.slopPx;
      const from = drive.immediate ? active.press : { clientX: active.press.clientX + (drive.axis === 'x' ? slop : 0), clientY: active.press.clientY + (drive.axis === 'y' ? slop : 0), shiftKey: at.shiftKey };
      drag = drive.open(origin, from); active.last = origin.start; active.phase = 'dragging';
      read(at);
    }
    function move(event: PointerEvent) {
      if (event.pointerId !== active.pointerId) return;
      // Letting go of the left button while another one is held arrives as a move, not as a release. So does a pointer that comes back after its button came up outside the window.
      if ((event.buttons & 1) === 0) { up(event); return; }
      if (active.phase === 'dragging') { read(event); return; }
      if (active.phase === 'dead') return;
      const along = drive.axis === 'x' ? event.clientX - active.press.clientX : event.clientY - active.press.clientY;
      if (Math.abs(along) >= MAP_NUMBER_SCRUB.slopPx) begin(event, along);
    }
    function up(event: PointerEvent) {
      if (event.pointerId !== active.pointerId) return;
      if (active.phase === 'pressed') { end(); drive.tap?.(); return; }
      if (active.phase === 'dragging') {
        read(event);                                                  // the place of the release
        if (active.phase === 'dragging') { latest.current.scrub.finish(); drive.close?.(); }
      }
      end();
      // The click that follows a drag is nobody's: on the name of a field it would put the caret in the box.
      const swallow = (click: Event) => { click.stopPropagation(); click.preventDefault(); };
      window.addEventListener('click', swallow, true);
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    }
    function cancel(event: Event) {
      if ('pointerId' in event && event.pointerId !== active.pointerId) return;
      giveUp();
    }
    session.current = active;
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', cancel, true);
    // Not in the capture phase: the blur of the field that `begin` takes the focus from would be heard too, and cancel the drag as it starts.
    window.addEventListener('blur', cancel); target.addEventListener('lostpointercapture', cancel);
    try { target.setPointerCapture(pointerId); } catch { /* no capture here: the window listeners follow the pointer anyway */ }
    if (drive.immediate) begin(active.press, 0);
  }, []);
}
