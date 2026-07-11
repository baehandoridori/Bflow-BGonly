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
const EXTREMA_PROBE_COUNT = 24;

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

function haltDependencyStart(
  events: readonly MarketAdminEvent[],
  stockId: string,
  rangeStartMs: number,
  rangeEndMs: number,
  includeRangeEnd: boolean,
): number {
  let dependencyStartMs = rangeStartMs;
  while (true) {
    let nextDependencyStartMs = dependencyStartMs;
    for (const event of events) {
      if (
        event.stockId !== stockId
        || event.kind !== 'halt'
        || !eventOverlaps(event, dependencyStartMs, rangeEndMs, includeRangeEnd)
      ) {
        continue;
      }
      nextDependencyStartMs = Math.min(
        nextDependencyStartMs,
        Date.parse(event.startsAt) - 1000,
      );
    }
    if (nextDependencyStartMs === dependencyStartMs) return dependencyStartMs;
    dependencyStartMs = nextDependencyStartMs;
  }
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
  const overlapEndMs = isCompleted ? sourceEndMs : Math.min(sourceEndMs, request.nowMs);
  const includeRangeEnd = !isCompleted;
  const dependencyStartMs = haltDependencyStart(
    request.events,
    request.profile.stockId,
    sourceStartMs,
    overlapEndMs,
    includeRangeEnd,
  );
  const priceEvents = request.events.filter((event) => (
    event.stockId === request.profile.stockId
    && eventOverlaps(event, dependencyStartMs, overlapEndMs, includeRangeEnd)
  ));
  const eventsKey = eventFingerprint(priceEvents);
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

  const closeSampleMs = Math.min(sourceEndMs - 1, request.nowMs);
  const sampleTimes = new Set<number>([sourceStartMs, closeSampleMs]);
  const sampleSpanMs = Math.max(0, closeSampleMs - sourceStartMs);
  for (let probe = 1; probe <= EXTREMA_PROBE_COUNT; probe += 1) {
    sampleTimes.add(
      sourceStartMs
      + Math.floor((sampleSpanMs * probe) / (EXTREMA_PROBE_COUNT + 1)),
    );
  }
  const prices = [...sampleTimes]
    .sort((left, right) => left - right)
    .map((sampleMs) => sampler(request.profile, sampleMs, priceEvents));
  const openWon = prices[0];
  const closeWon = prices.at(-1)!;
  const newsIds = priceEvents
    .filter((event) => eventOverlaps(
      event,
      sourceStartMs,
      overlapEndMs,
      includeRangeEnd,
    ))
    .map((event) => event.id)
    .filter((eventId, index, allIds) => allIds.indexOf(eventId) === index)
    .sort();
  const candle: MarketCandle = {
    startsAt: new Date(bucketStartMs).toISOString(),
    openWon,
    highWon: Math.max(...prices),
    lowWon: Math.min(...prices),
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
