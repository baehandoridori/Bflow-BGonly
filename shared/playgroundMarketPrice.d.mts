export type SharedMarketEventKind = 'news' | 'shock-up' | 'shock-down' | 'trend' | 'halt';

export interface SharedMarketInstrumentProfile {
  stockId: string;
  basePriceWon: number;
  volatilityBps: number;
  phase: number;
  sectorId?: 'studio' | 'platform' | 'creative-tools' | 'collaboration';
  marketBeta?: number;
  sectorBeta?: number;
  idiosyncraticVolatilityBps?: number;
  longTermDriftBps?: number;
  baseMinuteVolume?: number;
  jumpSensitivity?: number;
}

export interface SharedMarketAdminEvent {
  id: string;
  stockId: string;
  kind: SharedMarketEventKind;
  title: string;
  impactBps: number;
  startsAt: string;
  endsAt: string | null;
  revision: number;
  automatic?: boolean;
  summary?: string;
  publishedAt?: string;
}

export const MARKET_INSTRUMENT_PROFILES: Readonly<Record<string, SharedMarketInstrumentProfile>>;

export interface SharedMarketDailyCheckpoint {
  dayStartMs: number;
  openWon: number;
  highWon: number;
  lowWon: number;
  closeWon: number;
  volumeShares: number;
  regime: 'bull' | 'bear' | 'sideways';
}

export interface SharedMarketMinuteBar {
  openWon: number;
  highWon: number;
  lowWon: number;
  closeWon: number;
  volumeShares: number;
}

export interface SharedMarketEventCheckpointCacheStats {
  hits: number;
  calculations: number;
  series: number;
  entries: number;
}

export function getMarketDailyCheckpoint(
  profile: SharedMarketInstrumentProfile,
  dayStartMs: number,
  events: readonly SharedMarketAdminEvent[],
): SharedMarketDailyCheckpoint;

export function getMarketMinuteBar(
  profile: SharedMarketInstrumentProfile,
  minuteStartMs: number,
  observedUntilMs: number,
  events: readonly SharedMarketAdminEvent[],
): SharedMarketMinuteBar;

export function getMarketEventCheckpointCacheStats(): SharedMarketEventCheckpointCacheStats;

export const AUTONOMOUS_NEWS_DECAY_MS: number;

export function getAutonomousMarketEventsForRange(
  startMs: number,
  endMs: number,
): readonly SharedMarketAdminEvent[];

export function getAutonomousMarketNewsForNow(nowMs: number): readonly SharedMarketAdminEvent[];

export function mergeMarketEvents(
  manualEvents: readonly SharedMarketAdminEvent[],
  automaticEvents: readonly SharedMarketAdminEvent[],
): readonly SharedMarketAdminEvent[];

export function getEffectiveMarketEventsForRange(
  startMs: number,
  endMs: number,
  manualEvents: readonly SharedMarketAdminEvent[],
): readonly SharedMarketAdminEvent[];

export function getLivePriceWon(
  profile: SharedMarketInstrumentProfile,
  nowMs: number,
  events: readonly SharedMarketAdminEvent[],
): number;

export function getCanonicalMarketQuoteWon(
  stockId: string,
  nowMs: number,
  events: readonly SharedMarketAdminEvent[],
): number;
