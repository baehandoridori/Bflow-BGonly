import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Filter, Settings2, Palmtree, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/cn';
import { useAppStore } from '@/stores/useAppStore';
import { getEvents, getEventsForDate } from '@/services/calendarService';
import { fetchAllVacationEvents } from '@/services/vacationService';
import type { CalendarEvent, CalendarFilter } from '@/types/calendar';
import { VACATION_COLOR } from '@/types/vacation';
import { Widget } from './Widget';

const WEEKDAYS_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

/** ISO week number for a date */
function getWeekNumber(d: Date): number {
  const tmp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  tmp.setDate(tmp.getDate() + 4 - (tmp.getDay() || 7));
  const yearStart = new Date(tmp.getFullYear(), 0, 1);
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Get Sunday-start week beginning for a date */
function getWeekStart(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - r.getDay());
  return r;
}

/** D-day label */
function getDdayLabel(dateStr: string, todayStr: string): string | null {
  const d = parseDate(dateStr);
  const t = parseDate(todayStr);
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 0) return 'D-Day';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

type WidgetViewMode = 'month' | '2week' | 'week' | 'today';

/** Pack events into non-overlapping rows (greedy) */
function packEventRows(events: CalendarEvent[]): CalendarEvent[][] {
  const rows: CalendarEvent[][] = [];
  for (const ev of events) {
    let placed = false;
    for (const row of rows) {
      if (row[row.length - 1].endDate < ev.startDate) { row.push(ev); placed = true; break; }
    }
    if (!placed) rows.push([ev]);
  }
  return rows;
}

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

export function CalendarWidget() {
  const { setView } = useAppStore();
  const dashboardDeptFilter = useAppStore((s) => s.dashboardDeptFilter);
  const vacationConnected = useAppStore((s) => s.vacationConnected);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [vacationEvts, setVacationEvts] = useState<CalendarEvent[]>([]);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [viewMode, setViewMode] = useState<WidgetViewMode>('month');
  const [typeFilter, setTypeFilter] = useState<CalendarFilter>('all');
  const [showVacation, setShowVacation] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  // Navigation offsets for non-month views
  const [weekOffset, setWeekOffset] = useState(0);   // for 2week and week views
  const [dayOffset, setDayOffset] = useState(0);      // for today view
  const [monthDirection, setMonthDirection] = useState(0); // -1 or 1 for slide animation

  // Wheel scroll navigation
  const containerRef = useRef<HTMLDivElement>(null);
  const lastWheelTs = useRef(0);
  const isHovered = useRef(false);

  const today = fmtDate(new Date());

  useEffect(() => {
    getEvents().then(setEvents);
    const refresh = () => getEvents().then(setEvents);
    window.addEventListener('bflow:calendar-changed', refresh);
    return () => window.removeEventListener('bflow:calendar-changed', refresh);
  }, []);

  // 휴가 이벤트 로드
  useEffect(() => {
    if (!vacationConnected) { setVacationEvts([]); return; }
    fetchAllVacationEvents()
      .then((raw) => {
        setVacationEvts(raw.map((v, i) => ({
          id: `wvac-${v.name}-${v.startDate}-${i}`,
          title: `${v.name} ${v.type}`,
          memo: '',
          color: VACATION_COLOR,
          type: 'vacation' as const,
          startDate: v.startDate,
          endDate: v.endDate,
          createdBy: v.name,
          createdAt: new Date().toISOString(),
          vacationType: v.type,
          vacationUserName: v.name,
          isReadOnly: true,
        })));
      })
      .catch(() => setVacationEvts([]));
  }, [vacationConnected]);

  // 통합 이벤트
  const allEvents = useMemo(() => [...events, ...vacationEvts], [events, vacationEvts]);

  // Wheel scroll navigation for all view modes
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!isHovered.current) return; // 마우스가 위젯 밖이면 무시
    const now = Date.now();
    if (now - lastWheelTs.current < 150) return;
    lastWheelTs.current = now;
    e.preventDefault();
    e.stopPropagation();

    const dir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
    if (dir === 0) return;

    if (viewMode === 'month') {
      setMonthDirection(dir);
      setMonth((prev) => {
        const next = prev + dir;
        if (next < 0) { setYear((y) => y - 1); return 11; }
        if (next > 11) { setYear((y) => y + 1); return 0; }
        return next;
      });
      setSelectedDate(null);
    } else if (viewMode === '2week' || viewMode === 'week') {
      setWeekOffset((o) => o + dir);
    } else if (viewMode === 'today') {
      setDayOffset((o) => o + dir);
    }
  }, [viewMode]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // 부서 필터 연동
  const filteredEvents = useMemo(() => {
    let result = allEvents;
    // 휴가 토글
    if (!showVacation) result = result.filter((e) => e.type !== 'vacation');
    if (typeFilter !== 'all') result = result.filter((e) => e.type === typeFilter);
    if (dashboardDeptFilter !== 'all') {
      result = result.filter((e) => e.linkedDepartment === dashboardDeptFilter || e.type === 'custom' || e.type === 'vacation');
    }
    return result;
  }, [allEvents, typeFilter, showVacation, dashboardDeptFilter]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const days: { date: number; dateStr: string; isCurrentMonth: boolean; isToday: boolean; dow: number }[] = [];

    const prevMonthLast = new Date(year, month, 0).getDate();
    for (let i = startDow - 1; i >= 0; i--) {
      const d = prevMonthLast - i;
      const ds = fmtDate(new Date(year, month - 1, d));
      days.push({ date: d, dateStr: ds, isCurrentMonth: false, isToday: false, dow: days.length % 7 });
    }

    for (let d = 1; d <= totalDays; d++) {
      const ds = fmtDate(new Date(year, month, d));
      days.push({ date: d, dateStr: ds, isCurrentMonth: true, isToday: ds === today, dow: days.length % 7 });
    }

    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const ds = fmtDate(new Date(year, month + 1, d));
      days.push({ date: d, dateStr: ds, isCurrentMonth: false, isToday: false, dow: days.length % 7 });
    }

    return days;
  }, [year, month, today]);

  // 선택 날짜 또는 오늘 일정
  const displayDate = selectedDate ?? today;
  const dateEvents = useMemo(() => getEventsForDate(filteredEvents, displayDate), [filteredEvents, displayDate]);

  const goToPrevMonth = () => {
    setMonthDirection(-1);
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
    setSelectedDate(null);
  };
  const goToNextMonth = () => {
    setMonthDirection(1);
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
    setSelectedDate(null);
  };

  return (
    <Widget
      title="캘린더"
      icon={<CalendarDays size={14} />}
      headerRight={
        <div className="flex items-center gap-1">
          {/* 뷰 모드 토글 */}
          {(['month', '2week', 'week', 'today'] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setViewMode(m); setSelectedDate(null); setWeekOffset(0); setDayOffset(0); }}
              className={cn(
                'px-1.5 py-0.5 text-[9px] rounded font-medium cursor-pointer transition-colors',
                viewMode === m ? 'bg-accent/20 text-accent' : 'text-text-secondary/40 hover:text-text-primary',
              )}
            >
              {m === 'month' ? '월' : m === '2week' ? '2주' : m === 'week' ? '주' : '오늘'}
            </button>
          ))}
          <button
            onClick={() => setShowFilter(!showFilter)}
            className={cn(
              'p-0.5 cursor-pointer transition-colors ml-0.5',
              showFilter ? 'text-accent' : 'text-text-secondary/40 hover:text-text-secondary',
            )}
          >
            <Settings2 size={10} />
          </button>
          <button
            onClick={() => setView('schedule')}
            className="text-[9px] text-accent hover:underline cursor-pointer ml-0.5"
          >
            전체
          </button>
        </div>
      }
    >
      <div
        ref={containerRef}
        className="flex flex-col gap-1.5 h-full"
        onMouseEnter={() => { isHovered.current = true; }}
        onMouseLeave={() => { isHovered.current = false; }}
      >
        {/* 미니 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {viewMode === 'month' && (
              <>
                <button onClick={goToPrevMonth} className="p-0.5 text-text-secondary/50 hover:text-text-primary cursor-pointer">
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[11px] font-semibold text-text-primary min-w-[48px] text-center">
                  {month + 1}월
                </span>
                <button onClick={goToNextMonth} className="p-0.5 text-text-secondary/50 hover:text-text-primary cursor-pointer">
                  <ChevronRight size={12} />
                </button>
              </>
            )}
            {viewMode === '2week' && (
              <>
                <button
                  onClick={() => setWeekOffset((o) => o - 1)}
                  className="p-0.5 text-text-secondary/50 hover:text-text-primary cursor-pointer"
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[11px] font-semibold text-text-primary min-w-[72px] text-center">
                  {(() => {
                    const ws = addDays(getWeekStart(new Date()), weekOffset * 14);
                    const wn = getWeekNumber(ws);
                    const ws2 = addDays(ws, 7);
                    const wn2 = getWeekNumber(ws2);
                    return `${wn}-${wn2}주차 ${ws.getMonth() + 1}/${ws.getDate()}~`;
                  })()}
                </span>
                <button
                  onClick={() => setWeekOffset((o) => o + 1)}
                  className="p-0.5 text-text-secondary/50 hover:text-text-primary cursor-pointer"
                >
                  <ChevronRight size={12} />
                </button>
              </>
            )}
            {viewMode === 'week' && (
              <>
                <button
                  onClick={() => setWeekOffset((o) => o - 1)}
                  className="p-0.5 text-text-secondary/50 hover:text-text-primary cursor-pointer"
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[11px] font-semibold text-text-primary min-w-[72px] text-center">
                  {(() => {
                    const ws = addDays(getWeekStart(new Date()), weekOffset * 7);
                    const wn = getWeekNumber(ws);
                    return `${wn}주차 ${ws.getMonth() + 1}/${ws.getDate()}~`;
                  })()}
                </span>
                <button
                  onClick={() => setWeekOffset((o) => o + 1)}
                  className="p-0.5 text-text-secondary/50 hover:text-text-primary cursor-pointer"
                >
                  <ChevronRight size={12} />
                </button>
              </>
            )}
            {viewMode === 'today' && (
              <>
                <button
                  onClick={() => setDayOffset((o) => o - 1)}
                  className="p-0.5 text-text-secondary/50 hover:text-text-primary cursor-pointer"
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[11px] font-semibold text-text-primary min-w-[48px] text-center">
                  {(() => {
                    const d = addDays(new Date(), dayOffset);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  })()}
                </span>
                <button
                  onClick={() => setDayOffset((o) => o + 1)}
                  className="p-0.5 text-text-secondary/50 hover:text-text-primary cursor-pointer"
                >
                  <ChevronRight size={12} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 필터 바 (접기/펼치기) */}
        {showFilter && (
          <div className="flex flex-wrap gap-0.5 items-center">
            {/* 타입 필터 */}
            {(['all', 'custom', 'episode', 'part', 'scene'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={cn(
                  'px-1.5 py-0.5 text-[8px] rounded font-medium cursor-pointer transition-colors',
                  typeFilter === f
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-secondary/50 hover:text-text-primary',
                )}
              >
                {f === 'all' ? '전체' : f === 'custom' ? '일반' : f === 'episode' ? 'EP' : f === 'part' ? '파트' : '씬'}
              </button>
            ))}
            {/* 휴가 토글 (별도) */}
            <div className="w-px h-3 bg-bg-border/30 mx-0.5" />
            <button
              onClick={() => setShowVacation((v) => !v)}
              className={cn(
                'flex items-center gap-0.5 px-1.5 py-0.5 text-[8px] rounded font-medium cursor-pointer transition-colors',
                showVacation
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-text-secondary/30 hover:text-text-secondary/50',
              )}
            >
              {showVacation ? <Eye size={8} /> : <EyeOff size={8} />}
              휴가
            </button>
          </div>
        )}

        {/* 월간 미니 캘린더 */}
        {viewMode === 'month' && (
          <>
            <div className="grid grid-cols-7 gap-px">
              {WEEKDAYS_SHORT.map((d, i) => (
                <div key={d} className={cn(
                  'text-center text-[9px] font-medium py-0.5',
                  i === 0 ? 'text-red-400/50' : i === 6 ? 'text-blue-400/50' : 'text-text-secondary/40',
                )}>
                  {d}
                </div>
              ))}
            </div>

            <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={`month-${year}-${month}`}
              initial={{ opacity: 0, y: monthDirection > 0 ? 20 : -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: monthDirection > 0 ? -20 : 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="grid grid-cols-7 gap-px flex-1 relative">
              {calendarDays.map((day, i) => {
                const dayEvents = filteredEvents.filter((e) => e.startDate <= day.dateStr && e.endDate >= day.dateStr);
                const hasEvents = dayEvents.length > 0;
                const isSelected = selectedDate === day.dateStr;
                // 단일 이벤트만 도트 표시 (연속 이벤트는 오버레이 바로 표시)
                const dotEvents = dayEvents.filter((e) => e.startDate === e.endDate).slice(0, 3);
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex flex-col items-center justify-center py-0.5 rounded-sm transition-colors relative cursor-pointer',
                      day.isCurrentMonth ? 'hover:bg-bg-border/20' : 'opacity-25',
                      day.isToday && 'bg-accent/10',
                      isSelected && 'bg-accent/20 ring-1 ring-accent/40',
                    )}
                    onClick={() => setSelectedDate(isSelected ? null : day.dateStr)}
                  >
                    <span className={cn(
                      'text-[11px] tabular-nums leading-none',
                      day.isToday
                        ? 'bg-accent text-white w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold'
                        : day.dow === 0 ? 'text-red-400/60'
                        : day.dow === 6 ? 'text-blue-400/60'
                        : 'text-text-primary/50',
                    )}>
                      {day.date}
                    </span>
                    {hasEvents && !day.isToday && dotEvents.length > 0 && (
                      <div className="flex items-center gap-px mt-0.5">
                        {dotEvents.map((ev) => (
                          <div key={ev.id} className="w-1 h-1 rounded-full" style={{ backgroundColor: `${ev.color}90` }} />
                        ))}
                      </div>
                    )}
                    {/* 연속 이벤트 시작일에 바 표시 */}
                    {day.isCurrentMonth && (() => {
                      const startingHere = filteredEvents.filter(
                        (e) => e.startDate !== e.endDate && (e.startDate === day.dateStr || (day.dow === 0 && e.startDate < day.dateStr && e.endDate >= day.dateStr)),
                      );
                      if (startingHere.length === 0) return null;
                      return startingHere.slice(0, 2).map((ev, evIdx) => {
                        const isStart = ev.startDate === day.dateStr;
                        const evEnd = parseDate(ev.endDate);
                        const dayDate = parseDate(day.dateStr);
                        // 이번 주 끝 (토요일)까지 또는 이벤트 끝까지
                        const weekEnd = addDays(dayDate, 6 - day.dow);
                        const barEnd = evEnd < weekEnd ? evEnd : weekEnd;
                        const spanDays = Math.round((barEnd.getTime() - dayDate.getTime()) / 86400000) + 1;
                        const widthCols = Math.min(spanDays, 7 - day.dow);
                        return (
                          <div
                            key={`bar-${ev.id}-${day.dateStr}`}
                            className="absolute pointer-events-none"
                            style={{
                              bottom: 1 + evIdx * 5,
                              left: 0,
                              width: `calc(${widthCols * 100}% + ${(widthCols - 1)}px)`,
                              height: 3,
                              backgroundColor: `${ev.color}70`,
                              borderRadius: isStart ? '2px 0 0 2px' : 0,
                              borderTopRightRadius: ev.endDate <= fmtDate(barEnd) ? 2 : 0,
                              borderBottomRightRadius: ev.endDate <= fmtDate(barEnd) ? 2 : 0,
                              zIndex: 10,
                            }}
                          />
                        );
                      });
                    })()}
                  </div>
                );
              })}
            </motion.div>
            </AnimatePresence>
          </>
        )}

        {/* 이벤트 리스트 (선택 날짜 or 2week/week/today) */}
        {viewMode === 'month' && dateEvents.length > 0 && (
          <div className="border-t border-bg-border/30 pt-1.5 mt-auto">
            <div className="text-[11px] text-text-secondary/50 mb-1">
              {selectedDate ? `${parseDate(selectedDate).getMonth() + 1}/${parseDate(selectedDate).getDate()} 일정` : '오늘 일정'}
            </div>
            <div className="flex flex-col gap-0.5">
              {dateEvents.slice(0, 4).map((ev) => (
                <div key={ev.id} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
                  <span className="text-[11px] text-text-primary truncate">{ev.title}</span>
                </div>
              ))}
              {dateEvents.length > 4 && (
                <span className="text-[11px] text-accent">+{dateEvents.length - 4} 더</span>
              )}
            </div>
          </div>
        )}

        {/* ── 2주 뷰 (포커싱 스크롤) ── */}
        {viewMode === '2week' && (() => {
          // 5개 주(활성 2주 + 위1 + 아래2)를 보여주되 가운데 2주만 강조
          const baseDate = getWeekStart(new Date());
          const activeStart = addDays(baseDate, weekOffset * 14);

          const weeks = Array.from({ length: 5 }, (_, i) => {
            const ws = addDays(activeStart, (i - 1) * 7);
            const wn = getWeekNumber(ws);
            const days = Array.from({ length: 7 }, (__, j) => {
              const d = addDays(ws, j);
              return { date: d, str: fmtDate(d), dow: j };
            });
            const isActive = i >= 1 && i <= 2; // 가운데 2주
            return { ws, wn, days, isActive, idx: i };
          });

          const renderFocusWeekRow = (week: typeof weeks[0]) => {
            const { wn, days, isActive } = week;
            const weekEndStr = days[6].str;
            const weekStartStr = days[0].str;

            // 간트 바 (활성 주만)
            const weekEvents = isActive ? filteredEvents
              .filter((e) => e.endDate >= weekStartStr && e.startDate <= weekEndStr)
              .sort((a, b) => a.startDate.localeCompare(b.startDate)) : [];
            const rows = packEventRows(weekEvents);

            return (
              <motion.div
                key={`2w-${wn}-${fmtDate(week.ws)}`}
                layout
                className="flex flex-col gap-0.5 rounded-lg px-1.5 py-0.5"
                animate={{
                  opacity: isActive ? 1 : 0.25,
                  scale: isActive ? 1 : 0.97,
                  flex: isActive ? 2 : 0.6,
                  backgroundColor: isActive ? 'rgba(108, 92, 231, 0.06)' : 'rgba(0, 0, 0, 0)',
                }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  minHeight: 0,
                  borderLeft: isActive ? '2px solid rgba(108, 92, 231, 0.5)' : '2px solid transparent',
                }}
              >
                <div className="text-[8px] font-semibold" style={{ color: isActive ? '#6C5CE7' : '#8B8DA3' }}>
                  {wn}주차
                </div>
                <div className="grid grid-cols-7 gap-px">
                  {days.map((d) => {
                    const isToday = d.str === today;
                    return (
                      <div key={d.str} className="flex flex-col items-center">
                        <span className={cn(
                          'text-[9px] tabular-nums leading-tight',
                          isToday ? 'bg-accent text-white w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold'
                            : d.dow === 0 ? 'text-[#E17055]/70' : d.dow === 6 ? 'text-[#74B9FF]/70' : 'text-text-primary/50',
                        )}>
                          {d.date.getDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {isActive && rows.length > 0 && (
                  <div className="relative" style={{ minHeight: rows.length * 11 + 2 }}>
                    {rows.map((row, rowIdx) =>
                      row.map((ev) => {
                        const evStart = parseDate(ev.startDate) < days[0].date ? 0 : parseDate(ev.startDate).getDay();
                        const evEnd = parseDate(ev.endDate) > days[6].date ? 6 : parseDate(ev.endDate).getDay();
                        const span = evEnd - evStart + 1;
                        return (
                          <div
                            key={`${ev.id}-${fmtDate(week.ws)}`}
                            className="absolute overflow-hidden whitespace-nowrap text-ellipsis"
                            style={{
                              top: rowIdx * 11, left: `${(evStart / 7) * 100}%`, width: `${(span / 7) * 100}%`,
                              height: 9, backgroundColor: `${ev.color}50`, borderRadius: 3,
                              fontSize: 7, lineHeight: '9px', paddingLeft: 3, color: '#E8E8EE',
                            }}
                            title={ev.title}
                          >{ev.title}</div>
                        );
                      }),
                    )}
                  </div>
                )}
              </motion.div>
            );
          };

          return (
            <div className="flex flex-col flex-1 overflow-hidden">
              {weeks.map((w) => renderFocusWeekRow(w))}
            </div>
          );
        })()}

        {/* ── 1주 뷰 (포커싱 스크롤) ── */}
        {viewMode === 'week' && (() => {
          // 5개 주: 활성 1주(가운데) + 위아래 각 2주 (흐리게)
          const baseDate = getWeekStart(new Date());

          const weeks = Array.from({ length: 5 }, (_, i) => {
            const ws = addDays(baseDate, (weekOffset + i - 2) * 7);
            const wn = getWeekNumber(ws);
            const days = Array.from({ length: 7 }, (__, j) => {
              const d = addDays(ws, j);
              return { date: d, str: fmtDate(d), dow: j };
            });
            const isActive = i === 2; // 정중앙
            const dist = Math.abs(i - 2);
            return { ws, wn, days, isActive, dist };
          });

          const renderFocusWeek = (week: typeof weeks[0]) => {
            const { wn, days, isActive, dist } = week;
            const weekEndStr = days[6].str;
            const weekStartStr = days[0].str;

            const weekEvents = isActive ? filteredEvents
              .filter((e) => e.endDate >= weekStartStr && e.startDate <= weekEndStr)
              .sort((a, b) => a.startDate.localeCompare(b.startDate)) : [];
            const rows = packEventRows(weekEvents);

            const todayEvents = isActive ? getEventsForDate(filteredEvents, today) : [];

            return (
              <motion.div
                key={`week-${wn}-${fmtDate(week.ws)}`}
                layout
                className="flex flex-col gap-0.5 rounded-lg px-1.5 py-1"
                animate={{
                  opacity: isActive ? 1 : dist === 1 ? 0.3 : 0.12,
                  scale: isActive ? 1 : 1 - dist * 0.03,
                  flex: isActive ? 3 : dist === 1 ? 0.8 : 0.4,
                  backgroundColor: isActive ? 'rgba(108, 92, 231, 0.06)' : 'rgba(0, 0, 0, 0)',
                }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  minHeight: 0,
                  borderLeft: isActive ? '2px solid rgba(108, 92, 231, 0.5)' : '2px solid transparent',
                }}
              >
                {/* 주차 라벨 */}
                <div className="text-[8px] font-semibold" style={{ color: isActive ? '#6C5CE7' : '#8B8DA3' }}>
                  {wn}주차 {isActive && <span className="text-text-secondary/40 font-normal ml-1">
                    {days[0].date.getMonth() + 1}/{days[0].date.getDate()} ~ {days[6].date.getMonth() + 1}/{days[6].date.getDate()}
                  </span>}
                </div>
                {/* 요일 + 날짜 */}
                <div className="grid grid-cols-7 gap-px">
                  {days.map((d) => {
                    const isToday = d.str === today;
                    return (
                      <div key={d.str} className="flex flex-col items-center gap-0.5">
                        {isActive && (
                          <span className={cn('text-[7px]',
                            d.dow === 0 ? 'text-[#E17055]/60' : d.dow === 6 ? 'text-[#74B9FF]/60' : 'text-text-secondary/40',
                          )}>{WEEKDAYS_SHORT[d.dow]}</span>
                        )}
                        <span className={cn(
                          isActive ? 'text-[10px] font-medium' : 'text-[8px]',
                          'tabular-nums leading-tight',
                          isToday ? 'bg-accent text-white w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold'
                            : d.dow === 0 ? 'text-[#E17055]/70' : d.dow === 6 ? 'text-[#74B9FF]/70' : 'text-text-primary/60',
                        )}>
                          {d.date.getDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {/* 간트 바 (활성 주만) */}
                {isActive && rows.length > 0 && (
                  <div className="relative mt-0.5" style={{ minHeight: rows.length * 13 + 2 }}>
                    {rows.map((row, rowIdx) =>
                      row.map((ev) => {
                        const evStart = parseDate(ev.startDate) < days[0].date ? 0 : parseDate(ev.startDate).getDay();
                        const evEnd = parseDate(ev.endDate) > days[6].date ? 6 : parseDate(ev.endDate).getDay();
                        const span = evEnd - evStart + 1;
                        return (
                          <div
                            key={`w-${ev.id}`}
                            className="absolute overflow-hidden whitespace-nowrap text-ellipsis"
                            style={{
                              top: rowIdx * 13, left: `${(evStart / 7) * 100}%`, width: `${(span / 7) * 100}%`,
                              height: 11, backgroundColor: `${ev.color}50`, borderRadius: 3,
                              fontSize: 8, lineHeight: '11px', paddingLeft: 3, color: '#E8E8EE',
                            }}
                            title={ev.title}
                          >{ev.title}</div>
                        );
                      }),
                    )}
                  </div>
                )}
                {isActive && rows.length === 0 && (
                  <div className="text-[9px] text-text-secondary/30 py-1 text-center">일정 없음</div>
                )}
                {/* 오늘 일정 요약 (활성 주만) */}
                {isActive && todayEvents.length > 0 && (
                  <div className="border-t border-bg-border/30 pt-1 mt-auto">
                    <div className="text-[9px] font-semibold text-text-secondary/50 mb-0.5">오늘의 일정</div>
                    <div className="flex flex-col gap-0.5">
                      {todayEvents.slice(0, 4).map((ev) => (
                        <div key={ev.id} className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
                          <span className="text-[9px] text-text-primary truncate">{ev.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            );
          };

          return (
            <div className="flex flex-col flex-1 overflow-hidden">
              {weeks.map((w) => renderFocusWeek(w))}
            </div>
          );
        })()}

        {/* ── 일간 뷰 (포커스 캐러셀) ── */}
        {viewMode === 'today' && (() => {
          const baseDate = new Date();
          const centerDate = addDays(baseDate, dayOffset);
          const prevDate = addDays(centerDate, -1);
          const nextDate = addDays(centerDate, 1);
          const centerStr = fmtDate(centerDate);
          const prevStr = fmtDate(prevDate);
          const nextStr = fmtDate(nextDate);
          const centerEvents = getEventsForDate(filteredEvents, centerStr);

          const renderSideCol = (d: Date, dateStr: string) => (
            <motion.div
              key={`side-${dateStr}`}
              className="flex-1 flex flex-col items-center justify-center"
              animate={{ opacity: 0.3, scale: 0.95 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className={cn(
                'text-[18px] font-light tabular-nums',
                d.getDay() === 0 ? 'text-[#E17055]' : d.getDay() === 6 ? 'text-[#74B9FF]' : 'text-text-primary',
              )}>
                {d.getDate()}
              </span>
              <span className={cn(
                'text-[9px]',
                d.getDay() === 0 ? 'text-[#E17055]/60' : d.getDay() === 6 ? 'text-[#74B9FF]/60' : 'text-text-secondary/50',
              )}>
                {WEEKDAYS_SHORT[d.getDay()]}
              </span>
            </motion.div>
          );

          return (
            <div
              className="flex flex-col flex-1 overflow-auto"
            >
              <div className="flex items-stretch gap-1 flex-1 min-h-0">
                {/* Previous day */}
                {renderSideCol(prevDate, prevStr)}

                {/* Center (today / selected) */}
                <motion.div
                  key={`center-${centerStr}`}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="flex-[2] flex flex-col items-center rounded-lg py-2 px-1 overflow-auto"
                  style={{
                    border: '1px solid #6C5CE730',
                    boxShadow: '0 0 12px #6C5CE715',
                    background: 'linear-gradient(180deg, #6C5CE708 0%, transparent 50%)',
                  }}
                >
                  <span className="text-[28px] font-light tabular-nums" style={{ color: '#6C5CE7' }}>
                    {centerDate.getDate()}
                  </span>
                  <span className={cn(
                    'text-[10px] mb-2',
                    centerDate.getDay() === 0 ? 'text-[#E17055]' : centerDate.getDay() === 6 ? 'text-[#74B9FF]' : 'text-text-secondary/60',
                  )}>
                    {WEEKDAYS_SHORT[centerDate.getDay()]}요일 &middot; {centerDate.getMonth() + 1}월
                  </span>

                  {centerEvents.length === 0 ? (
                    <div className="text-[9px] text-text-secondary/30 mt-2">일정 없음</div>
                  ) : (
                    <div className="flex flex-col gap-1 w-full px-1 mt-1">
                      {centerEvents.map((ev) => {
                        const dday = getDdayLabel(ev.endDate, centerStr);
                        return (
                          <div key={ev.id} className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
                            <span className="text-[10px] text-text-primary truncate flex-1">{ev.title}</span>
                            {dday && (
                              <span
                                className="text-[7px] px-1 py-px rounded shrink-0 font-medium"
                                style={{
                                  backgroundColor: dday === 'D-Day' ? '#E1705530' : '#6C5CE720',
                                  color: dday === 'D-Day' ? '#E17055' : '#8B8DA3',
                                }}
                              >
                                {dday}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>

                {/* Next day */}
                {renderSideCol(nextDate, nextStr)}
              </div>
            </div>
          );
        })()}
      </div>
    </Widget>
  );
}
