export type MarketPeriod = 'today' | 'week' | 'month' | 'all';
export type MarketTrend = 'up' | 'down' | 'flat';

export type MarketBarInterval = '1m' | '5m' | '10m' | '15m' | '1h' | '1d';
export type MarketChartRange = 'today' | 'week' | 'month' | 'six-months' | 'all';
export type MarketChartStyle = 'line' | 'candlestick';
export type MarketEventKind = 'news' | 'shock-up' | 'shock-down' | 'trend' | 'halt';

export interface MarketInstrumentProfile {
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

export interface MarketAdminEvent {
  id: string;
  stockId: string;
  kind: MarketEventKind;
  title: string;
  impactBps: number;
  startsAt: string;
  endsAt: string | null;
  revision: number;
  automatic?: boolean;
  summary?: string;
  publishedAt?: string;
}

export interface MarketAdminEventInput {
  stockId: string;
  kind: MarketEventKind;
  title: string;
  impactBps: number;
  startsAt: string;
  endsAt: string | null;
}

export interface MarketCandle {
  startsAt: string;
  openWon: number;
  highWon: number;
  lowWon: number;
  closeWon: number;
  volumeShares: number;
  newsIds: string[];
}

export interface PricePoint {
  at: string;
  priceWon: number;
  newsId?: string;
}

export interface MarketQuoteContext {
  quoteWonByStockId: Readonly<Record<string, number>>;
  previousCloseWonByStockId: Readonly<Record<string, number>>;
  sparklineByStockId: Readonly<Record<string, PricePoint[]>>;
  news: MarketNews[];
  newsByStockId: Readonly<Record<string, MarketNews[]>>;
  reasonByStockId: Readonly<Record<string, string>>;
}

export interface MarketNews {
  id: string;
  stockId: string;
  title: string;
  summary: string;
  publishedAt: string;
}

export interface MarketStock {
  id: string;
  name: string;
  symbol: string;
  character: string;
  description: string;
  referencePriceWon: number;
  previousCloseWon: number;
  reason: string;
  series: Record<MarketPeriod, PricePoint[]>;
}

export interface Holding {
  stockId: string;
  quantityShares: number;
  costBasisWon: number;
}

export interface MarketAccount {
  walletPoints: number;
  lifetimeEarnedPoints: number;
  cashWon: number;
  realizedPnlThisMonthWon: number;
  unrealizedPnlAtMonthStartWon: number;
  holdings: Holding[];
}

export type MarketRequestProbe = 'missing' | 'same' | 'conflict';

export interface MarketRemoteState {
  revision: number;
  account: MarketAccount;
  favoriteStockIds: string[];
  beginnerMission: 'favorite' | 'reason' | 'first-order' | 'complete';
  adminEvents: MarketAdminEvent[];
  requestProbe?: MarketRequestProbe;
}

export interface MarketSnapshot {
  revision: number;
  marketOpenLabel: '24시간 열림';
  stocks: MarketStock[];
  news: MarketNews[];
  favoriteStockIds: string[];
  account: MarketAccount;
  beginnerMission: 'favorite' | 'reason' | 'first-order' | 'complete';
  adminEvents: MarketAdminEvent[];
}

export type MarketCommand =
  | { kind: 'favorite'; requestId: string; stockId: string; wished: boolean }
  | { kind: 'read-reason'; requestId: string; stockId: string }
  | { kind: 'transfer'; requestId: string; direction: 'wallet-to-broker' | 'broker-to-wallet'; points: number }
  | { kind: 'buy'; requestId: string; stockId: string; quantityShares: number; quotedPriceWon: number; quotedRevision: number }
  | { kind: 'sell'; requestId: string; stockId: string; quantityShares: number | 'all'; quotedPriceWon: number; quotedRevision: number };
