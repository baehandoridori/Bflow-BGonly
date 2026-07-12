import { useEffect, useMemo, useState } from 'react';

import { resolveIntervalForRange } from '@/features/playground/market/chartSeries';
import { formatShares, formatWon } from '@/features/playground/market/format';
import { MARKET_INSTRUMENT_PROFILES } from '@/features/playground/market/livePriceEngine';
import { MAX_MARKET_CHART_BARS } from '@/features/playground/market/marketChartUi';
import {
  buildMarketDisplayCandles,
  buildMarketDisplayCandlesProgressively,
  marketDisplayEventsFingerprint,
  selectCausalMarketEvents,
  splitMarketDisplayRange,
} from '@/features/playground/market/marketDisplaySeries';
import type {
  MarketAdminEvent,
  MarketBarInterval,
  MarketCandle,
  MarketChartRange,
  MarketChartStyle,
  MarketStock,
} from '@/features/playground/market/types';
import { MarketInteractiveChart } from './MarketInteractiveChart';

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

interface ProgressiveSeriesState {
  requestKey: string;
  candles: MarketCandle[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;

const INTERVAL_OPTIONS = [
  ['1m', '1분'], ['5m', '5분'], ['10m', '10분'],
  ['15m', '15분'], ['1h', '1시간'], ['1d', '1일'],
] as const;
const RANGE_OPTIONS = [
  ['today', '오늘'], ['week', '1주'], ['month', '1개월'],
  ['six-months', '6개월'], ['all', '전체'],
] as const;
const STYLE_OPTIONS = [['line', '선'], ['candlestick', '캔들']] as const;
const SELECT_CLASS_NAME = 'mt-2 min-h-11 w-full cursor-pointer rounded-xl border border-bg-border bg-bg-primary/55 px-3 py-2 text-sm font-semibold text-text-primary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

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
  return INTERVAL_OPTIONS.find(([option]) => option === value)?.[1] ?? value;
}

function rangeLabel(value: MarketChartRange): string {
  return RANGE_OPTIONS.find(([option]) => option === value)?.[1] ?? value;
}

function formatSelectedCandle(
  stockName: string,
  candle: MarketCandle | null,
): string {
  if (!candle) return `${stockName} 가격 정보가 아직 없어요.`;
  const parsed = new Date(candle.startsAt);
  const time = Number.isNaN(parsed.getTime())
    ? candle.startsAt
    : new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(parsed);
  return `${stockName} · 시간 ${time} · 시가 ${formatWon(candle.openWon)} · 고가 ${formatWon(candle.highWon)} · 저가 ${formatWon(candle.lowWon)} · 종가 ${formatWon(candle.closeWon)} · 거래량 ${formatShares(candle.volumeShares)}`;
}

function progressiveSeriesRequestKey(
  segment: 'leading' | 'historical',
  stockId: string,
  interval: MarketBarInterval,
  range: MarketChartRange,
  startMs: number,
  endMs: number,
  events: readonly MarketAdminEvent[],
): string {
  return [
    segment,
    stockId,
    interval,
    range,
    startMs,
    endMs,
    marketDisplayEventsFingerprint(events),
  ].join('::');
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
  const [selectedCandleStartsAt, setSelectedCandleStartsAt] = useState<string | null>(null);
  const [selectedCandleAnnouncement, setSelectedCandleAnnouncement] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [leadingState, setLeadingState] = useState<ProgressiveSeriesState>({
    requestKey: '',
    candles: [],
  });
  const [historicalState, setHistoricalState] = useState<ProgressiveSeriesState>({
    requestKey: '',
    candles: [],
  });
  const profile = MARKET_INSTRUMENT_PROFILES[stock.id];
  const chartRangeStartMs = chartStartMs(range, nowMs);
  const segments = splitMarketDisplayRange(chartRangeStartMs, nowMs);
  const leadingEvents = selectCausalMarketEvents(events, stock.id, segments.leading.endMs);
  const historicalEvents = selectCausalMarketEvents(
    events,
    stock.id,
    segments.historical.endMs,
  );
  const currentEvents = selectCausalMarketEvents(events, stock.id, segments.current.endMs);
  const currentEventsFingerprint = marketDisplayEventsFingerprint(currentEvents);
  const leadingRequestKey = progressiveSeriesRequestKey(
    'leading',
    stock.id,
    interval,
    range,
    segments.leading.startMs,
    segments.leading.endMs,
    leadingEvents,
  );
  const historicalRequestKey = progressiveSeriesRequestKey(
    'historical',
    stock.id,
    interval,
    range,
    segments.historical.startMs,
    segments.historical.endMs,
    historicalEvents,
  );

  useEffect(() => {
    if (!profile) return undefined;
    const controller = new AbortController();
    void buildMarketDisplayCandlesProgressively({
      profile,
      ...segments.leading,
      nowMs: segments.leading.endMs,
      events: leadingEvents,
      interval,
    }, {
      signal: controller.signal,
      onProgress: (nextCandles) => {
        if (!controller.signal.aborted) {
          setLeadingState({
            requestKey: leadingRequestKey,
            candles: [...nextCandles],
          });
        }
      },
    }).then((nextCandles) => {
      if (!controller.signal.aborted) {
        setLeadingState({
          requestKey: leadingRequestKey,
          candles: nextCandles,
        });
      }
    });
    return () => controller.abort();
  }, [
    interval,
    leadingRequestKey,
    profile,
    segments.leading.endMs,
    segments.leading.startMs,
  ]);

  useEffect(() => {
    if (!profile) return undefined;
    const controller = new AbortController();
    void buildMarketDisplayCandlesProgressively({
      profile,
      ...segments.historical,
      nowMs: segments.historical.endMs,
      events: historicalEvents,
      interval,
    }, {
      signal: controller.signal,
      onProgress: (nextCandles) => {
        if (!controller.signal.aborted) {
          setHistoricalState({
            requestKey: historicalRequestKey,
            candles: [...nextCandles],
          });
        }
      },
    }).then((nextCandles) => {
      if (!controller.signal.aborted) {
        setHistoricalState({
          requestKey: historicalRequestKey,
          candles: nextCandles,
        });
      }
    });
    return () => controller.abort();
  }, [
    historicalRequestKey,
    interval,
    profile,
    segments.historical.endMs,
    segments.historical.startMs,
  ]);

  const currentCandles = useMemo(() => {
    if (!profile) return [];
    return buildMarketDisplayCandles({
      profile,
      ...segments.current,
      nowMs,
      events: currentEvents,
      interval,
    });
  }, [
    currentEventsFingerprint,
    interval,
    nowMs,
    profile,
    segments.current.endMs,
    segments.current.startMs,
  ]);
  const leadingCandles = leadingState.requestKey === leadingRequestKey
    ? leadingState.candles
    : [];
  const historicalCandles = historicalState.requestKey === historicalRequestKey
    ? historicalState.candles
    : [];
  const builtCandles = useMemo(() => [
    ...leadingCandles,
    ...historicalCandles,
    ...currentCandles,
  ].slice(-MAX_MARKET_CHART_BARS), [currentCandles, historicalCandles, leadingCandles]);
  const candles = useMemo(() => {
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
  }, [builtCandles, stock.referencePriceWon]);
  const startPriceWon = candles[0]?.openWon ?? stock.referencePriceWon;
  const currentPriceWon = candles.at(-1)?.closeWon ?? stock.referencePriceWon;
  const selectedCandle = selectedCandleStartsAt
    ? candles.find((candle) => candle.startsAt === selectedCandleStartsAt) ?? candles.at(-1) ?? null
    : candles.at(-1) ?? null;
  const selectedCandleSummary = formatSelectedCandle(stock.name, selectedCandle);

  useEffect(() => {
    setSelectedCandleStartsAt(null);
    setSelectedCandleAnnouncement('');
  }, [interval, range, stock.id]);

  const selectRange = (nextRange: MarketChartRange) => {
    const effectiveInterval = resolveIntervalForRange(nextRange, interval);
    onRangeChange(nextRange);
    if (effectiveInterval !== interval) {
      onIntervalChange(effectiveInterval);
      setAnnouncement(`${rangeLabel(nextRange)} 기간에 맞춰 ${intervalLabel(effectiveInterval)} 간격으로 바꿨어요.`);
    } else {
      setAnnouncement(`${rangeLabel(nextRange)} 기간으로 바꿨어요.`);
    }
  };

  const selectInterval = (requestedInterval: MarketBarInterval) => {
    const effectiveInterval = resolveIntervalForRange(range, requestedInterval);
    onIntervalChange(effectiveInterval);
    setAnnouncement(effectiveInterval === requestedInterval
      ? `${intervalLabel(effectiveInterval)} 간격으로 바꿨어요.`
      : `선택한 기간에는 ${intervalLabel(effectiveInterval)} 간격이 가장 촘촘해요.`);
  };

  const selectCandle = (nextCandle: MarketCandle | null) => {
    setSelectedCandleStartsAt(nextCandle?.startsAt ?? null);
    if (nextCandle) {
      setSelectedCandleAnnouncement(formatSelectedCandle(stock.name, nextCandle));
    }
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-6">
        <p className="text-sm leading-6 text-text-secondary">
          휠로 확대하고 드래그로 이동할 수 있어요.
        </p>
        <dl className="flex shrink-0 items-end gap-6 text-sm">
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

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="market-chart-style" className="text-xs font-semibold text-text-secondary">차트 모양</label>
          <select
            id="market-chart-style"
            aria-label="차트 모양"
            value={style}
            onChange={(event) => onStyleChange(event.currentTarget.value as MarketChartStyle)}
            className={SELECT_CLASS_NAME}
          >
            {STYLE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="market-chart-interval" className="text-xs font-semibold text-text-secondary">간격</label>
          <select
            id="market-chart-interval"
            aria-label="간격"
            value={interval}
            onChange={(event) => selectInterval(event.currentTarget.value as MarketBarInterval)}
            className={SELECT_CLASS_NAME}
          >
            {INTERVAL_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="market-chart-range" className="text-xs font-semibold text-text-secondary">기간</label>
          <select
            id="market-chart-range"
            aria-label="기간"
            value={range}
            onChange={(event) => selectRange(event.currentTarget.value as MarketChartRange)}
            className={SELECT_CLASS_NAME}
          >
            {RANGE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => {
              setSelectedCandleStartsAt(null);
              setResetKey((previous) => previous + 1);
              setAnnouncement('차트를 현재 기간 전체에 맞췄어요.');
            }}
            className="min-h-11 w-full rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            차트 초기화
          </button>
        </div>
      </div>

      {candles.length > 0 ? (
        <div className="mt-4">
          <MarketInteractiveChart
            stockName={stock.name}
            candles={candles}
            style={style}
            interval={interval}
            range={range}
            resetKey={resetKey}
            onSelectedCandle={selectCandle}
          />
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

      <p className="mt-3 min-h-12 text-sm leading-6 text-text-secondary">
        {selectedCandleSummary}
      </p>

      <p className="sr-only" aria-live="polite">{announcement}</p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {selectedCandleAnnouncement}
      </p>
    </div>
  );
}
