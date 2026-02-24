import { useState, useEffect, useMemo, useCallback } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Filter, Settings2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAppStore } from '@/stores/useAppStore';
import { getEvents, getEventsForDate } from '@/services/calendarService';
import type { CalendarEvent, CalendarFilter } from '@/types/calendar';
import { Widget } from './Widget';

const WEEKDAYS_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

type WidgetViewMode = 'month' | '2week' | 'week' | 'today';

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
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [viewMode, setViewMode] = useState<WidgetViewMode>('month');
  const [typeFilter, setTypeFilter] = useState<CalendarFilter>('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  const today = fmtDate(new Date());

  useEffect(() => {
    getEvents().then(setEvents);
  }, []);

  // 부서 필터 연동
  const filteredEvents = useMemo(() => {
    let result = events;
    if (typeFilter !== 'all') result = result.filter((e) => e.type === typeFilter);
    if (dashboardDeptFilter !== 'all') {
      result = result.filter((e) => e.linkedDepartment === dashboardDeptFilter || e.type === 'custom');
    }
    return result;
  }, [events, typeFilter, dashboardDeptFilter]);

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

  // 리스트 뷰용 이벤트 (2week/week/today)
  const listEvents = useMemo(() => {
    if (viewMode === 'today') {
      return getEventsForDate(filteredEvents, today);
    }
    const now = new Date();
    const nowDow = now.getDay();
    const weekStart = addDays(now, -nowDow);
    const numDays = viewMode === '2week' ? 14 : 7;
    const weekEnd = addDays(weekStart, numDays - 1);
    const startStr = fmtDate(weekStart);
    const endStr = fmtDate(weekEnd);
    return filteredEvents
      .filter((e) => e.endDate >= startStr && e.startDate <= endStr)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [filteredEvents, viewMode, today]);

  const goToPrevMonth = () => {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
    setSelectedDate(null);
  };
  const goToNextMonth = () => {
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
              onClick={() => { setViewMode(m); setSelectedDate(null); }}
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
      <div className="flex flex-col gap-1.5 h-full">
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
            {viewMode !== 'month' && (
              <span className="text-[11px] font-semibold text-text-primary">
                {viewMode === 'today' ? '오늘' : viewMode === 'week' ? '이번 주' : '2주'}
              </span>
            )}
          </div>
        </div>

        {/* 필터 바 (접기/펼치기) */}
        {showFilter && (
          <div className="flex flex-wrap gap-0.5">
            {/* 타입 필터 */}
            {(['all', 'custom', 'episode', 'part', 'scene'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={cn(
                  'px-1.5 py-0.5 text-[8px] rounded font-medium cursor-pointer transition-colors',
                  typeFilter === f ? 'bg-accent/20 text-accent' : 'text-text-secondary/50 hover:text-text-primary',
                )}
              >
                {f === 'all' ? '전체' : f === 'custom' ? '일반' : f === 'episode' ? 'EP' : f === 'part' ? '파트' : '씬'}
              </button>
            ))}
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

            <div className="grid grid-cols-7 gap-px flex-1 relative">
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
                      'text-[10px] tabular-nums leading-none',
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
            </div>
          </>
        )}

        {/* 이벤트 리스트 (선택 날짜 or 2week/week/today) */}
        {viewMode === 'month' && dateEvents.length > 0 && (
          <div className="border-t border-bg-border/30 pt-1.5 mt-auto">
            <div className="text-[10px] text-text-secondary/50 mb-1">
              {selectedDate ? `${parseDate(selectedDate).getMonth() + 1}/${parseDate(selectedDate).getDate()} 일정` : '오늘 일정'}
            </div>
            <div className="flex flex-col gap-0.5">
              {dateEvents.slice(0, 4).map((ev) => (
                <div key={ev.id} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
                  <span className="text-[10px] text-text-primary truncate">{ev.title}</span>
                </div>
              ))}
              {dateEvents.length > 4 && (
                <span className="text-[10px] text-accent">+{dateEvents.length - 4} 더</span>
              )}
            </div>
          </div>
        )}

        {viewMode !== 'month' && (
          <div className="flex flex-col gap-1 flex-1 overflow-auto">
            {/* 날짜 범위 표시 */}
            {viewMode !== 'today' && (
              <div className="text-[10px] text-text-secondary/50 pb-0.5">
                {(() => {
                  const now = new Date();
                  const nowDow = now.getDay();
                  const weekStart = addDays(now, -nowDow);
                  const numDays = viewMode === '2week' ? 14 : 7;
                  const weekEnd = addDays(weekStart, numDays - 1);
                  return `${weekStart.getMonth() + 1}/${weekStart.getDate()} — ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`;
                })()}
              </div>
            )}
            {listEvents.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[10px] text-text-secondary/40">
                일정 없음
              </div>
            ) : (
              listEvents.map((ev) => {
                const s = parseDate(ev.startDate);
                const e = parseDate(ev.endDate);
                const isContinuous = ev.startDate !== ev.endDate;
                const dateRange = ev.startDate === ev.endDate
                  ? `${s.getMonth() + 1}/${s.getDate()}`
                  : `${s.getMonth() + 1}/${s.getDate()}→${e.getMonth() + 1}/${e.getDate()}`;
                return (
                  <div
                    key={ev.id}
                    className="flex items-center gap-1.5 py-1 px-1.5 rounded-md transition-colors hover:bg-bg-border/10"
                    style={isContinuous ? {
                      borderLeft: `2px solid ${ev.color}`,
                      background: `linear-gradient(90deg, ${ev.color}08 0%, transparent 100%)`,
                    } : undefined}
                  >
                    {!isContinuous && <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />}
                    <span className="text-[10px] text-text-primary truncate flex-1">{ev.title}</span>
                    <span className="text-[8px] text-text-secondary/40 shrink-0">{dateRange}</span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </Widget>
  );
}
