import { useMemo } from 'react';
import { useActivityStore } from '@/stores/useActivityStore';
import { dayLabel, addGroupedCount, EMPTY_GROUPED_COUNT, type GroupedCount } from './utils';

export interface BarHoverInfo {
  label: string;
  cell: GroupedCount;
  x: number;
  y: number;
}

interface Props {
  mode: 'hour' | 'day';
  onBarHover?: (info: BarHoverInfo | null) => void;
}

const ACCENT_GRADIENT = 'linear-gradient(to top, rgb(var(--color-accent)) 0%, rgb(var(--color-accent-sub)) 100%)';
// 정점 강조용 — 노란색/액센트 (테마와 분리, 실제 시안 그대로)
const PEAK_GRADIENT = 'linear-gradient(to top, #FDCB6E 0%, #FFE5A0 100%)';

export function GoldenBarChart({ mode, onBarHover }: Props) {
  const grid = useActivityStore((s) => s.statsGrid);

  /** mode 기준으로 24시간(또는 7요일) 분 그룹별 카운트 합산. */
  const buckets = useMemo<GroupedCount[]>(() => {
    if (mode === 'hour') {
      const arr: GroupedCount[] = Array.from({ length: 24 }, () => ({ ...EMPTY_GROUPED_COUNT }));
      for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) arr[h] = addGroupedCount(arr[h], grid[d][h]);
      return arr;
    }
    const arr: GroupedCount[] = Array.from({ length: 7 }, () => ({ ...EMPTY_GROUPED_COUNT }));
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) arr[d] = addGroupedCount(arr[d], grid[d][h]);
    return arr;
  }, [grid, mode]);

  const totals = useMemo(() => buckets.map((b) => b.total), [buckets]);
  const max = Math.max(1, ...totals);
  const peakIdx = totals.indexOf(Math.max(...totals));

  if (mode === 'hour') {
    return (
      <div
        className="grid items-end gap-[3px] relative"
        style={{ gridTemplateColumns: 'repeat(24, 1fr)', height: '130px', paddingBottom: '18px' }}
      >
        {buckets.map((cell, h) => {
          const pct = max > 0 ? (cell.total / max) * 100 : 0;
          // 마우스 위치를 그대로 전달 — 툴팁이 커서를 따라다님 (목업과 동일)
          const reportHover = (e: React.MouseEvent<HTMLDivElement>) =>
            onBarHover?.({ label: `${h}시`, cell, x: e.clientX, y: e.clientY });
          return (
            <div
              key={h}
              className="rounded-t-[3px] cursor-pointer relative path-link-bar"
              style={{
                height: `${Math.max(pct, 2)}%`,
                background: ACCENT_GRADIENT,
                transition: 'opacity 0.15s ease, filter 0.15s ease',
              }}
              onMouseEnter={reportHover}
              onMouseMove={reportHover}
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
      {buckets.map((cell, d) => {
        const pct = max > 0 ? (cell.total / max) * 100 : 0;
        const isPeak = d === peakIdx && cell.total > 0;
        const reportHover = (e: React.MouseEvent<HTMLDivElement>) =>
          onBarHover?.({ label: `${dayLabel(d)}요일`, cell, x: e.clientX, y: e.clientY });
        return (
          <div
            key={d}
            className="rounded-t-[5px] cursor-pointer relative path-link-bar"
            style={{
              height: `${Math.max(pct, 4)}%`,
              background: isPeak ? PEAK_GRADIENT : ACCENT_GRADIENT,
              transition: 'opacity 0.15s ease, filter 0.15s ease',
            }}
            onMouseEnter={reportHover}
            onMouseMove={reportHover}
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
