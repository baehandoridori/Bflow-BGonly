// ─── DayScrollView: 휠 스크롤 포커스 일간 뷰 (5일 표시) ──────
import React, { useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarDays } from 'lucide-react';
import type { CalendarEvent } from '@/types/calendar';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { fmtDate, daysBetween, hexToRgba } from '@/utils/calendarDate';
import { formatEventTimeRange, sortEventsForList } from '@/utils/calendarEventFilter';

/* ── 로컬 유틸 ──────────────────────────────────────── */
const WEEKDAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

/** 연도의 dayIndex(0-based) → Date */
function dayIndexToDate(year: number, dayIndex: number): Date {
  const jan1 = new Date(year, 0, 1, 12, 0, 0, 0);
  const d = new Date(jan1);
  d.setDate(d.getDate() + dayIndex);
  return d;
}

/** 해당 연도의 총 일수 */
function daysInYear(year: number): number {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
}

/* ── 타입 ────────────────────────────────────────────── */
export interface DayScrollViewProps {
  events: CalendarEvent[];
  activeDayIndex: number; // day of year (0-based, 0~365)
  onActiveDayChange: (index: number) => void;
  onEventClick?: (event: CalendarEvent) => void;
  onDateClick?: (date: string) => void; // YYYY-MM-DD — 날짜 클릭 시 이벤트 생성
  year: number;
}

/* ── 상수 ────────────────────────────────────────────── */
const TRANSITION = {
  duration: 0.4,
  ease: [0.16, 1, 0.3, 1],
};

const DEBOUNCE_MS = 150;
const VISIBLE_RANGE = 2; // ±2 days shown
const PRIMARY_TEXT = 'rgb(var(--color-text-primary))';
const SECONDARY_TEXT = 'rgb(var(--color-text-secondary))';
const ACCENT = 'rgb(var(--color-accent))';
const CARD_BG_SOFT = 'rgb(var(--color-bg-card) / 0.58)';
const CARD_BG_SOFTEST = 'rgb(var(--color-bg-card) / 0.46)';
const CARD_BORDER = '1px solid rgb(var(--color-bg-border) / 0.28)';

/* ── 컴포넌트 ────────────────────────────────────────── */
export default function DayScrollView({
  events,
  activeDayIndex,
  onActiveDayChange,
  onEventClick,
  onDateClick,
  year,
}: DayScrollViewProps) {
  const maxDay = daysInYear(year) - 1;
  const tags = useCalendarStore((state) => state.tags);
  const tagNameById = useMemo(
    () => Object.fromEntries(tags.map((tag) => [tag.id, tag.name])) as Record<string, string>,
    [tags],
  );

  /* 표시할 날짜 범위: active ± 2 */
  const visibleDays = useMemo(() => {
    const result: { date: Date; dateStr: string; absIdx: number }[] = [];
    const start = Math.max(0, activeDayIndex - VISIBLE_RANGE);
    const end = Math.min(maxDay, activeDayIndex + VISIBLE_RANGE);
    for (let i = start; i <= end; i++) {
      const d = dayIndexToDate(year, i);
      result.push({ date: d, dateStr: fmtDate(d), absIdx: i });
    }
    return result;
  }, [year, activeDayIndex, maxDay]);

  /* 휠 디바운스 */
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (wheelTimer.current) return;
      // 스크롤 가능한 이벤트 리스트 내부에서는 날짜 이동 차단
      const target = e.target as HTMLElement;
      const scrollable = target.closest('[data-scroll-events]') as HTMLElement | null;
      if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) {
        const { scrollTop, scrollHeight, clientHeight } = scrollable;
        const atTop = scrollTop <= 0 && e.deltaY < 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
        if (!atTop && !atBottom) return; // 리스트 내 스크롤 우선
      }
      const dir = e.deltaY > 0 ? 1 : -1;
      const next = Math.max(0, Math.min(maxDay, activeDayIndex + dir));
      if (next !== activeDayIndex) onActiveDayChange(next);
      wheelTimer.current = setTimeout(() => {
        wheelTimer.current = null;
      }, DEBOUNCE_MS);
    },
    [activeDayIndex, maxDay, onActiveDayChange],
  );

  /* 특정 날짜의 이벤트 */
  const getDayEvents = useCallback(
    (dateStr: string) => {
      return events.filter(
        (ev) => ev.startDate <= dateStr && ev.endDate >= dateStr,
      );
    },
    [events],
  );

  const today = fmtDate(new Date());

  return (
    <div
      className="flex items-stretch w-full select-none overflow-hidden flex-1 h-full gap-2"
      onWheel={handleWheel}
    >
      <AnimatePresence mode="popLayout">
        {visibleDays.map(({ date, dateStr, absIdx }) => {
          const diff = absIdx - activeDayIndex;
          const absDiff = Math.abs(diff);
          const isActive = diff === 0;
          const isNear = !isActive && absDiff === 1;

          const opacity = isActive ? 1 : isNear ? 0.3 : 0.12;
          const scale = isActive ? 1 : isNear ? 0.97 : 0.94;

          const dayEvents = getDayEvents(dateStr);

          return (
            <motion.div
              key={`day-${absIdx}`}
              layout
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity, scale }}
              transition={TRANSITION}
              className="flex-shrink-0"
              style={{
                cursor: !isActive ? 'pointer' : undefined,
                width: isActive ? '60%' : isNear ? '15%' : '5%',
                minWidth: isActive ? 0 : isNear ? 60 : 36,
                transition: 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onClick={() => !isActive && onActiveDayChange(absIdx)}
            >
              {isActive ? (
                <ActiveDay
                  date={date}
                  dateStr={dateStr}
                  events={dayEvents}
                  today={today}
                  onEventClick={onEventClick}
                  onDateClick={onDateClick}
                  tagNameById={tagNameById}
                />
              ) : isNear ? (
                <NearDay
                  date={date}
                  dateStr={dateStr}
                  events={dayEvents}
                  today={today}
                />
              ) : (
                <FarDay
                  date={date}
                  dateStr={dateStr}
                  today={today}
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ── ActiveDay: 포커스된 날 ──────────────────────────── */
function ActiveDay({
  date,
  dateStr,
  events,
  today,
  onEventClick,
  onDateClick,
  tagNameById,
}: {
  date: Date;
  dateStr: string;
  events: CalendarEvent[];
  today: string;
  onEventClick?: (ev: CalendarEvent) => void;
  onDateClick?: (date: string) => void;
  tagNameById: Record<string, string>;
}) {
  const dow = date.getDay();
  const isToday = dateStr === today;
  const dayColor = dow === 0 ? '#E17055' : dow === 6 ? '#74B9FF' : PRIMARY_TEXT;
  const label = `${date.getMonth() + 1}/${date.getDate()} ${WEEKDAY_KR[dow]}`;
  const sortedEvents = useMemo(() => sortEventsForList(events), [events]);

  return (
    <div
      className="rounded-xl p-5 flex flex-col h-full"
      style={{
        background: 'rgba(108,92,231,0.06)',
        border: '1px solid rgba(108,92,231,0.35)',
        boxShadow: '0 0 18px rgba(108,92,231,0.12)',
      }}
    >
      {/* 날짜 헤더 */}
      <div className="flex items-center gap-3 mb-4">
        <span
          className="text-3xl font-bold w-12 h-12 flex items-center justify-center rounded-full"
          style={{
            color: isToday ? '#fff' : dayColor,
            background: isToday ? '#6C5CE7' : 'transparent',
          }}
        >
          {date.getDate()}
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-bold" style={{ color: ACCENT }}>
            {label}
          </span>
          <span className="text-[10px]" style={{ color: SECONDARY_TEXT }}>
            {date.getFullYear()}년 {date.getMonth() + 1}월
          </span>
        </div>
        {isToday && (
          <span
            className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'rgb(var(--color-accent) / 0.2)', color: ACCENT }}
          >
            오늘
          </span>
        )}
      </div>

      {/* 이벤트 카드 */}
      {events.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center flex-1 gap-2 cursor-pointer rounded-lg hover:bg-bg-border/20 transition-colors"
          onClick={() => onDateClick?.(dateStr)}
        >
          <CalendarDays size={36} color={SECONDARY_TEXT} />
          <span className="text-sm" style={{ color: SECONDARY_TEXT }}>
            일정이 없습니다
          </span>
        </div>
      ) : (
        <div data-scroll-events className="flex flex-col gap-2 flex-1 overflow-y-auto">
          {sortedEvents.map((ev) => (
            <DayEventCard
              key={ev.id}
              event={ev}
              today={today}
              tagNameById={tagNameById}
              onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }}
            />
          ))}
          {/* 빈 공간 클릭으로 이벤트 생성 */}
          <div
            className="flex-1 min-h-[40px] cursor-pointer rounded-lg hover:bg-bg-border/20 transition-colors"
            onClick={() => onDateClick?.(dateStr)}
          />
        </div>
      )}
    </div>
  );
}

/* ── DayEventCard ────────────────────────────────────── */
function DayEventCard({
  event,
  today,
  tagNameById,
  onClick,
}: {
  event: CalendarEvent;
  today: string;
  tagNameById: Record<string, string>;
  onClick: (e: React.MouseEvent) => void;
}) {
  const dDay = daysBetween(today, event.endDate);
  const dDayLabel =
    dDay === 0 ? 'D-Day' : dDay > 0 ? `D-${dDay}` : `D+${Math.abs(dDay)}`;
  const subtitle = event.allDay === false
    ? formatEventTimeRange(event, tagNameById)
    : event.tagId ? tagNameById[event.tagId] : null;

  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      onClick={onClick}
      className="flex items-center gap-2 cursor-pointer"
      style={{
        background: hexToRgba(event.color, 0.08),
        borderLeft: `3px solid ${event.color}`,
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      <div className="flex flex-col flex-1 min-w-0">
        <span
          className="font-bold truncate"
          style={{ fontSize: 12, color: PRIMARY_TEXT }}
        >
          {event.title}
        </span>
        {subtitle && (
          <span style={{ fontSize: 10, color: SECONDARY_TEXT }}>
            {subtitle}
          </span>
        )}
      </div>
      <span
        className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
        style={{
          background: hexToRgba(event.color, 0.18),
          color: event.color,
        }}
      >
        {dDayLabel}
      </span>
    </motion.div>
  );
}

/* ── NearDay: ±1일 (반투명, 축소) ────────────────────── */
function NearDay({
  date,
  dateStr,
  events,
  today,
}: {
  date: Date;
  dateStr: string;
  events: CalendarEvent[];
  today: string;
}) {
  const dow = date.getDay();
  const isToday = dateStr === today;
  const dayColor = dow === 0 ? '#E17055' : dow === 6 ? '#74B9FF' : PRIMARY_TEXT;

  return (
    <div
      className="rounded-lg px-2 py-3 h-full flex flex-col items-center"
      style={{ background: CARD_BG_SOFT, border: CARD_BORDER }}
    >
      <span
        className="text-[10px] font-medium mb-1"
        style={{ color: dayColor }}
      >
        {WEEKDAY_KR[dow]}
      </span>
      <span
        className="text-lg font-bold w-8 h-8 flex items-center justify-center rounded-full mb-2"
        style={{
          color: isToday ? '#fff' : dayColor,
          background: isToday ? '#6C5CE7' : 'transparent',
        }}
      >
        {date.getDate()}
      </span>
      {/* 이벤트 도트 */}
      <div className="flex flex-col gap-1 items-center">
        {events.slice(0, 5).map((ev) => (
          <div
            key={ev.id}
            className="rounded-full"
            style={{ width: 6, height: 6, background: ev.color }}
          />
        ))}
        {events.length > 5 && (
          <span style={{ fontSize: 7, color: SECONDARY_TEXT }}>
            +{events.length - 5}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── FarDay: ±2일 (매우 투명, 날짜만) ─────────────────── */
function FarDay({
  date,
  dateStr,
  today,
}: {
  date: Date;
  dateStr: string;
  today: string;
}) {
  const dow = date.getDay();
  const isToday = dateStr === today;
  const dayColor = dow === 0 ? '#E17055' : dow === 6 ? '#74B9FF' : PRIMARY_TEXT;

  return (
    <div
      className="rounded-lg px-1 py-3 h-full flex flex-col items-center justify-center"
      style={{ background: CARD_BG_SOFTEST, border: CARD_BORDER }}
    >
      <span
        className="text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full"
        style={{
          color: isToday ? '#fff' : dayColor,
          background: isToday ? '#6C5CE7' : 'transparent',
        }}
      >
        {date.getDate()}
      </span>
    </div>
  );
}
