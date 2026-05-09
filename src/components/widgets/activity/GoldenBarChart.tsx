import { useMemo, useState } from 'react';
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
// 정점 강조용 — 노란색/액센트 (테마와 분리)
const PEAK_GRADIENT = 'linear-gradient(to top, #FDCB6E 0%, #FFE5A0 100%)';

type ChartShape = 'bar' | 'line';
const CHART_SHAPE_KEY = 'bflow_activity_chart_shape';

function loadChartShape(): ChartShape {
  try {
    const v = localStorage.getItem(CHART_SHAPE_KEY) as ChartShape | null;
    if (v === 'bar' || v === 'line') return v;
  } catch { /* ignore */ }
  return 'bar';
}

export function GoldenBarChart({ mode, onBarHover }: Props) {
  const grid = useActivityStore((s) => s.statsGrid);
  // v1.23.3 (#4): 막대 / 선 토글
  const [chartShape, setChartShape] = useState<ChartShape>(loadChartShape);
  const handleSetShape = (s: ChartShape) => {
    try { localStorage.setItem(CHART_SHAPE_KEY, s); } catch { /* ignore */ }
    setChartShape(s);
  };

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

  const hourLabel = (h: number) => `${h}시`;
  const dayLabelOf = (d: number) => `${dayLabel(d)}요일`;
  const tooltipLabel = (i: number) => mode === 'hour' ? hourLabel(i) : dayLabelOf(i);

  return (
    <div className="relative">
      {/* v1.23.3 (#4): 막대/선 토글 — 우상단 작게 */}
      <div className="absolute -top-1 right-0 z-10 flex gap-[2px] bg-bg-border/40 p-[2px] rounded-md">
        <ShapeButton active={chartShape === 'bar'} onClick={() => handleSetShape('bar')} label="막대" />
        <ShapeButton active={chartShape === 'line'} onClick={() => handleSetShape('line')} label="선" />
      </div>

      {chartShape === 'bar' ? (
        mode === 'hour' ? (
          <BarHourChart buckets={buckets} totals={totals} max={max} peakIdx={peakIdx} onBarHover={onBarHover} tooltipLabel={tooltipLabel} />
        ) : (
          <BarDayChart buckets={buckets} totals={totals} max={max} peakIdx={peakIdx} onBarHover={onBarHover} tooltipLabel={tooltipLabel} />
        )
      ) : (
        <LineAreaChart
          mode={mode}
          buckets={buckets}
          totals={totals}
          max={max}
          peakIdx={peakIdx}
          onBarHover={onBarHover}
          tooltipLabel={tooltipLabel}
        />
      )}
    </div>
  );
}

function ShapeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded-[4px] text-[9.5px] cursor-pointer transition-all ${
        active ? 'bg-accent/22 text-accent-sub' : 'text-text-secondary hover:text-text-primary'
      }`}
      style={active ? { boxShadow: 'inset 0 0 0 1px rgba(108, 92, 231, 0.32)' } : {}}
    >
      {label}
    </button>
  );
}

// ─── 막대 ───
function BarHourChart({ buckets, max, peakIdx, onBarHover, tooltipLabel }: {
  buckets: GroupedCount[]; totals: number[]; max: number; peakIdx: number;
  onBarHover?: (info: BarHoverInfo | null) => void;
  tooltipLabel: (i: number) => string;
}) {
  return (
    <div
      className="grid items-end gap-[3px] relative"
      style={{ gridTemplateColumns: 'repeat(24, 1fr)', height: '130px', paddingBottom: '18px' }}
    >
      {buckets.map((cell, h) => {
        const pct = max > 0 ? (cell.total / max) * 100 : 0;
        const isPeak = h === peakIdx && cell.total > 0;
        const reportHover = (e: React.MouseEvent<HTMLDivElement>) =>
          onBarHover?.({ label: tooltipLabel(h), cell, x: e.clientX, y: e.clientY });
        return (
          <div
            key={h}
            className={`rounded-t-[3px] cursor-pointer relative path-link-bar ${isPeak ? 'bflow-peak-pulse' : ''}`}
            style={{
              height: `${Math.max(pct, 2)}%`,
              background: isPeak ? PEAK_GRADIENT : ACCENT_GRADIENT,
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

function BarDayChart({ buckets, max, peakIdx, onBarHover }: {
  buckets: GroupedCount[]; totals: number[]; max: number; peakIdx: number;
  onBarHover?: (info: BarHoverInfo | null) => void;
  tooltipLabel: (i: number) => string;
}) {
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
            className={`rounded-t-[5px] cursor-pointer relative path-link-bar ${isPeak ? 'bflow-peak-pulse' : ''}`}
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

// ─── 선 그래프 (영역 채움 + 정점 펄스) ───
function LineAreaChart({ mode, buckets, totals, max, peakIdx, onBarHover, tooltipLabel }: {
  mode: 'hour' | 'day';
  buckets: GroupedCount[];
  totals: number[];
  max: number;
  peakIdx: number;
  onBarHover?: (info: BarHoverInfo | null) => void;
  tooltipLabel: (i: number) => string;
}) {
  const W = 1000; // viewBox 가상 좌표
  const H = 200;
  const PADDING_BOTTOM = 30;
  const PADDING_TOP = 20;
  const usableH = H - PADDING_BOTTOM - PADDING_TOP;
  const n = totals.length;
  const stepX = W / Math.max(1, n - 1);

  const points = totals.map((v, i) => {
    const x = i * stepX;
    const y = PADDING_TOP + usableH * (1 - v / max);
    return { x, y, value: v, idx: i };
  });

  // v1.23.4 (#1 한솔 보고): 곡선이 어색 → 각 점을 단순 직선으로 연결 (polyline).
  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  }, [points]);

  const areaPath = useMemo(() => {
    if (points.length === 0) return '';
    return `${linePath} L ${points[n - 1].x.toFixed(1)} ${(H - PADDING_BOTTOM).toFixed(1)} L ${points[0].x.toFixed(1)} ${(H - PADDING_BOTTOM).toFixed(1)} Z`;
  }, [linePath, points, n]);

  const hoverPoint = (e: React.MouseEvent<SVGRectElement>, i: number) => {
    onBarHover?.({ label: tooltipLabel(i), cell: buckets[i], x: e.clientX, y: e.clientY });
  };

  const xLabels: number[] = mode === 'hour' ? [0, 6, 12, 18] : [0, 1, 2, 3, 4, 5, 6];

  return (
    <div className="relative" style={{ height: '160px' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-full overflow-visible"
      >
        <defs>
          <linearGradient id="bflow-line-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--color-accent-sub))" stopOpacity="0.55" />
            <stop offset="100%" stopColor="rgb(var(--color-accent))" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="bflow-line-stroke" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--color-accent-sub))" />
            <stop offset="100%" stopColor="rgb(var(--color-accent))" />
          </linearGradient>
        </defs>

        {/* 영역 채움 */}
        <path d={areaPath} fill="url(#bflow-line-area)" />
        {/* 선 */}
        <path d={linePath} fill="none" stroke="url(#bflow-line-stroke)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* 정점 펄스 */}
        {peakIdx >= 0 && totals[peakIdx] > 0 && (
          <g transform={`translate(${points[peakIdx].x.toFixed(1)},${points[peakIdx].y.toFixed(1)})`}>
            <circle r="6" fill="#FDCB6E" opacity="0.35">
              <animate attributeName="r" values="6;14;6" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;0.05;0.35" dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle r="4.5" fill="#FFE5A0" stroke="#FDCB6E" strokeWidth="1.5" />
          </g>
        )}

        {/* 점 dot — 일반 */}
        {points.map((p, i) => (
          i !== peakIdx && p.value > 0 ? (
            <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="rgb(var(--color-accent-sub))" />
          ) : null
        ))}

        {/* 호버 영역 — 투명한 col rect */}
        {points.map((p, i) => (
          <rect
            key={`hover-${i}`}
            x={Math.max(0, p.x - stepX / 2)}
            y={0}
            width={stepX}
            height={H - PADDING_BOTTOM}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={(e) => hoverPoint(e, i)}
            onMouseMove={(e) => hoverPoint(e, i)}
            onMouseLeave={() => onBarHover?.(null)}
          />
        ))}

        {/* X 라벨 */}
        {xLabels.map((i) => {
          const p = points[i];
          if (!p) return null;
          return (
            <text
              key={`x-${i}`}
              x={p.x}
              y={H - 8}
              textAnchor="middle"
              fontSize="11"
              fill="rgb(var(--color-text-secondary) / 0.55)"
            >
              {mode === 'hour' ? i : dayLabel(i)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
