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
