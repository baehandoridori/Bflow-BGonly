import { formatWon } from './format.ts';
import type { MarketCandle } from './types';

export const MAX_MARKET_CHART_BARS = 1500;

export interface MarketChartFitDecision {
  fitContent: boolean;
  fittedKey: string | null;
}

export function resolveMarketChartFitDecision(
  fittedKey: string | null,
  completedSeriesKey: string | null,
): MarketChartFitDecision {
  if (completedSeriesKey === null || completedSeriesKey === fittedKey) {
    return { fitContent: false, fittedKey };
  }
  return { fitContent: true, fittedKey: completedSeriesKey };
}

export function resolveMarketChartKeyboardIndex(
  currentIndex: number,
  candleCount: number,
  key: string,
): number | null {
  if (candleCount <= 0) return null;
  const lastIndex = candleCount - 1;
  const safeCurrentIndex = Math.min(lastIndex, Math.max(0, currentIndex));
  if (key === 'ArrowLeft') return Math.max(0, safeCurrentIndex - 1);
  if (key === 'ArrowRight') return Math.min(lastIndex, safeCurrentIndex + 1);
  if (key === 'Home') return 0;
  if (key === 'End') return lastIndex;
  return null;
}

export interface MarketChartSelectionDecision {
  selectedIndex: number;
  resetSelection: boolean;
}

export function resolveMarketChartSelectedIndex(
  candles: readonly Pick<MarketCandle, 'startsAt'>[],
  selectedStartsAt: string | null,
  preserveSelection: boolean,
): MarketChartSelectionDecision {
  if (preserveSelection && selectedStartsAt !== null) {
    const matchingIndex = candles.findIndex((candle) => candle.startsAt === selectedStartsAt);
    if (matchingIndex >= 0) {
      return { selectedIndex: matchingIndex, resetSelection: false };
    }
  }
  return {
    selectedIndex: Math.max(0, candles.length - 1),
    resetSelection: !preserveSelection || selectedStartsAt !== null,
  };
}

export interface SafeMarketChartCandle {
  candle: MarketCandle;
  utcSeconds: number;
}

function isSafePositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function toSafeMarketChartCandle(
  candle: MarketCandle,
): SafeMarketChartCandle | null {
  const startsAtMs = Date.parse(candle.startsAt);
  const utcSeconds = Math.floor(startsAtMs / 1000);
  const safePrices = [
    candle.openWon,
    candle.highWon,
    candle.lowWon,
    candle.closeWon,
  ].every(isSafePositiveInteger);
  const safeVolume = Number.isSafeInteger(candle.volumeShares)
    && candle.volumeShares >= 0;
  const safeShape = candle.highWon >= Math.max(candle.openWon, candle.closeWon)
    && candle.lowWon <= Math.min(candle.openWon, candle.closeWon)
    && candle.highWon >= candle.lowWon;

  if (
    !Number.isFinite(startsAtMs)
    || !Number.isSafeInteger(utcSeconds)
    || !safePrices
    || !safeVolume
    || !safeShape
  ) {
    return null;
  }

  return { candle, utcSeconds };
}

export function limitMarketChartCandles(
  candles: readonly MarketCandle[],
): readonly MarketCandle[] {
  return candles.slice(-MAX_MARKET_CHART_BARS);
}

export function nearestMarketCandleIndex(
  pointerX: number,
  width: number,
  candleCount: number,
  plotPadding = 0,
): number {
  if (candleCount <= 1) return 0;
  const safeWidth = Math.max(0, width);
  const safePadding = Math.min(Math.max(0, plotPadding), safeWidth / 2);
  const plotWidth = safeWidth - safePadding * 2;
  const ratio = plotWidth > 0
    ? Math.min(1, Math.max(0, (pointerX - safePadding) / plotWidth))
    : 0;
  return Math.round(ratio * (candleCount - 1));
}

export function formatMarketCandleSummary(
  stockName: string,
  candle: MarketCandle,
): string {
  const parsed = new Date(candle.startsAt);
  const time = Number.isNaN(parsed.getTime())
    ? candle.startsAt
    : new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(parsed);
  return `${stockName} ${time}. 시가 ${formatWon(candle.openWon)}, 고가 ${formatWon(candle.highWon)}, 저가 ${formatWon(candle.lowWon)}, 종가 ${formatWon(candle.closeWon)}.`;
}
