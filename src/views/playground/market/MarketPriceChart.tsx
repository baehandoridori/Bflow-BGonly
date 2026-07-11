import { useId, useState } from 'react';

import {
  getChartGeometry,
  getChartHoverBands,
} from '@/features/playground/market/domain';
import type {
  MarketPeriod,
  MarketStock,
  MarketTrend,
  PricePoint,
} from '@/features/playground/market/types';

interface MarketPriceChartProps {
  stock: MarketStock;
  period: MarketPeriod;
  onPeriodChange(period: MarketPeriod): void;
}

const PERIODS: Array<{ value: MarketPeriod; label: string }> = [
  { value: 'today', label: '오늘' },
  { value: 'week', label: '1주' },
  { value: 'month', label: '1개월' },
  { value: 'all', label: '전체' },
];

const CHART_WIDTH = 720;
const CHART_HEIGHT = 280;
const VISUAL_PADDING = 12;

function formatPoints(points: number): string {
  return `${points.toLocaleString('ko-KR')}P`;
}

function trendForSeries(series: PricePoint[]): MarketTrend {
  const first = series[0]?.pricePoints;
  const current = series.at(-1)?.pricePoints;
  if (first === undefined || current === undefined || first === current) return 'flat';
  return current > first ? 'up' : 'down';
}

function trendClass(trend: MarketTrend): string {
  if (trend === 'up') return 'text-market-up';
  if (trend === 'down') return 'text-market-down';
  return 'text-market-flat';
}

function trendSentence(trend: MarketTrend, start: number, current: number): string {
  const difference = Math.abs(current - start);
  if (trend === 'up') return `${formatPoints(difference)} 상승했어요.`;
  if (trend === 'down') return `${formatPoints(difference)} 하락했어요.`;
  return '가격 변화 없이 보합이에요.';
}

function formatHoveredTime(point: PricePoint, period: MarketPeriod): string {
  const date = new Date(point.at);
  if (Number.isNaN(date.getTime())) return point.at;
  return new Intl.DateTimeFormat('ko-KR', period === 'today'
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' }).format(date);
}

export function MarketPriceChart({ stock, period, onPeriodChange }: MarketPriceChartProps) {
  const gradientId = `market-price-${useId().replace(/:/g, '')}`;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const series = stock.series[period];
  const periodLabel = PERIODS.find((item) => item.value === period)?.label ?? period;

  const tabs = (
    <div className="grid grid-cols-4 gap-2" aria-label="가격 그래프 기간">
      {PERIODS.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={period === item.value}
          onClick={() => {
            setHoveredIndex(null);
            onPeriodChange(item.value);
          }}
          className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-2 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  if (series.length === 0) {
    return (
      <div>
        {tabs}
        <div
          role="img"
          aria-label={`${stock.name} ${periodLabel} 가격 정보가 아직 없어요.`}
          className="mt-4 flex min-h-56 items-center justify-center rounded-2xl border border-dashed border-bg-border bg-bg-primary/40 px-5 text-center text-sm text-text-secondary"
        >
          가격 정보가 아직 없어요
        </div>
      </div>
    );
  }

  const rawGeometry = getChartGeometry(stock.series[period], 720, 280);
  const geometry = rawGeometry.map((point) => ({
    x: VISUAL_PADDING + (point.x / CHART_WIDTH) * (CHART_WIDTH - VISUAL_PADDING * 2),
    y: VISUAL_PADDING + (point.y / CHART_HEIGHT) * (CHART_HEIGHT - VISUAL_PADDING * 2),
  }));
  const startPrice = series[0].pricePoints;
  const currentPrice = series.at(-1)?.pricePoints ?? startPrice;
  const trend = trendForSeries(series);
  const colorClass = trendClass(trend);
  const linePath = geometry.map((point, index) => (
    `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  )).join(' ');
  const areaPath = geometry.length > 1
    ? `${linePath} L ${geometry.at(-1)!.x.toFixed(2)} ${(CHART_HEIGHT - VISUAL_PADDING).toFixed(2)} L ${geometry[0].x.toFixed(2)} ${(CHART_HEIGHT - VISUAL_PADDING).toFixed(2)} Z`
    : '';
  const hoveredPoint = hoveredIndex === null ? null : series[hoveredIndex];
  const hoverBands = getChartHoverBands(geometry, CHART_WIDTH);
  const ariaLabel = `${stock.name} ${periodLabel} 가격 그래프. 시작 가격 ${formatPoints(startPrice)}, 현재 가격 ${formatPoints(currentPrice)}. ${trendSentence(trend, startPrice, currentPrice)}`;

  return (
    <div>
      {tabs}
      <div className="mt-4 flex items-end justify-between gap-4 text-sm">
        <div>
          <p className="text-xs text-text-secondary">기간 시작 가격</p>
          <p className="mt-1 font-semibold tabular-nums text-text-primary">{formatPoints(startPrice)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-text-secondary">현재 가격</p>
          <p className="mt-1 font-semibold tabular-nums text-text-primary">{formatPoints(currentPrice)}</p>
        </div>
      </div>

      <div className={`mt-3 overflow-hidden rounded-2xl border border-bg-border bg-bg-primary/40 p-2 ${colorClass}`}>
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label={ariaLabel}
          className="block h-auto w-full max-w-full"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <title>{ariaLabel}</title>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} aria-hidden="true" />}
          {geometry.length === 1 ? (
            <circle
              cx={geometry[0].x}
              cy={geometry[0].y}
              r="6"
              fill="currentColor"
              aria-hidden="true"
            />
          ) : (
            <path
              d={linePath}
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              aria-hidden="true"
            />
          )}

          {series.map((point, index) => point.newsId ? (
            <g key={point.newsId} className="pointer-events-none text-accent-sub" aria-hidden="true">
              <line
                x1={geometry[index].x}
                x2={geometry[index].x}
                y1={VISUAL_PADDING}
                y2={CHART_HEIGHT - VISUAL_PADDING}
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="5 6"
                opacity="0.7"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={geometry[index].x} cy={geometry[index].y} r="7" fill="currentColor" />
            </g>
          ) : null)}

          {series.map((point, index) => (
            <rect
              key={`${point.at}-${index}`}
              x={hoverBands[index].x}
              y="0"
              width={hoverBands[index].width}
              height={CHART_HEIGHT}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(index)}
              onPointerDown={() => setHoveredIndex(index)}
              aria-hidden="true"
            />
          ))}
        </svg>
      </div>

      <p className="mt-2 min-h-6 text-sm text-text-secondary" aria-live="polite">
        {hoveredPoint
          ? `${formatHoveredTime(hoveredPoint, period)} · ${formatPoints(hoveredPoint.pricePoints)}${hoveredPoint.newsId ? ' · 소식이 공개된 시점' : ''}`
          : '그래프 위를 가리키면 그때의 가격을 볼 수 있어요.'}
      </p>
    </div>
  );
}
