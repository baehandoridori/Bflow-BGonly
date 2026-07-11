import { buildCandles } from './chartSeries.ts';
import { getLivePriceWon } from './livePriceEngine.ts';
import { MAX_MARKET_CHART_BARS } from './marketChartUi.ts';
import type {
  MarketAdminEvent,
  MarketBarInterval,
  MarketCandle,
  MarketInstrumentProfile,
} from './types.ts';

const MINUTE_MS = 60_000;
const INTERVAL_MS: Readonly<Record<'1h' | '1d', number>> = {
  '1h': 60 * MINUTE_MS,
  '1d': 24 * 60 * MINUTE_MS,
};
const MAX_COMPLETED_DISPLAY_BARS = 8192;

export type MarketDisplayPriceSampler = (
  profile: MarketInstrumentProfile,
  nowMs: number,
  events: readonly MarketAdminEvent[],
) => number;

export interface BuildMarketDisplayCandlesRequest {
  profile: MarketInstrumentProfile;
  startMs: number;
  endMs: number;
  nowMs: number;
  events: readonly MarketAdminEvent[];
  interval: MarketBarInterval;
  samplePriceWon?: MarketDisplayPriceSampler;
}

const completedDisplayBarCache = new Map<string, MarketCandle>();
const samplerIds = new WeakMap<MarketDisplayPriceSampler, number>();
let nextSamplerId = 1;

function cloneCandle(candle: MarketCandle): MarketCandle {
  return { ...candle, newsIds: [...candle.newsIds] };
}

function samplerId(sampler: MarketDisplayPriceSampler): number {
  const existing = samplerIds.get(sampler);
  if (existing !== undefined) return existing;
  const created = nextSamplerId;
  nextSamplerId += 1;
  samplerIds.set(sampler, created);
  return created;
}

function profileFingerprint(profile: MarketInstrumentProfile): string {
  return [profile.stockId, profile.basePriceWon, profile.volatilityBps, profile.phase].join(':');
}

function eventFingerprint(
  stockId: string,
  events: readonly MarketAdminEvent[],
): string {
  return events
    .filter((event) => event.stockId === stockId)
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

function eventOverlaps(
  event: MarketAdminEvent,
  rangeStartMs: number,
  rangeEndMs: number,
  includeRangeEnd: boolean,
): boolean {
  const eventStartMs = Date.parse(event.startsAt);
  const eventEndMs = event.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(event.endsAt);
  if (!Number.isFinite(eventStartMs) || Number.isNaN(eventEndMs) || eventEndMs <= eventStartMs) {
    return false;
  }
  const startsBeforeEnd = includeRangeEnd
    ? eventStartMs <= rangeEndMs
    : eventStartMs < rangeEndMs;
  return startsBeforeEnd && eventEndMs > rangeStartMs;
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

function buildRepresentativeBar(
  request: BuildMarketDisplayCandlesRequest,
  sampler: MarketDisplayPriceSampler,
  bucketStartMs: number,
  bucketEndMs: number,
  sourceStartMs: number,
  sourceEndMs: number,
): MarketCandle {
  const isCompleted = bucketEndMs <= request.nowMs;
  const eventsKey = eventFingerprint(request.profile.stockId, request.events);
  const cacheKey = [
    profileFingerprint(request.profile),
    sourceStartMs,
    sourceEndMs,
    request.interval,
    eventsKey,
    samplerId(sampler),
  ].join('::');
  const cached = isCompleted ? completedDisplayBarCache.get(cacheKey) : undefined;
  if (cached) return cloneCandle(cached);

  const openWon = sampler(request.profile, sourceStartMs, request.events);
  let highWon = openWon;
  let lowWon = openWon;
  let closeWon = openWon;
  for (
    let minuteStartMs = sourceStartMs;
    minuteStartMs < sourceEndMs;
    minuteStartMs += MINUTE_MS
  ) {
    const representativeCloseMs = Math.min(
      minuteStartMs + MINUTE_MS - 1000,
      sourceEndMs - 1,
      request.nowMs,
    );
    closeWon = sampler(request.profile, representativeCloseMs, request.events);
    highWon = Math.max(highWon, closeWon);
    lowWon = Math.min(lowWon, closeWon);
  }

  const overlapEndMs = isCompleted ? sourceEndMs : Math.min(sourceEndMs, request.nowMs);
  const newsIds = request.events
    .filter((event) => (
      event.stockId === request.profile.stockId
      && eventOverlaps(event, sourceStartMs, overlapEndMs, !isCompleted)
    ))
    .map((event) => event.id)
    .filter((eventId, index, allIds) => allIds.indexOf(eventId) === index)
    .sort();
  const candle: MarketCandle = {
    startsAt: new Date(bucketStartMs).toISOString(),
    openWon,
    highWon,
    lowWon,
    closeWon,
    newsIds,
  };
  if (isCompleted) setCompletedDisplayBar(cacheKey, candle);
  return candle;
}

export function buildMarketDisplayCandles(
  request: BuildMarketDisplayCandlesRequest,
): MarketCandle[] {
  if (request.interval !== '1h' && request.interval !== '1d') {
    return buildCandles({
      profile: request.profile,
      startMs: request.startMs,
      endMs: request.endMs,
      nowMs: request.nowMs,
      events: request.events,
      interval: request.interval,
    });
  }
  if (![request.startMs, request.endMs, request.nowMs].every(Number.isFinite)) {
    throw new RangeError('display candle timestamps must be finite');
  }
  if (request.endMs <= request.startMs || request.nowMs < request.startMs) return [];

  const intervalMs = INTERVAL_MS[request.interval];
  const requestedFirstMinuteMs = Math.floor(request.startMs / MINUTE_MS) * MINUTE_MS;
  const requestedLastMinuteMs = Math.floor((request.endMs - 1) / MINUTE_MS) * MINUTE_MS;
  const visibleLastMinuteMs = Math.floor(request.nowMs / MINUTE_MS) * MINUTE_MS;
  const lastMinuteMs = Math.min(requestedLastMinuteMs, visibleLastMinuteMs);
  if (lastMinuteMs < requestedFirstMinuteMs) return [];

  const requestedFirstBucketMs = Math.floor(requestedFirstMinuteMs / intervalMs) * intervalMs;
  const lastBucketMs = Math.floor(lastMinuteMs / intervalMs) * intervalMs;
  const firstBucketMs = Math.max(
    requestedFirstBucketMs,
    lastBucketMs - (MAX_MARKET_CHART_BARS - 1) * intervalMs,
  );
  const sampler = request.samplePriceWon ?? getLivePriceWon;
  const result: MarketCandle[] = [];

  for (
    let bucketStartMs = firstBucketMs;
    bucketStartMs <= lastBucketMs;
    bucketStartMs += intervalMs
  ) {
    const bucketEndMs = bucketStartMs + intervalMs;
    const sourceStartMs = Math.max(requestedFirstMinuteMs, bucketStartMs);
    const sourceEndMs = Math.min(request.endMs, bucketEndMs, request.nowMs + 1);
    if (sourceEndMs <= sourceStartMs) continue;
    result.push(buildRepresentativeBar(
      request,
      sampler,
      bucketStartMs,
      bucketEndMs,
      sourceStartMs,
      sourceEndMs,
    ));
  }

  return result.slice(-MAX_MARKET_CHART_BARS);
}
