import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/cn';
import type { CalendarEvent } from '@/types/calendar';

// ─── Props ───────────────────────────────────────
export interface MiniCalendarProps {
  currentMonth: Date;
  onMonthChange: (month: Date) => void;
  onDateSelect: (dateStr: string) => void;
  events: CalendarEvent[];
  activeWeekStart?: string; // YYYY-MM-DD (Sunday of the active week)
  selectedDate?: string;
}

// ─── Utility functions ───────────────────────────
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ─── Component ───────────────────────────────────
export function MiniCalendar({
  currentMonth,
  onMonthChange,
  onDateSelect,
  events,
  activeWeekStart,
  selectedDate,
}: MiniCalendarProps) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const today = fmtDate(new Date());

  // Active week range (Sunday ~ Saturday)
  const activeWeekRange = useMemo(() => {
    if (!activeWeekStart) return null;
    const [y, m, d] = activeWeekStart.split('-').map(Number);
    const start = new Date(y, m - 1, d, 12);
    const end = addDays(start, 6);
    return { start: fmtDate(start), end: fmtDate(end) };
  }, [activeWeekStart]);

  // Build calendar grid (42 cells = 6 rows x 7 cols)
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const days: {
      date: number;
      dateStr: string;
      isCurrentMonth: boolean;
      isToday: boolean;
      dow: number;
    }[] = [];

    // Previous month fill
    const prevMonthLast = new Date(year, month, 0).getDate();
    for (let i = startDow - 1; i >= 0; i--) {
      const d = prevMonthLast - i;
      const ds = fmtDate(new Date(year, month - 1, d));
      days.push({ date: d, dateStr: ds, isCurrentMonth: false, isToday: false, dow: days.length % 7 });
    }

    // Current month
    for (let d = 1; d <= totalDays; d++) {
      const ds = fmtDate(new Date(year, month, d));
      days.push({ date: d, dateStr: ds, isCurrentMonth: true, isToday: ds === today, dow: days.length % 7 });
    }

    // Next month fill (up to 42 cells)
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const ds = fmtDate(new Date(year, month + 1, d));
      days.push({ date: d, dateStr: ds, isCurrentMonth: false, isToday: false, dow: days.length % 7 });
    }

    return days;
  }, [year, month, today]);

  // Build event lookup map: dateStr -> CalendarEvent[]
  const eventMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      // Expand event across its date range
      const [sy, sm, sd] = ev.startDate.split('-').map(Number);
      const [ey, em, ed] = ev.endDate.split('-').map(Number);
      const start = new Date(sy, sm - 1, sd, 12);
      const end = new Date(ey, em - 1, ed, 12);
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = fmtDate(cursor);
        const arr = map.get(key);
        if (arr) arr.push(ev);
        else map.set(key, [ev]);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [events]);

  const goToPrevMonth = () => {
    onMonthChange(new Date(year, month - 1, 1));
  };
  const goToNextMonth = () => {
    onMonthChange(new Date(year, month + 1, 1));
  };

  const monthKey = `${year}-${month}`;

  return (
    <div className="flex flex-col gap-1 select-none" style={{ minWidth: 160 }}>
      {/* Header: navigation + month/year */}
      <div className="flex items-center justify-between px-0.5">
        <button
          onClick={goToPrevMonth}
          className="p-0.5 rounded hover:bg-bg-border/60 text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[11px] font-semibold text-text-primary tabular-nums">
          {year}년 {month + 1}월
        </span>
        <button
          onClick={goToNextMonth}
          className="p-0.5 rounded hover:bg-bg-border/60 text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className={cn(
              'text-center text-[9px] font-medium py-0.5',
              i === 0 ? 'text-[#E17055]/60' : i === 6 ? 'text-[#74B9FF]/60' : 'text-text-secondary/70',
            )}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid with month transition */}
      <AnimatePresence mode="wait">
        <motion.div
          key={monthKey}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="grid grid-cols-7 gap-px"
        >
          {calendarDays.map((day, i) => {
            const dayEvents = eventMap.get(day.dateStr) ?? [];
            const dotEvents = dayEvents.slice(0, 3);
            const isSelected = selectedDate === day.dateStr;
            const isInActiveWeek =
              activeWeekRange != null &&
              day.dateStr >= activeWeekRange.start &&
              day.dateStr <= activeWeekRange.end;

            return (
              <div
                key={i}
                onClick={() => onDateSelect(day.dateStr)}
                className={cn(
                  'flex flex-col items-center justify-center py-[3px] rounded-sm transition-colors cursor-pointer relative',
                  // Dimmed for non-current month
                  !day.isCurrentMonth && 'opacity-30',
                  // Active week highlight
                  isInActiveWeek && day.isCurrentMonth && 'bg-accent/[0.08]',
                  // Hover
                  day.isCurrentMonth && 'hover:bg-bg-border/40',
                  // Selected ring
                  isSelected && 'ring-1 ring-accent/50',
                )}
              >
                <span
                  className={cn(
                    'text-[10px] tabular-nums leading-none flex items-center justify-center',
                    // Today: accent circle
                    day.isToday
                      ? 'bg-accent text-on-accent w-[18px] h-[18px] rounded-full text-[9px] font-bold'
                      : day.dow === 0
                        ? 'text-[#E17055]/70'
                        : day.dow === 6
                          ? 'text-[#74B9FF]/70'
                          : 'text-text-primary/70',
                  )}
                >
                  {day.date}
                </span>

                {/* Event dots (max 3) */}
                {dotEvents.length > 0 && !day.isToday && (
                  <div className="flex items-center gap-[2px] mt-[2px]">
                    {dotEvents.map((ev, idx) => (
                      <div
                        key={`${ev.id}-${idx}`}
                        className="w-[3px] h-[3px] rounded-full"
                        style={{ backgroundColor: `${ev.color}A0` }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
