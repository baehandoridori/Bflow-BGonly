import {
  getMarketEventCheckpointCacheStats,
  getMarketDailyCheckpoint,
  getMarketMinuteBar,
  getMarketPriceWon,
  MARKET_PROFILE_ENHANCEMENT_DEFAULTS,
} from './playgroundMarketModel.mjs';

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

export {
  getMarketDailyCheckpoint,
  getMarketEventCheckpointCacheStats,
  getMarketMinuteBar,
};

export function getLivePriceWon(profile, nowMs, events) {
  return getMarketPriceWon(profile, nowMs, events);
}

export function getCanonicalMarketQuoteWon(stockId, nowMs, events) {
  const profile = MARKET_INSTRUMENT_PROFILES[stockId];
  if (!profile) throw new RangeError('unknown market stock');
  return getLivePriceWon(profile, nowMs, events);
}
