import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CalendarEvent } from '@/types/calendar';
import {
  calendarEventIdentityKey,
  snapshotCalendarEventIdentity,
  type CalendarEventIdentity,
} from '@/utils/calendarEventIdentity';
import { computeEdgeScrollSpeed } from '@/utils/dragAutoScroll';
import { minutesToTime, pxToMinutes, snapMinutes, timeToMinutes } from '@/utils/timeGridLayout';

export type TimeGridDragMode = 'create' | 'move' | 'resize-end';

export type TimeGridEventPatch = {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
};

export type TimeGridDragPreview = TimeGridEventPatch & {
  mode: TimeGridDragMode;
  eventId?: string;
  identity?: CalendarEventIdentity;
  identityKey?: string;
};

export type TimeGridCreateCallback = (date: string, startTime: string, endTime: string) => void;
export type TimeGridEventChangeCallback = (
  eventId: string,
  identity: CalendarEventIdentity,
  patch: TimeGridEventPatch,
) => void;

export const TIME_GRID_HOUR_PX = 56;
export const TIME_GRID_DRAG_EDGE = 40;
const DRAG_THRESHOLD_PX = 5;
const CLICK_SUPPRESS_MS = 280;

export type TimeGridPointerTarget = {
  date: string;
  bandStartMin: number;
  column: HTMLElement;
};

type ActiveTimeGridDrag = {
  mode: TimeGridDragMode;
  anchor: { x: number; y: number; minutes: number; date: string };
  original?: TimeGridEventPatch;
  eventId?: string;
  identity?: CalendarEventIdentity;
  hasCrossedThreshold: boolean;
};

export type UseTimeGridDnDOptions = {
  scrollContainerRef: RefObject<HTMLElement | null>;
  onCreate?: TimeGridCreateCallback;
  onEventChange?: TimeGridEventChangeCallback;
};

/** 스크롤된 열의 viewport rect 기준 포인터 위치를 15분 단위로 바꾼다. */
export function getTimeGridPointerMinutes(clientY: number, rect: { top: number }, hourPx = TIME_GRID_HOUR_PX): number {
  return snapMinutes(pxToMinutes(clientY - rect.top, hourPx));
}

export function getTimeGridCreateRange(startMinutes: number, currentMinutes: number): Pick<TimeGridEventPatch, 'startTime' | 'endTime'> {
  const start = Math.min(startMinutes, currentMinutes);
  const end = startMinutes === currentMinutes ? start + 15 : Math.max(startMinutes, currentMinutes);
  return { startTime: minutesToTime(start), endTime: minutesToTime(Math.min(24 * 60, end)) };
}

export function getTimeGridEventPatch(
  mode: Extract<TimeGridDragMode, 'move' | 'resize-end'>,
  original: TimeGridEventPatch,
  targetDate: string,
  targetMinutes: number,
  anchorMinutes = timeToMinutes(original.startTime),
): TimeGridEventPatch {
  const originalStart = timeToMinutes(original.startTime);
  const originalEnd = timeToMinutes(original.endTime);
  if (mode === 'move') {
    const duration = Math.max(15, originalEnd - originalStart);
    const start = Math.max(0, Math.min(24 * 60 - duration, targetMinutes - (anchorMinutes - originalStart)));
    return {
      startDate: targetDate,
      endDate: targetDate,
      startTime: minutesToTime(start),
      endTime: minutesToTime(start + duration),
    };
  }

  const isBeforeStart = targetDate < original.startDate;
  const end = isBeforeStart ? originalStart + 15 : Math.max(originalStart + 15, targetMinutes);
  return {
    startDate: original.startDate,
    endDate: isBeforeStart ? original.startDate : targetDate,
    startTime: original.startTime,
    endTime: minutesToTime(Math.min(24 * 60, end)),
  };
}

export function shouldStartTimeGridDrag(start: { x: number; y: number }, current: { x: number; y: number }): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= DRAG_THRESHOLD_PX;
}

export function shouldSuppressTimeGridClick(dragFinishedAt: number, now: number): boolean {
  return dragFinishedAt > 0 && now - dragFinishedAt >= 0 && now - dragFinishedAt < CLICK_SUPPRESS_MS;
}

export function getTimeGridEventDragMode(isReadOnly: boolean, clientY: number, rectBottom: number): Extract<TimeGridDragMode, 'move' | 'resize-end'> | null {
  if (isReadOnly) return null;
  return clientY >= rectBottom - 8 ? 'resize-end' : 'move';
}

export type TimeGridDragCompletion =
  | { type: 'create'; date: string; startTime: string; endTime: string }
  | { type: 'event-change'; eventId: string; identity: CalendarEventIdentity; patch: TimeGridEventPatch };

/** Escape 또는 클릭만 한 경우 null을 반환해 완료 콜백을 원천적으로 막는다. */
export function getTimeGridDragCompletion(
  state: Pick<ActiveTimeGridDrag, 'mode' | 'hasCrossedThreshold' | 'eventId' | 'identity'> | null,
  preview: TimeGridDragPreview | null,
  cancelled = false,
): TimeGridDragCompletion | null {
  if (cancelled || !state?.hasCrossedThreshold || !preview) return null;
  if (state.mode === 'create') {
    return { type: 'create', date: preview.startDate, startTime: preview.startTime, endTime: preview.endTime };
  }
  if (!state.eventId || !state.identity) return null;
  return {
    type: 'event-change',
    eventId: state.eventId,
    identity: state.identity,
    patch: {
      startDate: preview.startDate,
      endDate: preview.endDate,
      startTime: preview.startTime,
      endTime: preview.endTime,
    },
  };
}

export function getTimeGridAutoScrollSpeed(clientY: number, rect: { top: number; bottom: number }): number {
  return computeEdgeScrollSpeed(clientY, rect.top, rect.bottom, TIME_GRID_DRAG_EDGE);
}

function findPointerTarget(clientX: number, clientY: number): TimeGridPointerTarget | null {
  const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const column = target?.closest<HTMLElement>('[data-time-grid-column="true"][data-date]');
  if (!column) return null;
  const date = column.dataset.date;
  const bandStartMin = Number(column.dataset.timeGridBandStart);
  if (!date || !Number.isFinite(bandStartMin)) return null;
  return { date, bandStartMin, column };
}

function getPointerMinute(target: TimeGridPointerTarget, clientY: number): number {
  return snapMinutes(target.bandStartMin + getTimeGridPointerMinutes(clientY, target.column.getBoundingClientRect()));
}

export function useTimeGridDnD({ scrollContainerRef, onCreate, onEventChange }: UseTimeGridDnDOptions) {
  const [drag, setDrag] = useState<ActiveTimeGridDrag | null>(null);
  const [preview, setPreview] = useState<TimeGridDragPreview | null>(null);
  const [settledIdentityKey, setSettledIdentityKey] = useState<string | null>(null);
  const dragRef = useRef<ActiveTimeGridDrag | null>(null);
  const previewRef = useRef<TimeGridDragPreview | null>(null);
  const latestClientY = useRef<number | null>(null);
  const onCreateRef = useRef(onCreate);
  const onEventChangeRef = useRef(onEventChange);
  const finishedAtRef = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  onCreateRef.current = onCreate;
  onEventChangeRef.current = onEventChange;

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    previewRef.current = null;
    latestClientY.current = null;
    setDrag(null);
    setPreview(null);
  }, []);

  const beginCreate = useCallback((event: React.MouseEvent<HTMLElement>, target: TimeGridPointerTarget) => {
    if (event.button !== 0) return;
    const minutes = getPointerMinute(target, event.clientY);
    const state: ActiveTimeGridDrag = {
      mode: 'create',
      anchor: { x: event.clientX, y: event.clientY, minutes, date: target.date },
      hasCrossedThreshold: false,
    };
    const range = getTimeGridCreateRange(minutes, minutes);
    dragRef.current = state;
    previewRef.current = { mode: 'create', startDate: target.date, endDate: target.date, ...range };
    latestClientY.current = event.clientY;
    setDrag(state);
    setPreview(previewRef.current);
  }, []);

  const beginEventDrag = useCallback((
    event: React.MouseEvent<HTMLElement>,
    source: CalendarEvent,
    mode: Extract<TimeGridDragMode, 'move' | 'resize-end'>,
    target: TimeGridPointerTarget,
  ) => {
    if (event.button !== 0 || source.isReadOnly) return;
    const anchorMinutes = getPointerMinute(target, event.clientY);
    const original: TimeGridEventPatch = {
      startDate: source.startDate,
      endDate: source.endDate,
      startTime: source.startTime ?? '00:00',
      endTime: source.endTime ?? '00:15',
    };
    const identity = snapshotCalendarEventIdentity(source);
    const state: ActiveTimeGridDrag = {
      mode,
      anchor: { x: event.clientX, y: event.clientY, minutes: anchorMinutes, date: target.date },
      original,
      eventId: source.id,
      identity,
      hasCrossedThreshold: false,
    };
    const identityKey = calendarEventIdentityKey(identity);
    dragRef.current = state;
    previewRef.current = { mode, eventId: source.id, identity, identityKey, ...original };
    latestClientY.current = event.clientY;
    setDrag(state);
    setPreview(previewRef.current);
  }, []);

  const isSettling = useCallback((event: CalendarEvent): boolean => (
    settledIdentityKey === calendarEventIdentityKey(event)
  ), [settledIdentityKey]);

  const shouldSuppressClick = useCallback(() => shouldSuppressTimeGridClick(finishedAtRef.current, Date.now()), []);

  useEffect(() => {
    if (!drag) return;
    const block = document.createElement('style');
    block.id = 'time-grid-dnd-pointer-block';
    block.textContent = '[data-time-grid-event="true"] { pointer-events: none !important; }';
    document.head.appendChild(block);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = drag.mode === 'resize-end' ? 'row-resize' : 'grabbing';

    const handleMouseMove = (event: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;
      latestClientY.current = event.clientY;
      if (!state.hasCrossedThreshold) {
        if (!shouldStartTimeGridDrag(state.anchor, { x: event.clientX, y: event.clientY })) return;
        state.hasCrossedThreshold = true;
        setDrag({ ...state });
      }
      const target = findPointerTarget(event.clientX, event.clientY);
      if (!target) return;
      const targetMinutes = getPointerMinute(target, event.clientY);
      const next = state.mode === 'create'
        ? { mode: state.mode, startDate: target.date, endDate: target.date, ...getTimeGridCreateRange(state.anchor.minutes, targetMinutes) }
        : {
          mode: state.mode,
          eventId: state.eventId,
          identity: state.identity,
          identityKey: state.identity ? calendarEventIdentityKey(state.identity) : undefined,
          ...getTimeGridEventPatch(state.mode, state.original!, target.date, targetMinutes, state.anchor.minutes),
        };
      previewRef.current = next;
      setPreview(next);
    };

    const finish = () => {
      const state = dragRef.current;
      const current = previewRef.current;
      const completion = getTimeGridDragCompletion(state, current);
      if (completion) {
        if (completion.type === 'create') {
          onCreateRef.current?.(completion.date, completion.startTime, completion.endTime);
        } else if (onEventChangeRef.current) {
          onEventChangeRef.current?.(completion.eventId, completion.identity, completion.patch);
          const key = calendarEventIdentityKey(completion.identity);
          setSettledIdentityKey(key);
          if (settleTimer.current) clearTimeout(settleTimer.current);
          settleTimer.current = setTimeout(() => setSettledIdentityKey(null), 450);
        }
        finishedAtRef.current = Date.now();
      }
      clearDrag();
    };

    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        getTimeGridDragCompletion(dragRef.current, previewRef.current, true);
        clearDrag();
      }
    };

    const scrollTimer = window.setInterval(() => {
      const y = latestClientY.current;
      const scroller = scrollContainerRef.current;
      if (y == null || !scroller) return;
      scroller.scrollTop += getTimeGridAutoScrollSpeed(y, scroller.getBoundingClientRect());
    }, 16);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', finish);
    document.addEventListener('keydown', cancel);
    return () => {
      window.clearInterval(scrollTimer);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', finish);
      document.removeEventListener('keydown', cancel);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      block.remove();
    };
  }, [clearDrag, drag, scrollContainerRef]);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  return {
    isDragging: drag !== null,
    isDragActive: drag?.hasCrossedThreshold === true,
    preview,
    beginCreate,
    beginEventDrag,
    isSettling,
    shouldSuppressClick,
  };
}
