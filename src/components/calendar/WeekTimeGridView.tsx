import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { CalendarEvent } from '@/types/calendar';
import { layoutEventBars, type EventBar } from '@/components/calendar/CalendarGrid';
import { fmtDate, hexToRgba } from '@/utils/calendarDate';
import { formatEventChipText, formatEventTimeRange } from '@/utils/calendarEventFilter';
import { calendarEventIdentityKey } from '@/utils/calendarEventIdentity';
import { layoutDayBlocks, minutesToTime, timeToMinutes } from '@/utils/timeGridLayout';
import { useMotionPref } from '@/hooks/useMotionPref';
import { clampStaggerDelay } from '@/components/widgets/my-tasks/motionUtils';
import {
  useTimeGridDnD,
  getTimeGridEventDragMode,
  type TimeGridDragPreview,
  type TimeGridEventChangeCallback,
  type TimeGridCreateCallback,
  type TimeGridPointerTarget,
} from '@/hooks/useTimeGridDnD';

const HOUR_PX = 56;
const TIME_GUTTER_PX = 56;
const MAIN_START_MIN = 9 * 60;
const MAIN_END_MIN = 19 * 60;
const DAWN_END_MIN = MAIN_START_MIN;
const EVENING_START_MIN = MAIN_END_MIN;
const DAY_END_MIN = 24 * 60;
const ALL_DAY_ROW_PX = 28;
const MIN_TIMED_TEXT_HEIGHT_PX = 14;
const WHEEL_GESTURE_LOCK_MS = 150;
const WEEKDAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
const CARD_BASE_RGB = [26, 29, 39] as const; // #1A1D27
const EMPTY_NAME_MAP: Record<string, string> = {};

export interface WeekTimeGridViewProps {
  /** 일요일부터 토요일까지의 활성 주간 날짜 7개 */
  weekDays: Date[];
  events: CalendarEvent[];
  /** 상위 보기의 날짜 힌트. 현재 시각 강조는 minute-updated clock을 기준으로 계산한다. */
  today: string;
  onEventClick: (event: CalendarEvent) => void;
  /** PR-C에서 시간 prefill을 연결한다. PR-B는 선택한 날짜만 연다. */
  onSlotClick: (date: string, startTime: string, endTime: string) => void;
  tagNameById: Record<string, string>;
  calendarNameById: Record<string, string>;
  /** ScheduleView가 주 범위를 소유하고, 그리드는 계산한 다음 인덱스만 요청한다. */
  activeWeekIndex: number;
  weekCount: number;
  onWeekChange: (nextIndex: number) => void;
  /** PR-D에서 DOM 핸들러를 연결할 미래 확장점. B.3에서는 의도적으로 attach하지 않는다. */
  onEventContextMenu?: (event: CalendarEvent, mouse: React.MouseEvent<HTMLButtonElement>) => void;
  /** ScheduleView가 기존 optimistic update 경로로 연결할 시간표 생성 콜백. */
  onTimeGridCreate?: TimeGridCreateCallback;
  /** ScheduleView가 source-aware identity로 연결할 시간표 이동·종료 리사이즈 콜백. */
  onTimeGridEventChange?: TimeGridEventChangeCallback;
  /** 상위가 낙관적 변경을 보이는 동안 내부 preview를 덮어쓸 수 있는 선택 계약. */
  timeGridDragPreview?: TimeGridDragPreview | null;
  /** 다른 창에서 추가·수정된 source-aware 일정 identity. */
  highlightedEventIdentities?: ReadonlySet<string>;
}

type TimedEvent = {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  layoutId: string;
};

type TimeBandBlock = {
  source: TimedEvent;
  startMin: number;
  endMin: number;
  layoutId: string;
};

type WeekWheelGestureLock = { current: ReturnType<typeof setTimeout> | null };

export function splitWeekTimeGridEvents(events: CalendarEvent[]): {
  allDayEvents: CalendarEvent[];
  timedEventsByDate: Map<string, CalendarEvent[]>;
} {
  const allDayEvents: CalendarEvent[] = [];
  const timedEventsByDate = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    if (event.allDay !== false || event.startDate !== event.endDate) {
      allDayEvents.push(event);
      continue;
    }
    const dayEvents = timedEventsByDate.get(event.startDate) ?? [];
    dayEvents.push(event);
    timedEventsByDate.set(event.startDate, dayEvents);
  }

  return { allDayEvents, timedEventsByDate };
}

/** 밴드에 일정이 있거나 현재 시각이 속하면 최초 기본값은 펼치되, 사용자의 선택은 우선한다. */
export function resolveBandExpanded(
  hasTimedBlocks: boolean,
  userChoice: boolean | null,
  nowMin: number,
  bandStartMin: number,
  bandEndMin: number,
  includesToday: boolean,
): boolean {
  if (userChoice !== null) return userChoice;
  const containsNow = includesToday && nowMin >= bandStartMin && nowMin < bandEndMin;
  return hasTimedBlocks || containsNow;
}

/** 빈 시간 클릭을 위한 30분 단위 슬롯. */
export function getTimeSlots(startMin: number, endMin: number): Array<{ startMin: number; endMin: number }> {
  const slots: Array<{ startMin: number; endMin: number }> = [];
  for (let slotStart = startMin; slotStart < endMin; slotStart += 30) {
    slots.push({ startMin: slotStart, endMin: Math.min(endMin, slotStart + 30) });
  }
  return slots;
}

/** minute-updated clock에서 실제 오늘과 주 안의 열 위치를 함께 계산한다. */
export function getTimeGridToday(now: Date, dateStrings: readonly string[]): { today: string; todayIndex: number } {
  const today = fmtDate(now);
  return { today, todayIndex: dateStrings.indexOf(today) };
}

/** 범위 밖 -1 / weekCount도 상위가 연도 이동으로 해석하도록 그대로 전달한다. */
export function getNextWeekIndex(activeWeekIndex: number, _weekCount: number, delta: -1 | 1): number {
  return activeWeekIndex + delta;
}

/** Shift+wheel만 상위 주 이동으로 소비한다. 일반 wheel과 0 이동은 native scroll에 맡긴다. */
export function requestWeekChangeFromWheel(
  event: Pick<React.WheelEvent<HTMLDivElement>, 'shiftKey' | 'deltaY' | 'deltaX' | 'preventDefault'>,
  activeWeekIndex: number,
  weekCount: number,
  onWeekChange: (nextIndex: number) => void,
  gestureLock?: WeekWheelGestureLock,
): boolean {
  if (!event.shiftKey) return false;
  const movement = event.deltaY || event.deltaX;
  if (movement === 0) return false;
  if (gestureLock?.current != null) {
    event.preventDefault();
    return false;
  }
  event.preventDefault();
  onWeekChange(getNextWeekIndex(activeWeekIndex, weekCount, movement > 0 ? 1 : -1));
  if (gestureLock) {
    gestureLock.current = setTimeout(() => {
      gestureLock.current = null;
    }, WHEEL_GESTURE_LOCK_MS);
  }
  return true;
}

/** 컴포넌트 unmount 시 남아 있는 Shift+wheel 잠금을 정리한다. */
export function clearWeekWheelGestureLock(gestureLock: WeekWheelGestureLock): void {
  if (gestureLock.current !== null) {
    clearTimeout(gestureLock.current);
    gestureLock.current = null;
  }
}

/** 종일 레인으로 강등된 시간 일정도 시작 시각과 주간 경계 계속 표시를 잃지 않는다. */
export function getAllDayBarLabel(
  bar: Pick<EventBar, 'event' | 'isStart' | 'isEnd'>,
  tagNameById: Record<string, string> = EMPTY_NAME_MAP,
  calendarNameById: Record<string, string> = EMPTY_NAME_MAP,
): string {
  const before = bar.isStart ? '' : '◂ ';
  const after = bar.isEnd ? '' : ' ▸';
  return `${before}${formatEventChipText(bar.event, tagNameById, calendarNameById)}${after}`;
}

/** 현재 시각선은 활성 밴드 내부의 half-open 구간에서만 위치를 만든다. */
export function getCurrentTimeMarker(
  nowMin: number,
  bandStartMin: number,
  bandEndMin: number,
  todayIndex: number,
): { top: number; label: string; todayIndex: number } | null {
  if (todayIndex < 0 || nowMin < bandStartMin || nowMin >= bandEndMin) return null;
  return {
    top: ((nowMin - bandStartMin) / 60) * HOUR_PX,
    label: minutesToTime(nowMin),
    todayIndex,
  };
}

function tintOnCard(color: string): string {
  const hex = color.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return color;
  const source = [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
  const tinted = source.map((channel, index) => Math.round(CARD_BASE_RGB[index] * 0.82 + channel * 0.18));
  return `rgb(${tinted.join(', ')})`;
}

/** D10 시간 블록의 공통 색상 처리. */
export function getTimedBlockVisualStyle(color: string): {
  background: string;
  borderLeft: string;
  titleColor: string;
  titleFontSize: number;
  timeColor: string;
} {
  return {
    background: tintOnCard(color),
    borderLeft: `3px solid ${color}`,
    titleColor: '#E8E8EE',
    titleFontSize: 11,
    timeColor: color,
  };
}

export function getTimedBlockStateStyle(color: string, isCurrent: boolean): {
  outline?: string;
  outlineOffset?: number;
  boxShadow?: string;
} {
  if (!isCurrent) return {};
  return {
    outline: `1px solid ${color}`,
    outlineOffset: 1,
    boxShadow: `0 0 16px ${hexToRgba(color, 0.75)}`,
  };
}

export function getTimedBlockOpacity(isPast: boolean): number {
  return isPast ? 0.5 : 1;
}

/** 24:00은 다음 날짜의 00:00으로 저장되므로, 같은 열에서는 하루를 더해 ghost 높이를 계산한다. */
export function getTimeGridCreateGhostHeight(preview: Pick<TimeGridDragPreview, 'startDate' | 'endDate' | 'startTime' | 'endTime'>): number {
  const startMinutes = timeToMinutes(preview.startTime);
  const endMinutes = timeToMinutes(preview.endTime) + (preview.endDate > preview.startDate ? DAY_END_MIN : 0);
  return Math.max(0, ((endMinutes - startMinutes) / 60) * HOUR_PX);
}

/** 드래그 중인 블록은 Framer Motion transform으로만 확대해 inline transform과 충돌하지 않게 한다. */
export function getTimeGridBlockMotion({
  reduce,
  opacity,
  layoutIndex,
  isMoving,
  isSettling,
}: {
  reduce: boolean;
  opacity: number;
  layoutIndex: number;
  isMoving: boolean;
  isSettling: boolean;
}): {
  animate: { opacity: number; y: number; scale: number };
  transition: { duration: number; delay?: number; ease?: number[] };
} {
  const animate = { opacity, y: 0, scale: reduce ? 1 : (isMoving ? 1.02 : 1) };
  if (reduce) return { animate, transition: { duration: 0 } };
  if (isSettling) {
    return {
      animate,
      transition: { duration: 0.45, ease: [0.34, 1.56, 0.64, 1] },
    };
  }
  return {
    animate,
    transition: { duration: 0.18, delay: clampStaggerDelay(layoutIndex, false) },
  };
}

export function getAllDayBarStyle(color: string): { background: string; borderLeft: string; color: string } {
  return {
    background: tintOnCard(color),
    borderLeft: `3px solid ${color}`,
    color: '#E8E8EE',
  };
}

function toTimedEvent(event: CalendarEvent): TimedEvent {
  const startMin = Math.max(0, Math.min(DAY_END_MIN, timeToMinutes(event.startTime ?? '00:00')));
  const suppliedEnd = event.endTime ? timeToMinutes(event.endTime) : startMin + 60;
  const endMin = Math.max(startMin + 1, Math.min(DAY_END_MIN, suppliedEnd > startMin ? suppliedEnd : startMin + 60));
  return { event, startMin, endMin, layoutId: calendarEventIdentityKey(event) };
}

function bandContains(blocks: TimedEvent[], startMin: number, endMin: number): boolean {
  return blocks.some((block) => block.startMin < endMin && block.endMin > startMin);
}

function hasBlocksInBand(blocksByDate: Map<string, TimedEvent[]>, startMin: number, endMin: number): boolean {
  return [...blocksByDate.values()].some((blocks) => bandContains(blocks, startMin, endMin));
}

/** 이동·종료 리사이즈 preview는 새 범위를 그리되, mouseup 전에는 원래 밴드가 접혀 pointer 좌표가 바뀌지 않게 한다. */
function isTimedEventInBand(event: CalendarEvent | null, startMin: number, endMin: number): boolean {
  return event !== null
    && event.allDay === false
    && event.startDate === event.endDate
    && bandContains([toTimedEvent(event)], startMin, endMin);
}

/** 각 보이는 시간 밴드 안에서만 겹침을 계산하도록 블록을 자르고 고유 ID를 붙인다. */
function clipTimedBlocksToBand(blocks: TimedEvent[], startMin: number, endMin: number): TimeBandBlock[] {
  return blocks.flatMap((block) => {
    const clippedStart = Math.max(block.startMin, startMin);
    const clippedEnd = Math.min(block.endMin, endMin);
    if (clippedEnd <= clippedStart) return [];
    return [{
      source: block,
      startMin: clippedStart,
      endMin: clippedEnd,
      layoutId: `${block.layoutId}@${startMin}-${endMin}`,
    }];
  });
}

export function formatKoreanHour(min: number): string {
  const hour = Math.floor(min / 60) % 24;
  const period = hour < 12 ? '오전' : '오후';
  const displayHour = hour % 12 || 12;
  return `${period} ${displayHour}시`;
}

export function getCollapsedBandLabel(label: string, startMin: number, endMin: number): string {
  return `▸ ${label} · ${formatKoreanHour(startMin)}–${formatKoreanHour(endMin)} · 접힘`;
}

export function getNonTodayCurrentLineStyle(): { background: string; height: number } {
  return { background: 'rgba(255, 107, 107, 0.28)', height: 1 };
}

export function getWeekendCellStyle(isWeekend: boolean): { backgroundImage?: string } {
  return isWeekend
    ? { backgroundImage: 'linear-gradient(rgba(116, 185, 255, 0.06), rgba(116, 185, 255, 0.06))' }
    : {};
}

function eventBlockStyle(layout: { col: number; span: number; cols: number }, top: number, height: number) {
  return {
    top,
    height,
    left: `calc(${(layout.col / layout.cols) * 100}% + 2px)`,
    width: `calc(${(layout.span / layout.cols) * 100}% - 4px)`,
  };
}

export function WeekTimeGridView({
  weekDays,
  events,
  onEventClick,
  onSlotClick,
  tagNameById,
  calendarNameById,
  activeWeekIndex,
  weekCount,
  onWeekChange,
  onTimeGridCreate,
  onTimeGridEventChange,
  timeGridDragPreview,
  highlightedEventIdentities,
}: WeekTimeGridViewProps) {
  const { reduce } = useMotionPref();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showAllDay, setShowAllDay] = useState(false);
  const [dawnChoice, setDawnChoice] = useState<boolean | null>(null);
  const [eveningChoice, setEveningChoice] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => new Date());
  const wheelGestureLock = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeGridDnD = useTimeGridDnD({
    scrollContainerRef: scrollRef,
    onCreate: onTimeGridCreate,
    onEventChange: onTimeGridEventChange,
  });
  const dragPreview = timeGridDragPreview ?? timeGridDnD.preview;

  const dates = useMemo(() => weekDays.slice(0, 7), [weekDays]);
  const dateStrings = useMemo(() => dates.map(fmtDate), [dates]);
  const weekKey = dateStrings.join('|');
  const displayedEvents = useMemo(() => {
    if (!dragPreview?.identityKey || dragPreview.mode === 'create') return events;
    return events.map((event) => calendarEventIdentityKey(event) === dragPreview.identityKey
      ? { ...event, ...dragPreview }
      : event);
  }, [dragPreview, events]);
  const { allDayEvents: displayedAllDayEvents, timedEventsByDate } = useMemo(
    () => splitWeekTimeGridEvents(displayedEvents),
    [displayedEvents],
  );
  const { allDayEvents: sourceAllDayEvents } = useMemo(() => splitWeekTimeGridEvents(events), [events]);
  const dragGhostEvent = useMemo(() => (
    dragPreview && dragPreview.mode !== 'create' && dragPreview.identityKey
      ? events.find((event) => calendarEventIdentityKey(event) === dragPreview.identityKey) ?? null
      : null
  ), [dragPreview, events]);
  // 날짜를 넘긴 시간 일정 preview는 종일 레인으로 승격되지만, mouseup 전에는 헤더 높이가 변하면 안 된다.
  const shouldFreezeAllDayLayout = timeGridDnD.isDragActive
    && dragGhostEvent?.allDay === false
    && dragGhostEvent.startDate === dragGhostEvent.endDate;
  const allDayEvents = shouldFreezeAllDayLayout ? sourceAllDayEvents : displayedAllDayEvents;
  const allDayBars = useMemo(
    () => (dates.length === 7 ? layoutEventBars(allDayEvents, dates[0], 7) : []),
    [allDayEvents, dates],
  );
  // 시간 일정이 날짜를 넘겨 종일 레인으로 승격돼도, 드래그 중 레인 높이는 원래 배치로 고정한다.
  // 이때 preview 자체는 별도 절대 배치로 남겨 사용자가 이동 결과와 시각을 계속 확인할 수 있게 한다.
  const frozenTimedDragPreviewBar = useMemo(() => {
    if (!shouldFreezeAllDayLayout || !dragPreview?.identityKey || dates.length !== 7) return null;
    const previewEvent = displayedAllDayEvents.find((event) => (
      calendarEventIdentityKey(event) === dragPreview.identityKey
    ));
    if (!previewEvent) return null;
    return layoutEventBars([...sourceAllDayEvents, previewEvent], dates[0], 7).find((bar) => (
      calendarEventIdentityKey(bar.event) === dragPreview.identityKey
    )) ?? null;
  }, [dates, displayedAllDayEvents, dragPreview, shouldFreezeAllDayLayout, sourceAllDayEvents]);
  const visibleAllDayRows = showAllDay
    ? (allDayBars.length ? Math.max(...allDayBars.map((bar) => bar.row)) + 1 : 0)
    : Math.min(2, allDayBars.length ? Math.max(...allDayBars.map((bar) => bar.row)) + 1 : 0);
  const hiddenAllDayCount = allDayBars.filter((bar) => bar.row >= 2).length;

  const timedByDate = useMemo(() => {
    const result = new Map<string, TimedEvent[]>();
    for (const date of dateStrings) {
      result.set(date, (timedEventsByDate.get(date) ?? []).map(toTimedEvent));
    }
    return result;
  }, [dateStrings, timedEventsByDate]);
  const hasDawnBlocks = useMemo(() => (
    hasBlocksInBand(timedByDate, 0, DAWN_END_MIN)
    || (timeGridDnD.isDragActive && isTimedEventInBand(dragGhostEvent, 0, DAWN_END_MIN))
  ), [dragGhostEvent, timeGridDnD.isDragActive, timedByDate]);
  const hasEveningBlocks = useMemo(() => (
    hasBlocksInBand(timedByDate, EVENING_START_MIN, DAY_END_MIN)
    || (timeGridDnD.isDragActive && isTimedEventInBand(dragGhostEvent, EVENING_START_MIN, DAY_END_MIN))
  ), [dragGhostEvent, timeGridDnD.isDragActive, timedByDate]);
  const { today: actualToday, todayIndex } = getTimeGridToday(now, dateStrings);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const includesToday = todayIndex >= 0;
  const dawnVisible = resolveBandExpanded(hasDawnBlocks, dawnChoice, nowMin, 0, DAWN_END_MIN, includesToday);
  const eveningVisible = resolveBandExpanded(hasEveningBlocks, eveningChoice, nowMin, EVENING_START_MIN, DAY_END_MIN, includesToday);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => () => clearWeekWheelGestureLock(wheelGestureLock), []);

  useEffect(() => {
    let cancelled = false;
    let done = false;
    const scrollIntoView = () => {
      if (cancelled || done) return;
      done = true;
      const currentTodayIndex = dateStrings.indexOf(actualToday);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const beforeMain = dawnVisible ? (DAWN_END_MIN / 60) * HOUR_PX : 0;
      const target = currentTodayIndex >= 0
        ? Math.max(0, beforeMain + ((nowMin - MAIN_START_MIN - 90) / 60) * HOUR_PX)
        : beforeMain;
      scrollRef.current?.scrollTo({ top: target, behavior: 'auto' });
    };
    const frame = window.requestAnimationFrame(scrollIntoView);
    const fallback = window.setTimeout(scrollIntoView, 0);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, [actualToday, dawnVisible, weekKey]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    requestWeekChangeFromWheel(event, activeWeekIndex, weekCount, onWeekChange, wheelGestureLock);
  }, [activeWeekIndex, onWeekChange, weekCount]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-bg-border/40 bg-bg-primary/50">
      <div className="sticky top-0 z-30 border-b border-bg-border/40 bg-bg-primary/95 backdrop-blur">
        <div className="grid" style={{ gridTemplateColumns: `${TIME_GUTTER_PX}px repeat(7, minmax(0, 1fr))` }}>
          <div aria-hidden="true" />
          {dates.map((date, index) => {
            const dateStr = dateStrings[index];
            const isToday = dateStr === actualToday;
            const isWeekend = index === 0 || index === 6;
            return (
              <div
                key={dateStr}
                className={`min-w-0 border-l border-bg-border/25 px-2 py-2 text-center ${isToday ? 'bg-accent/10' : ''}`}
                style={getWeekendCellStyle(isWeekend)}
              >
                <div className={`text-[11px] font-semibold ${index === 0 ? 'text-red-400' : index === 6 ? 'text-blue-400' : 'text-text-secondary'}`}>
                  {WEEKDAY_KR[index]}
                </div>
                <div className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${isToday ? 'bg-accent text-white' : 'text-text-primary'}`}>
                  {date.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        <div className="relative border-t border-bg-border/25" style={{ minHeight: Math.max(ALL_DAY_ROW_PX, visibleAllDayRows * ALL_DAY_ROW_PX) + 6 }}>
          <div className="absolute inset-y-0 left-0 flex items-start justify-center pt-2 text-[9px] text-text-secondary" style={{ width: TIME_GUTTER_PX }}>종일</div>
          <div className="absolute inset-y-0 right-0 grid grid-cols-7" style={{ left: TIME_GUTTER_PX }}>
            {dateStrings.map((dateStr, index) => (
              <div
                key={dateStr}
                aria-hidden="true"
                data-time-grid-all-day-empty="true"
                className={`border-l border-bg-border/20 transition-colors hover:bg-bg-border/15 ${dateStr === actualToday ? 'bg-accent/[0.03]' : ''}`}
                style={getWeekendCellStyle(index === 0 || index === 6)}
              />
            ))}
          </div>
          <div className="absolute inset-y-0 right-0" style={{ left: TIME_GUTTER_PX }}>
            {allDayBars.filter((bar) => bar.row < visibleAllDayRows).map((bar) => {
              const label = getAllDayBarLabel(bar, tagNameById, calendarNameById);
              const identityKey = calendarEventIdentityKey(bar.event);
              const isRealtimeHighlighted = highlightedEventIdentities?.has(identityKey) === true;
              return (
                <button
                  key={`${identityKey}-${bar.startCol}`}
                  type="button"
                  title={label}
                  aria-label={`${label}, 종일 일정`}
                  data-event-identity={identityKey}
                  data-realtime-highlight={isRealtimeHighlighted ? 'true' : undefined}
                  className={`absolute z-10 truncate rounded px-1.5 text-left text-[10px] font-semibold text-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary ${isRealtimeHighlighted ? reduce ? 'calendar-realtime-highlight-static' : 'calendar-realtime-highlight' : ''}`}
                  style={{
                    top: 3 + bar.row * ALL_DAY_ROW_PX,
                    left: `calc(${bar.startCol * (100 / 7)}% + 2px)`,
                    width: `calc(${bar.span * (100 / 7)}% - 4px)`,
                    height: 22,
                    ...getAllDayBarStyle(bar.event.color),
                    ...(isRealtimeHighlighted ? {
                      outline: `2px solid ${bar.event.color}`,
                      outlineOffset: 2,
                      boxShadow: `0 0 12px ${bar.event.color}80`,
                    } : {}),
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onEventClick(bar.event);
                  }}
                >
                  {label}
                </button>
              );
            })}
            {frozenTimedDragPreviewBar && (
              <div
                aria-hidden="true"
                data-time-grid-drag-preview="true"
                className="pointer-events-none absolute z-20 truncate rounded border border-dashed border-white/70 px-1.5 text-left text-[10px] font-semibold text-white shadow-lg"
                style={{
                  // 승격된 preview의 새 행은 고정된 레인에 없을 수 있으므로, 마지막 표시 행 위에만 겹친다.
                  top: 3 + Math.min(
                    frozenTimedDragPreviewBar.row,
                    Math.max(0, visibleAllDayRows - 1),
                  ) * ALL_DAY_ROW_PX,
                  left: `calc(${frozenTimedDragPreviewBar.startCol * (100 / 7)}% + 2px)`,
                  width: `calc(${frozenTimedDragPreviewBar.span * (100 / 7)}% - 4px)`,
                  height: 22,
                  ...getAllDayBarStyle(frozenTimedDragPreviewBar.event.color),
                }}
              >
                {getAllDayBarLabel(frozenTimedDragPreviewBar, tagNameById, calendarNameById)}
              </div>
            )}
          </div>
          {hiddenAllDayCount > 0 && (
            <button
              type="button"
              className="absolute bottom-1 left-1 text-[10px] font-semibold text-accent hover:underline"
              aria-expanded={showAllDay}
              onClick={() => setShowAllDay((expanded) => !expanded)}
            >
              {showAllDay ? '접기' : `+${hiddenAllDayCount}개`}
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" onWheel={handleWheel}>
        <TimeBand
          label="새벽 시간대"
          startMin={0}
          endMin={DAWN_END_MIN}
          visible={dawnVisible}
          onToggle={() => setDawnChoice((choice) => !resolveBandExpanded(hasDawnBlocks, choice, nowMin, 0, DAWN_END_MIN, includesToday))}
          dates={dates}
          dateStrings={dateStrings}
          blocksByDate={timedByDate}
          today={actualToday}
          todayIndex={todayIndex}
          nowMin={nowMin}
          reduce={reduce}
          onEventClick={onEventClick}
          onSlotClick={onSlotClick}
          tagNameById={tagNameById}
          timeGridDnD={timeGridDnD}
          dragPreview={dragPreview}
          dragGhostEvent={dragGhostEvent}
          highlightedEventIdentities={highlightedEventIdentities}
        />
        <TimeBand
          label="시간대"
          startMin={MAIN_START_MIN}
          endMin={MAIN_END_MIN}
          visible
          dates={dates}
          dateStrings={dateStrings}
          blocksByDate={timedByDate}
          today={actualToday}
          todayIndex={todayIndex}
          nowMin={nowMin}
          reduce={reduce}
          onEventClick={onEventClick}
          onSlotClick={onSlotClick}
          tagNameById={tagNameById}
          timeGridDnD={timeGridDnD}
          dragPreview={dragPreview}
          dragGhostEvent={dragGhostEvent}
          highlightedEventIdentities={highlightedEventIdentities}
        />
        <TimeBand
          label="저녁 시간대"
          startMin={EVENING_START_MIN}
          endMin={DAY_END_MIN}
          visible={eveningVisible}
          onToggle={() => setEveningChoice((choice) => !resolveBandExpanded(hasEveningBlocks, choice, nowMin, EVENING_START_MIN, DAY_END_MIN, includesToday))}
          dates={dates}
          dateStrings={dateStrings}
          blocksByDate={timedByDate}
          today={actualToday}
          todayIndex={todayIndex}
          nowMin={nowMin}
          reduce={reduce}
          onEventClick={onEventClick}
          onSlotClick={onSlotClick}
          tagNameById={tagNameById}
          timeGridDnD={timeGridDnD}
          dragPreview={dragPreview}
          dragGhostEvent={dragGhostEvent}
          highlightedEventIdentities={highlightedEventIdentities}
        />
      </div>
    </div>
  );
}

function TimeBand({
  label,
  startMin,
  endMin,
  visible,
  onToggle,
  dates,
  dateStrings,
  blocksByDate,
  today,
  todayIndex,
  nowMin,
  reduce,
  onEventClick,
  onSlotClick,
  tagNameById,
  timeGridDnD,
  dragPreview,
  dragGhostEvent,
  highlightedEventIdentities,
}: {
  label: string;
  startMin: number;
  endMin: number;
  visible: boolean;
  onToggle?: () => void;
  dates: Date[];
  dateStrings: string[];
  blocksByDate: Map<string, TimedEvent[]>;
  today: string;
  todayIndex: number;
  nowMin: number;
  reduce: boolean;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (date: string, startTime: string, endTime: string) => void;
  tagNameById: Record<string, string>;
  timeGridDnD: ReturnType<typeof useTimeGridDnD>;
  dragPreview: TimeGridDragPreview | null;
  dragGhostEvent: CalendarEvent | null;
  highlightedEventIdentities?: ReadonlySet<string>;
}) {
  if (!visible) {
    return (
      <button
        type="button"
        className="flex h-8 w-full items-center justify-center border-b border-bg-border/25 text-[10px] font-medium text-text-secondary hover:bg-bg-border/15 hover:text-text-primary"
        aria-label={`${label} 펼치기`}
        onClick={onToggle}
      >
        {getCollapsedBandLabel(label, startMin, endMin)}
      </button>
    );
  }

  const height = ((endMin - startMin) / 60) * HOUR_PX;
  const hours = Array.from({ length: Math.ceil((endMin - startMin) / 60) + 1 }, (_, index) => startMin + index * 60)
    .filter((minute) => minute <= endMin);
  const slots = getTimeSlots(startMin, endMin);
  const currentTimeMarker = getCurrentTimeMarker(nowMin, startMin, endMin, todayIndex);
  const getPointerTarget = (element: HTMLElement, date: string): TimeGridPointerTarget | null => {
    const column = element.closest<HTMLElement>('[data-time-grid-column="true"][data-date]');
    return column ? { date, bandStartMin: startMin, column } : null;
  };

  return (
    <section className="relative border-b border-bg-border/25" style={{ height }} aria-label={label}>
      {onToggle && (
        <button
          type="button"
          className="absolute left-0 top-0 z-20 flex h-5 items-center justify-center bg-bg-primary/80 text-[9px] text-text-secondary hover:text-text-primary"
          aria-label={`${label} 접기`}
          onClick={onToggle}
          style={{ width: TIME_GUTTER_PX }}
        >
          ▾ 접기
        </button>
      )}
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `${TIME_GUTTER_PX}px repeat(7, minmax(0, 1fr))` }}>
        <div className="relative border-r border-bg-border/25">
          {hours.map((minute) => (
            <span key={minute} className="absolute right-1 -translate-y-1/2 text-[9px] text-text-secondary" style={{ top: ((minute - startMin) / 60) * HOUR_PX }}>
              {formatKoreanHour(minute)}
            </span>
          ))}
        </div>
        {dates.map((_, index) => {
          const date = dateStrings[index];
          const isWeekend = index === 0 || index === 6;
          const timedBlocks = blocksByDate.get(date) ?? [];
          const bandBlocks = clipTimedBlocksToBand(timedBlocks, startMin, endMin);
          const layouts = layoutDayBlocks(bandBlocks.map((block) => ({ id: block.layoutId, startMin: block.startMin, endMin: block.endMin })));
          return (
            <div
              key={date}
              data-time-grid-column="true"
              data-date={date}
              data-time-grid-band-start={startMin}
              className={`relative border-r border-bg-border/20 ${date === today ? 'bg-accent/[0.035]' : ''}`}
              style={getWeekendCellStyle(isWeekend)}
            >
              {hours.map((minute) => (
                <div key={minute} className="pointer-events-none absolute left-0 right-0 border-t border-bg-border/20" style={{ top: ((minute - startMin) / 60) * HOUR_PX }} />
              ))}
              {slots.filter((slot) => slot.startMin % 60 !== 0).map((slot) => (
                <div key={`half-${slot.startMin}`} className="pointer-events-none absolute left-0 right-0 border-t border-bg-border/10" style={{ top: ((slot.startMin - startMin) / 60) * HOUR_PX }} />
              ))}
              {slots.map(({ startMin: slotStart, endMin: slotEnd }) => {
                return (
                  <button
                    key={slotStart}
                    type="button"
                    aria-label={`${date} ${minutesToTime(slotStart)} 일정 만들기`}
                    className="absolute left-0 right-0 z-[1] cursor-cell outline-none hover:bg-accent/[0.06] focus-visible:bg-accent/10"
                    style={{ top: ((slotStart - startMin) / 60) * HOUR_PX, height: ((slotEnd - slotStart) / 60) * HOUR_PX }}
                    onMouseDown={(event) => {
                      const target = getPointerTarget(event.currentTarget, date);
                      if (target) timeGridDnD.beginCreate(event, target);
                    }}
                    onClick={() => {
                      if (timeGridDnD.shouldSuppressClick()) return;
                      onSlotClick(date, minutesToTime(slotStart), minutesToTime(slotEnd));
                    }}
                  />
                );
              })}
              {dragGhostEvent && dragGhostEvent.startDate === date && dragGhostEvent.startTime && dragGhostEvent.endTime
                && timeToMinutes(dragGhostEvent.startTime) >= startMin && timeToMinutes(dragGhostEvent.startTime) < endMin && (
                <div
                  data-time-grid-original-ghost="true"
                  className="pointer-events-none absolute z-[9] rounded border border-dashed border-white/70 bg-bg-primary/20"
                  style={{
                    top: ((timeToMinutes(dragGhostEvent.startTime) - startMin) / 60) * HOUR_PX,
                    height: ((timeToMinutes(dragGhostEvent.endTime) - timeToMinutes(dragGhostEvent.startTime)) / 60) * HOUR_PX,
                    left: '2px', right: '2px',
                  }}
                />
              )}
              {dragPreview?.mode === 'create' && dragPreview.startDate === date
                && timeToMinutes(dragPreview.startTime) >= startMin && timeToMinutes(dragPreview.startTime) < endMin && (
                <div
                  data-time-grid-create-ghost="true"
                  className="pointer-events-none absolute z-20 overflow-hidden rounded border border-dashed border-accent bg-accent/20 px-1 text-[9px] font-bold text-white shadow-lg"
                  style={{
                    top: ((timeToMinutes(dragPreview.startTime) - startMin) / 60) * HOUR_PX,
                    height: getTimeGridCreateGhostHeight(dragPreview),
                    left: '2px', right: '2px',
                  }}
                >
                  <span data-time-grid-live-label="true">{dragPreview.startTime} – {dragPreview.endTime}</span>
                </div>
              )}
              {layouts.map((layout, layoutIndex) => {
                const bandBlock = bandBlocks.find((candidate) => candidate.layoutId === layout.id);
                if (!bandBlock) return null;
                const block = bandBlock.source;
                const isPast = date < today || (date === today && block.endMin <= nowMin);
                const isCurrent = date === today && block.startMin <= nowMin && nowMin < block.endMin;
                const duration = block.endMin - block.startMin;
                const visibleHeight = ((bandBlock.endMin - bandBlock.startMin) / 60) * HOUR_PX;
                const canShowText = visibleHeight >= MIN_TIMED_TEXT_HEIGHT_PX;
                const visualStyle = getTimedBlockVisualStyle(block.event.color);
                const stateStyle = getTimedBlockStateStyle(block.event.color, isCurrent);
                const opacity = getTimedBlockOpacity(isPast);
                const timeLabel = formatEventTimeRange(block.event, tagNameById)
                  ?? `${minutesToTime(block.startMin)}–${minutesToTime(block.endMin)}`;
                const isPreviewed = dragPreview?.identityKey === calendarEventIdentityKey(block.event);
                const isMoving = isPreviewed && timeGridDnD.isDragActive;
                const isSettling = timeGridDnD.isSettling(block.event);
                const isRealtimeHighlighted = highlightedEventIdentities?.has(calendarEventIdentityKey(block.event)) === true;
                const canResizeEnd = bandBlock.endMin === block.endMin;
                const blockMotion = getTimeGridBlockMotion({
                  reduce,
                  opacity,
                  layoutIndex,
                  isMoving,
                  isSettling,
                });
                const isReadOnly = block.event.isReadOnly === true;
                // 앞선 드롭의 저장이 확정되기 전에는 같은 블록을 다시 끌지 못하게 한다.
                const isPersisting = timeGridDnD.isPersisting(block.event);
                const eventDragProps = isReadOnly || isPersisting ? {} : {
                  onMouseDown: (event: React.MouseEvent<HTMLElement>) => {
                    const target = getPointerTarget(event.currentTarget, date);
                    if (!target) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const mode = canResizeEnd
                      ? getTimeGridEventDragMode(isReadOnly, event.clientY, rect.bottom)
                      : 'move';
                    if (!mode) return;
                    timeGridDnD.beginEventDrag(
                      event,
                      block.event,
                      mode,
                      target,
                    );
                  },
                };
                return (
                  <motion.button
                    key={layout.id}
                    type="button"
                    title={`${block.event.title} · ${minutesToTime(block.startMin)}–${minutesToTime(block.endMin)}`}
                    aria-label={`${block.event.title}, ${date} ${minutesToTime(block.startMin)}부터 ${minutesToTime(block.endMin)}까지`}
                    data-time-grid-event="true"
                    data-event-identity={calendarEventIdentityKey(block.event)}
                    data-realtime-highlight={isRealtimeHighlighted ? 'true' : undefined}
                    className={`absolute z-10 overflow-hidden rounded ${canShowText ? 'px-1.5 py-1' : 'p-0'} text-left font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary ${isMoving ? 'shadow-xl' : ''} ${isSettling ? 'time-grid-settling' : ''} ${isRealtimeHighlighted ? reduce ? 'calendar-realtime-highlight-static' : 'calendar-realtime-highlight' : ''}`}
                    style={{
                      ...eventBlockStyle(
                        layout,
                        ((bandBlock.startMin - startMin) / 60) * HOUR_PX,
                        visibleHeight,
                      ),
                      background: visualStyle.background,
                      borderLeft: visualStyle.borderLeft,
                      opacity,
                      ...stateStyle,
                      ...(isRealtimeHighlighted ? {
                        outline: `2px solid ${block.event.color}`,
                        outlineOffset: 2,
                        boxShadow: `0 0 12px ${block.event.color}80`,
                      } : {}),
                    }}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={blockMotion.animate}
                    transition={blockMotion.transition}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (timeGridDnD.shouldSuppressClick()) return;
                      onEventClick(block.event);
                    }}
                    {...eventDragProps}
                  >
                    {canShowText && duration >= 30 && <span data-time-grid-time="true" data-time-grid-live-label={isPreviewed ? 'true' : undefined} className="block truncate" style={{ color: visualStyle.timeColor, fontSize: 9 }}>{timeLabel}</span>}
                    {canShowText && <span data-time-grid-title="true" className="block truncate" style={{ color: visualStyle.titleColor, fontSize: visualStyle.titleFontSize }}>{block.event.title}</span>}
                  </motion.button>
                );
              })}
            </div>
          );
        })}
      </div>
      {currentTimeMarker && (
        <div className="pointer-events-none absolute left-0 right-0 z-30" aria-label={`현재 시각 ${currentTimeMarker.label}`} style={{ top: currentTimeMarker.top }}>
          <span className="absolute -top-2 rounded bg-red-500 px-1 py-0.5 text-[9px] font-bold text-white shadow" style={{ left: 2 }}>{currentTimeMarker.label}</span>
          <div className="absolute right-0" style={{ left: TIME_GUTTER_PX, ...getNonTodayCurrentLineStyle() }}>
            <div
              className="absolute -top-px h-0.5 bg-red-500"
              style={{ left: `${(currentTimeMarker.todayIndex / 7) * 100}%`, width: `${100 / 7}%` }}
            />
            <span
              className="absolute -top-1.5 h-3 w-3 rounded-full border-2 border-bg-primary bg-red-500"
              style={{ left: `calc(${(currentTimeMarker.todayIndex / 7) * 100}% - 5px)` }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

export default WeekTimeGridView;
