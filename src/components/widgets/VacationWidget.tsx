import { useState, useEffect, useCallback } from 'react';
import { Palmtree, RefreshCw } from 'lucide-react';
import { Widget } from './Widget';
import { useAppStore } from '@/stores/useAppStore';
import { fetchAllVacationEvents } from '@/services/vacationService';
import type { VacationEvent } from '@/types/vacation';
import { cn } from '@/utils/cn';

type ViewMode = 'today' | 'week';

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { start: fmtDate(monday), end: fmtDate(friday) };
}

export function VacationWidget() {
  const vacationConnected = useAppStore((s) => s.vacationConnected);
  const [mode, setMode] = useState<ViewMode>('today');
  const [events, setEvents] = useState<VacationEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!vacationConnected) return;
    setLoading(true);
    try {
      const all = await fetchAllVacationEvents(new Date().getFullYear());
      setEvents(all);
    } catch {
      // non-blocking
    } finally {
      setLoading(false);
    }
  }, [vacationConnected]);

  useEffect(() => { load(); }, [load]);

  const today = fmtDate(new Date());
  const weekRange = getWeekRange();

  const filtered = events.filter((ev) => {
    if (mode === 'today') {
      return ev.startDate <= today && ev.endDate >= today;
    }
    return ev.startDate <= weekRange.end && ev.endDate >= weekRange.start;
  });

  // 중복 제거 (같은 이름 + 같은 타입 + 같은 기간)
  const unique = filtered.reduce<VacationEvent[]>((acc, ev) => {
    if (!acc.some((e) => e.name === ev.name && e.type === ev.type && e.startDate === ev.startDate && e.endDate === ev.endDate)) {
      acc.push(ev);
    }
    return acc;
  }, []);

  return (
    <Widget
      title={mode === 'today' ? '오늘의 휴가자' : '이번주 휴가자'}
      icon={<Palmtree size={14} className="text-emerald-400" />}
      headerRight={
        <div className="flex items-center gap-1">
          <div className="flex bg-bg-border/30 rounded-md p-0.5">
            {(['today', 'week'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-2 py-0.5 rounded text-[9px] font-medium transition-colors cursor-pointer',
                  mode === m ? 'bg-emerald-500/20 text-emerald-400' : 'text-text-secondary/50 hover:text-text-primary',
                )}
              >
                {m === 'today' ? '오늘' : '주간'}
              </button>
            ))}
          </div>
          <button onClick={load} className="p-0.5 text-text-secondary/30 hover:text-text-primary cursor-pointer">
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      }
    >
      {!vacationConnected ? (
        <div className="flex items-center justify-center h-full text-xs text-text-secondary/40">
          휴가 연동이 필요합니다
        </div>
      ) : unique.length === 0 ? (
        <div className="flex items-center justify-center h-full text-xs text-text-secondary/40">
          {mode === 'today' ? '오늘 휴가자가 없습니다' : '이번주 휴가자가 없습니다'}
        </div>
      ) : (
        <div className="space-y-1 px-1 overflow-auto">
          {unique.map((ev, i) => (
            <div
              key={`${ev.name}-${ev.startDate}-${i}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-border/10 transition-colors"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-[12px] text-text-primary font-medium">{ev.name}</span>
              <span className="text-[11px] text-text-secondary/50">{ev.type}</span>
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}
