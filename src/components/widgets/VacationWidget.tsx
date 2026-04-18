import { useState, useEffect, useCallback } from 'react';
import { Palmtree, RefreshCw } from 'lucide-react';
import { Widget } from './Widget';
import { useAppStore } from '@/stores/useAppStore';
import { fetchAllVacationEvents } from '@/services/vacationService';
import type { VacationEvent } from '@/types/vacation';
import { useVacationPendingStore, type PendingVacationEvent } from '@/stores/useVacationPendingStore';
import { cn } from '@/utils/cn';

type DisplayEvent = VacationEvent | PendingVacationEvent;

function isPending(ev: DisplayEvent): ev is PendingVacationEvent {
  return (ev as PendingVacationEvent).status === 'pending';
}

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
  const pending = useVacationPendingStore((s) => s.pending);
  const pendingHydrated = useVacationPendingStore((s) => s.hydrated);
  const hydratePending = useVacationPendingStore((s) => s.hydrate);

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

  // pending 스토어 하이드레이트 (팝업/메인 둘 다 안전하게)
  useEffect(() => {
    if (!pendingHydrated) { hydratePending(); }
  }, [pendingHydrated, hydratePending]);

  const today = fmtDate(new Date());
  const weekRange = getWeekRange();

  // pending + 실제 이벤트 병합
  const combined: DisplayEvent[] = [...events, ...pending];

  const filtered = combined.filter((ev) => {
    if (mode === 'today') {
      return ev.startDate <= today && ev.endDate >= today;
    }
    return ev.startDate <= weekRange.end && ev.endDate >= weekRange.start;
  });

  // 중복 제거 (같은 이름 + 같은 타입 + 같은 기간) — pending 우선 유지
  const unique = filtered.reduce<DisplayEvent[]>((acc, ev) => {
    const dupIdx = acc.findIndex((e) => e.name === ev.name && e.type === ev.type && e.startDate === ev.startDate && e.endDate === ev.endDate);
    if (dupIdx === -1) {
      acc.push(ev);
    } else if (isPending(ev) && !isPending(acc[dupIdx])) {
      // 같은 항목이 pending + 서버 둘 다 있으면 pending 쪽을 유지 (등록 중 표시 우선)
      acc[dupIdx] = ev;
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
          {unique.map((ev, i) => {
            const isP = isPending(ev);
            const key = isP ? ev.pendingId : `${ev.name}-${ev.startDate}-${i}`;
            return (
              <div
                key={key}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors',
                  isP
                    ? 'bg-amber-400/20 border border-amber-400/60'
                    : 'hover:bg-bg-border/10',
                )}
              >
                <div className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  isP ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400',
                )} />
                <span className={cn(
                  'text-[12px] font-medium',
                  isP ? 'text-amber-200' : 'text-text-primary',
                )}>{ev.name}</span>
                <span className={cn(
                  'text-[11px]',
                  isP ? 'text-amber-200/70' : 'text-text-secondary/50',
                )}>{ev.type}</span>
                {isP && (
                  <span className="ml-auto text-[9px] text-amber-300/80 font-semibold">등록 중...</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}
