// ─── WeekSidebar: 주간 네비게이션 사이드바 (ISO 주차) ────────────────
import { memo, useMemo, useRef, useEffect } from 'react';
import type { CalendarEvent } from '@/types/calendar';
import { fmtDate, getISOWeekNumber } from '@/utils/calendarDate';
import { visibleWeekDays } from '@/utils/calendarWeekdays';
import { scrollIntoNearestScroller } from '@/utils/scrollIntoScroller';

/* ── 로컬 유틸 ──────────────────────────────────────── */
/* ── 타입 ────────────────────────────────────────────── */
export interface WeekSidebarProps {
  weeks: Date[][]; // 전체 연도 주 배열
  events: CalendarEvent[];
  today: string;
  activeWeekIndex: number; // 연도 기준 절대 인덱스
  onWeekSelect: (index: number) => void;
  currentMonth: number; // 호환용 (사용하지 않음)
  currentYear: number;
  /** 꺼져 있으면 토·일 날짜를 그리지 않는다(주 5일 보기). */
  showWeekends?: boolean;
}

/* ── 상수 ────────────────────────────────────────────── */
const ACTIVE_BG = 'rgba(108,92,231,0.15)';
const ACTIVE_BORDER = 'rgba(108,92,231,0.4)';
const MAX_DOTS = 3;
const PRIMARY_TEXT = 'rgb(var(--color-text-primary))';
const SECONDARY_TEXT = 'rgb(var(--color-text-secondary))';
const ACCENT = 'rgb(var(--color-accent))';

/* ── 컴포넌트 ────────────────────────────────────────── */
export default function WeekSidebar({
  weeks,
  events,
  today,
  activeWeekIndex,
  onWeekSelect,
  showWeekends = true,
}: WeekSidebarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrolledOnceRef = useRef(false);

  // 활성 주가 바뀌면 사이드바 목록 안에서만 보이게 옮긴다. 처음 열 때는 바로, 그 뒤로는 부드럽게.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(`[data-week-idx="${activeWeekIndex}"]`);
    if (!activeEl) return;
    scrollIntoNearestScroller(activeEl, scrolledOnceRef.current ? 'smooth' : 'auto');
    scrolledOnceRef.current = true;
  }, [activeWeekIndex, weeks]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-1.5 overflow-y-auto py-2 px-1"
      style={{ width: 180 }}
    >
      {weeks.map((week, idx) => (
        <WeekItem
          key={idx}
          week={week}
          weekIndex={idx}
          events={events}
          today={today}
          isActive={idx === activeWeekIndex}
          onWeekSelect={onWeekSelect}
          showWeekends={showWeekends}
        />
      ))}
    </div>
  );
}

/* ── WeekItem ────────────────────────────────────────── */
// 주를 넘길 때 실제로 바뀌는 건 '활성' 두 줄뿐이다. 나머지 51주는 다시 그리지 않는다.
const WeekItem = memo(function WeekItem({
  week,
  weekIndex,
  events,
  today,
  isActive,
  onWeekSelect,
  showWeekends,
}: {
  week: Date[];
  weekIndex: number;
  events: CalendarEvent[];
  today: string;
  isActive: boolean;
  onWeekSelect: (index: number) => void;
  showWeekends: boolean;
}) {
  const isoWeek = getISOWeekNumber(week[3]); // 목요일 기준
  // 주차 계산은 7일 배열 그대로 쓰고, 날짜 점만 보이는 날로 거른다.
  const visibleDays = visibleWeekDays(week, showWeekends);

  /* 이 주의 이벤트 컬러 수집 */
  const weekColors = useMemo(() => {
    const wStart = fmtDate(week[0]);
    const wEnd = fmtDate(week[6]);
    const matched = events.filter(
      (ev) => ev.endDate >= wStart && ev.startDate <= wEnd,
    );
    // 고유 컬러 수집
    const colors = [...new Set(matched.map((ev) => ev.color))];
    return { colors, extra: Math.max(0, matched.length - MAX_DOTS) };
  }, [week, events]);

  /* 날짜 범위 라벨 */
  const rangeLabel = `${week[0].getMonth() + 1}.${week[0].getDate()} ~ ${week[6].getMonth() + 1}.${week[6].getDate()}`;

  return (
    <button
      type="button"
      data-week-idx={weekIndex}
      onClick={() => onWeekSelect(weekIndex)}
      // 호버·누름 확대는 CSS 로 — 53개를 framer 컴포넌트로 두면 넘길 때마다 그만큼 무겁다.
      className="w-full text-left rounded-lg px-2.5 py-2 transition duration-150 motion-safe:hover:scale-[1.02] motion-safe:active:scale-[0.98]"
      style={{
        background: isActive ? ACTIVE_BG : 'transparent',
        border: isActive
          ? `1px solid ${ACTIVE_BORDER}`
          : '1px solid transparent',
        opacity: isActive ? 1 : 0.9,
        cursor: 'pointer',
      }}
    >
      {/* 주차 라벨 + 날짜 범위 */}
      <div className="flex items-center justify-between mb-1">
        <span
          className="font-bold"
          style={{ fontSize: 11, color: isActive ? ACCENT : PRIMARY_TEXT }}
        >
          {isoWeek}주차
        </span>
        <span style={{ fontSize: 9, color: SECONDARY_TEXT }}>{rangeLabel}</span>
      </div>

      {/* 미니 7-number 날짜 그리드 */}
      <div className="grid gap-px mb-1" style={{ gridTemplateColumns: `repeat(${visibleDays.length}, minmax(0, 1fr))` }}>
        {visibleDays.map((day) => {
          const ds = fmtDate(day);
          const isToday = ds === today;
          const dow = day.getDay();
          const color =
            dow === 0 ? 'rgb(var(--color-calendar-sunday))' : dow === 6 ? 'rgb(var(--color-calendar-saturday))' : PRIMARY_TEXT;

          return (
            <span
              key={ds}
              className="text-center rounded-full flex items-center justify-center"
              style={{
                fontSize: 8,
                width: 16,
                height: 16,
                fontWeight: isToday ? 700 : 500,
                color: isToday ? '#fff' : color,
                background: isToday ? '#6C5CE7' : 'transparent',
              }}
            >
              {day.getDate()}
            </span>
          );
        })}
      </div>

      {/* 이벤트 컬러 도트 */}
      {(weekColors.colors.length > 0 || weekColors.extra > 0) && (
        <div className="flex items-center gap-1 mt-0.5">
          {weekColors.colors.slice(0, MAX_DOTS).map((c, i) => (
            <div
              key={i}
              className="rounded-full"
              style={{
                width: 5,
                height: 5,
                background: c,
              }}
            />
          ))}
          {weekColors.extra > 0 && (
            <span style={{ fontSize: 8, color: SECONDARY_TEXT }}>
              +{weekColors.extra}
            </span>
          )}
        </div>
      )}
    </button>
  );
});
