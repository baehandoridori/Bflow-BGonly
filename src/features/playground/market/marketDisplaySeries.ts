import {
  aggregateCandles,
  buildCandles,
  buildMinuteCandles,
  marketEventNewsEndMs,
} from './chartSeries.ts';
import { getMarketDailyCheckpoint, getMarketMinuteBar } from './livePriceEngine.ts';
import { MAX_MARKET_CHART_BARS } from './marketChartUi.ts';
import type {
  MarketAdminEvent,
  MarketBarInterval,
  MarketCandle,
  MarketInstrumentProfile,
} from './types.ts';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_COMPLETED_DISPLAY_BARS = 4096;
const PROGRESSIVE_PUBLISH_INTERVAL = 8;

export interface BuildMarketDisplayCandlesRequest {
  profile: MarketInstrumentProfile;
  startMs: number;
  endMs: number;
  nowMs: number;
  events: readonly MarketAdminEvent[];
  interval: MarketBarInterval;
}

export interface BuildMarketDisplayCandlesProgressivelyOptions {
  signal?: Pick<AbortSignal, 'aborted'>;
  onProgress?(candles: readonly MarketCandle[]): void;
  yieldControl?(): Promise<void>;
}

export interface MarketDisplayTimeRange {
  startMs: number;
  endMs: number;
}

export interface MarketDisplayRangeSegments {
  leading: MarketDisplayTimeRange;
  historical: MarketDisplayTimeRange;
  current: MarketDisplayTimeRange;
}

interface DailyBucketWindow {
  requestedFirstMinuteMs: number;
  firstBucketMs: number;
  lastBucketMs: number;
}

const completedDisplayBarCache = new Map<string, MarketCandle>();

export function selectCausalMarketEvents(
  events: readonly MarketAdminEvent[],
  stockId: string,
  observedUntilExclusiveMs: number,
): MarketAdminEvent[] {
  return events.filter((event) => {
    if (event.stockId !== stockId) return false;
    const eventStartMs = Date.parse(event.startsAt);
    return Number.isFinite(eventStartMs) && eventStartMs < observedUntilExclusiveMs;
  });
}

export function marketDisplayEventsFingerprint(
  events: readonly MarketAdminEvent[],
): string {
  return events
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

export function splitMarketDisplayRange(
  rangeStartMs: number,
  nowMs: number,
): MarketDisplayRangeSegments {
  if (![rangeStartMs, nowMs].every(Number.isFinite)) {
    throw new RangeError('display range timestamps must be finite');
  }
  const visibleEndMs = nowMs + 1;
  const firstFullUtcDayStartMs = Math.ceil(rangeStartMs / DAY_MS) * DAY_MS;
  const currentUtcDayStartMs = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return {
    leading: {
      startMs: rangeStartMs,
      endMs: Math.min(firstFullUtcDayStartMs, currentUtcDayStartMs),
    },
    historical: {
      startMs: firstFullUtcDayStartMs,
      endMs: currentUtcDayStartMs,
    },
    current: {
      startMs: Math.max(currentUtcDayStartMs, rangeStartMs),
      endMs: visibleEndMs,
    },
  };
}

function cloneCandle(candle: MarketCandle): MarketCandle {
  return { ...candle, newsIds: [...candle.newsIds] };
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

function completedDayEventFingerprint(
  profile: MarketInstrumentProfile,
  bucketEndMs: number,
  events: readonly MarketAdminEvent[],
): string {
  return marketDisplayEventsFingerprint(selectCausalMarketEvents(
    events,
    profile.stockId,
    bucketEndMs,
  ));
}

function newsIdsForRange(
  profile: MarketInstrumentProfile,
  rangeStartMs: number,
  rangeEndMs: number,
  events: readonly MarketAdminEvent[],
): string[] {
  return events
    .filter((event) => {
      if (event.stockId !== profile.stockId) return false;
      const eventStartMs = Date.parse(event.startsAt);
      const eventEndMs = marketEventNewsEndMs(event);
      return Number.isFinite(eventStartMs)
        && !Number.isNaN(eventEndMs)
        && eventEndMs > rangeStartMs
        && eventStartMs < rangeEndMs;
    })
    .map((event) => event.id)
    .filter((eventId, index, allIds) => allIds.indexOf(eventId) === index)
    .sort();
}

function isFullyHaltedRange(
  profile: MarketInstrumentProfile,
  rangeStartMs: number,
  rangeEndMs: number,
  events: readonly MarketAdminEvent[],
): boolean {
  const intervals = events
    .filter((event) => event.stockId === profile.stockId && event.kind === 'halt')
    .map((event) => ({
      startMs: Math.max(rangeStartMs, Date.parse(event.startsAt)),
      endMs: Math.min(
        rangeEndMs,
        event.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(event.endsAt),
      ),
    }))
    .filter((interval) => (
      Number.isFinite(interval.startMs)
      && !Number.isNaN(interval.endMs)
      && interval.endMs > interval.startMs
    ))
    .sort((left, right) => left.startMs - right.startMs);
  let coveredUntilMs = rangeStartMs;
  for (const interval of intervals) {
    if (interval.startMs > coveredUntilMs) return false;
    coveredUntilMs = Math.max(coveredUntilMs, interval.endMs);
    if (coveredUntilMs >= rangeEndMs) return true;
  }
  return false;
}

function setCompletedDisplayBar(key: string, candle: MarketCandle): void {
  if (completedDisplayBarCache.has(key)) completedDisplayBarCache.delete(key);
  completedDisplayBarCache.set(key, cloneCandle(candle));
  while (completedDisplayBarCache.size > MAX_COMPLETED_DISPLAY_BARS) {
    const oldestKey = completedDisplayBarCache.keys().next().value;
    if (oldestKey === undefined) break;
    completedDisplayBarCache.delete(oldestKey);
  }
}

function buildCompletedDailyCandle(
  request: BuildMarketDisplayCandlesRequest,
  bucketStartMs: number,
): MarketCandle {
  const bucketEndMs = bucketStartMs + DAY_MS;
  const cacheKey = [
    profileFingerprint(request.profile),
    bucketStartMs,
    completedDayEventFingerprint(request.profile, bucketEndMs, request.events),
  ].join('::');
  const cached = completedDisplayBarCache.get(cacheKey);
  if (cached) return cloneCandle(cached);

  const checkpoint = getMarketDailyCheckpoint(
    request.profile,
    bucketStartMs,
    request.events,
  );
  const fullHaltBar = isFullyHaltedRange(
    request.profile,
    bucketStartMs,
    bucketEndMs,
    request.events,
  )
    ? getMarketMinuteBar(
      request.profile,
      bucketStartMs,
      bucketStartMs + MINUTE_MS - 1,
      request.events,
    )
    : null;
  const candle: MarketCandle = {
    startsAt: new Date(bucketStartMs).toISOString(),
    openWon: fullHaltBar?.openWon ?? checkpoint.openWon,
    highWon: fullHaltBar?.highWon ?? checkpoint.highWon,
    lowWon: fullHaltBar?.lowWon ?? checkpoint.lowWon,
    closeWon: fullHaltBar?.closeWon ?? checkpoint.closeWon,
    volumeShares: fullHaltBar?.volumeShares ?? checkpoint.volumeShares,
    newsIds: newsIdsForRange(
      request.profile,
      bucketStartMs,
      bucketEndMs,
      request.events,
    ),
  };
  setCompletedDisplayBar(cacheKey, candle);
  return candle;
}

function buildPartialDailyCandle(
  request: BuildMarketDisplayCandlesRequest,
  sourceStartMs: number,
  sourceEndMs: number,
): MarketCandle | undefined {
  const minuteCandles = buildMinuteCandles({
    profile: request.profile,
    startMs: sourceStartMs,
    endMs: sourceEndMs,
    nowMs: request.nowMs,
    events: request.events,
  });
  return aggregateCandles(minuteCandles, '1d')[0];
}

function resolveDailyBucketWindow(
  request: BuildMarketDisplayCandlesRequest,
): DailyBucketWindow | null {
  if (![request.startMs, request.endMs, request.nowMs].every(Number.isFinite)) {
    throw new RangeError('display candle timestamps must be finite');
  }
  if (request.endMs <= request.startMs || request.nowMs < request.startMs) return null;

  const requestedFirstMinuteMs = Math.floor(request.startMs / MINUTE_MS) * MINUTE_MS;
  const requestedLastMinuteMs = Math.floor((request.endMs - 1) / MINUTE_MS) * MINUTE_MS;
  const visibleLastMinuteMs = Math.floor(request.nowMs / MINUTE_MS) * MINUTE_MS;
  const lastMinuteMs = Math.min(requestedLastMinuteMs, visibleLastMinuteMs);
  if (lastMinuteMs < requestedFirstMinuteMs) return null;

  const requestedFirstBucketMs = Math.floor(requestedFirstMinuteMs / DAY_MS) * DAY_MS;
  const lastBucketMs = Math.floor(lastMinuteMs / DAY_MS) * DAY_MS;
  return {
    requestedFirstMinuteMs,
    firstBucketMs: Math.max(
      requestedFirstBucketMs,
      lastBucketMs - (MAX_MARKET_CHART_BARS - 1) * DAY_MS,
    ),
    lastBucketMs,
  };
}

function buildDailyBucketCandle(
  request: BuildMarketDisplayCandlesRequest,
  requestedFirstMinuteMs: number,
  bucketStartMs: number,
): MarketCandle | undefined {
  const bucketEndMs = bucketStartMs + DAY_MS;
  const sourceStartMs = Math.max(requestedFirstMinuteMs, bucketStartMs);
  const sourceEndMs = Math.min(request.endMs, bucketEndMs, request.nowMs + 1);
  if (sourceEndMs <= sourceStartMs) return undefined;

  const usesFullCompletedDay = sourceStartMs === bucketStartMs
    && sourceEndMs >= bucketEndMs
    && bucketEndMs <= request.nowMs;
  return usesFullCompletedDay
    ? buildCompletedDailyCandle(request, bucketStartMs)
    : buildPartialDailyCandle(request, sourceStartMs, sourceEndMs);
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function resolveProgressiveDayWindow(
  request: BuildMarketDisplayCandlesRequest,
): { firstDayMs: number; lastDayMs: number; visibleEndMs: number } | null {
  if (![request.startMs, request.endMs, request.nowMs].every(Number.isFinite)) {
    throw new RangeError('display candle timestamps must be finite');
  }
  const visibleEndMs = Math.min(request.endMs, request.nowMs + 1);
  if (visibleEndMs <= request.startMs) return null;
  return {
    firstDayMs: Math.floor(request.startMs / DAY_MS) * DAY_MS,
    lastDayMs: Math.floor((visibleEndMs - 1) / DAY_MS) * DAY_MS,
    visibleEndMs,
  };
}

export function buildMarketDisplayCandles(
  request: BuildMarketDisplayCandlesRequest,
): MarketCandle[] {
  if (request.interval !== '1d') {
    return buildCandles({
      profile: request.profile,
      startMs: request.startMs,
      endMs: request.endMs,
      nowMs: request.nowMs,
      events: request.events,
      interval: request.interval,
    });
  }
  const window = resolveDailyBucketWindow(request);
  if (!window) return [];
  const result: MarketCandle[] = [];

  for (
    let bucketStartMs = window.firstBucketMs;
    bucketStartMs <= window.lastBucketMs;
    bucketStartMs += DAY_MS
  ) {
    const candle = buildDailyBucketCandle(
      request,
      window.requestedFirstMinuteMs,
      bucketStartMs,
    );
    if (candle) result.push(candle);
  }

  return result.slice(-MAX_MARKET_CHART_BARS);
}

export async function buildMarketDisplayCandlesProgressively(
  request: BuildMarketDisplayCandlesRequest,
  options: BuildMarketDisplayCandlesProgressivelyOptions = {},
): Promise<MarketCandle[]> {
  const yieldControl = options.yieldControl ?? yieldToMainThread;
  await yieldControl();
  if (options.signal?.aborted) return [];
  const window = resolveProgressiveDayWindow(request);
  if (!window) return [];
  const result: MarketCandle[] = [];
  let processedDays = 0;
  for (
    let dayStartMs = window.lastDayMs;
    dayStartMs >= window.firstDayMs;
    dayStartMs -= DAY_MS
  ) {
    if (options.signal?.aborted) return result;
    const dayCandles = buildMarketDisplayCandles({
      ...request,
      startMs: Math.max(request.startMs, dayStartMs),
      endMs: Math.min(window.visibleEndMs, dayStartMs + DAY_MS),
    });
    if (dayCandles.length > 0) result.unshift(...dayCandles);
    processedDays += 1;
    if (
      processedDays === 1
      || processedDays % PROGRESSIVE_PUBLISH_INTERVAL === 0
      || dayStartMs === window.firstDayMs
    ) {
      options.onProgress?.(result.slice(-MAX_MARKET_CHART_BARS).map(cloneCandle));
    }
    await yieldControl();
  }
  return result.slice(-MAX_MARKET_CHART_BARS);
}
