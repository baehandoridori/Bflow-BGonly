import { getLivePriceWon } from './livePriceEngine.ts';
import type {
  MarketAdminEvent,
  MarketBarInterval,
  MarketCandle,
  MarketChartRange,
  MarketInstrumentProfile,
} from './types';

const MINUTE_MS = 60_000;
const MAX_RETURNED_CANDLES = 600;
const MAX_CACHED_CANDLES = 8192;
const MAX_CACHED_AGGREGATED_CANDLES = 4096;
const MAX_CACHED_REQUESTS = 128;

const INTERVAL_MS: Record<MarketBarInterval, number> = {
  '1m': MINUTE_MS,
  '5m': 5 * MINUTE_MS,
  '10m': 10 * MINUTE_MS,
  '15m': 15 * MINUTE_MS,
  '1h': 60 * MINUTE_MS,
  '1d': 24 * 60 * MINUTE_MS,
};

const MIN_INTERVAL_BY_RANGE: Record<MarketChartRange, MarketBarInterval> = {
  today: '1m',
  week: '15m',
  month: '1h',
  'six-months': '1d',
  all: '1d',
};

export interface BuildMinuteCandlesRequest {
  profile: MarketInstrumentProfile;
  startMs: number;
  endMs: number;
  nowMs: number;
  events: readonly MarketAdminEvent[];
}

export interface BuildCandlesRequest extends BuildMinuteCandlesRequest {
  interval: MarketBarInterval;
}

const completedCandleCache = new Map<string, MarketCandle>();
const completedAggregatedCandleCache = new Map<string, MarketCandle>();
const completedRequestCache = new Map<string, MarketCandle[]>();

function cloneCandle(candle: MarketCandle): MarketCandle {
  return { ...candle, newsIds: [...candle.newsIds] };
}

function cloneCandles(candles: readonly MarketCandle[]): MarketCandle[] {
  return candles.map(cloneCandle);
}

function setBoundedCache<T>(cache: Map<string, T>, key: string, value: T, maximum: number): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > maximum) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function profileFingerprint(profile: MarketInstrumentProfile): string {
  return [profile.stockId, profile.basePriceWon, profile.volatilityBps, profile.phase].join(':');
}

function eventFingerprint(profile: MarketInstrumentProfile, events: readonly MarketAdminEvent[]): string {
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

function overlapsInterval(
  event: MarketAdminEvent,
  intervalStartMs: number,
  intervalEndMs: number,
  includeIntervalEnd: boolean,
): boolean {
  const eventStartMs = Date.parse(event.startsAt);
  const eventEndMs = event.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(event.endsAt);
  if (!Number.isFinite(eventStartMs) || Number.isNaN(eventEndMs) || eventEndMs <= eventStartMs) {
    return false;
  }
  const startsWithinInterval = includeIntervalEnd
    ? eventStartMs <= intervalEndMs
    : eventStartMs < intervalEndMs;
  return startsWithinInterval && eventEndMs > intervalStartMs;
}

function buildOneMinuteCandle(
  profile: MarketInstrumentProfile,
  minuteStartMs: number,
  lastSampleSecond: number,
  eventOverlapEndMs: number,
  includeEventAtOverlapEnd: boolean,
  events: readonly MarketAdminEvent[],
): MarketCandle {
  if (
    profile.volatilityBps === 0
    && events.every((event) => event.stockId !== profile.stockId)
  ) {
    const priceWon = getLivePriceWon(profile, minuteStartMs, events);
    return {
      startsAt: new Date(minuteStartMs).toISOString(),
      openWon: priceWon,
      highWon: priceWon,
      lowWon: priceWon,
      closeWon: priceWon,
      newsIds: [],
    };
  }
  const prices = Array.from({ length: lastSampleSecond + 1 }, (_, second) => (
    getLivePriceWon(profile, minuteStartMs + second * 1000, events)
  ));
  const newsIds = events
    .filter((event) => (
      event.stockId === profile.stockId
      && overlapsInterval(
        event,
        minuteStartMs,
        eventOverlapEndMs,
        includeEventAtOverlapEnd,
      )
    ))
    .map((event) => event.id)
    .filter((eventId, index, allIds) => allIds.indexOf(eventId) === index)
    .sort();
  return {
    startsAt: new Date(minuteStartMs).toISOString(),
    openWon: prices[0],
    highWon: Math.max(...prices),
    lowWon: Math.min(...prices),
    closeWon: prices.at(-1)!,
    newsIds,
  };
}

function normalizeRequest(
  requestOrProfile: BuildMinuteCandlesRequest | MarketInstrumentProfile,
  startMs?: number,
  endMs?: number,
  eventsOrNowMs?: readonly MarketAdminEvent[] | number,
  nowMsOrEvents?: number | readonly MarketAdminEvent[],
): BuildMinuteCandlesRequest {
  if ('profile' in requestOrProfile) return requestOrProfile;
  const events = Array.isArray(eventsOrNowMs)
    ? eventsOrNowMs
    : Array.isArray(nowMsOrEvents)
      ? nowMsOrEvents
      : [];
  const nowMs = typeof eventsOrNowMs === 'number'
    ? eventsOrNowMs
    : typeof nowMsOrEvents === 'number'
      ? nowMsOrEvents
      : endMs;
  return {
    profile: requestOrProfile,
    startMs: startMs!,
    endMs: endMs!,
    nowMs: nowMs!,
    events,
  };
}

export function buildMinuteCandles(request: BuildMinuteCandlesRequest): MarketCandle[];
export function buildMinuteCandles(
  profile: MarketInstrumentProfile,
  startMs: number,
  endMs: number,
  events: readonly MarketAdminEvent[],
  nowMs?: number,
): MarketCandle[];
export function buildMinuteCandles(
  profile: MarketInstrumentProfile,
  startMs: number,
  endMs: number,
  nowMs: number,
  events: readonly MarketAdminEvent[],
): MarketCandle[];
export function buildMinuteCandles(
  requestOrProfile: BuildMinuteCandlesRequest | MarketInstrumentProfile,
  startMs?: number,
  endMs?: number,
  eventsOrNowMs?: readonly MarketAdminEvent[] | number,
  nowMsOrEvents?: number | readonly MarketAdminEvent[],
): MarketCandle[] {
  const request = normalizeRequest(requestOrProfile, startMs, endMs, eventsOrNowMs, nowMsOrEvents);
  return buildMinuteCandlesForRequest(request, MAX_RETURNED_CANDLES);
}

function buildMinuteCandlesForRequest(
  request: BuildMinuteCandlesRequest,
  maximumReturnedCandles: number | null,
  cacheCompletedRequest = true,
): MarketCandle[] {
  if (![request.startMs, request.endMs, request.nowMs].every(Number.isFinite)) {
    throw new RangeError('candle timestamps must be finite');
  }
  if (request.endMs <= request.startMs || request.nowMs < request.startMs) return [];

  const requestedFirstMinuteMs = Math.floor(request.startMs / MINUTE_MS) * MINUTE_MS;
  const requestedLastMinuteMs = Math.floor((request.endMs - 1) / MINUTE_MS) * MINUTE_MS;
  const visibleLastMinuteMs = Math.floor(request.nowMs / MINUTE_MS) * MINUTE_MS;
  const lastMinuteMs = Math.min(requestedLastMinuteMs, visibleLastMinuteMs);
  if (lastMinuteMs < requestedFirstMinuteMs) return [];
  const firstMinuteMs = maximumReturnedCandles === null
    ? requestedFirstMinuteMs
    : Math.max(
      requestedFirstMinuteMs,
      lastMinuteMs - (maximumReturnedCandles - 1) * MINUTE_MS,
    );
  const profileKey = profileFingerprint(request.profile);
  const eventsKey = eventFingerprint(request.profile, request.events);
  const isCompletedRequest = lastMinuteMs + MINUTE_MS <= request.nowMs;
  const requestKey = [profileKey, firstMinuteMs, lastMinuteMs, '1m', eventsKey].join('::');

  if (isCompletedRequest && cacheCompletedRequest) {
    const cachedRequest = completedRequestCache.get(requestKey);
    if (cachedRequest) return cloneCandles(cachedRequest);
  }

  const candles: MarketCandle[] = [];
  for (let minuteStartMs = firstMinuteMs; minuteStartMs <= lastMinuteMs; minuteStartMs += MINUTE_MS) {
    const isCompletedMinute = minuteStartMs + MINUTE_MS <= request.nowMs;
    const candleKey = [profileKey, minuteStartMs, '1m', eventsKey].join('::');
    const cachedCandle = isCompletedMinute ? completedCandleCache.get(candleKey) : undefined;
    if (cachedCandle) {
      candles.push(cloneCandle(cachedCandle));
      continue;
    }

    const lastSampleSecond = isCompletedMinute
      ? 59
      : Math.min(59, Math.max(0, Math.floor((request.nowMs - minuteStartMs) / 1000)));
    const candle = buildOneMinuteCandle(
      request.profile,
      minuteStartMs,
      lastSampleSecond,
      isCompletedMinute ? minuteStartMs + MINUTE_MS : request.nowMs,
      !isCompletedMinute,
      request.events,
    );
    candles.push(candle);
    if (isCompletedMinute) {
      setBoundedCache(completedCandleCache, candleKey, cloneCandle(candle), MAX_CACHED_CANDLES);
    }
  }

  if (isCompletedRequest && cacheCompletedRequest) {
    setBoundedCache(completedRequestCache, requestKey, cloneCandles(candles), MAX_CACHED_REQUESTS);
  }
  return candles;
}

export function buildCandles(request: BuildCandlesRequest): MarketCandle[] {
  if (request.interval === '1m') return buildMinuteCandles(request);
  if (![request.startMs, request.endMs, request.nowMs].every(Number.isFinite)) {
    throw new RangeError('candle timestamps must be finite');
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
    lastBucketMs - (MAX_RETURNED_CANDLES - 1) * intervalMs,
  );
  const profileKey = profileFingerprint(request.profile);
  const eventsKey = eventFingerprint(request.profile, request.events);
  const result: MarketCandle[] = [];

  for (let bucketStartMs = firstBucketMs; bucketStartMs <= lastBucketMs; bucketStartMs += intervalMs) {
    const bucketEndMs = bucketStartMs + intervalMs;
    const sourceStartMs = Math.max(request.startMs, bucketStartMs);
    const sourceEndMs = Math.min(request.endMs, bucketEndMs);
    if (sourceEndMs <= sourceStartMs) continue;

    const isCompletedBucket = bucketEndMs <= request.nowMs;
    const aggregatedKey = [
      profileKey,
      sourceStartMs,
      sourceEndMs,
      request.interval,
      eventsKey,
    ].join('::');
    const cachedCandle = isCompletedBucket
      ? completedAggregatedCandleCache.get(aggregatedKey)
      : undefined;
    if (cachedCandle) {
      result.push(cloneCandle(cachedCandle));
      continue;
    }

    const sourceCandles = buildMinuteCandlesForRequest({
      profile: request.profile,
      startMs: sourceStartMs,
      endMs: sourceEndMs,
      nowMs: request.nowMs,
      events: request.events,
    }, null, false);
    const aggregated = aggregateCandles(sourceCandles, request.interval)[0];
    if (!aggregated) continue;
    result.push(aggregated);
    if (isCompletedBucket) {
      setBoundedCache(
        completedAggregatedCandleCache,
        aggregatedKey,
        cloneCandle(aggregated),
        MAX_CACHED_AGGREGATED_CANDLES,
      );
    }
  }

  return result.slice(-MAX_RETURNED_CANDLES);
}

export function aggregateCandles(
  candles: readonly MarketCandle[],
  interval: MarketBarInterval,
): MarketCandle[] {
  const intervalMs = INTERVAL_MS[interval];
  const sortedCandles = candles
    .filter((candle) => Number.isFinite(Date.parse(candle.startsAt)))
    .map(cloneCandle)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const aggregated: MarketCandle[] = [];

  for (const candle of sortedCandles) {
    const bucketStartMs = Math.floor(Date.parse(candle.startsAt) / intervalMs) * intervalMs;
    const previous = aggregated.at(-1);
    if (!previous || Date.parse(previous.startsAt) !== bucketStartMs) {
      aggregated.push({
        ...candle,
        startsAt: new Date(bucketStartMs).toISOString(),
        newsIds: [...new Set(candle.newsIds)],
      });
      continue;
    }
    previous.highWon = Math.max(previous.highWon, candle.highWon);
    previous.lowWon = Math.min(previous.lowWon, candle.lowWon);
    previous.closeWon = candle.closeWon;
    previous.newsIds = [...new Set([...previous.newsIds, ...candle.newsIds])];
  }

  return aggregated.slice(-MAX_RETURNED_CANDLES);
}

export function resolveIntervalForRange(
  range: MarketChartRange,
  requestedInterval: MarketBarInterval,
): MarketBarInterval {
  const minimumInterval = MIN_INTERVAL_BY_RANGE[range];
  return INTERVAL_MS[requestedInterval] < INTERVAL_MS[minimumInterval]
    ? minimumInterval
    : requestedInterval;
}
