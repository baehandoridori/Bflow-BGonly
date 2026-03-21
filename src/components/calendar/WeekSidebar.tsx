// ─── WeekSidebar: 주간 네비게이션 사이드바 (ISO 주차) ────────────────
import React, { useMemo, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { CalendarEvent } from '@/types/calendar';
import { getISOWeekNumber } from './WeekScrollView';

/* ── 로컬 유틸 ──────────────────────────────────────── */
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/* ── 타입 ────────────────────────────────────────────── */
export interface WeekSidebarProps {
  weeks: Date[][]; // 전체 연도 주 배열
  events: CalendarEvent[];
  today: string;
  activeWeekIndex: number; // 연도 기준 절대 인덱스
  onWeekSelect: (index: number) => void;
  currentMonth: number; // 호환용 (사용하지 않음)
  currentYear: number;
}

/* ── 상수 ────────────────────────────────────────────── */
const ACTIVE_BG = 'rgba(108,92,231,0.15)';
const ACTIVE_BORDER = 'rgba(108,92,231,0.4)';
const MAX_DOTS = 3;

/* ── 컴포넌트 ────────────────────────────────────────── */
export default function WeekSidebar({
  weeks,
  events,
  today,
  activeWeekIndex,
  onWeekSelect,
}: WeekSidebarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 활성 주가 변경될 때 스크롤하여 보이게 함
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeEl = container.querySelector(`[data-week-idx="${activeWeekIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeWeekIndex]);

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
          onSelect={() => onWeekSelect(idx)}
        />
      ))}
    </div>
  );
}

/* ── WeekItem ────────────────────────────────────────── */
function WeekItem({
  week,
  weekIndex,
  events,
  today,
  isActive,
  onSelect,
}: {
  week: Date[];
  weekIndex: number;
  events: CalendarEvent[];
  today: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const isoWeek = getISOWeekNumber(week[3]); // 목요일 기준

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
    <motion.button
      data-week-idx={weekIndex}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onSelect}
      className="w-full text-left rounded-lg px-2.5 py-2 transition-colors"
      style={{
        background: isActive ? ACTIVE_BG : 'transparent',
        border: isActive
          ? `1px solid ${ACTIVE_BORDER}`
          : '1px solid transparent',
        opacity: isActive ? 1 : 0.5,
        cursor: 'pointer',
      }}
    >
      {/* 주차 라벨 + 날짜 범위 */}
      <div className="flex items-center justify-between mb-1">
        <span
          className="font-bold"
          style={{ fontSize: 11, color: isActive ? '#6C5CE7' : '#E8E8EE' }}
        >
          {isoWeek}주차
        </span>
        <span style={{ fontSize: 9, color: '#8B8DA3' }}>{rangeLabel}</span>
      </div>

      {/* 미니 7-number 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-px mb-1">
        {week.map((day) => {
          const ds = fmtDate(day);
          const isToday = ds === today;
          const dow = day.getDay();
          const color =
            dow === 0 ? '#E17055' : dow === 6 ? '#74B9FF' : '#E8E8EE';

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
            <span style={{ fontSize: 8, color: '#8B8DA3' }}>
              +{weekColors.extra}
            </span>
          )}
        </div>
      )}
    </motion.button>
  );
}
