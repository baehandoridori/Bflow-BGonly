import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CalendarEvent } from '@/types/calendar';
import {
  calendarEventIdentityKey,
  snapshotCalendarEventIdentity,
  type CalendarEventIdentity,
} from '@/utils/calendarEventIdentity';
import { computeEdgeScrollSpeed } from '@/utils/dragAutoScroll';
import { minutesToTime, pxToMinutes, snapMinutes, timeToMinutes } from '@/utils/timeGridLayout';
import { addDays, fmtDate, parseDate } from '@/utils/calendarDate';

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
) => void | Promise<void>;

export const TIME_GRID_HOUR_PX = 56;
export const TIME_GRID_DRAG_EDGE = 40;
const DRAG_THRESHOLD_PX = 5;
const CLICK_SUPPRESS_MS = 280;
const DAY_END_MINUTES = 24 * 60;

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
  const safeAnchor = Math.max(0, Math.min(startMinutes, DAY_END_MINUTES - 15));
  const safeCurrent = Math.max(0, Math.min(currentMinutes, DAY_END_MINUTES));
  const start = Math.min(safeAnchor, safeCurrent);
  const end = Math.min(
    DAY_END_MINUTES,
    safeAnchor === safeCurrent ? start + 15 : Math.max(safeAnchor, safeCurrent),
  );
  return { startTime: minutesToTime(Math.min(start, end - 15)), endTime: minutesToTime(end) };
}

function addDaysToDate(date: string, days: number): string {
  return fmtDate(addDays(parseDate(date), days));
}

function normalizeEndDateTime(date: string, minutes: number): Pick<TimeGridEventPatch, 'endDate' | 'endTime'> {
  const overflowDays = Math.floor(Math.max(0, minutes) / (24 * 60));
  return {
    endDate: addDaysToDate(date, overflowDays),
    endTime: minutesToTime(minutes - overflowDays * 24 * 60),
  };
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
    const duration = originalEnd - originalStart;
    const start = Math.max(0, targetMinutes - (anchorMinutes - originalStart));
    const startOverflowDays = Math.floor(start / (24 * 60));
    const startDate = addDaysToDate(targetDate, startOverflowDays);
    const startTime = minutesToTime(start - startOverflowDays * 24 * 60);
    const end = normalizeEndDateTime(startDate, start - startOverflowDays * 24 * 60 + duration);
    return {
      startDate,
      startTime,
      ...end,
    };
  }

  const isBeforeStartDate = targetDate < original.startDate;
  const isSameStartDate = targetDate === original.startDate;
  const end = isBeforeStartDate
    ? originalStart + 15
    : isSameStartDate
      ? Math.max(originalStart + 15, targetMinutes)
      : targetMinutes;
  const normalizedEnd = normalizeEndDateTime(isBeforeStartDate ? original.startDate : targetDate, end);
  return {
    startDate: original.startDate,
    ...normalizedEnd,
    startTime: original.startTime,
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

function getTimeGridCreatePreview(date: string, startMinutes: number, currentMinutes: number): TimeGridDragPreview {
  const range = getTimeGridCreateRange(startMinutes, currentMinutes);
  return {
    mode: 'create',
    startDate: date,
    endDate: range.endTime <= range.startTime ? addDaysToDate(date, 1) : date,
    ...range,
  };
}

export function useTimeGridDnD({ scrollContainerRef, onCreate, onEventChange }: UseTimeGridDnDOptions) {
  const [drag, setDrag] = useState<ActiveTimeGridDrag | null>(null);
  const [preview, setPreview] = useState<TimeGridDragPreview | null>(null);
  const [settledIdentityKey, setSettledIdentityKey] = useState<string | null>(null);
  const dragRef = useRef<ActiveTimeGridDrag | null>(null);
  const previewRef = useRef<TimeGridDragPreview | null>(null);
  const latestPointerRef = useRef<{ x: number; y: number } | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const onCreateRef = useRef(onCreate);
  const onEventChangeRef = useRef(onEventChange);
  const finishedAtRef = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  onCreateRef.current = onCreate;
  onEventChangeRef.current = onEventChange;

  const cancelPreviewFrame = useCallback(() => {
    if (previewFrameRef.current === null) return;
    window.cancelAnimationFrame(previewFrameRef.current);
    previewFrameRef.current = null;
  }, []);

  const schedulePreview = useCallback((next: TimeGridDragPreview) => {
    // mouseup은 다음 프레임 전에 올 수 있으므로 완료 계산용 최신값은 즉시 보존한다.
    previewRef.current = next;
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null;
      const latest = previewRef.current;
      if (latest) setPreview(latest);
    });
  }, []);

  const flushPreviewFrame = useCallback(() => {
    if (previewFrameRef.current === null) return;
    cancelPreviewFrame();
    const latest = previewRef.current;
    if (latest) setPreview(latest);
  }, [cancelPreviewFrame]);

  const clearDrag = useCallback(() => {
    cancelPreviewFrame();
    dragRef.current = null;
    previewRef.current = null;
    latestPointerRef.current = null;
    setDrag(null);
    setPreview(null);
  }, [cancelPreviewFrame]);

  const beginCreate = useCallback((event: React.MouseEvent<HTMLElement>, target: TimeGridPointerTarget) => {
    if (event.button !== 0) return;
    cancelPreviewFrame();
    const minutes = getPointerMinute(target, event.clientY);
    const state: ActiveTimeGridDrag = {
      mode: 'create',
      anchor: { x: event.clientX, y: event.clientY, minutes, date: target.date },
      hasCrossedThreshold: false,
    };
    dragRef.current = state;
    previewRef.current = null;
    latestPointerRef.current = { x: event.clientX, y: event.clientY };
    setDrag(state);
    setPreview(null);
  }, [cancelPreviewFrame]);

  const beginEventDrag = useCallback((
    event: React.MouseEvent<HTMLElement>,
    source: CalendarEvent,
    mode: Extract<TimeGridDragMode, 'move' | 'resize-end'>,
    target: TimeGridPointerTarget,
  ) => {
    if (event.button !== 0 || source.isReadOnly) return;
    cancelPreviewFrame();
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
    dragRef.current = state;
    previewRef.current = null;
    latestPointerRef.current = { x: event.clientX, y: event.clientY };
    setDrag(state);
    setPreview(null);
  }, [cancelPreviewFrame]);

  const isSettling = useCallback((event: CalendarEvent): boolean => (
    settledIdentityKey === calendarEventIdentityKey(event)
  ), [settledIdentityKey]);

  const shouldSuppressClick = useCallback(() => shouldSuppressTimeGridClick(finishedAtRef.current, Date.now()), []);

  const isDragPresent = drag !== null;

  useEffect(() => {
    if (!isDragPresent) return;

    const activateDrag = (state: ActiveTimeGridDrag) => {
      if (!document.getElementById('time-grid-dnd-pointer-block')) {
        const block = document.createElement('style');
        block.id = 'time-grid-dnd-pointer-block';
        block.textContent = '[data-time-grid-event="true"] { pointer-events: none !important; }';
        document.head.appendChild(block);
      }
      document.body.style.userSelect = 'none';
      document.body.style.cursor = state.mode === 'resize-end' ? 'row-resize' : 'grabbing';
    };

    const refreshPreview = (clientX: number, clientY: number) => {
      const state = dragRef.current;
      if (!state?.hasCrossedThreshold) return;
      const target = findPointerTarget(clientX, clientY);
      if (!target) return;
      const targetMinutes = getPointerMinute(target, clientY);
      const next = state.mode === 'create'
        ? getTimeGridCreatePreview(state.anchor.date, state.anchor.minutes, targetMinutes)
        : {
          mode: state.mode,
          eventId: state.eventId,
          identity: state.identity,
          identityKey: state.identity ? calendarEventIdentityKey(state.identity) : undefined,
          ...getTimeGridEventPatch(state.mode, state.original!, target.date, targetMinutes, state.anchor.minutes),
        };
      schedulePreview(next);
    };

    const handleMouseMove = (event: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;
      latestPointerRef.current = { x: event.clientX, y: event.clientY };
      if (!state.hasCrossedThreshold) {
        if (!shouldStartTimeGridDrag(state.anchor, { x: event.clientX, y: event.clientY })) return;
        state.hasCrossedThreshold = true;
        activateDrag(state);
        setDrag({ ...state });
      }
      refreshPreview(event.clientX, event.clientY);
    };

    const finish = () => {
      const state = dragRef.current;
      const pointer = latestPointerRef.current;
      if (pointer) refreshPreview(pointer.x, pointer.y);
      flushPreviewFrame();
      const current = previewRef.current;
      const completion = getTimeGridDragCompletion(state, current);
      if (completion) {
        if (completion.type === 'create') {
          onCreateRef.current?.(completion.date, completion.startTime, completion.endTime);
        } else if (onEventChangeRef.current) {
          try {
            const changeResult = onEventChangeRef.current(completion.eventId, completion.identity, completion.patch);
            void Promise.resolve(changeResult).catch((error) => {
              console.warn('[Calendar] 시간표 일정 변경 저장 실패:', error);
            });
          } catch (error) {
            console.warn('[Calendar] 시간표 일정 변경 저장 실패:', error);
          }
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
        event.preventDefault?.();
        if (dragRef.current?.hasCrossedThreshold) {
          finishedAtRef.current = Date.now();
        }
        clearDrag();
      }
    };

    const scrollTimer = window.setInterval(() => {
      const state = dragRef.current;
      const pointer = latestPointerRef.current;
      const scroller = scrollContainerRef.current;
      if (!state?.hasCrossedThreshold || !pointer || !scroller) return;
      const speed = getTimeGridAutoScrollSpeed(pointer.y, scroller.getBoundingClientRect());
      if (speed === 0) return;
      scroller.scrollTop += speed;
      refreshPreview(pointer.x, pointer.y);
    }, 16);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', finish);
    document.addEventListener('keydown', cancel);
    return () => {
      window.clearInterval(scrollTimer);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', finish);
      document.removeEventListener('keydown', cancel);
      cancelPreviewFrame();
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.getElementById('time-grid-dnd-pointer-block')?.remove();
    };
  }, [cancelPreviewFrame, clearDrag, flushPreviewFrame, isDragPresent, schedulePreview, scrollContainerRef]);

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
