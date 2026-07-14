import {
  getAutonomousMarketNewsForNow,
  getCanonicalMarketQuoteWon,
  getMarketMinuteBar,
  MARKET_INSTRUMENT_PROFILES,
} from './livePriceEngine.ts';
import type {
  MarketInstrumentProfile,
  MarketNews,
  MarketQuoteContext,
  MarketSnapshot,
  PricePoint,
} from './types.ts';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const KOREA_OFFSET_MS = 9 * 60 * MINUTE_MS;
const MAX_SPARKLINE_POINTS = 96;
const MAX_SPARKLINE_CACHE_ENTRIES = 64;

const PROFILE_BY_STOCK_ID = MARKET_INSTRUMENT_PROFILES as Readonly<
  Record<string, MarketInstrumentProfile>
>;
const completedSparklineCache = new Map<string, PricePoint[]>();

function toMarketNews(event: {
  id: string;
  stockId: string;
  title: string;
  summary?: string;
  startsAt: string;
  publishedAt?: string;
}): MarketNews {
  return {
    id: event.id,
    stockId: event.stockId,
    title: event.title,
    summary: event.summary ?? event.title,
    publishedAt: event.publishedAt ?? event.startsAt,
  };
}

function mergeNews(
  manualNews: readonly MarketNews[],
  automaticNews: readonly MarketNews[],
): MarketNews[] {
  const merged: MarketNews[] = [];
  const ids = new Set<string>();
  for (const item of [...automaticNews, ...manualNews]) {
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    merged.push(item);
  }
  return merged.sort((left, right) => (
    Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
    || left.id.localeCompare(right.id)
  ));
}

export function alignMarketSecond(nowMs: number): number {
  if (!Number.isFinite(nowMs)) throw new RangeError('market clock must be finite');
  return Math.floor(nowMs / SECOND_MS) * SECOND_MS;
}

function getKoreaDayStartMs(nowMs: number): number {
  return Math.floor((nowMs + KOREA_OFFSET_MS) / DAY_MS) * DAY_MS - KOREA_OFFSET_MS;
}

function representativeMinuteIndexes(minuteCount: number): number[] {
  const pointCount = Math.min(MAX_SPARKLINE_POINTS, minuteCount);
  if (pointCount <= 1) return [Math.max(0, minuteCount - 1)];
  return Array.from({ length: pointCount }, (_, index) => (
    Math.round((index * (minuteCount - 1)) / (pointCount - 1))
  ));
}

function profileFingerprint(profile: MarketInstrumentProfile): string {
  return [
    profile.stockId,
    profile.basePriceWon,
    profile.volatilityBps,
    profile.phase,
    profile.sectorId ?? '',
    profile.marketBeta ?? '',
    profile.sectorBeta ?? '',
    profile.idiosyncraticVolatilityBps ?? '',
    profile.longTermDriftBps ?? '',
    profile.baseMinuteVolume ?? '',
    profile.jumpSensitivity ?? '',
  ].join(':');
}

function eventFingerprint(
  profile: MarketInstrumentProfile,
  events: MarketSnapshot['adminEvents'],
): string {
  return events
    .filter((event) => event.stockId === profile.stockId)
    .map((event) => [
      event.id,
      event.revision,
      event.kind,
      event.impactBps,
      event.startsAt,
      event.endsAt ?? '',
    ].join(':'))
    .sort()
    .join('|');
}

function setCompletedSparklineCache(key: string, points: PricePoint[]): void {
  if (completedSparklineCache.has(key)) completedSparklineCache.delete(key);
  completedSparklineCache.set(key, points);
  while (completedSparklineCache.size > MAX_SPARKLINE_CACHE_ENTRIES) {
    const oldestKey = completedSparklineCache.keys().next().value;
    if (oldestKey === undefined) break;
    completedSparklineCache.delete(oldestKey);
  }
}

function buildTodaySparkline(
  profile: MarketInstrumentProfile,
  dayStartMs: number,
  nowMs: number,
  quoteWon: number,
  events: MarketSnapshot['adminEvents'],
): PricePoint[] {
  const minuteCount = Math.floor((nowMs - dayStartMs) / MINUTE_MS) + 1;
  const minuteIndexes = representativeMinuteIndexes(minuteCount);
  const latestMinuteIndex = minuteIndexes.at(-1)!;
  const cacheKey = [
    profileFingerprint(profile),
    eventFingerprint(profile, events),
    dayStartMs,
    latestMinuteIndex,
  ].join('::');
  let historicalPoints = completedSparklineCache.get(cacheKey);
  if (!historicalPoints) {
    historicalPoints = minuteIndexes.slice(0, -1).map((minuteIndex) => {
      const minuteStartMs = dayStartMs + minuteIndex * MINUTE_MS;
      const observedUntilMs = minuteStartMs + MINUTE_MS - 1;
      const minuteBar = getMarketMinuteBar(
        profile,
        minuteStartMs,
        observedUntilMs,
        events,
      );
      return {
        at: new Date(observedUntilMs).toISOString(),
        priceWon: minuteBar.closeWon,
      };
    });
    setCompletedSparklineCache(cacheKey, historicalPoints);
  }
  return [
    ...historicalPoints,
    {
      at: new Date(nowMs).toISOString(),
      priceWon: quoteWon,
    },
  ];
}

export function getMarketSnapshotQuoteWon(
  snapshot: Pick<MarketSnapshot, 'adminEvents'>,
  stockId: string,
  nowMs: number,
): number {
  return getCanonicalMarketQuoteWon(
    stockId,
    alignMarketSecond(nowMs),
    snapshot.adminEvents,
  );
}

export function buildMarketQuoteWonByStockId(
  snapshot: Pick<MarketSnapshot, 'stocks' | 'adminEvents'>,
  nowMs: number,
): Readonly<Record<string, number>> {
  const alignedNowMs = alignMarketSecond(nowMs);
  return Object.fromEntries(snapshot.stocks.map((stock) => [
    stock.id,
    getCanonicalMarketQuoteWon(stock.id, alignedNowMs, snapshot.adminEvents),
  ]));
}

export function buildMarketQuoteContext(
  snapshot: Pick<MarketSnapshot, 'stocks' | 'adminEvents' | 'news'>,
  nowMs: number,
): MarketQuoteContext {
  const alignedNowMs = alignMarketSecond(nowMs);
  const dayStartMs = getKoreaDayStartMs(alignedNowMs);
  const previousCloseAtMs = dayStartMs - SECOND_MS;
  const quoteWonByStockId: Record<string, number> = {};
  const previousCloseWonByStockId: Record<string, number> = {};
  const sparklineByStockId: Record<string, PricePoint[]> = {};
  const automaticNews = getAutonomousMarketNewsForNow(alignedNowMs).map(toMarketNews);
  const news = mergeNews(snapshot.news, automaticNews);
  const newsByStockId: Record<string, MarketNews[]> = {};
  const reasonByStockId: Record<string, string> = {};

  for (const stock of snapshot.stocks) {
    const profile = PROFILE_BY_STOCK_ID[stock.id];
    if (!profile) throw new RangeError(`unknown market stock: ${stock.id}`);
    const quoteWon = getCanonicalMarketQuoteWon(
      stock.id,
      alignedNowMs,
      snapshot.adminEvents,
    );
    quoteWonByStockId[stock.id] = quoteWon;
    previousCloseWonByStockId[stock.id] = getCanonicalMarketQuoteWon(
      stock.id,
      previousCloseAtMs,
      snapshot.adminEvents,
    );
    sparklineByStockId[stock.id] = buildTodaySparkline(
      profile,
      dayStartMs,
      alignedNowMs,
      quoteWon,
      snapshot.adminEvents,
    );
    const stockNews = news.filter((item) => item.stockId === stock.id);
    newsByStockId[stock.id] = stockNews;
    const automaticReason = automaticNews.find((item) => item.stockId === stock.id);
    reasonByStockId[stock.id] = automaticReason
      ? `${automaticReason.title} ${automaticReason.summary}`
      : stock.reason;
  }

  return {
    quoteWonByStockId,
    previousCloseWonByStockId,
    sparklineByStockId,
    news,
    newsByStockId,
    reasonByStockId,
  };
}
