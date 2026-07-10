export type MarketPeriod = 'today' | 'week' | 'month' | 'all';
export type MarketTrend = 'up' | 'down' | 'flat';

export interface PricePoint {
  at: string;
  pricePoints: number;
  newsId?: string;
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
  pricePoints: number;
  previousClosePoints: number;
  reason: string;
  series: Record<MarketPeriod, PricePoint[]>;
}

export interface Holding {
  stockId: string;
  quantityMicros: number;
  costBasisPoints: number;
}

export interface MarketAccount {
  walletPoints: number;
  cashPoints: number;
  realizedPnlThisMonthPoints: number;
  unrealizedPnlAtMonthStartPoints: number;
  holdings: Holding[];
}

export interface MarketSnapshot {
  revision: number;
  marketOpenLabel: '24시간 열림';
  stocks: MarketStock[];
  news: MarketNews[];
  favoriteStockIds: string[];
  account: MarketAccount;
  beginnerMission: 'favorite' | 'reason' | 'first-order' | 'complete';
}

export type MarketCommand =
  | { kind: 'favorite'; requestId: string; stockId: string; wished: boolean }
  | { kind: 'read-reason'; requestId: string; stockId: string }
  | { kind: 'transfer'; requestId: string; direction: 'wallet-to-broker' | 'broker-to-wallet'; points: number }
  | { kind: 'buy'; requestId: string; stockId: string; points: number }
  | { kind: 'sell'; requestId: string; stockId: string; ratioBps: number };
