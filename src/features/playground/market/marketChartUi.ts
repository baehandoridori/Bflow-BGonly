import { formatWon } from './format.ts';
import type { MarketCandle } from './types';

export const MAX_MARKET_CHART_BARS = 1500;

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
