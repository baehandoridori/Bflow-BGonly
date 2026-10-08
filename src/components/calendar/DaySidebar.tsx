// ─── DaySidebar: 일간 네비게이션 사이드바 (월별 날짜 리스트) ────────────────
import { memo, useMemo, useRef, useEffect } from 'react';
import type { CalendarEvent } from '@/types/calendar';
import { fmtDate } from '@/utils/calendarDate';
import { scrollIntoNearestScroller } from '@/utils/scrollIntoScroller';

/* ── 로컬 유틸 ──────────────────────────────────────── */
const WEEKDAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

/** 연도의 dayIndex(0-based) → Date */
function dayIndexToDate(year: number, dayIndex: number): Date {
  const jan1 = new Date(year, 0, 1, 12, 0, 0, 0);
  const d = new Date(jan1);
  d.setDate(d.getDate() + dayIndex);
  return d;
}

/** Date → 연도 내 dayIndex (0-based) */
function dateToDayIndex(d: Date): number {
  const jan1 = new Date(d.getFullYear(), 0, 1, 12, 0, 0, 0);
  return Math.round((d.getTime() - jan1.getTime()) / 86400000);
}

/* ── 타입 ────────────────────────────────────────────── */
export interface DaySidebarProps {
  activeDayIndex: number;
  onDaySelect: (index: number) => void;
  events: CalendarEvent[];
  year: number;
}

/* ── 상수 ────────────────────────────────────────────── */
const ACTIVE_BG = 'rgba(108,92,231,0.15)';
const ACTIVE_BORDER = 'rgba(108,92,231,0.4)';
const MAX_DOTS = 3;
const PRIMARY_TEXT = 'rgb(var(--color-text-primary))';
const SECONDARY_TEXT = 'rgb(var(--color-text-secondary))';
const ACCENT = 'rgb(var(--color-accent))';

/* ── 컴포넌트 ────────────────────────────────────────── */
export default function DaySidebar({
  activeDayIndex,
  onDaySelect,
  events,
  year,
}: DaySidebarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrolledOnceRef = useRef(false);

  // 활성 날짜가 속한 월의 모든 날짜 생성
  const activeDate = useMemo(() => dayIndexToDate(year, activeDayIndex), [year, activeDayIndex]);
  const activeMonth = activeDate.getMonth();

  // 날짜마다 그 날의 일정 색·개수는 달·일정이 바뀔 때만 다시 센다(날을 넘길 때마다 31일 × 전체 일정을 훑지 않게).
  const monthDays = useMemo(() => {
    const daysInMonth = new Date(year, activeMonth + 1, 0).getDate();
    const result: { date: Date; dateStr: string; dayIdx: number; colors: string[]; eventCount: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, activeMonth, d, 12, 0, 0, 0);
      const dateStr = fmtDate(date);
      const dayEvents = events.filter((ev) => ev.startDate <= dateStr && ev.endDate >= dateStr);
      result.push({
        date,
        dateStr,
        dayIdx: dateToDayIndex(date),
        colors: [...new Set(dayEvents.map((ev) => ev.color))],
        eventCount: dayEvents.length,
      });
    }
    return result;
  }, [year, activeMonth, events]);

  // 활성 날짜가 바뀌면 사이드바 목록 안에서만 보이게 옮긴다. 처음 열 때는 바로, 그 뒤로는 부드럽게.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(`[data-day-idx="${activeDayIndex}"]`);
    if (!activeEl) return;
    scrollIntoNearestScroller(activeEl, scrolledOnceRef.current ? 'smooth' : 'auto');
    scrolledOnceRef.current = true;
  }, [activeDayIndex]);

  const today = fmtDate(new Date());

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-1 overflow-y-auto py-2 px-1"
      style={{ width: 180 }}
    >
      {/* 월 라벨 */}
      <div className="px-2 py-1 mb-1">
        <span className="text-xs font-bold" style={{ color: ACCENT }}>
          {year}년 {activeMonth + 1}월
        </span>
      </div>

      {monthDays.map(({ date, dateStr, dayIdx, colors, eventCount }) => (
        <DayItem
          key={dateStr}
          date={date}
          dayIdx={dayIdx}
          isActive={dayIdx === activeDayIndex}
          isToday={dateStr === today}
          colors={colors}
          eventCount={eventCount}
          onDaySelect={onDaySelect}
        />
      ))}
    </div>
  );
}

/* ── DayItem ─────────────────────────────────────────── */
// 날을 넘길 때 실제로 바뀌는 건 '활성' 두 줄뿐이다. 나머지는 다시 그리지 않는다.
const DayItem = memo(function DayItem({
  date,
  dayIdx,
  isActive,
  isToday,
  colors,
  eventCount,
  onDaySelect,
}: {
  date: Date;
  dayIdx: number;
  isActive: boolean;
  isToday: boolean;
  colors: string[];
  eventCount: number;
  onDaySelect: (index: number) => void;
}) {
  const dow = date.getDay();
  const dayColor = dow === 0 ? 'rgb(var(--color-calendar-sunday))' : dow === 6 ? 'rgb(var(--color-calendar-saturday))' : PRIMARY_TEXT;

  return (
    <button
      type="button"
      data-day-idx={dayIdx}
      onClick={() => onDaySelect(dayIdx)}
      // 호버·누름 확대는 CSS 로 — 날마다 framer 컴포넌트를 두면 넘길 때마다 그만큼 무겁다.
      className="w-full text-left rounded-lg px-2.5 py-1.5 transition duration-150 motion-safe:hover:scale-[1.02] motion-safe:active:scale-[0.98]"
      style={{
        background: isActive ? ACTIVE_BG : 'transparent',
        border: isActive
          ? `1px solid ${ACTIVE_BORDER}`
          : '1px solid transparent',
        opacity: isActive ? 1 : 0.9,
        cursor: 'pointer',
      }}
    >
      <div className="flex items-center gap-2">
        {/* 날짜 번호 */}
        <span
          className="text-sm font-bold w-6 h-6 flex items-center justify-center rounded-full shrink-0"
          style={{
            color: isToday ? '#fff' : dayColor,
            background: isToday ? '#6C5CE7' : 'transparent',
            fontSize: 11,
          }}
        >
          {date.getDate()}
        </span>
        {/* 요일 */}
        <span
          className="text-[10px] font-medium shrink-0"
          style={{ color: dayColor, minWidth: 14 }}
        >
          {WEEKDAY_KR[dow]}
        </span>
        {/* 이벤트 도트 */}
        <div className="flex items-center gap-0.5 flex-1 min-w-0">
          {colors.slice(0, MAX_DOTS).map((c, i) => (
            <div
              key={i}
              className="rounded-full shrink-0"
              style={{ width: 5, height: 5, background: c }}
            />
          ))}
          {eventCount > MAX_DOTS && (
            <span style={{ fontSize: 7, color: SECONDARY_TEXT }}>
              +{eventCount - MAX_DOTS}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});
