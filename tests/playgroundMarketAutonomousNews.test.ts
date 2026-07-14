import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTONOMOUS_NEWS_DECAY_MS,
  getAutonomousMarketEventsForRange,
  getAutonomousMarketNewsForNow,
  MARKET_INSTRUMENT_PROFILES,
  getEffectiveMarketEventsForRange,
  getLivePriceWon,
  mergeMarketEvents,
} from '../shared/playgroundMarketPrice.mjs';

const KST_DAY_START_MS = Date.parse('2026-07-14T15:00:00.000Z');
const KST_DAY_END_MS = KST_DAY_START_MS + 24 * 60 * 60_000;

test('automatic news is deterministic, carries a KST day id, and appears only after publication', () => {
  const first = getAutonomousMarketEventsForRange(KST_DAY_START_MS, KST_DAY_END_MS - 1);
  const second = getAutonomousMarketEventsForRange(KST_DAY_START_MS, KST_DAY_END_MS - 1);

  assert.equal(first.length, 1);
  assert.deepEqual(first, second);
  assert.match(first[0].id, /^auto:2026-07-15:/);
  assert.equal(first[0].automatic, true);
  assert.ok(Date.parse(first[0].startsAt) >= KST_DAY_START_MS);
  if (first[0].endsAt === null) throw new Error('automatic news must end');
  assert.ok(Date.parse(first[0].endsAt) <= KST_DAY_END_MS);

  const publishedAt = Date.parse(first[0].startsAt);
  assert.deepEqual(getAutonomousMarketNewsForNow(publishedAt - 1), []);
  assert.deepEqual(getAutonomousMarketNewsForNow(publishedAt), first);
});

test('automatic event lookup respects the KST midnight boundary', () => {
  const midnightMs = Date.parse('2026-07-14T15:00:00.000Z');
  const events = getAutonomousMarketEventsForRange(midnightMs - 1_000, midnightMs + 1_000);

  assert.deepEqual(events.map((event) => event.id.split(':')[1]), ['2026-07-14', '2026-07-15']);
});

test('price wrapper applies automatic news and fully removes its effect after the short decay', () => {
  const [event] = getAutonomousMarketEventsForRange(KST_DAY_START_MS, KST_DAY_END_MS - 1);
  const profile = MARKET_INSTRUMENT_PROFILES[event.stockId];
  const startsAtMs = Date.parse(event.startsAt);
  if (event.endsAt === null) throw new Error('automatic news must end');
  const endsAtMs = Date.parse(event.endsAt);
  const duringNewsMs = startsAtMs + 5 * 60_000;
  const afterDecayMs = endsAtMs + AUTONOMOUS_NEWS_DECAY_MS + 1_000;
  const neutralManualEvent = { ...event, impactBps: 0, automatic: undefined };

  assert.notEqual(
    getLivePriceWon(profile, duringNewsMs, []),
    getLivePriceWon(profile, duringNewsMs, [neutralManualEvent]),
  );
  assert.equal(
    getLivePriceWon(profile, afterDecayMs, []),
    getLivePriceWon(profile, afterDecayMs, [neutralManualEvent]),
  );
});

test('manual events stay immutable and override an automatic event with the same id', () => {
  const [automatic] = getAutonomousMarketEventsForRange(KST_DAY_START_MS, KST_DAY_END_MS - 1);
  const manual = {
    ...automatic,
    title: '관리자가 덮어쓴 소식',
    impactBps: -321,
    automatic: undefined,
  };
  const manualEvents = [manual];
  const effective = getEffectiveMarketEventsForRange(
    KST_DAY_START_MS,
    KST_DAY_END_MS,
    manualEvents,
  );

  assert.equal(effective.filter((event) => event.id === automatic.id).length, 1);
  assert.deepEqual(effective.find((event) => event.id === automatic.id), manual);
  assert.deepEqual(manualEvents, [manual]);
  assert.deepEqual(
    mergeMarketEvents(manualEvents, [automatic]).find((event) => event.id === automatic.id),
    manual,
  );
});
