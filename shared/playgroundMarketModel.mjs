import { AUTONOMOUS_NEWS_DECAY_MS } from './playgroundMarketAutoNews.mjs';

export const MARKET_MODEL_REVISION = 'jbbj-cumulative-market-v1';

export const MARKET_PROFILE_ENHANCEMENT_DEFAULTS = Object.freeze({
  jbbj: {
    sectorId: 'studio', marketBeta: 0.78, sectorBeta: 0.65,
    idiosyncraticVolatilityBps: 120, longTermDriftBps: 1.4,
    baseMinuteVolume: 48_000, jumpSensitivity: 1.2,
  },
  youtube: {
    sectorId: 'platform', marketBeta: 0.9, sectorBeta: 0.75,
    idiosyncraticVolatilityBps: 80, longTermDriftBps: 1.2,
    baseMinuteVolume: 62_000, jumpSensitivity: 0.8,
  },
  'meta-comedy': {
    sectorId: 'studio', marketBeta: 0.82, sectorBeta: 0.7,
    idiosyncraticVolatilityBps: 160, longTermDriftBps: 0.8,
    baseMinuteVolume: 36_000, jumpSensitivity: 1.4,
  },
  netflix: {
    sectorId: 'platform', marketBeta: 0.72, sectorBeta: 0.6,
    idiosyncraticVolatilityBps: 75, longTermDriftBps: 1,
    baseMinuteVolume: 54_000, jumpSensitivity: 0.7,
  },
  adobe: {
    sectorId: 'creative-tools', marketBeta: 0.7, sectorBeta: 0.75,
    idiosyncraticVolatilityBps: 105, longTermDriftBps: 1.1,
    baseMinuteVolume: 32_000, jumpSensitivity: 0.9,
  },
  wacom: {
    sectorId: 'creative-tools', marketBeta: 0.65, sectorBeta: 0.8,
    idiosyncraticVolatilityBps: 150, longTermDriftBps: 0.7,
    baseMinuteVolume: 25_000, jumpSensitivity: 1.3,
  },
  slack: {
    sectorId: 'collaboration', marketBeta: 0.6, sectorBeta: 0.7,
    idiosyncraticVolatilityBps: 55, longTermDriftBps: 0.9,
    baseMinuteVolume: 28_000, jumpSensitivity: 0.6,
  },
  'google-drive': {
    sectorId: 'collaboration', marketBeta: 0.55, sectorBeta: 0.65,
    idiosyncraticVolatilityBps: 50, longTermDriftBps: 0.8,
    baseMinuteVolume: 30_000, jumpSensitivity: 0.5,
  },
});

const EPOCH_MS = Date.parse('2025-01-01T00:00:00.000Z');
const MINUTE_MS = 60_000;
const COMPLETED_MINUTE_FRACTION = (MINUTE_MS - 1) / MINUTE_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MINUTES_PER_DAY = DAY_MS / MINUTE_MS;
const KST_OFFSET_MS = 9 * 60 * MINUTE_MS;
const TREND_RAMP_MS = 60 * MINUTE_MS;
const SHOCK_ENTRY_TAU_MS = 15_000;
const SHOCK_DECAY_TAU_MS = 6 * 60 * MINUTE_MS;
const SHOCK_RESIDUAL_FRACTION = 0.2;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const HASH_OFFSET_HIGH_32 = 0xcbf29ce4;
const HASH_OFFSET_LOW_32 = 0x84222325;
const HASH_PRIME_LOW = 0x1b3;
const TWO_POW_32 = 4_294_967_296;
const TWO_POW_53 = 9_007_199_254_740_992;
const SECTOR_IDS = new Set(['studio', 'platform', 'creative-tools', 'collaboration']);
const MINUTE_PATH_CACHE_LIMIT = 96;
const EVENT_CHECKPOINT_SERIES_CACHE_LIMIT = 32;
const EVENT_CHECKPOINTS_PER_SERIES_LIMIT = 640;

const profileStateCache = new Map();
const minutePathCache = new Map();
const eventCheckpointCache = new Map();
const regimeByDay = new Map();

let eventCheckpointCacheHits = 0;
let eventCheckpointCalculations = 0;

let nextForwardRegimeDay = 0;
let nextForwardRegimeSegment = 0;
let nextBackwardRegimeDay = -1;
let nextBackwardRegimeSegment = -1;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function compareText(left, right) {
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function safeWon(value) {
  if (!Number.isFinite(value) || value >= MAX_SAFE_INTEGER) return MAX_SAFE_INTEGER;
  return Math.max(1, Math.round(value));
}

function safeShares(value) {
  if (!Number.isFinite(value) || value >= MAX_SAFE_INTEGER) return MAX_SAFE_INTEGER;
  return Math.max(0, Math.round(value));
}

function setBoundedCache(cache, key, value, maximum) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > maximum) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function getEventCheckpointSeriesCache(seriesKey) {
  const cached = eventCheckpointCache.get(seriesKey);
  if (cached) {
    setBoundedCache(
      eventCheckpointCache,
      seriesKey,
      cached,
      EVENT_CHECKPOINT_SERIES_CACHE_LIMIT,
    );
    return cached;
  }
  const seriesCache = new Map();
  setBoundedCache(
    eventCheckpointCache,
    seriesKey,
    seriesCache,
    EVENT_CHECKPOINT_SERIES_CACHE_LIMIT,
  );
  return seriesCache;
}

export function getMarketEventCheckpointCacheStats() {
  let entries = 0;
  for (const seriesCache of eventCheckpointCache.values()) entries += seriesCache.size;
  return {
    hits: eventCheckpointCacheHits,
    calculations: eventCheckpointCalculations,
    series: eventCheckpointCache.size,
    entries,
  };
}

function hash64(input) {
  let high = HASH_OFFSET_HIGH_32;
  let low = HASH_OFFSET_LOW_32;
  for (let index = 0; index < input.length; index += 1) {
    low = (low ^ input.charCodeAt(index)) >>> 0;
    const lowProduct = low * HASH_PRIME_LOW;
    high = (
      Math.imul(high, HASH_PRIME_LOW)
      + Math.floor(lowProduct / TWO_POW_32)
      + ((low << 8) >>> 0)
    ) >>> 0;
    low = lowProduct >>> 0;
  }
  return { high, low };
}

function uniform(bucket, factorId) {
  const key = `${MARKET_MODEL_REVISION}|${bucket}|${factorId}`;
  const hash = hash64(key);
  return (hash.high * 2_097_152 + (hash.low >>> 11)) / TWO_POW_53;
}

function normal(bucket, factorId) {
  const first = Math.max(Number.EPSILON, uniform(bucket, `${factorId}:u1`));
  const second = uniform(bucket, `${factorId}:u2`);
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function normalizeProfile(profile) {
  if (!profile || typeof profile.stockId !== 'string' || profile.stockId.length === 0) {
    throw new RangeError('market profile stockId is required');
  }
  const basePriceWon = safeWon(finiteOr(profile.basePriceWon, 1));
  const volatilityBps = clamp(finiteOr(profile.volatilityBps, 0), 0, 10_000);
  const phase = finiteOr(profile.phase, 0);
  const hasNaturalMovement = volatilityBps > 0;
  const enhancementDefaults = MARKET_PROFILE_ENHANCEMENT_DEFAULTS[profile.stockId] ?? {
    sectorId: 'studio',
    marketBeta: 0.65,
    sectorBeta: 0.35,
    idiosyncraticVolatilityBps: volatilityBps * 0.65,
    longTermDriftBps: 0.8,
    baseMinuteVolume: Math.max(1_000, basePriceWon * 8),
    jumpSensitivity: 1,
  };
  return {
    stockId: profile.stockId,
    basePriceWon,
    volatilityBps,
    phase,
    sectorId: SECTOR_IDS.has(profile.sectorId)
      ? profile.sectorId
      : enhancementDefaults.sectorId,
    marketBeta: hasNaturalMovement
      ? clamp(finiteOr(profile.marketBeta, enhancementDefaults.marketBeta), -3, 3)
      : 0,
    sectorBeta: hasNaturalMovement
      ? clamp(finiteOr(profile.sectorBeta, enhancementDefaults.sectorBeta), -3, 3)
      : 0,
    idiosyncraticVolatilityBps: hasNaturalMovement
      ? clamp(
        finiteOr(
          profile.idiosyncraticVolatilityBps,
          enhancementDefaults.idiosyncraticVolatilityBps,
        ),
        0,
        10_000,
      )
      : 0,
    longTermDriftBps: hasNaturalMovement
      ? clamp(finiteOr(profile.longTermDriftBps, enhancementDefaults.longTermDriftBps), -100, 100)
      : 0,
    baseMinuteVolume: clamp(
      finiteOr(profile.baseMinuteVolume, enhancementDefaults.baseMinuteVolume),
      0,
      MAX_SAFE_INTEGER,
    ),
    jumpSensitivity: hasNaturalMovement
      ? clamp(finiteOr(profile.jumpSensitivity, enhancementDefaults.jumpSensitivity), 0, 4)
      : 0,
  };
}

function profileFingerprint(profile) {
  return [
    profile.stockId,
    profile.basePriceWon,
    profile.volatilityBps,
    profile.phase,
    profile.sectorId,
    profile.marketBeta,
    profile.sectorBeta,
    profile.idiosyncraticVolatilityBps,
    profile.longTermDriftBps,
    profile.baseMinuteVolume,
    profile.jumpSensitivity,
  ].join(':');
}

function getProfileState(inputProfile) {
  const profile = normalizeProfile(inputProfile);
  const key = profileFingerprint(profile);
  let state = profileStateCache.get(key);
  if (!state) {
    state = {
      key,
      profile,
      records: new Map(),
      maxForwardDay: -1,
      nextForwardOpenWon: profile.basePriceWon,
      minBackwardDay: 0,
      nextBackwardCloseWon: profile.basePriceWon,
      summaries: new Map(),
    };
    profileStateCache.set(key, state);
  }
  return state;
}

function regimeForSegment(segmentIndex) {
  const bucket = `regime-segment:${segmentIndex}`;
  const durationDays = 3 + Math.floor(uniform(bucket, 'duration') * 16);
  const selector = uniform(bucket, 'kind');
  const regime = selector < 0.36 ? 'bull' : selector < 0.72 ? 'bear' : 'sideways';
  return { durationDays, regime };
}

function getRegime(dayIndex) {
  if (regimeByDay.has(dayIndex)) return regimeByDay.get(dayIndex);
  if (dayIndex >= 0) {
    while (nextForwardRegimeDay <= dayIndex) {
      const { durationDays, regime } = regimeForSegment(nextForwardRegimeSegment);
      for (let offset = 0; offset < durationDays; offset += 1) {
        regimeByDay.set(nextForwardRegimeDay + offset, regime);
      }
      nextForwardRegimeDay += durationDays;
      nextForwardRegimeSegment += 1;
    }
  } else {
    while (nextBackwardRegimeDay >= dayIndex) {
      const { durationDays, regime } = regimeForSegment(nextBackwardRegimeSegment);
      for (let offset = 0; offset < durationDays; offset += 1) {
        regimeByDay.set(nextBackwardRegimeDay - offset, regime);
      }
      nextBackwardRegimeDay -= durationDays;
      nextBackwardRegimeSegment -= 1;
    }
  }
  return regimeByDay.get(dayIndex);
}

function naturalDailyReturn(profile, dayIndex) {
  if (profile.volatilityBps === 0) return 0;
  const bucket = `day:${dayIndex}`;
  const regime = getRegime(dayIndex);
  const dailyVolatility = profile.volatilityBps / 10_000;
  const regimeDrift = profile.longTermDriftBps / 10_000 + (
    regime === 'bull'
      ? dailyVolatility * 0.12
      : regime === 'bear'
        ? -dailyVolatility * 0.12
        : 0
  );
  const marketShock = normal(bucket, 'market-shock') * 0.011;
  const sectorShock = normal(bucket, `sector-shock:${profile.sectorId}`) * 0.0085;
  const idiosyncraticShock = normal(
    bucket,
    `idiosyncratic-shock:${profile.stockId}:${profile.phase}`,
  ) * (profile.idiosyncraticVolatilityBps / 10_000);
  const jumpGate = uniform(bucket, `rare-jump-gate:${profile.stockId}:${profile.phase}`);
  let rareJump = 0;
  if (profile.jumpSensitivity > 0 && jumpGate < 0.009) {
    const direction = uniform(bucket, `rare-jump-direction:${profile.stockId}`) < 0.5 ? -1 : 1;
    const magnitude = Math.min(
      0.12,
      (0.018 + uniform(bucket, `rare-jump-size:${profile.stockId}`) * 0.052)
        * profile.jumpSensitivity,
    );
    rareJump = direction * magnitude;
  }
  return clamp(
    regimeDrift
      + profile.marketBeta * marketShock
      + profile.sectorBeta * sectorShock
      + idiosyncraticShock
      + rareJump,
    -0.24,
    0.24,
  );
}

function buildForwardRecordsThrough(state, requestedDay) {
  while (state.maxForwardDay < requestedDay) {
    const dayIndex = state.maxForwardDay + 1;
    const openWon = state.nextForwardOpenWon;
    const dailyReturn = naturalDailyReturn(state.profile, dayIndex);
    const closeWon = safeWon(Math.exp(Math.log(openWon) + dailyReturn));
    const record = {
      dayIndex,
      dayStartMs: EPOCH_MS + dayIndex * DAY_MS,
      openWon,
      closeWon,
      targetLogReturn: Math.log(closeWon / openWon),
      regime: getRegime(dayIndex),
    };
    state.records.set(dayIndex, record);
    state.maxForwardDay = dayIndex;
    state.nextForwardOpenWon = closeWon;
  }
}

function buildBackwardRecordsThrough(state, requestedDay) {
  while (state.minBackwardDay > requestedDay) {
    const dayIndex = state.minBackwardDay - 1;
    const closeWon = state.nextBackwardCloseWon;
    const dailyReturn = naturalDailyReturn(state.profile, dayIndex);
    const openWon = safeWon(Math.exp(Math.log(closeWon) - dailyReturn));
    const record = {
      dayIndex,
      dayStartMs: EPOCH_MS + dayIndex * DAY_MS,
      openWon,
      closeWon,
      targetLogReturn: Math.log(closeWon / openWon),
      regime: getRegime(dayIndex),
    };
    state.records.set(dayIndex, record);
    state.minBackwardDay = dayIndex;
    state.nextBackwardCloseWon = openWon;
  }
}

function getDailyRecord(state, dayIndex) {
  if (!state.records.has(dayIndex)) {
    if (dayIndex >= 0) buildForwardRecordsThrough(state, dayIndex);
    else buildBackwardRecordsThrough(state, dayIndex);
  }
  return state.records.get(dayIndex);
}

function buildMinutePath(state, dayIndex) {
  const cacheKey = `${state.key}|${dayIndex}`;
  const cached = minutePathCache.get(cacheKey);
  if (cached) {
    setBoundedCache(minutePathCache, cacheKey, cached, MINUTE_PATH_CACHE_LIMIT);
    return cached;
  }
  const profile = state.profile;
  const dailyRecord = getDailyRecord(state, dayIndex);
  const raw = new Float64Array(MINUTES_PER_DAY);
  const bridged = new Float64Array(MINUTES_PER_DAY);
  const varianceByMinute = new Float64Array(MINUTES_PER_DAY);
  const cumulativeLogReturn = new Float64Array(MINUTES_PER_DAY + 1);
  const intraAmplitude = new Float64Array(MINUTES_PER_DAY);
  const intraPhase = new Float64Array(MINUTES_PER_DAY);
  const baseVariance = (
    profile.idiosyncraticVolatilityBps / 10_000 / Math.sqrt(MINUTES_PER_DAY)
  ) ** 2;
  let variance = baseVariance;
  let previousReturn = 0;
  let rawSum = 0;

  if (profile.volatilityBps > 0) {
    for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
      const bucket = `day:${dayIndex}:minute:${minute}`;
      variance = clamp(
        baseVariance * 0.08 + variance * 0.86 + previousReturn ** 2 * 0.06,
        baseVariance * 0.35,
        baseVariance * 12,
      );
      const sharedShock = profile.marketBeta
        * normal(bucket, 'market-minute-shock') * (0.011 / Math.sqrt(MINUTES_PER_DAY));
      const sectorShock = profile.sectorBeta
        * normal(bucket, `sector-minute-shock:${profile.sectorId}`)
        * (0.0085 / Math.sqrt(MINUTES_PER_DAY));
      const idiosyncraticShock = normal(
        bucket,
        `idiosyncratic-minute-shock:${profile.stockId}:${profile.phase}`,
      );
      let jump = 0;
      if (
        profile.jumpSensitivity > 0
        && uniform(bucket, `minute-jump-gate:${profile.stockId}`) < 0.0007
      ) {
        const direction = uniform(bucket, `minute-jump-direction:${profile.stockId}`) < 0.5
          ? -1
          : 1;
        jump = direction * Math.min(
          0.035,
          (0.004 + uniform(bucket, `minute-jump-size:${profile.stockId}`) * 0.008)
            * profile.jumpSensitivity,
        );
      }
      const rawReturn = sharedShock
        + sectorShock
        + Math.sqrt(variance) * idiosyncraticShock
        + jump;
      raw[minute] = rawReturn;
      varianceByMinute[minute] = variance;
      previousReturn = rawReturn;
      rawSum += rawReturn;
      const minimumAmplitude = 0.0018;
      intraAmplitude[minute] = Math.max(Math.sqrt(baseVariance) * 2.4, minimumAmplitude)
        * (0.8 + uniform(bucket, `intra-amplitude:${profile.stockId}`) * 0.4);
      intraPhase[minute] = uniform(bucket, `intra-phase:${profile.stockId}`) * 2 * Math.PI;
    }
  }

  const correction = (dailyRecord.targetLogReturn - rawSum) / MINUTES_PER_DAY;
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
    bridged[minute] = raw[minute] + correction;
    cumulativeLogReturn[minute + 1] = cumulativeLogReturn[minute] + bridged[minute];
  }
  const path = {
    state,
    dayIndex,
    dailyRecord,
    baseVariance,
    bridged,
    varianceByMinute,
    cumulativeLogReturn,
    intraAmplitude,
    intraPhase,
    completedBaseBars: new Array(MINUTES_PER_DAY),
  };
  setBoundedCache(minutePathCache, cacheKey, path, MINUTE_PATH_CACHE_LIMIT);
  return path;
}

function basePriceFromPath(path, minute, fraction) {
  const boundedMinute = clamp(minute, 0, MINUTES_PER_DAY - 1);
  const boundedFraction = clamp(fraction, 0, 1);
  const dailyOpenLog = Math.log(path.dailyRecord.openWon);
  if (boundedFraction >= COMPLETED_MINUTE_FRACTION) {
    return safeWon(Math.exp(
      dailyOpenLog + path.cumulativeLogReturn[boundedMinute + 1],
    ));
  }
  const startLog = dailyOpenLog + path.cumulativeLogReturn[boundedMinute];
  const bridgeEnvelope = Math.sqrt(Math.max(0, Math.sin(Math.PI * boundedFraction)));
  const phase = path.intraPhase[boundedMinute];
  const bridge = path.intraAmplitude[boundedMinute]
    * bridgeEnvelope
    * (
      Math.sin(10 * Math.PI * boundedFraction + phase) * 0.65
      + Math.sin(60 * Math.PI * boundedFraction + phase * 1.61803398875) * 0.55
    );
  const unroundedPriceWon = Math.exp(
    startLog + path.bridged[boundedMinute] * boundedFraction + bridge,
  );
  const tickIndex = Math.floor(boundedFraction * 60 + 1e-9);
  const tickDirection = (tickIndex + Math.floor(phase * 1000)) % 2 === 0 ? -1 : 1;
  const microstructureWon = path.state.profile.volatilityBps === 0
    ? 0
    : tickDirection
      * Math.pow(Math.max(0, Math.sin(Math.PI * boundedFraction)), 0.15)
      * 0.9;
  return safeWon(unroundedPriceWon + microstructureWon);
}

function getBasePriceWon(state, nowMs) {
  const dayIndex = Math.floor((nowMs - EPOCH_MS) / DAY_MS);
  const dayStartMs = EPOCH_MS + dayIndex * DAY_MS;
  const elapsedMs = nowMs - dayStartMs;
  const minute = Math.min(MINUTES_PER_DAY - 1, Math.floor(elapsedMs / MINUTE_MS));
  const fraction = (elapsedMs - minute * MINUTE_MS) / MINUTE_MS;
  const path = buildMinutePath(state, dayIndex);
  return basePriceFromPath(path, minute, fraction);
}

function parseEvent(event) {
  if (!event || typeof event.id !== 'string' || typeof event.stockId !== 'string') return null;
  const startMs = Date.parse(event.startsAt);
  const endMs = event.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(event.endsAt);
  if (!Number.isFinite(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
  return { ...event, startMs, endMs };
}

function normalizeRelevantEvents(stockId, events) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.stockId === stockId)
    .map(parseEvent)
    .filter((event) => event !== null)
    .sort((left, right) => (
      left.startMs - right.startMs
      || compareText(left.id, right.id)
      || compareText(left.kind, right.kind)
      || finiteOr(left.impactBps, 0) - finiteOr(right.impactBps, 0)
      || left.endMs - right.endMs
    ));
}

function signedImpactFraction(event) {
  const impactBps = finiteOr(event.impactBps, 0);
  const directionalBps = event.kind === 'shock-up'
    ? Math.abs(impactBps)
    : event.kind === 'shock-down'
      ? -Math.abs(impactBps)
      : impactBps;
  return clamp(directionalBps / 10_000, -0.24, 0.24);
}

function eventOverlayLog(event, nowMs) {
  if (event.kind === 'halt' || nowMs < event.startMs) return 0;
  const impactFraction = signedImpactFraction(event);
  const impactLog = Math.log1p(impactFraction);
  if (event.kind === 'trend') {
    const rampEndMs = Number.isFinite(event.endMs)
      ? event.endMs
      : event.startMs + TREND_RAMP_MS;
    const progress = clamp((nowMs - event.startMs) / (rampEndMs - event.startMs), 0, 1);
    return impactLog * progress;
  }
  const elapsedMs = nowMs - event.startMs;
  if (!Number.isFinite(event.endMs) || nowMs < event.endMs) {
    return impactLog * (1 - Math.exp(-elapsedMs / SHOCK_ENTRY_TAU_MS));
  }
  const entryAtEnd = 1 - Math.exp(-(event.endMs - event.startMs) / SHOCK_ENTRY_TAU_MS);
  if (event.automatic === true) {
    const automaticFade = clamp(
      1 - (nowMs - event.endMs) / AUTONOMOUS_NEWS_DECAY_MS,
      0,
      1,
    );
    return impactLog * entryAtEnd * automaticFade;
  }
  const decayProgress = Math.exp(-(nowMs - event.endMs) / SHOCK_DECAY_TAU_MS);
  return impactLog * entryAtEnd * (
    SHOCK_RESIDUAL_FRACTION + (1 - SHOCK_RESIDUAL_FRACTION) * decayProgress
  );
}

function totalEventOverlayLog(events, nowMs) {
  return clamp(
    events.reduce((sum, event) => sum + eventOverlayLog(event, nowMs), 0),
    -4,
    4,
  );
}

function getPriceWithNormalizedEvents(state, nowMs, events, ignoredHaltIds = new Set()) {
  const activeHalt = events
    .filter((event) => (
      event.kind === 'halt'
      && !ignoredHaltIds.has(event.id)
      && nowMs >= event.startMs
      && nowMs < event.endMs
    ))
    .sort((left, right) => (
      right.startMs - left.startMs || compareText(left.id, right.id)
    ))[0];
  if (activeHalt) {
    const nextIgnoredHaltIds = new Set(ignoredHaltIds);
    nextIgnoredHaltIds.add(activeHalt.id);
    return getPriceWithNormalizedEvents(
      state,
      activeHalt.startMs - 1000,
      events,
      nextIgnoredHaltIds,
    );
  }
  const basePriceWon = getBasePriceWon(state, nowMs);
  return safeWon(Math.exp(
    Math.log(basePriceWon) + totalEventOverlayLog(events, nowMs),
  ));
}

function minuteActivityFactor(minuteStartMs) {
  const kstMsInDay = ((minuteStartMs - EPOCH_MS + KST_OFFSET_MS) % DAY_MS + DAY_MS) % DAY_MS;
  const hour = Math.floor(kstMsInDay / (60 * MINUTE_MS));
  if (hour >= 9 && hour < 12) return 1.35;
  if (hour >= 12 && hour < 14) return 0.95;
  if (hour >= 14 && hour < 18) return 1.25;
  if (hour >= 18 && hour < 23) return 0.85;
  return 0.5;
}

function tradableObservedFraction(minuteStartMs, observedUntilMs, events) {
  const observedEndExclusive = Math.min(minuteStartMs + MINUTE_MS, observedUntilMs + 1);
  const intervals = events
    .filter((event) => event.kind === 'halt')
    .map((event) => ({
      startMs: Math.max(minuteStartMs, event.startMs),
      endMs: Math.min(observedEndExclusive, event.endMs),
    }))
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  let haltedMs = 0;
  let mergedStart = null;
  let mergedEnd = null;
  for (const interval of intervals) {
    if (mergedStart === null || interval.startMs > mergedEnd) {
      if (mergedStart !== null) haltedMs += mergedEnd - mergedStart;
      mergedStart = interval.startMs;
      mergedEnd = interval.endMs;
    } else {
      mergedEnd = Math.max(mergedEnd, interval.endMs);
    }
  }
  if (mergedStart !== null) haltedMs += mergedEnd - mergedStart;
  const observedMs = Math.max(0, observedEndExclusive - minuteStartMs);
  return clamp((observedMs - haltedMs) / MINUTE_MS, 0, 1);
}

function calculateVolumeShares(
  state,
  minuteStartMs,
  observedUntilMs,
  events,
  openWon,
  closeWon,
) {
  const observedFraction = tradableObservedFraction(minuteStartMs, observedUntilMs, events);
  if (observedFraction <= 0 || state.profile.baseMinuteVolume <= 0) return 0;
  const dayIndex = Math.floor((minuteStartMs - EPOCH_MS) / DAY_MS);
  const dayStartMs = EPOCH_MS + dayIndex * DAY_MS;
  const minute = Math.floor((minuteStartMs - dayStartMs) / MINUTE_MS);
  const path = buildMinutePath(state, dayIndex);
  const baseVariance = Math.max(path.baseVariance, Number.EPSILON);
  const volatilityFactor = path.baseVariance === 0
    ? 1
    : clamp(Math.sqrt(path.varianceByMinute[minute] / baseVariance), 0.5, 4);
  const baseMinuteVolatility = Math.max(
    state.profile.volatilityBps / 10_000 / Math.sqrt(MINUTES_PER_DAY),
    0.00001,
  );
  const absoluteReturn = Math.abs(Math.log(closeWon / openWon));
  const absoluteReturnFactor = 1 + clamp(absoluteReturn / baseMinuteVolatility, 0, 5) * 0.28;
  const eventOverlay = Math.abs(totalEventOverlayLog(events, observedUntilMs));
  const eventFactor = 1 + clamp(eventOverlay * 8, 0, 3);
  const bucket = `day:${dayIndex}:minute:${minute}`;
  const deterministicNoise = 0.72
    + uniform(bucket, `volume-noise:${state.profile.stockId}`) * 0.56;
  return safeShares(
    state.profile.baseMinuteVolume
      * observedFraction
      * minuteActivityFactor(minuteStartMs)
      * volatilityFactor
      * absoluteReturnFactor
      * eventFactor
      * deterministicNoise,
  );
}

function buildSampleTimes(minuteStartMs, observedUntilMs) {
  const times = [];
  const lastWholeSecond = Math.floor((observedUntilMs - minuteStartMs) / 1000);
  for (let second = 0; second <= lastWholeSecond; second += 1) {
    times.push(minuteStartMs + second * 1000);
  }
  if (times.at(-1) !== observedUntilMs) times.push(observedUntilMs);
  return times;
}

function buildBaseCompletedMinuteBar(state, minuteStartMs) {
  const dayIndex = Math.floor((minuteStartMs - EPOCH_MS) / DAY_MS);
  const dayStartMs = EPOCH_MS + dayIndex * DAY_MS;
  const minute = Math.floor((minuteStartMs - dayStartMs) / MINUTE_MS);
  const path = buildMinutePath(state, dayIndex);
  const cached = path.completedBaseBars[minute];
  if (cached) return { ...cached };

  let openWon = 0;
  let highWon = 0;
  let lowWon = MAX_SAFE_INTEGER;
  for (let second = 0; second < 60; second += 1) {
    const priceWon = basePriceFromPath(path, minute, second / 60);
    if (second === 0) openWon = priceWon;
    highWon = Math.max(highWon, priceWon);
    lowWon = Math.min(lowWon, priceWon);
  }
  const closeWon = basePriceFromPath(path, minute, COMPLETED_MINUTE_FRACTION);
  highWon = Math.max(highWon, closeWon);
  lowWon = Math.min(lowWon, closeWon);
  const bar = {
    openWon,
    highWon,
    lowWon,
    closeWon,
    volumeShares: calculateVolumeShares(
      state,
      minuteStartMs,
      minuteStartMs + MINUTE_MS - 1,
      [],
      openWon,
      closeWon,
    ),
  };
  path.completedBaseBars[minute] = bar;
  return { ...bar };
}

function buildMinuteBar(state, minuteStartMs, observedUntilMs, events) {
  if (
    events.length === 0
    && observedUntilMs === minuteStartMs + MINUTE_MS - 1
  ) {
    return buildBaseCompletedMinuteBar(state, minuteStartMs);
  }
  const prices = buildSampleTimes(minuteStartMs, observedUntilMs)
    .map((sampleMs) => getPriceWithNormalizedEvents(state, sampleMs, events));
  const openWon = prices[0];
  const closeWon = prices.at(-1);
  return {
    openWon,
    highWon: Math.max(...prices),
    lowWon: Math.min(...prices),
    closeWon,
    volumeShares: calculateVolumeShares(
      state,
      minuteStartMs,
      observedUntilMs,
      events,
      openWon,
      closeWon,
    ),
  };
}

function aggregateCompletedDay(state, dayIndex, events) {
  const dailyRecord = getDailyRecord(state, dayIndex);
  let openWon = 0;
  let highWon = 0;
  let lowWon = MAX_SAFE_INTEGER;
  let closeWon = 0;
  let volumeShares = 0;
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
    const minuteStartMs = dailyRecord.dayStartMs + minute * MINUTE_MS;
    const bar = buildMinuteBar(
      state,
      minuteStartMs,
      minuteStartMs + MINUTE_MS - 1,
      events,
    );
    if (minute === 0) openWon = bar.openWon;
    highWon = Math.max(highWon, bar.highWon);
    lowWon = Math.min(lowWon, bar.lowWon);
    closeWon = bar.closeWon;
    volumeShares = safeShares(volumeShares + bar.volumeShares);
  }
  return {
    dayStartMs: dailyRecord.dayStartMs,
    openWon,
    highWon,
    lowWon,
    closeWon,
    volumeShares,
    regime: dailyRecord.regime,
  };
}

function getBaseDailySummary(state, dayIndex) {
  const cached = state.summaries.get(dayIndex);
  if (cached) return cached;
  const summary = aggregateCompletedDay(state, dayIndex, []);
  state.summaries.set(dayIndex, summary);
  return summary;
}

function eventCanAffectCompletedDay(event, dayStartMs) {
  const dayEndMs = dayStartMs + DAY_MS;
  if (event.startMs >= dayEndMs) return false;
  if (event.automatic === true) {
    return event.endMs + AUTONOMOUS_NEWS_DECAY_MS > dayStartMs;
  }
  return event.kind !== 'halt' || event.endMs > dayStartMs;
}

function eventsFingerprint(events) {
  return events.map((event) => [
    event.id,
    event.stockId,
    event.kind,
    finiteOr(event.impactBps, 0),
    event.startMs,
    event.endMs,
    event.automatic === true ? 'automatic' : 'manual',
  ].join(':')).join('|');
}

export function getMarketPriceWon(profile, nowMs, events) {
  if (!Number.isFinite(nowMs)) throw new RangeError('nowMs must be finite');
  const state = getProfileState(profile);
  const relevantEvents = normalizeRelevantEvents(state.profile.stockId, events);
  return getPriceWithNormalizedEvents(state, nowMs, relevantEvents);
}

export function getMarketMinuteBar(profile, minuteStartMs, observedUntilMs, events) {
  if (![minuteStartMs, observedUntilMs].every(Number.isFinite)) {
    throw new RangeError('minute timestamps must be finite');
  }
  const normalizedMinuteStartMs = Math.floor(minuteStartMs / MINUTE_MS) * MINUTE_MS;
  if (minuteStartMs !== normalizedMinuteStartMs) {
    throw new RangeError('minuteStartMs must be aligned to a UTC minute');
  }
  if (observedUntilMs < minuteStartMs) {
    throw new RangeError('observedUntilMs must not precede minuteStartMs');
  }
  const boundedObservedUntilMs = Math.min(
    observedUntilMs,
    minuteStartMs + MINUTE_MS - 1,
  );
  const state = getProfileState(profile);
  const relevantEvents = normalizeRelevantEvents(state.profile.stockId, events);
  return buildMinuteBar(state, minuteStartMs, boundedObservedUntilMs, relevantEvents);
}

export function getMarketDailyCheckpoint(profile, dayStartMs, events) {
  if (!Number.isFinite(dayStartMs)) throw new RangeError('dayStartMs must be finite');
  const dayIndex = Math.floor((dayStartMs - EPOCH_MS) / DAY_MS);
  const normalizedDayStartMs = EPOCH_MS + dayIndex * DAY_MS;
  if (dayStartMs !== normalizedDayStartMs) {
    throw new RangeError('dayStartMs must be aligned to a UTC day');
  }
  const state = getProfileState(profile);
  const relevantEvents = normalizeRelevantEvents(state.profile.stockId, events);
  const affectingEvents = relevantEvents.filter((event) => (
    eventCanAffectCompletedDay(event, normalizedDayStartMs)
  ));
  if (affectingEvents.length === 0) return { ...getBaseDailySummary(state, dayIndex) };

  const seriesKey = `${state.key}|${eventsFingerprint(affectingEvents)}`;
  const seriesCache = getEventCheckpointSeriesCache(seriesKey);
  const cached = seriesCache.get(dayIndex);
  if (cached) {
    eventCheckpointCacheHits += 1;
    setBoundedCache(
      seriesCache,
      dayIndex,
      cached,
      EVENT_CHECKPOINTS_PER_SERIES_LIMIT,
    );
    return { ...cached };
  }
  eventCheckpointCalculations += 1;
  const checkpoint = aggregateCompletedDay(state, dayIndex, affectingEvents);
  setBoundedCache(
    seriesCache,
    dayIndex,
    checkpoint,
    EVENT_CHECKPOINTS_PER_SERIES_LIMIT,
  );
  return { ...checkpoint };
}
