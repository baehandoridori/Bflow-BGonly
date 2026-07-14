import {
  getMarketEventCheckpointCacheStats,
  getMarketDailyCheckpoint as getRawMarketDailyCheckpoint,
  getMarketMinuteBar as getRawMarketMinuteBar,
  getMarketPriceWon,
  MARKET_PROFILE_ENHANCEMENT_DEFAULTS,
} from './playgroundMarketModel.mjs';
import {
  AUTONOMOUS_NEWS_DECAY_MS,
  getAutonomousMarketEventsForRange,
  getAutonomousMarketNewsForNow,
} from './playgroundMarketAutoNews.mjs';

const AUTO_NEWS_LOOKBACK_MS = 24 * 60 * 60_000;

export const MARKET_INSTRUMENT_PROFILES = {
  jbbj: {
    stockId: 'jbbj', basePriceWon: 1842, volatilityBps: 180, phase: 0.37,
    ...MARKET_PROFILE_ENHANCEMENT_DEFAULTS.jbbj,
  },
  youtube: {
    stockId: 'youtube', basePriceWon: 1260, volatilityBps: 135, phase: 0.11,
    ...MARKET_PROFILE_ENHANCEMENT_DEFAULTS.youtube,
  },
  'meta-comedy': {
    stockId: 'meta-comedy', basePriceWon: 920, volatilityBps: 220, phase: 0.73,
    ...MARKET_PROFILE_ENHANCEMENT_DEFAULTS['meta-comedy'],
  },
  netflix: {
    stockId: 'netflix', basePriceWon: 1540, volatilityBps: 120, phase: 0.51,
    ...MARKET_PROFILE_ENHANCEMENT_DEFAULTS.netflix,
  },
  adobe: {
    stockId: 'adobe', basePriceWon: 770, volatilityBps: 160, phase: 0.29,
    ...MARKET_PROFILE_ENHANCEMENT_DEFAULTS.adobe,
  },
  wacom: {
    stockId: 'wacom', basePriceWon: 430, volatilityBps: 210, phase: 0.83,
    ...MARKET_PROFILE_ENHANCEMENT_DEFAULTS.wacom,
  },
  slack: {
    stockId: 'slack', basePriceWon: 610, volatilityBps: 90, phase: 0.19,
    ...MARKET_PROFILE_ENHANCEMENT_DEFAULTS.slack,
  },
  'google-drive': {
    stockId: 'google-drive', basePriceWon: 505, volatilityBps: 80, phase: 0.61,
    ...MARKET_PROFILE_ENHANCEMENT_DEFAULTS['google-drive'],
  },
};

export { getMarketEventCheckpointCacheStats };
export {
  AUTONOMOUS_NEWS_DECAY_MS,
  getAutonomousMarketEventsForRange,
  getAutonomousMarketNewsForNow,
};

export function mergeMarketEvents(manualEvents, automaticEvents) {
  const merged = [];
  const ids = new Set();
  for (const event of Array.isArray(manualEvents) ? manualEvents : []) {
    if (!event || typeof event.id !== 'string' || ids.has(event.id)) continue;
    ids.add(event.id);
    merged.push(event);
  }
  for (const event of Array.isArray(automaticEvents) ? automaticEvents : []) {
    if (!event || typeof event.id !== 'string' || ids.has(event.id)) continue;
    ids.add(event.id);
    merged.push(event);
  }
  return merged;
}

export function getEffectiveMarketEventsForRange(startMs, endMs, manualEvents) {
  if (![startMs, endMs].every(Number.isFinite)) {
    throw new RangeError('effective market event range must use finite timestamps');
  }
  const automaticEvents = getAutonomousMarketEventsForRange(
    startMs - AUTO_NEWS_LOOKBACK_MS - AUTONOMOUS_NEWS_DECAY_MS,
    endMs,
  );
  return mergeMarketEvents(manualEvents, automaticEvents);
}

export function getMarketDailyCheckpoint(profile, dayStartMs, manualEvents) {
  return getRawMarketDailyCheckpoint(
    profile,
    dayStartMs,
    getEffectiveMarketEventsForRange(dayStartMs, dayStartMs + 24 * 60 * 60_000, manualEvents),
  );
}

export function getMarketMinuteBar(profile, minuteStartMs, observedUntilMs, manualEvents) {
  return getRawMarketMinuteBar(
    profile,
    minuteStartMs,
    observedUntilMs,
    getEffectiveMarketEventsForRange(minuteStartMs, observedUntilMs, manualEvents),
  );
}

export function getLivePriceWon(profile, nowMs, manualEvents) {
  return getMarketPriceWon(
    profile,
    nowMs,
    getEffectiveMarketEventsForRange(nowMs, nowMs, manualEvents),
  );
}

export function getCanonicalMarketQuoteWon(stockId, nowMs, events) {
  const profile = MARKET_INSTRUMENT_PROFILES[stockId];
  if (!profile) throw new RangeError('unknown market stock');
  return getLivePriceWon(profile, nowMs, events);
}
