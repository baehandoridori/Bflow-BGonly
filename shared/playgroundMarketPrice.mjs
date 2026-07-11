export const MARKET_INSTRUMENT_PROFILES = {
  jbbj: { stockId: 'jbbj', basePriceWon: 1842, volatilityBps: 180, phase: 0.37 },
  youtube: { stockId: 'youtube', basePriceWon: 1260, volatilityBps: 135, phase: 0.11 },
  'meta-comedy': { stockId: 'meta-comedy', basePriceWon: 920, volatilityBps: 220, phase: 0.73 },
  netflix: { stockId: 'netflix', basePriceWon: 1540, volatilityBps: 120, phase: 0.51 },
  adobe: { stockId: 'adobe', basePriceWon: 770, volatilityBps: 160, phase: 0.29 },
  wacom: { stockId: 'wacom', basePriceWon: 430, volatilityBps: 210, phase: 0.83 },
  slack: { stockId: 'slack', basePriceWon: 610, volatilityBps: 90, phase: 0.19 },
  'google-drive': { stockId: 'google-drive', basePriceWon: 505, volatilityBps: 80, phase: 0.61 },
};

const MINUTE_MS = 60_000;
const TREND_RAMP_MS = 60 * MINUTE_MS;

function hashUnit(input) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

function controlValue(profile, minuteIndex) {
  const seed = `${profile.stockId}:${profile.phase}:${minuteIndex}`;
  return hashUnit(seed) * 2 - 1;
}

function smoothstep(progress) {
  return progress * progress * (3 - 2 * progress);
}

function basePrice(profile, nowMs) {
  const minuteIndex = Math.floor(nowMs / MINUTE_MS);
  const minuteProgress = (nowMs - minuteIndex * MINUTE_MS) / MINUTE_MS;
  const left = controlValue(profile, minuteIndex);
  const right = controlValue(profile, minuteIndex + 1);
  const interpolatedNoise = left + (right - left) * smoothstep(minuteProgress);
  const bridgeDirection = controlValue(profile, minuteIndex + 0.5) < 0 ? -1 : 1;
  const intraMinuteBridge = Math.sin(Math.PI * minuteProgress) * bridgeDirection;
  const movementBps = profile.volatilityBps * (interpolatedNoise + intraMinuteBridge);
  return profile.basePriceWon * (1 + movementBps / 10_000);
}

function eventBounds(event) {
  const startMs = Date.parse(event.startsAt);
  const endMs = event.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(event.endsAt);
  if (!Number.isFinite(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

function isEventActive(event, nowMs) {
  const bounds = eventBounds(event);
  return bounds !== null && nowMs >= bounds.startMs && nowMs < bounds.endMs;
}

function signedImpactBps(event, nowMs) {
  if (event.kind === 'halt') return 0;
  const directionalImpact = event.kind === 'shock-up'
    ? Math.abs(event.impactBps)
    : event.kind === 'shock-down'
      ? -Math.abs(event.impactBps)
      : event.impactBps;
  if (event.kind !== 'trend') return directionalImpact;

  const startMs = Date.parse(event.startsAt);
  const endMs = event.endsAt === null ? startMs + TREND_RAMP_MS : Date.parse(event.endsAt);
  const progress = Math.min(1, Math.max(0, (nowMs - startMs) / (endMs - startMs)));
  return directionalImpact * progress;
}

function calculatePrice(profile, nowMs, events, ignoredHaltIds) {
  const relevantEvents = events.filter((event) => event.stockId === profile.stockId);
  const activeHalt = relevantEvents
    .filter((event) => (
      event.kind === 'halt'
      && !ignoredHaltIds.has(event.id)
      && isEventActive(event, nowMs)
    ))
    .sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt))[0];

  if (activeHalt) {
    const nextIgnoredHaltIds = new Set(ignoredHaltIds);
    nextIgnoredHaltIds.add(activeHalt.id);
    return calculatePrice(
      profile,
      Date.parse(activeHalt.startsAt) - 1000,
      events,
      nextIgnoredHaltIds,
    );
  }

  const totalImpactBps = relevantEvents
    .filter((event) => event.kind !== 'halt' && isEventActive(event, nowMs))
    .reduce((sum, event) => sum + signedImpactBps(event, nowMs), 0);
  const impactedPrice = basePrice(profile, nowMs) * Math.max(0.01, 1 + totalImpactBps / 10_000);
  return Math.max(1, Math.round(impactedPrice));
}

export function getLivePriceWon(profile, nowMs, events) {
  if (!Number.isFinite(nowMs)) throw new RangeError('nowMs must be finite');
  return calculatePrice(profile, nowMs, events, new Set());
}

export function getCanonicalMarketQuoteWon(stockId, nowMs, events) {
  const profile = MARKET_INSTRUMENT_PROFILES[stockId];
  if (!profile) throw new RangeError('unknown market stock');
  return getLivePriceWon(profile, nowMs, events);
}
