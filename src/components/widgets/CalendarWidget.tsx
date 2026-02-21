import { useState, useEffect, useMemo } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAppStore } from '@/stores/useAppStore';
import { getEvents, getEventsForDate } from '@/services/calendarService';
import type { CalendarEvent } from '@/types/calendar';
import { Widget } from './Widget';

const WEEKDAYS_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function CalendarWidget() {
  const { setView } = useAppStore();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());

  const today = fmtDate(new Date());

  useEffect(() => {
    getEvents().then(setEvents);
  }, []);

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

  // 오늘 일정
  const todayEvents = useMemo(() => getEventsForDate(events, today), [events, today]);

  const goToPrevMonth = () => {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
  };
  const goToNextMonth = () => {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
  };

  return (
    <Widget title="캘린더" icon={<CalendarDays size={14} />}>
      <div className="flex flex-col gap-2 h-full">
        {/* 미니 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={goToPrevMonth} className="p-0.5 text-text-secondary/50 hover:text-text-primary cursor-pointer">
              <ChevronLeft size={12} />
            </button>
            <span className="text-[11px] font-semibold text-text-primary min-w-[60px] text-center">
              {month + 1}월
            </span>
            <button onClick={goToNextMonth} className="p-0.5 text-text-secondary/50 hover:text-text-primary cursor-pointer">
              <ChevronRight size={12} />
            </button>
          </div>
          <button
            onClick={() => setView('schedule')}
            className="text-[10px] text-accent hover:underline cursor-pointer"
          >
            전체 보기
          </button>
        </div>

        {/* 요일 */}
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

        {/* 날짜 그리드 */}
        <div className="grid grid-cols-7 gap-px flex-1">
          {calendarDays.map((day, i) => {
            const hasEvents = events.some((e) => e.startDate <= day.dateStr && e.endDate >= day.dateStr);
            return (
              <div
                key={i}
                className={cn(
                  'flex flex-col items-center justify-center py-0.5 rounded-sm transition-colors relative',
                  day.isCurrentMonth ? '' : 'opacity-25',
                  day.isToday && 'bg-accent/10',
                )}
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
                {hasEvents && !day.isToday && (
                  <div className="w-1 h-1 rounded-full bg-accent/60 mt-0.5" />
                )}
              </div>
            );
          })}
        </div>

        {/* 오늘 일정 미리보기 */}
        {todayEvents.length > 0 && (
          <div className="border-t border-bg-border/30 pt-2 mt-auto">
            <div className="text-[10px] text-text-secondary/50 mb-1">오늘 일정</div>
            <div className="flex flex-col gap-0.5">
              {todayEvents.slice(0, 3).map((ev) => (
                <div key={ev.id} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
                  <span className="text-[10px] text-text-primary truncate">{ev.title}</span>
                </div>
              ))}
              {todayEvents.length > 3 && (
                <span className="text-[10px] text-accent">+{todayEvents.length - 3} 더</span>
              )}
            </div>
          </div>
        )}
      </div>
    </Widget>
  );
}
