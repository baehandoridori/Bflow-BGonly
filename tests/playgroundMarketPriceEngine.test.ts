import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateCandles,
  buildCandles,
  buildMinuteCandles,
  resolveIntervalForRange,
} from '../src/features/playground/market/chartSeries.ts';
import { getLivePriceWon } from '../src/features/playground/market/livePriceEngine.ts';
import * as livePriceEngine from '../src/features/playground/market/livePriceEngine.ts';
import type {
  MarketAdminEvent,
  MarketBarInterval,
  MarketCandle,
  MarketInstrumentProfile,
} from '../src/features/playground/market/types.ts';

const PROFILE: MarketInstrumentProfile = {
  stockId: 'jbbj',
  basePriceWon: 1842,
  volatilityBps: 180,
  phase: 0.37,
};

const CONSTANT_PROFILE: MarketInstrumentProfile = {
  stockId: 'constant',
  basePriceWon: 1842,
  volatilityBps: 0,
  phase: 0.37,
};

const DAILY_MINUTE_PARITY_PROFILE = {
  stockId: 'daily-minute-parity',
  basePriceWon: 75_000,
  volatilityBps: 190,
  phase: 0.41,
  sectorId: 'platform',
  marketBeta: 0.8,
  sectorBeta: 0.6,
  idiosyncraticVolatilityBps: 120,
  longTermDriftBps: 1,
  baseMinuteVolume: 12_000,
  jumpSensitivity: 1,
} as MarketInstrumentProfile;

interface MarketDailyCheckpoint {
  dayStartMs: number;
  openWon: number;
  highWon: number;
  lowWon: number;
  closeWon: number;
  volumeShares: number;
  regime: 'bull' | 'bear' | 'sideways';
}

interface MarketMinuteBar {
  openWon: number;
  highWon: number;
  lowWon: number;
  closeWon: number;
  volumeShares: number;
}

type MarketModelApi = {
  getMarketDailyCheckpoint?: (
    profile: MarketInstrumentProfile,
    dayStartMs: number,
    events: readonly MarketAdminEvent[],
  ) => MarketDailyCheckpoint;
  getMarketMinuteBar?: (
    profile: MarketInstrumentProfile,
    minuteStartMs: number,
    observedUntilMs: number,
    events: readonly MarketAdminEvent[],
  ) => MarketMinuteBar;
};

const marketModelApi = livePriceEngine as typeof livePriceEngine & MarketModelApi;

function getMarketDailyCheckpoint(
  profile: MarketInstrumentProfile,
  dayStartMs: number,
  events: readonly MarketAdminEvent[],
): MarketDailyCheckpoint {
  assert.equal(
    typeof marketModelApi.getMarketDailyCheckpoint,
    'function',
    'getMarketDailyCheckpoint must be exported by the live price engine',
  );
  return marketModelApi.getMarketDailyCheckpoint!(profile, dayStartMs, events);
}

function getMarketMinuteBar(
  profile: MarketInstrumentProfile,
  minuteStartMs: number,
  observedUntilMs: number,
  events: readonly MarketAdminEvent[],
): MarketMinuteBar {
  assert.equal(
    typeof marketModelApi.getMarketMinuteBar,
    'function',
    'getMarketMinuteBar must be exported by the live price engine',
  );
  return marketModelApi.getMarketMinuteBar!(
    profile,
    minuteStartMs,
    observedUntilMs,
    events,
  );
}

function logReturns(values: readonly number[]): number[] {
  return values.slice(1).map((value, index) => Math.log(value / values[index]));
}

function correlation(left: readonly number[], right: readonly number[]): number {
  assert.equal(left.length, right.length);
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

test('live price is deterministic, advances each second, and stays positive', () => {
  const firstSecond = Date.parse('2026-07-11T12:00:01Z');
  const secondSecond = Date.parse('2026-07-11T12:00:02Z');

  assert.equal(
    getLivePriceWon(PROFILE, firstSecond, []),
    getLivePriceWon(PROFILE, firstSecond, []),
  );
  assert.notEqual(
    getLivePriceWon(PROFILE, firstSecond, []),
    getLivePriceWon(PROFILE, secondSecond, []),
  );
  assert.ok(getLivePriceWon(PROFILE, firstSecond, []) > 0);
});

test('halt freezes the quote at one second before its interval starts', () => {
  const startsAt = '2026-07-11T12:00:10Z';
  const halt: MarketAdminEvent = {
    id: 'halt-1',
    stockId: PROFILE.stockId,
    kind: 'halt',
    title: '거래 정지',
    impactBps: 0,
    startsAt,
    endsAt: '2026-07-11T12:01:00Z',
    revision: 1,
  };
  const expectedFrozenPrice = getLivePriceWon(PROFILE, Date.parse(startsAt) - 1000, [halt]);

  assert.equal(getLivePriceWon(PROFILE, Date.parse(startsAt), [halt]), expectedFrozenPrice);
  assert.equal(
    getLivePriceWon(PROFILE, Date.parse('2026-07-11T12:00:35Z'), [halt]),
    expectedFrozenPrice,
  );
  assert.equal(
    getLivePriceWon(PROFILE, Date.parse('2026-07-11T12:00:59Z'), [halt]),
    expectedFrozenPrice,
  );
});

test('a positive shock raises the affected quote', () => {
  const nowMs = Date.parse('2026-07-11T12:00:30Z');
  const shock: MarketAdminEvent = {
    id: 'shock-1',
    stockId: PROFILE.stockId,
    kind: 'shock-up',
    title: '상승 충격',
    impactBps: 1200,
    startsAt: '2026-07-11T12:00:00Z',
    endsAt: '2026-07-11T12:01:00Z',
    revision: 1,
  };

  assert.ok(
    getLivePriceWon(PROFILE, nowMs, [shock]) > getLivePriceWon(PROFILE, nowMs, []),
  );
});

test('a completed minute candle samples second zero through second fifty-nine', () => {
  const minuteStartMs = Date.parse('2026-07-11T12:00:00Z');
  const samples = Array.from({ length: 60 }, (_, second) => (
    getLivePriceWon(PROFILE, minuteStartMs + second * 1000, [])
  ));
  const candles = buildMinuteCandles({
    profile: PROFILE,
    startMs: minuteStartMs,
    endMs: minuteStartMs + 60_000,
    nowMs: minuteStartMs + 60_000,
    events: [],
  });

  assert.equal(candles.length, 1);
  assert.deepEqual(candles[0], {
    startsAt: new Date(minuteStartMs).toISOString(),
    openWon: samples[0],
    highWon: Math.max(...samples),
    lowWon: Math.min(...samples),
    closeWon: samples[59],
    newsIds: [],
  });
});

test('aggregation keeps first open, extrema, last close, and event IDs', () => {
  const startsAtMs = Date.parse('2026-07-11T12:00:00Z');
  const minuteCandles: MarketCandle[] = Array.from({ length: 60 }, (_, minute) => ({
    startsAt: new Date(startsAtMs + minute * 60_000).toISOString(),
    openWon: 1000 + minute,
    highWon: 2000 + minute,
    lowWon: 900 - minute,
    closeWon: 1500 + minute,
    newsIds: minute === 0 || minute === 1 ? ['event-1'] : minute === 59 ? ['event-2'] : [],
  }));

  const expectedGroupCounts: Record<Exclude<MarketBarInterval, '1m' | '1d'>, number> = {
    '5m': 12,
    '10m': 6,
    '15m': 4,
    '1h': 1,
  };
  for (const [interval, expectedCount] of Object.entries(expectedGroupCounts) as Array<
    [Exclude<MarketBarInterval, '1m' | '1d'>, number]
  >) {
    const aggregated = aggregateCandles(minuteCandles, interval);
    const firstGroupSize = interval === '1h' ? 60 : Number.parseInt(interval, 10);
    const firstGroup = minuteCandles.slice(0, firstGroupSize);
    assert.equal(aggregated.length, expectedCount, interval);
    assert.equal(aggregated[0].openWon, firstGroup[0].openWon, interval);
    assert.equal(aggregated[0].highWon, Math.max(...firstGroup.map((candle) => candle.highWon)), interval);
    assert.equal(aggregated[0].lowWon, Math.min(...firstGroup.map((candle) => candle.lowWon)), interval);
    assert.equal(aggregated[0].closeWon, firstGroup.at(-1)?.closeWon, interval);
  }
  assert.deepEqual(aggregateCandles(minuteCandles, '1h')[0].newsIds, ['event-1', 'event-2']);
});

test('range compatibility promotes intervals that would be too dense', () => {
  assert.equal(resolveIntervalForRange('today', '1m'), '1m');
  assert.equal(resolveIntervalForRange('month', '1m'), '1h');
  assert.equal(resolveIntervalForRange('six-months', '15m'), '1d');
  assert.equal(resolveIntervalForRange('all', '1h'), '1d');
});

test('event IDs follow interval overlap and current candles are never stale', () => {
  const minuteStartMs = Date.parse('2026-07-11T12:00:00Z');
  const event: MarketAdminEvent = {
    id: 'overlap-1',
    stockId: PROFILE.stockId,
    kind: 'news',
    title: '두 캔들에 걸친 소식',
    impactBps: 100,
    startsAt: '2026-07-11T12:00:30Z',
    endsAt: '2026-07-11T12:01:15Z',
    revision: 3,
  };
  const overlapped = buildMinuteCandles({
    profile: PROFILE,
    startMs: minuteStartMs,
    endMs: minuteStartMs + 120_000,
    nowMs: minuteStartMs + 120_000,
    events: [event],
  });
  assert.deepEqual(overlapped.map((candle) => candle.newsIds), [['overlap-1'], ['overlap-1']]);

  const firstTick = buildMinuteCandles({
    profile: PROFILE,
    startMs: minuteStartMs,
    endMs: minuteStartMs + 60_000,
    nowMs: minuteStartMs + 1000,
    events: [],
  });
  const secondTick = buildMinuteCandles({
    profile: PROFILE,
    startMs: minuteStartMs,
    endMs: minuteStartMs + 60_000,
    nowMs: minuteStartMs + 2000,
    events: [],
  });
  assert.notEqual(firstTick[0].closeWon, secondTick[0].closeWon);
});

test('a forming candle does not reveal an event before its start second', () => {
  const minuteStartMs = Date.parse('2026-07-11T12:00:00Z');
  const futureEvent: MarketAdminEvent = {
    id: 'future-news',
    stockId: PROFILE.stockId,
    kind: 'news',
    title: '아직 공개되지 않은 소식',
    impactBps: 100,
    startsAt: '2026-07-11T12:00:30Z',
    endsAt: '2026-07-11T12:01:00Z',
    revision: 1,
  };
  const beforeEvent = buildMinuteCandles({
    profile: PROFILE,
    startMs: minuteStartMs,
    endMs: minuteStartMs + 60_000,
    nowMs: minuteStartMs + 10_000,
    events: [futureEvent],
  });
  const atEvent = buildMinuteCandles({
    profile: PROFILE,
    startMs: minuteStartMs,
    endMs: minuteStartMs + 60_000,
    nowMs: minuteStartMs + 30_000,
    events: [futureEvent],
  });

  assert.deepEqual(beforeEvent[0].newsIds, []);
  assert.deepEqual(atEvent[0].newsIds, ['future-news']);
});

test('a forming candle uses the exact millisecond now for event overlap', () => {
  const minuteStartMs = Date.parse('2026-07-11T12:00:00Z');
  const eventStartsMs = minuteStartMs + 29_500;
  const fractionalEvent: MarketAdminEvent = {
    id: 'fractional-news',
    stockId: PROFILE.stockId,
    kind: 'news',
    title: '밀리초 경계 소식',
    impactBps: 100,
    startsAt: new Date(eventStartsMs).toISOString(),
    endsAt: new Date(minuteStartMs + 60_000).toISOString(),
    revision: 1,
  };
  const buildAt = (nowMs: number) => buildMinuteCandles({
    profile: PROFILE,
    startMs: minuteStartMs,
    endMs: minuteStartMs + 60_000,
    nowMs,
    events: [fractionalEvent],
  })[0].newsIds;

  assert.deepEqual(buildAt(minuteStartMs + 29_100), []);
  assert.deepEqual(buildAt(eventStartsMs), ['fractional-news']);
  assert.deepEqual(buildAt(eventStartsMs + 1), ['fractional-news']);
});

test('candle builders return at most the latest six hundred bars', () => {
  const startMs = Date.parse('2026-07-01T00:00:00Z');
  const candles = buildMinuteCandles({
    profile: PROFILE,
    startMs,
    endMs: startMs + 601 * 60_000,
    nowMs: startMs + 601 * 60_000,
    events: [],
  });

  assert.equal(candles.length, 600);
  assert.equal(candles[0].startsAt, new Date(startMs + 60_000).toISOString());
  assert.equal(aggregateCandles(Array.from({ length: 601 }, (_, minute) => ({
    startsAt: new Date(startMs + minute * 60_000).toISOString(),
    openWon: 1,
    highWon: 1,
    lowWon: 1,
    closeWon: 1,
    newsIds: [],
  })), '1m').length, 600);
});

test('integrated hourly candles preserve all forty-eight requested hours', () => {
  const startMs = Date.parse('2026-07-01T00:00:00Z');
  const endMs = startMs + 48 * 60 * 60_000;
  const candles = buildCandles({
    profile: PROFILE,
    startMs,
    endMs,
    nowMs: endMs,
    events: [],
    interval: '1h',
  });

  assert.equal(candles.length, 48);
  assert.equal(candles[0].startsAt, new Date(startMs).toISOString());
  assert.equal(candles.at(-1)?.startsAt, new Date(endMs - 60 * 60_000).toISOString());
});

test('integrated monthly candles apply the six-hundred cap after hourly aggregation', () => {
  const startMs = Date.parse('2026-06-01T00:00:00Z');
  const endMs = startMs + 30 * 24 * 60 * 60_000;
  const candles = buildCandles({
    profile: CONSTANT_PROFILE,
    startMs,
    endMs,
    nowMs: endMs,
    events: [],
    interval: '1h',
  });

  assert.equal(candles.length, 600);
  assert.equal(candles[0].startsAt, new Date(startMs + 120 * 60 * 60_000).toISOString());
  assert.equal(candles.at(-1)?.startsAt, new Date(endMs - 60 * 60_000).toISOString());
  assert.ok(candles.every((candle) => (
    candle.openWon === CONSTANT_PROFILE.basePriceWon
    && candle.highWon === CONSTANT_PROFILE.basePriceWon
    && candle.lowWon === CONSTANT_PROFILE.basePriceWon
    && candle.closeWon === CONSTANT_PROFILE.basePriceWon
  )));
});

test('integrated daily candles preserve the full six-month source range', () => {
  const startMs = Date.parse('2026-01-01T00:00:00Z');
  const endMs = startMs + 180 * 24 * 60 * 60_000;
  const candles = buildCandles({
    profile: CONSTANT_PROFILE,
    startMs,
    endMs,
    nowMs: endMs,
    events: [],
    interval: '1d',
  });

  assert.equal(candles.length, 180);
  assert.equal(candles[0].startsAt, new Date(startMs).toISOString());
  assert.equal(candles.at(-1)?.startsAt, new Date(endMs - 24 * 60 * 60_000).toISOString());
});

test('same profile, UTC instant, and events produce byte-identical model output', () => {
  const dayStartMs = Date.parse('2026-07-13T00:00:00.000Z');
  const minuteStartMs = dayStartMs + 61 * 60_000;
  const event: MarketAdminEvent = {
    id: 'deterministic-news',
    stockId: PROFILE.stockId,
    kind: 'news',
    title: '결정론 확인',
    impactBps: 240,
    startsAt: new Date(minuteStartMs + 5_000).toISOString(),
    endsAt: new Date(minuteStartMs + 50_000).toISOString(),
    revision: 17,
  };

  const firstDaily = getMarketDailyCheckpoint({ ...PROFILE }, dayStartMs, [{ ...event }]);
  const secondDaily = getMarketDailyCheckpoint({ ...PROFILE }, dayStartMs, [{ ...event }]);
  const firstMinute = getMarketMinuteBar(
    { ...PROFILE },
    minuteStartMs,
    minuteStartMs + 42_321,
    [{ ...event }],
  );
  const secondMinute = getMarketMinuteBar(
    { ...PROFILE },
    minuteStartMs,
    minuteStartMs + 42_321,
    [{ ...event }],
  );

  assert.equal(JSON.stringify(firstDaily), JSON.stringify(secondDaily));
  assert.equal(JSON.stringify(firstMinute), JSON.stringify(secondMinute));
});

test('partial minute does not observe a future event or future tick', () => {
  const minuteStartMs = Date.parse('2026-07-13T01:00:00.000Z');
  const observedUntilMs = minuteStartMs + 19_000;
  const before = getMarketMinuteBar(PROFILE, minuteStartMs, observedUntilMs, []);
  const withFuture = getMarketMinuteBar(PROFILE, minuteStartMs, observedUntilMs, [{
    id: 'future',
    stockId: PROFILE.stockId,
    revision: 1,
    kind: 'shock-up',
    title: '아직 오지 않은 충격',
    impactBps: 900,
    startsAt: new Date(minuteStartMs + 40_000).toISOString(),
    endsAt: null,
  }]);
  const observedPrices = Array.from({ length: 20 }, (_, second) => (
    getLivePriceWon(PROFILE, minuteStartMs + second * 1000, [])
  ));

  assert.deepEqual(withFuture, before);
  assert.equal(before.openWon, observedPrices[0]);
  assert.equal(before.highWon, Math.max(...observedPrices));
  assert.equal(before.lowWon, Math.min(...observedPrices));
  assert.equal(before.closeWon, observedPrices.at(-1));
});

test('daily checkpoints and minute bars contain safe integer OHLC and volume values', () => {
  const profile = {
    ...PROFILE,
    stockId: 'safe-integers',
    basePriceWon: Math.floor(Number.MAX_SAFE_INTEGER / 8),
    volatilityBps: 2600,
    idiosyncraticVolatilityBps: 2600,
    jumpSensitivity: 3,
    baseMinuteVolume: 9_000_000_000,
  } as MarketInstrumentProfile;
  const dayStartMs = Date.parse('2026-06-01T00:00:00.000Z');
  const daily = getMarketDailyCheckpoint(profile, dayStartMs, []);
  const minute = getMarketMinuteBar(
    profile,
    dayStartMs + 12 * 60_000,
    dayStartMs + 12 * 60_000 + 59_999,
    [],
  );

  for (const row of [daily, minute]) {
    for (const value of [
      row.openWon,
      row.highWon,
      row.lowWon,
      row.closeWon,
      row.volumeShares,
    ]) {
      assert.ok(Number.isSafeInteger(value), String(value));
      assert.ok(value >= 0, String(value));
    }
    assert.ok(row.lowWon <= row.openWon);
    assert.ok(row.lowWon <= row.closeWon);
    assert.ok(row.highWon >= row.openWon);
    assert.ok(row.highWon >= row.closeWon);
  }
});

test('each daily close is exactly the next UTC day open', () => {
  const firstDayMs = Date.parse('2026-01-01T00:00:00.000Z');
  const checkpoints = Array.from({ length: 45 }, (_, day) => (
    getMarketDailyCheckpoint(PROFILE, firstDayMs + day * 24 * 60 * 60_000, [])
  ));

  for (let index = 0; index < checkpoints.length - 1; index += 1) {
    assert.equal(checkpoints[index].closeWon, checkpoints[index + 1].openWon);
  }
});

test('daily checkpoint OHLCV exactly aggregates all completed minute bars', () => {
  const dayStartMs = Date.parse('2026-05-17T00:00:00.000Z');
  const checkpoint = getMarketDailyCheckpoint(DAILY_MINUTE_PARITY_PROFILE, dayStartMs, []);
  const minuteBars = Array.from({ length: 24 * 60 }, (_, minute) => {
    const minuteStartMs = dayStartMs + minute * 60_000;
    return getMarketMinuteBar(
      DAILY_MINUTE_PARITY_PROFILE,
      minuteStartMs,
      minuteStartMs + 59_999,
      [],
    );
  });

  assert.deepEqual({
    openWon: checkpoint.openWon,
    highWon: checkpoint.highWon,
    lowWon: checkpoint.lowWon,
    closeWon: checkpoint.closeWon,
    volumeShares: checkpoint.volumeShares,
  }, {
    openWon: minuteBars[0].openWon,
    highWon: Math.max(...minuteBars.map((bar) => bar.highWon)),
    lowWon: Math.min(...minuteBars.map((bar) => bar.lowWon)),
    closeWon: minuteBars.at(-1)?.closeWon,
    volumeShares: minuteBars.reduce((sum, bar) => sum + bar.volumeShares, 0),
  });
});

test('event-free completed day close exactly equals the next UTC day open', () => {
  const dayStarts = [
    Date.parse('2026-05-17T00:00:00.000Z'),
    Date.parse('2025-03-09T00:00:00.000Z'),
    Date.parse('2026-07-12T00:00:00.000Z'),
  ];

  for (const dayStartMs of dayStarts) {
    const completed = getMarketDailyCheckpoint(DAILY_MINUTE_PARITY_PROFILE, dayStartMs, []);
    const nextDay = getMarketDailyCheckpoint(
      DAILY_MINUTE_PARITY_PROFILE,
      dayStartMs + 24 * 60 * 60_000,
      [],
    );
    assert.equal(
      completed.closeWon,
      nextDay.openWon,
      new Date(dayStartMs).toISOString(),
    );
  }
});

test('a future non-overlapping event leaves a past daily checkpoint byte-identical', () => {
  const dayStartMs = Date.parse('2026-05-18T00:00:00.000Z');
  const withoutFuture = getMarketDailyCheckpoint(PROFILE, dayStartMs, []);
  const futureEvent: MarketAdminEvent = {
    id: 'after-checkpoint-day',
    stockId: PROFILE.stockId,
    revision: 1,
    kind: 'shock-up',
    title: '다음 날 이후의 충격',
    impactBps: 900,
    startsAt: new Date(dayStartMs + 2 * 24 * 60 * 60_000).toISOString(),
    endsAt: null,
  };
  const withFuture = getMarketDailyCheckpoint(PROFILE, dayStartMs, [futureEvent]);

  assert.equal(JSON.stringify(withFuture), JSON.stringify(withoutFuture));
});

test('the 180-day path compounds instead of resetting around the reference price', () => {
  const firstDayMs = Date.parse('2026-01-01T00:00:00.000Z');
  const closes = Array.from({ length: 180 }, (_, day) => (
    getMarketDailyCheckpoint(PROFILE, firstDayMs + day * 24 * 60 * 60_000, []).closeWon
  ));
  const oldFixedBandFraction = PROFILE.volatilityBps / 10_000;

  assert.ok(new Set(closes).size > 120);
  assert.ok(closes.some((closeWon) => (
    Math.abs(closeWon / PROFILE.basePriceWon - 1) > oldFixedBandFraction * 1.25
  )));
});

test('shared market and sector factors create stronger same-sector correlation', () => {
  const studioA = {
    stockId: 'correlation-studio-a',
    basePriceWon: 12_000,
    volatilityBps: 150,
    phase: 0.17,
    sectorId: 'studio',
    marketBeta: 0.7,
    sectorBeta: 1.1,
    idiosyncraticVolatilityBps: 35,
    longTermDriftBps: 0,
    baseMinuteVolume: 20_000,
    jumpSensitivity: 0,
  } as MarketInstrumentProfile;
  const studioB = { ...studioA, stockId: 'correlation-studio-b', phase: 0.71 };
  const platform = {
    ...studioA,
    stockId: 'correlation-platform',
    phase: 0.43,
    sectorId: 'platform' as const,
  };
  const firstDayMs = Date.parse('2026-01-01T00:00:00.000Z');
  const closesFor = (profile: MarketInstrumentProfile) => Array.from({ length: 181 }, (_, day) => (
    getMarketDailyCheckpoint(profile, firstDayMs + day * 24 * 60 * 60_000, []).closeWon
  ));
  const studioAReturns = logReturns(closesFor(studioA));
  const sameSectorCorrelation = correlation(studioAReturns, logReturns(closesFor(studioB)));
  const crossSectorCorrelation = correlation(studioAReturns, logReturns(closesFor(platform)));

  assert.ok(sameSectorCorrelation > 0.35, String(sameSectorCorrelation));
  assert.ok(
    sameSectorCorrelation > crossSectorCorrelation + 0.15,
    `${sameSectorCorrelation} vs ${crossSectorCorrelation}`,
  );
});

test('minute returns retain deterministic volatility clustering', () => {
  const profile = {
    stockId: 'volatility-cluster',
    basePriceWon: 100_000,
    volatilityBps: 260,
    phase: 0.57,
    sectorId: 'creative-tools',
    marketBeta: 0,
    sectorBeta: 0,
    idiosyncraticVolatilityBps: 260,
    longTermDriftBps: 0,
    baseMinuteVolume: 10_000,
    jumpSensitivity: 0,
  } as MarketInstrumentProfile;
  const dayStartMs = Date.parse('2026-07-12T00:00:00.000Z');
  const absoluteReturns = Array.from({ length: 720 }, (_, minute) => {
    const minuteStartMs = dayStartMs + minute * 60_000;
    const bar = getMarketMinuteBar(profile, minuteStartMs, minuteStartMs + 59_999, []);
    return Math.abs(Math.log(bar.closeWon / bar.openWon));
  });
  const sorted = [...absoluteReturns.slice(0, -1)].sort((left, right) => left - right);
  const lowThreshold = sorted[Math.floor(sorted.length * 0.25)];
  const highThreshold = sorted[Math.floor(sorted.length * 0.75)];
  const afterLow: number[] = [];
  const afterHigh: number[] = [];
  for (let index = 0; index < absoluteReturns.length - 1; index += 1) {
    if (absoluteReturns[index] <= lowThreshold) afterLow.push(absoluteReturns[index + 1]);
    if (absoluteReturns[index] >= highThreshold) afterHigh.push(absoluteReturns[index + 1]);
  }
  const mean = (values: readonly number[]) => (
    values.reduce((sum, value) => sum + value, 0) / values.length
  );

  assert.ok(mean(afterHigh) > mean(afterLow) * 1.05, `${mean(afterHigh)} vs ${mean(afterLow)}`);
});

test('natural daily jumps stay inside the twenty-four percent log-return cap', () => {
  const profile = {
    ...PROFILE,
    stockId: 'jump-cap',
    basePriceWon: 50_000,
    volatilityBps: 1000,
    idiosyncraticVolatilityBps: 1000,
    jumpSensitivity: 100,
  } as MarketInstrumentProfile;
  const firstDayMs = Date.parse('2025-01-01T00:00:00.000Z');
  const checkpoints = Array.from({ length: 366 }, (_, day) => (
    getMarketDailyCheckpoint(profile, firstDayMs + day * 24 * 60 * 60_000, [])
  ));

  for (const checkpoint of checkpoints) {
    const dailyLogReturn = Math.log(checkpoint.closeWon / checkpoint.openWon);
    assert.ok(Math.abs(dailyLogReturn) <= 0.241, String(dailyLogReturn));
  }
});

test('halt freezes price and makes observed volume zero', () => {
  const minuteStartMs = Date.parse('2026-07-13T01:00:00.000Z');
  const halt: MarketAdminEvent = {
    id: 'full-minute-halt',
    stockId: PROFILE.stockId,
    revision: 1,
    kind: 'halt',
    title: '거래 정지',
    impactBps: 0,
    startsAt: new Date(minuteStartMs - 10_000).toISOString(),
    endsAt: new Date(minuteStartMs + 120_000).toISOString(),
  };
  const bar = getMarketMinuteBar(PROFILE, minuteStartMs, minuteStartMs + 59_999, [halt]);
  const frozenPriceWon = getLivePriceWon(
    PROFILE,
    Date.parse(halt.startsAt) - 1000,
    [halt],
  );

  assert.equal(bar.openWon, frozenPriceWon);
  assert.equal(bar.openWon, bar.closeWon);
  assert.equal(bar.lowWon, bar.highWon);
  assert.equal(bar.volumeShares, 0);
});

test('ended shocks decay toward a residual level instead of disappearing', () => {
  const startsAtMs = Date.parse('2026-07-13T01:00:00.000Z');
  const endsAtMs = startsAtMs + 10 * 60_000;
  const shock: MarketAdminEvent = {
    id: 'residual-shock',
    stockId: PROFILE.stockId,
    revision: 1,
    kind: 'shock-up',
    title: '잔존 충격',
    impactBps: 2000,
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
  };
  const immediateMs = endsAtMs + 60_000;
  const laterMs = endsAtMs + 12 * 60 * 60_000;
  const immediateEffect = Math.log(
    getLivePriceWon(PROFILE, immediateMs, [shock]) / getLivePriceWon(PROFILE, immediateMs, []),
  );
  const laterEffect = Math.log(
    getLivePriceWon(PROFILE, laterMs, [shock]) / getLivePriceWon(PROFILE, laterMs, []),
  );

  assert.ok(immediateEffect > laterEffect, `${immediateEffect} vs ${laterEffect}`);
  assert.ok(laterEffect > 0.01, String(laterEffect));
});

test('an ended trend keeps its accumulated final level', () => {
  const startsAtMs = Date.parse('2026-07-13T01:00:00.000Z');
  const endsAtMs = startsAtMs + 60 * 60_000;
  const trend: MarketAdminEvent = {
    id: 'completed-trend',
    stockId: PROFILE.stockId,
    revision: 1,
    kind: 'trend',
    title: '누적 추세',
    impactBps: 800,
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
  };
  const effectAt = (nowMs: number) => Math.log(
    getLivePriceWon(PROFILE, nowMs, [trend]) / getLivePriceWon(PROFILE, nowMs, []),
  );
  const justAfter = effectAt(endsAtMs + 60_000);
  const muchLater = effectAt(endsAtMs + 12 * 60 * 60_000);

  assert.ok(justAfter > 0.05, String(justAfter));
  assert.ok(Math.abs(justAfter - muchLater) < 0.003, `${justAfter} vs ${muchLater}`);
});
