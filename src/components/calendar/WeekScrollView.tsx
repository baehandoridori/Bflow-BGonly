// ─── WeekScrollView: 휠 스크롤 포커스 주간 뷰 (전체 연도 ISO 주차) ──────
import React, { useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarDays } from 'lucide-react';
import type { CalendarEvent } from '@/types/calendar';

/* ── 로컬 유틸 ──────────────────────────────────────── */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (parseDate(b).getTime() - parseDate(a).getTime()) / 86400000,
  );
}

/** ISO 8601 주차 번호 (1~53) */
function getISOWeekNumber(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(12, 0, 0, 0);
  // ISO: 주의 시작은 월요일, 첫째 주는 1/4를 포함하는 주
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** 해당 연도의 일요일 시작 주 배열 생성 (약 53주) */
function generateYearWeeks(year: number): Date[][] {
  // 1월 1일이 속한 주의 일요일부터 시작
  const jan1 = new Date(year, 0, 1, 12, 0, 0, 0);
  const jan1Dow = jan1.getDay();
  const firstSunday = addDays(jan1, -jan1Dow);

  const weeks: Date[][] = [];
  let current = firstSunday;

  // 다음 해 1월 첫 주까지 포함
  const endDate = new Date(year + 1, 0, 7, 12, 0, 0, 0);
  while (current.getTime() < endDate.getTime()) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(addDays(current, d));
    }
    weeks.push(week);
    current = addDays(current, 7);
  }

  return weeks;
}

/** 오늘이 속한 주의 인덱스 찾기 */
function findWeekIndexForDate(weeks: Date[][], dateStr: string): number {
  for (let i = 0; i < weeks.length; i++) {
    const wStart = fmtDate(weeks[i][0]);
    const wEnd = fmtDate(weeks[i][6]);
    if (dateStr >= wStart && dateStr <= wEnd) return i;
  }
  return 0;
}

// hex → rgba
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── 타입 ────────────────────────────────────────────── */
export interface WeekScrollViewProps {
  currentMonth: number; // 0-indexed (호환용, 내부에서 연도 주차로 변환)
  currentYear: number;
  events: CalendarEvent[];
  today: string; // YYYY-MM-DD
  onEventClick: (ev: CalendarEvent) => void;
  onDateClick?: (date: string) => void; // YYYY-MM-DD — 날짜 클릭 시 이벤트 생성
  activeWeekIndex: number; // 연도 기준 절대 인덱스 (0~52)
  onWeekChange: (index: number) => void;
  mode?: 'week' | '2week'; // 'week' = 1주 포커스, '2week' = 2주 활성
}

/* ── 상수 ────────────────────────────────────────────── */
const TRANSITION = {
  duration: 0.4,
  ease: [0.16, 1, 0.3, 1],
};

const DEBOUNCE_MS = 150;
const VISIBLE_RANGE = 2; // 활성 주 ± 2주 표시

/* ── 컴포넌트 ────────────────────────────────────────── */
export default function WeekScrollView({
  currentYear,
  events,
  today,
  onEventClick,
  onDateClick,
  activeWeekIndex,
  onWeekChange,
  mode = 'week',
}: WeekScrollViewProps) {
  const is2Week = mode === '2week';
  /* 전체 연도 주 데이터 */
  const allWeeks = useMemo(() => generateYearWeeks(currentYear), [currentYear]);

  /* 표시할 주 범위 */
  const visibleWeeks = useMemo(() => {
    const result: { week: Date[]; absIdx: number }[] = [];
    const range = is2Week ? 1 : VISIBLE_RANGE;
    const start = Math.max(0, activeWeekIndex - range);
    // 2주 모드: active + next가 활성이므로 +1 더 보여줌
    const endExtra = is2Week ? range + 1 : range;
    const end = Math.min(allWeeks.length - 1, activeWeekIndex + endExtra);
    for (let i = start; i <= end; i++) {
      result.push({ week: allWeeks[i], absIdx: i });
    }
    return result;
  }, [allWeeks, activeWeekIndex, is2Week]);

  /* 휠 디바운스 */
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (wheelTimer.current) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      const next = Math.max(0, Math.min(allWeeks.length - 1, activeWeekIndex + dir));
      if (next !== activeWeekIndex) onWeekChange(next);
      wheelTimer.current = setTimeout(() => {
        wheelTimer.current = null;
      }, DEBOUNCE_MS);
    },
    [activeWeekIndex, allWeeks.length, onWeekChange],
  );

  /* 주에 해당하는 이벤트 */
  const getWeekEvents = useCallback(
    (week: Date[]) => {
      const wStart = fmtDate(week[0]);
      const wEnd = fmtDate(week[6]);
      return events.filter(
        (ev) => ev.endDate >= wStart && ev.startDate <= wEnd,
      );
    },
    [events],
  );

  return (
    <div
      className="flex flex-col w-full select-none overflow-hidden flex-1 h-full justify-center"
      onWheel={handleWheel}
    >
      <AnimatePresence mode="popLayout">
        {visibleWeeks.map(({ week, absIdx }) => {
          const diff = absIdx - activeWeekIndex;
          const absDiff = Math.abs(diff);
          const isoWeek = getISOWeekNumber(week[3]); // 목요일 기준

          // 2주 모드: active + next(+1) 둘 다 활성
          const isActive = is2Week
            ? (diff === 0 || diff === 1)
            : diff === 0;
          const isNear = !isActive && absDiff <= (is2Week ? 1 : 1);

          const opacity = isActive ? 1 : isNear ? 0.3 : 0.12;
          const scale = isActive ? 1 : isNear ? 0.97 : 0.94;

          return (
            <motion.div
              key={`week-${absIdx}`}
              layout
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity, scale }}
              transition={TRANSITION}
              className="w-full"
              style={{
                cursor: !isActive ? 'pointer' : undefined,
              }}
              onClick={() => !isActive && onWeekChange(absIdx)}
            >
              {isActive ? (
                <ActiveWeek
                  week={week}
                  events={getWeekEvents(week)}
                  today={today}
                  isoWeek={isoWeek}
                  onEventClick={onEventClick}
                  onDateClick={onDateClick}
                  compact={is2Week}
                />
              ) : isNear ? (
                <CompactWeek
                  week={week}
                  events={getWeekEvents(week)}
                  today={today}
                  isoWeek={isoWeek}
                  showBars
                />
              ) : (
                <CompactWeek
                  week={week}
                  events={[]}
                  today={today}
                  isoWeek={isoWeek}
                  showBars={false}
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* export for ScheduleView to find initial week index */
export { generateYearWeeks, findWeekIndexForDate, getISOWeekNumber };

/* ── ActiveWeek: 포커스된 주 ──────────────────────────── */
function ActiveWeek({
  week,
  events,
  today,
  isoWeek,
  onEventClick,
  onDateClick,
  compact,
}: {
  week: Date[];
  events: CalendarEvent[];
  today: string;
  isoWeek: number;
  onEventClick: (ev: CalendarEvent) => void;
  onDateClick?: (date: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-5 mb-2 flex flex-col"
      style={{
        background: 'rgba(108,92,231,0.06)',
        border: '1px solid rgba(108,92,231,0.35)',
        boxShadow: '0 0 18px rgba(108,92,231,0.12)',
        minHeight: compact ? '30vh' : '50vh',
      }}
    >
      {/* 주차 라벨 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold" style={{ color: '#6C5CE7' }}>
          {isoWeek}주차
        </span>
        <span className="text-[10px]" style={{ color: '#8B8DA3' }}>
          {week[0].getMonth() + 1}.{week[0].getDate()} ~ {week[6].getMonth() + 1}.{week[6].getDate()}
        </span>
      </div>

      {/* 7-day date grid + event dots */}
      <div className="grid grid-cols-7 gap-1 mb-3">
        {week.map((day, i) => {
          const ds = fmtDate(day);
          const isToday = ds === today;
          const dow = day.getDay();
          const color =
            dow === 0 ? '#E17055' : dow === 6 ? '#74B9FF' : '#E8E8EE';

          // 이 날짜에 해당하는 이벤트 수집
          const dayEvents = events.filter(
            (ev) => ev.startDate <= ds && ev.endDate >= ds,
          );

          return (
            <div
              key={ds}
              className="flex flex-col items-center gap-0.5 cursor-pointer rounded-lg hover:bg-white/5 transition-colors py-0.5"
              onClick={() => onDateClick?.(ds)}
            >
              <span
                className="text-[10px] font-medium"
                style={{ color }}
              >
                {WEEKDAYS[i]}
              </span>
              <span
                className="text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full"
                style={{
                  color: isToday ? '#fff' : color,
                  background: isToday ? '#6C5CE7' : 'transparent',
                }}
              >
                {day.getDate()}
              </span>
              {/* 이벤트 도트 (최대 3개) */}
              <div className="flex gap-px" style={{ minHeight: 6 }}>
                {dayEvents.slice(0, 3).map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-full"
                    style={{
                      width: 5,
                      height: 5,
                      background: ev.color,
                    }}
                  />
                ))}
                {dayEvents.length > 3 && (
                  <span style={{ fontSize: 7, color: '#8B8DA3', lineHeight: '5px' }}>
                    +{dayEvents.length - 3}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Multi-day event bars spanning the date grid */}
      {events.length > 0 && (
        <div className="flex flex-col gap-0.5 mb-2">
          {events.slice(0, 5).map((ev) => {
            const wStart = fmtDate(week[0]);
            const wEnd = fmtDate(week[6]);
            // 이벤트가 이 주에서 차지하는 범위 계산
            const barStart = ev.startDate < wStart ? 0 : daysBetween(wStart, ev.startDate);
            const barEnd = ev.endDate > wEnd ? 6 : daysBetween(wStart, ev.endDate);
            const startCol = Math.max(0, Math.min(6, barStart));
            const endCol = Math.max(0, Math.min(6, barEnd));
            const spanCols = endCol - startCol + 1;

            return (
              <div
                key={ev.id}
                className="grid grid-cols-7 gap-1"
              >
                <div
                  className="rounded-full truncate flex items-center px-1.5"
                  style={{
                    gridColumnStart: startCol + 1,
                    gridColumnEnd: startCol + 1 + spanCols,
                    background: hexToRgba(ev.color, 0.2),
                    height: 14,
                    fontSize: 8,
                    color: ev.color,
                    fontWeight: 600,
                  }}
                >
                  {ev.title}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Event cards */}
      {events.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center flex-1 gap-2 cursor-pointer rounded-lg hover:bg-white/5 transition-colors"
          onClick={() => onDateClick?.(fmtDate(week[3]))}
        >
          <CalendarDays size={36} color="#8B8DA3" />
          <span className="text-sm" style={{ color: '#8B8DA3' }}>
            이번 주 일정이 없습니다
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2 flex-1 overflow-y-auto mt-2">
          {events.map((ev) => (
            <EventCard
              key={ev.id}
              event={ev}
              today={today}
              onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── EventCard ────────────────────────────────────────── */
function EventCard({
  event,
  today,
  onClick,
}: {
  event: CalendarEvent;
  today: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const s = parseDate(event.startDate);
  const e = parseDate(event.endDate);
  const isSingle = event.startDate === event.endDate;

  // 요일 포함 날짜 표시: "3/18(수) → 3/20(금)"
  const dayLabel = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_SHORT[d.getDay()]})`;

  const dateRange = isSingle
    ? dayLabel(s)
    : `${dayLabel(s)} → ${dayLabel(e)}`;

  const dDay = daysBetween(today, event.endDate);
  const dDayLabel =
    dDay === 0 ? 'D-Day' : dDay > 0 ? `D-${dDay}` : `D+${Math.abs(dDay)}`;

  const spanDays = isSingle ? '' : ` (${daysBetween(event.startDate, event.endDate) + 1}일)`;

  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      onClick={onClick}
      className="flex items-center gap-2 cursor-pointer"
      style={{
        background: hexToRgba(event.color, 0.08),
        borderLeft: `3px solid ${event.color}`,
        borderRadius: 8,
        padding: '8px 10px',
      }}
    >
      <div className="flex flex-col flex-1 min-w-0">
        <span
          className="font-bold truncate"
          style={{ fontSize: 11, color: '#E8E8EE' }}
        >
          {event.title}
        </span>
        <span style={{ fontSize: 9, color: '#8B8DA3' }}>
          {dateRange}{spanDays} · {event.type}
        </span>
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

/* ── CompactWeek: 비활성 주 ───────────────────────────── */
function CompactWeek({
  week,
  events,
  today,
  isoWeek,
  showBars,
}: {
  week: Date[];
  events: CalendarEvent[];
  today: string;
  isoWeek: number;
  showBars: boolean;
}) {
  return (
    <div className="rounded-lg px-3 py-2 mb-1" style={{ background: 'rgba(26,29,39,0.5)' }}>
      {/* 주차 라벨 */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] font-bold" style={{ color: '#8B8DA3' }}>
          {isoWeek}주차
        </span>
        <span className="text-[8px]" style={{ color: '#8B8DA350' }}>
          {week[0].getMonth() + 1}.{week[0].getDate()}~{week[6].getMonth() + 1}.{week[6].getDate()}
        </span>
        {showBars && events.length > 0 && (
          <span className="text-[8px]" style={{ color: '#8B8DA3' }}>
            · {events.length}건
          </span>
        )}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {week.map((day) => {
          const ds = fmtDate(day);
          const isToday = ds === today;
          const dow = day.getDay();
          const color =
            dow === 0 ? '#E17055' : dow === 6 ? '#74B9FF' : '#E8E8EE';

          return (
            <div
              key={ds}
              className="flex flex-col items-center"
            >
              <span
                className="text-[10px] font-medium w-5 h-5 flex items-center justify-center rounded-full"
                style={{
                  color: isToday ? '#fff' : color,
                  background: isToday ? '#6C5CE7' : 'transparent',
                }}
              >
                {day.getDate()}
              </span>
              {/* event bar summaries */}
              {showBars && (
                <div className="flex gap-px mt-0.5">
                  {events
                    .filter((ev) => ev.startDate <= ds && ev.endDate >= ds)
                    .slice(0, 2)
                    .map((ev) => (
                      <div
                        key={ev.id}
                        className="rounded-full"
                        style={{
                          width: 4,
                          height: 2,
                          background: ev.color,
                        }}
                      />
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
