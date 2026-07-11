import type { MarketAdminEvent, MarketInstrumentProfile } from './types';

const MINUTE_MS = 60_000;
const TREND_RAMP_MS = 60 * MINUTE_MS;

function hashUnit(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

function controlValue(profile: MarketInstrumentProfile, minuteIndex: number): number {
  const seed = `${profile.stockId}:${profile.phase}:${minuteIndex}`;
  return hashUnit(seed) * 2 - 1;
}

function smoothstep(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function basePrice(profile: MarketInstrumentProfile, nowMs: number): number {
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

function eventBounds(event: MarketAdminEvent): { startMs: number; endMs: number } | null {
  const startMs = Date.parse(event.startsAt);
  const endMs = event.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(event.endsAt);
  if (!Number.isFinite(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

function isEventActive(event: MarketAdminEvent, nowMs: number): boolean {
  const bounds = eventBounds(event);
  return bounds !== null && nowMs >= bounds.startMs && nowMs < bounds.endMs;
}

function signedImpactBps(event: MarketAdminEvent, nowMs: number): number {
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

function calculatePrice(
  profile: MarketInstrumentProfile,
  nowMs: number,
  events: readonly MarketAdminEvent[],
  ignoredHaltIds: ReadonlySet<string>,
): number {
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

export function getLivePriceWon(
  profile: MarketInstrumentProfile,
  nowMs: number,
  events: readonly MarketAdminEvent[],
): number {
  if (!Number.isFinite(nowMs)) throw new RangeError('nowMs must be finite');
  return calculatePrice(profile, nowMs, events, new Set());
}
