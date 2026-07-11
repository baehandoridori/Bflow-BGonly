export type SharedMarketEventKind = 'news' | 'shock-up' | 'shock-down' | 'trend' | 'halt';

export interface SharedMarketInstrumentProfile {
  stockId: string;
  basePriceWon: number;
  volatilityBps: number;
  phase: number;
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
