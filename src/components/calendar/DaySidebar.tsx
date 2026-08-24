// ─── DaySidebar: 일간 네비게이션 사이드바 (월별 날짜 리스트) ────────────────
import React, { useMemo, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { CalendarEvent } from '@/types/calendar';
import { fmtDate } from '@/utils/calendarDate';

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

  // 활성 날짜가 속한 월의 모든 날짜 생성
  const activeDate = useMemo(() => dayIndexToDate(year, activeDayIndex), [year, activeDayIndex]);
  const activeMonth = activeDate.getMonth();

  const monthDays = useMemo(() => {
    const daysInMonth = new Date(year, activeMonth + 1, 0).getDate();
    const result: { date: Date; dateStr: string; dayIdx: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, activeMonth, d, 12, 0, 0, 0);
      result.push({
        date,
        dateStr: fmtDate(date),
        dayIdx: dateToDayIndex(date),
      });
    }
    return result;
  }, [year, activeMonth]);

  // 활성 날짜가 변경될 때 스크롤하여 보이게 함
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeEl = container.querySelector(`[data-day-idx="${activeDayIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
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

      {monthDays.map(({ date, dateStr, dayIdx }) => {
        const isActive = dayIdx === activeDayIndex;
        const isToday = dateStr === today;
        const dow = date.getDay();
        const dayColor = dow === 0 ? '#E17055' : dow === 6 ? '#74B9FF' : PRIMARY_TEXT;

        // 이 날짜의 이벤트 색상 수집
        const dayEvents = events.filter(
          (ev) => ev.startDate <= dateStr && ev.endDate >= dateStr,
        );
        const colors = [...new Set(dayEvents.map((ev) => ev.color))];

        return (
          <motion.button
            key={dateStr}
            data-day-idx={dayIdx}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onDaySelect(dayIdx)}
            className="w-full text-left rounded-lg px-2.5 py-1.5 transition-colors"
            style={{
              background: isActive ? ACTIVE_BG : 'transparent',
              border: isActive
                ? `1px solid ${ACTIVE_BORDER}`
                : '1px solid transparent',
              opacity: isActive ? 1 : 0.5,
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
                {dayEvents.length > MAX_DOTS && (
                  <span style={{ fontSize: 7, color: SECONDARY_TEXT }}>
                    +{dayEvents.length - MAX_DOTS}
                  </span>
                )}
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
