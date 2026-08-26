import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { CalendarEvent } from '@/types/calendar';
import { layoutEventBars, type EventBar } from '@/components/calendar/CalendarGrid';
import { fmtDate, hexToRgba } from '@/utils/calendarDate';
import { calendarEventIdentityKey } from '@/utils/calendarEventIdentity';
import { layoutDayBlocks, minutesToTime, timeToMinutes } from '@/utils/timeGridLayout';
import { useMotionPref } from '@/hooks/useMotionPref';
import { clampStaggerDelay } from '@/components/widgets/my-tasks/motionUtils';

const HOUR_PX = 56;
const TIME_GUTTER_PX = 56;
const MAIN_START_MIN = 9 * 60;
const MAIN_END_MIN = 19 * 60;
const DAWN_END_MIN = MAIN_START_MIN;
const EVENING_START_MIN = MAIN_END_MIN;
const DAY_END_MIN = 24 * 60;
const ALL_DAY_ROW_PX = 28;
const WEEKDAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

export interface WeekTimeGridViewProps {
  /** 일요일부터 토요일까지의 활성 주간 날짜 7개 */
  week: Date[];
  events: CalendarEvent[];
  today: string;
  onEventClick: (event: CalendarEvent) => void;
  /** PR-C에서 시간 prefill을 연결한다. PR-B는 선택한 날짜만 연다. */
  onSlotClick: (date: string, startTime: string, endTime: string) => void;
  /** ScheduleView가 이동 가능 범위를 소유하도록 delta만 전달한다. */
  onWeekShift: (delta: -1 | 1) => void;
}

type TimedEvent = {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  layoutId: string;
};

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

/** 밴드에 일정이 있어도 사용자가 명시적으로 접은 상태는 덮어쓰지 않는다. */
export function resolveBandExpanded(hasTimedBlocks: boolean, userChoice: boolean | null): boolean {
  return userChoice ?? hasTimedBlocks;
}

/** 빈 시간 클릭을 위한 30분 단위 슬롯. */
export function getTimeSlots(startMin: number, endMin: number): Array<{ startMin: number; endMin: number }> {
  const slots: Array<{ startMin: number; endMin: number }> = [];
  for (let slotStart = startMin; slotStart < endMin; slotStart += 30) {
    slots.push({ startMin: slotStart, endMin: Math.min(endMin, slotStart + 30) });
  }
  return slots;
}

/** 종일 레인으로 강등된 시간 일정도 시작 시각과 주간 경계 계속 표시를 잃지 않는다. */
export function getAllDayBarLabel(bar: Pick<EventBar, 'event' | 'isStart' | 'isEnd'>): string {
  const before = bar.isStart ? '' : '◂ ';
  const time = bar.event.allDay === false && bar.event.startTime ? `${bar.event.startTime} ` : '';
  const after = bar.isEnd ? '' : ' ▸';
  return `${before}${time}${bar.event.title}${after}`;
}

/** 현재 시각선은 활성 밴드 내부일 때만 위치를 만든다. */
export function getCurrentTimeMarker(
  nowMin: number,
  bandStartMin: number,
  bandEndMin: number,
  todayIndex: number,
): { top: number; label: string; todayIndex: number } | null {
  if (todayIndex < 0 || nowMin < bandStartMin || nowMin > bandEndMin) return null;
  return {
    top: ((nowMin - bandStartMin) / 60) * HOUR_PX,
    label: minutesToTime(nowMin),
    todayIndex,
  };
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
    background: hexToRgba(color, 0.18),
    borderLeft: `3px solid ${color}`,
    titleColor: '#ffffff',
    titleFontSize: 11,
    timeColor: color,
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

function formatHour(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:00`;
}

function eventBlockStyle(layout: { col: number; span: number; cols: number }, top: number, height: number) {
  return {
    top,
    height: Math.max(14, height),
    left: `calc(${(layout.col / layout.cols) * 100}% + 2px)`,
    width: `calc(${(layout.span / layout.cols) * 100}% - 4px)`,
  };
}

export function WeekTimeGridView({
  week,
  events,
  today,
  onEventClick,
  onSlotClick,
  onWeekShift,
}: WeekTimeGridViewProps) {
  const { reduce } = useMotionPref();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showAllDay, setShowAllDay] = useState(false);
  const [dawnChoice, setDawnChoice] = useState<boolean | null>(null);
  const [eveningChoice, setEveningChoice] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => new Date());

  const dates = useMemo(() => week.slice(0, 7), [week]);
  const dateStrings = useMemo(() => dates.map(fmtDate), [dates]);
  const weekKey = dateStrings.join('|');
  const { allDayEvents, timedEventsByDate } = useMemo(() => splitWeekTimeGridEvents(events), [events]);
  const allDayBars = useMemo(
    () => (dates.length === 7 ? layoutEventBars(allDayEvents, dates[0], 7) : []),
    [allDayEvents, dates],
  );
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
  const hasDawnBlocks = useMemo(
    () => [...timedByDate.values()].some((blocks) => bandContains(blocks, 0, DAWN_END_MIN)),
    [timedByDate],
  );
  const hasEveningBlocks = useMemo(
    () => [...timedByDate.values()].some((blocks) => bandContains(blocks, EVENING_START_MIN, DAY_END_MIN)),
    [timedByDate],
  );
  const dawnVisible = resolveBandExpanded(hasDawnBlocks, dawnChoice);
  const eveningVisible = resolveBandExpanded(hasEveningBlocks, eveningChoice);
  const todayIndex = dateStrings.indexOf(today);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let done = false;
    const scrollIntoView = () => {
      if (cancelled || done) return;
      done = true;
      const todayIndex = dateStrings.indexOf(today);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const beforeMain = dawnVisible ? (DAWN_END_MIN / 60) * HOUR_PX : 0;
      const target = todayIndex >= 0
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
  }, [dawnVisible, today, weekKey]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey) return;
    const movement = event.deltaY || event.deltaX;
    if (movement === 0) return;
    event.preventDefault();
    onWeekShift(movement > 0 ? 1 : -1);
  }, [onWeekShift]);

  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-bg-border/40 bg-bg-primary/50">
      <div className="sticky top-0 z-30 border-b border-bg-border/40 bg-bg-primary/95 backdrop-blur">
        <div className="grid" style={{ gridTemplateColumns: `${TIME_GUTTER_PX}px repeat(7, minmax(0, 1fr))` }}>
          <div aria-hidden="true" />
          {dates.map((date, index) => {
            const dateStr = dateStrings[index];
            const isToday = dateStr === today;
            return (
              <div
                key={dateStr}
                className={`min-w-0 border-l border-bg-border/25 px-2 py-2 text-center ${isToday ? 'bg-accent/10' : ''}`}
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
            {dateStrings.map((dateStr) => (
              <button
                key={dateStr}
                type="button"
                aria-label={`${dateStr} 종일 일정 만들기`}
                className={`border-l border-bg-border/20 transition-colors hover:bg-bg-border/15 ${dateStr === today ? 'bg-accent/[0.03]' : ''}`}
                onClick={() => onSlotClick(dateStr, '00:00', '23:59')}
              />
            ))}
          </div>
          <div className="absolute inset-y-0 right-0" style={{ left: TIME_GUTTER_PX }}>
            {allDayBars.filter((bar) => bar.row < visibleAllDayRows).map((bar) => (
              <button
                key={`${calendarEventIdentityKey(bar.event)}-${bar.startCol}`}
                type="button"
                title={getAllDayBarLabel(bar)}
                aria-label={`${getAllDayBarLabel(bar)}, 종일 일정`}
                className="absolute z-10 truncate rounded px-1.5 text-left text-[10px] font-semibold text-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary"
                style={{
                  top: 3 + bar.row * ALL_DAY_ROW_PX,
                  left: `calc(${bar.startCol * (100 / 7)}% + 2px)`,
                  width: `calc(${bar.span * (100 / 7)}% - 4px)`,
                  height: 22,
                  background: bar.event.color,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onEventClick(bar.event);
                }}
              >
                {getAllDayBarLabel(bar)}
              </button>
            ))}
          </div>
          {hiddenAllDayCount > 0 && (
            <button
              type="button"
              className="absolute bottom-1 left-1 text-[10px] font-semibold text-accent hover:underline"
              aria-expanded={showAllDay}
              onClick={() => setShowAllDay((expanded) => !expanded)}
            >
              {showAllDay ? '접기' : `+${hiddenAllDayCount}`}
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
          onToggle={() => setDawnChoice((choice) => !resolveBandExpanded(hasDawnBlocks, choice))}
          dates={dates}
          dateStrings={dateStrings}
          blocksByDate={timedByDate}
          today={today}
          todayIndex={todayIndex}
          nowMin={nowMin}
          reduce={reduce}
          onEventClick={onEventClick}
          onSlotClick={onSlotClick}
        />
        <TimeBand
          label="시간대"
          startMin={MAIN_START_MIN}
          endMin={MAIN_END_MIN}
          visible
          dates={dates}
          dateStrings={dateStrings}
          blocksByDate={timedByDate}
          today={today}
          todayIndex={todayIndex}
          nowMin={nowMin}
          reduce={reduce}
          onEventClick={onEventClick}
          onSlotClick={onSlotClick}
        />
        <TimeBand
          label="저녁 시간대"
          startMin={EVENING_START_MIN}
          endMin={DAY_END_MIN}
          visible={eveningVisible}
          onToggle={() => setEveningChoice((choice) => !resolveBandExpanded(hasEveningBlocks, choice))}
          dates={dates}
          dateStrings={dateStrings}
          blocksByDate={timedByDate}
          today={today}
          todayIndex={todayIndex}
          nowMin={nowMin}
          reduce={reduce}
          onEventClick={onEventClick}
          onSlotClick={onSlotClick}
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
}) {
  if (!visible) {
    return (
      <button
        type="button"
        className="flex h-8 w-full items-center justify-center border-b border-bg-border/25 text-[10px] font-medium text-text-secondary hover:bg-bg-border/15 hover:text-text-primary"
        aria-label={`${label} 펼치기`}
        onClick={onToggle}
      >
        {label} 펼치기
      </button>
    );
  }

  const height = ((endMin - startMin) / 60) * HOUR_PX;
  const hours = Array.from({ length: Math.ceil((endMin - startMin) / 60) + 1 }, (_, index) => startMin + index * 60)
    .filter((minute) => minute <= endMin);
  const slots = getTimeSlots(startMin, endMin);
  const currentTimeMarker = getCurrentTimeMarker(nowMin, startMin, endMin, todayIndex);

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
          접기
        </button>
      )}
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `${TIME_GUTTER_PX}px repeat(7, minmax(0, 1fr))` }}>
        <div className="relative border-r border-bg-border/25">
          {hours.map((minute) => (
            <span key={minute} className="absolute right-1 -translate-y-1/2 text-[9px] text-text-secondary" style={{ top: ((minute - startMin) / 60) * HOUR_PX }}>
              {formatHour(minute)}
            </span>
          ))}
        </div>
        {dates.map((_, index) => {
          const date = dateStrings[index];
          const timedBlocks = blocksByDate.get(date) ?? [];
          const layouts = layoutDayBlocks(timedBlocks.map((block) => ({ id: block.layoutId, startMin: block.startMin, endMin: block.endMin })));
          return (
            <div key={date} className={`relative border-r border-bg-border/20 ${date === today ? 'bg-accent/[0.035]' : ''}`}>
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
                    onClick={() => onSlotClick(date, minutesToTime(slotStart), minutesToTime(slotEnd))}
                  />
                );
              })}
              {layouts.map((layout, layoutIndex) => {
                const block = timedBlocks.find((candidate) => candidate.layoutId === layout.id);
                if (!block) return null;
                const clippedStart = Math.max(block.startMin, startMin);
                const clippedEnd = Math.min(block.endMin, endMin);
                if (clippedEnd <= clippedStart) return null;
                const isPast = date < today || (date === today && block.endMin <= nowMin);
                const isCurrent = date === today && block.startMin <= nowMin && nowMin < block.endMin;
                const duration = block.endMin - block.startMin;
                const visualStyle = getTimedBlockVisualStyle(block.event.color);
                return (
                  <motion.button
                    key={layout.id}
                    type="button"
                    title={`${block.event.title} · ${minutesToTime(block.startMin)}–${minutesToTime(block.endMin)}`}
                    aria-label={`${block.event.title}, ${date} ${minutesToTime(block.startMin)}부터 ${minutesToTime(block.endMin)}까지`}
                    className={`absolute z-10 overflow-hidden rounded px-1.5 py-1 text-left text-[10px] font-semibold text-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary ${isPast ? 'opacity-45' : ''} ${isCurrent ? 'ring-2 ring-white ring-offset-1 ring-offset-bg-primary' : ''}`}
                    style={{
                      ...eventBlockStyle(
                        layout,
                        ((clippedStart - startMin) / 60) * HOUR_PX,
                        ((clippedEnd - clippedStart) / 60) * HOUR_PX,
                      ),
                      background: visualStyle.background,
                      borderLeft: visualStyle.borderLeft,
                    }}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: isPast ? 0.45 : 1, y: 0 }}
                    transition={{ duration: reduce ? 0 : 0.18, delay: clampStaggerDelay(layoutIndex, reduce) }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEventClick(block.event);
                    }}
                  >
                    <span className="block truncate" style={{ color: visualStyle.titleColor, fontSize: visualStyle.titleFontSize }}>{block.event.title}</span>
                    {duration >= 30 && <span className="block truncate" style={{ color: visualStyle.timeColor, fontSize: 9 }}>{minutesToTime(block.startMin)}–{minutesToTime(block.endMin)}</span>}
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
          <div className="absolute right-0 h-px bg-text-secondary/45" style={{ left: TIME_GUTTER_PX }}>
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
