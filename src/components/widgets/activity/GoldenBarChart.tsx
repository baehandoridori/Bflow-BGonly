import { useMemo } from 'react';
import { useActivityStore } from '@/stores/useActivityStore';
import { dayLabel } from './utils';

interface Props {
  mode: 'hour' | 'day';
  onBarHover?: (info: { label: string; count: number; x: number; y: number } | null) => void;
}

export function GoldenBarChart({ mode, onBarHover }: Props) {
  const grid = useActivityStore((s) => s.statsGrid);

  const totals = useMemo(() => {
    if (mode === 'hour') {
      const arr = new Array(24).fill(0);
      for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) arr[h] += grid[d][h];
      return arr;
    } else {
      const arr = new Array(7).fill(0);
      for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) arr[d] += grid[d][h];
      return arr;
    }
  }, [grid, mode]);

  const max = Math.max(1, ...totals);
  const peakIdx = totals.indexOf(Math.max(...totals));

  if (mode === 'hour') {
    return (
      <div
        className="grid items-end gap-[3px] relative"
        style={{ gridTemplateColumns: 'repeat(24, 1fr)', height: '130px', paddingBottom: '18px' }}
      >
        {totals.map((count, h) => {
          const pct = max > 0 ? (count / max) * 100 : 0;
          return (
            <div
              key={h}
              className="rounded-t-[3px] cursor-pointer transition-opacity hover:opacity-80 relative"
              style={{
                height: `${Math.max(pct, 2)}%`,
                background: 'linear-gradient(to top, #6C5CE7 0%, #A29BFE 100%)',
              }}
              onMouseEnter={(e) =>
                onBarHover?.({ label: `${h}시`, count, x: e.clientX, y: e.clientY })
              }
              onMouseLeave={() => onBarHover?.(null)}
            >
              {[0, 6, 12, 18].includes(h) && (
                <span className="absolute left-1/2 -translate-x-1/2 -bottom-4 text-[8.5px] text-text-secondary/50">
                  {h}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // mode === 'day'
  return (
    <div
      className="grid items-end gap-3 px-3"
      style={{ gridTemplateColumns: 'repeat(7, 1fr)', height: '130px', paddingBottom: '22px' }}
    >
      {totals.map((count, d) => {
        const pct = max > 0 ? (count / max) * 100 : 0;
        const isPeak = d === peakIdx && count > 0;
        return (
          <div
            key={d}
            className="rounded-t-[5px] cursor-pointer transition-opacity hover:opacity-85 relative"
            style={{
              height: `${Math.max(pct, 4)}%`,
              background: isPeak
                ? 'linear-gradient(to top, #FDCB6E 0%, #FFE5A0 100%)'
                : 'linear-gradient(to top, #6C5CE7 0%, #A29BFE 100%)',
            }}
            onMouseEnter={(e) =>
              onBarHover?.({ label: `${dayLabel(d)}요일`, count, x: e.clientX, y: e.clientY })
            }
            onMouseLeave={() => onBarHover?.(null)}
          >
            <span className="absolute left-1/2 -translate-x-1/2 -bottom-5 text-[11px] text-text-secondary">
              {dayLabel(d)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
