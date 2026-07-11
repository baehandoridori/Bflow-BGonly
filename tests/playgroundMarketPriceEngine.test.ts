import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateCandles,
  buildCandles,
  buildMinuteCandles,
  resolveIntervalForRange,
} from '../src/features/playground/market/chartSeries.ts';
import { getLivePriceWon } from '../src/features/playground/market/livePriceEngine.ts';
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
