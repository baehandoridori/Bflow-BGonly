import { useMemo, useState } from 'react';

import { resolveIntervalForRange } from '@/features/playground/market/chartSeries';
import { formatWon } from '@/features/playground/market/format';
import { MARKET_INSTRUMENT_PROFILES } from '@/features/playground/market/livePriceEngine';
import { buildMarketDisplayCandles } from '@/features/playground/market/marketDisplaySeries';
import type {
  MarketAdminEvent,
  MarketBarInterval,
  MarketChartRange,
  MarketChartStyle,
  MarketStock,
} from '@/features/playground/market/types';
import { MarketChartCanvas } from './MarketChartCanvas';

interface MarketPriceChartProps {
  stock: MarketStock;
  events: readonly MarketAdminEvent[];
  nowMs: number;
  style: MarketChartStyle;
  interval: MarketBarInterval;
  range: MarketChartRange;
  onStyleChange(style: MarketChartStyle): void;
  onIntervalChange(interval: MarketBarInterval): void;
  onRangeChange(range: MarketChartRange): void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;

const STYLES: ReadonlyArray<{ value: MarketChartStyle; label: string }> = [
  { value: 'line', label: '선' },
  { value: 'candlestick', label: '캔들' },
];

const INTERVALS: ReadonlyArray<{ value: MarketBarInterval; label: string }> = [
  { value: '1m', label: '1분' },
  { value: '5m', label: '5분' },
  { value: '10m', label: '10분' },
  { value: '15m', label: '15분' },
  { value: '1h', label: '1시간' },
  { value: '1d', label: '1일' },
];

const RANGES: ReadonlyArray<{ value: MarketChartRange; label: string }> = [
  { value: 'today', label: '오늘' },
  { value: 'week', label: '1주' },
  { value: 'month', label: '1개월' },
  { value: 'six-months', label: '6개월' },
  { value: 'all', label: '전체' },
];

function chartStartMs(range: MarketChartRange, nowMs: number): number {
  if (range === 'today') {
    return Math.floor((nowMs + KOREA_OFFSET_MS) / DAY_MS) * DAY_MS - KOREA_OFFSET_MS;
  }
  if (range === 'week') return nowMs - 7 * DAY_MS;
  if (range === 'month') return nowMs - 30 * DAY_MS;
  if (range === 'six-months') return nowMs - 180 * DAY_MS;
  return nowMs - 600 * DAY_MS;
}

function intervalLabel(value: MarketBarInterval): string {
  return INTERVALS.find((item) => item.value === value)?.label ?? value;
}

export function MarketPriceChart({
  stock,
  events,
  nowMs,
  style,
  interval,
  range,
  onStyleChange,
  onIntervalChange,
  onRangeChange,
}: MarketPriceChartProps) {
  const [announcement, setAnnouncement] = useState('');
  const profile = MARKET_INSTRUMENT_PROFILES[stock.id];
  const candles = useMemo(() => {
    if (!profile) return [];
    const builtCandles = buildMarketDisplayCandles({
      profile,
      startMs: chartStartMs(range, nowMs),
      endMs: nowMs + 1,
      nowMs,
      events,
      interval,
    });
    const latestCandle = builtCandles.at(-1);
    if (!latestCandle) return builtCandles;
    return [
      ...builtCandles.slice(0, -1),
      {
        ...latestCandle,
        closeWon: stock.referencePriceWon,
        highWon: Math.max(latestCandle.highWon, stock.referencePriceWon),
        lowWon: Math.min(latestCandle.lowWon, stock.referencePriceWon),
      },
    ];
  }, [events, interval, nowMs, profile, range, stock.referencePriceWon]);
  const startPriceWon = candles[0]?.openWon ?? stock.referencePriceWon;
  const currentPriceWon = candles.at(-1)?.closeWon ?? stock.referencePriceWon;

  const selectRange = (nextRange: MarketChartRange) => {
    const effectiveInterval = resolveIntervalForRange(nextRange, interval);
    onRangeChange(nextRange);
    if (effectiveInterval !== interval) {
      onIntervalChange(effectiveInterval);
      setAnnouncement(`${RANGES.find((item) => item.value === nextRange)?.label ?? nextRange} 기간에 맞춰 ${intervalLabel(effectiveInterval)} 간격으로 바꿨어요.`);
    }
  };

  const selectInterval = (requestedInterval: MarketBarInterval) => {
    const effectiveInterval = resolveIntervalForRange(range, requestedInterval);
    onIntervalChange(effectiveInterval);
    setAnnouncement(effectiveInterval === requestedInterval
      ? `${intervalLabel(effectiveInterval)} 간격으로 바꿨어요.`
      : `선택한 기간에는 ${intervalLabel(effectiveInterval)} 간격이 가장 촘촘해요.`);
  };

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-text-secondary">차트 모양</p>
          <div className="mt-2 grid grid-cols-2 gap-2" aria-label="차트 모양">
            {STYLES.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={style === item.value}
                onClick={() => onStyleChange(item.value)}
                className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-4 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <dl className="flex items-end justify-between gap-6 text-sm sm:justify-end">
          <div>
            <dt className="text-xs text-text-secondary">기간 시작</dt>
            <dd className="mt-1 font-semibold tabular-nums text-text-primary">{formatWon(startPriceWon)}</dd>
          </div>
          <div className="text-right">
            <dt className="text-xs text-text-secondary">현재</dt>
            <dd className="mt-1 font-semibold tabular-nums text-text-primary">{formatWon(currentPriceWon)}</dd>
          </div>
        </dl>
      </div>

      {candles.length > 0 ? (
        <div className="mt-4">
          <MarketChartCanvas stockName={stock.name} candles={candles} style={style} />
        </div>
      ) : (
        <div
          role="img"
          aria-label={`${stock.name} 가격 정보가 아직 없어요.`}
          className="mt-4 flex min-h-56 items-center justify-center rounded-2xl border border-dashed border-bg-border bg-bg-primary/40 px-5 text-center text-sm text-text-secondary"
        >
          가격 정보가 아직 없어요
        </div>
      )}

      <div className="mt-5">
        <p className="text-xs font-semibold text-text-secondary">간격</p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="가격 차트 간격">
          {INTERVALS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={interval === item.value}
              onClick={() => selectInterval(item.value)}
              className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-2 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold text-text-secondary">기간</p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="가격 차트 기간">
          {RANGES.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={range === item.value}
              onClick={() => selectRange(item.value)}
              className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-2 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  );
}
