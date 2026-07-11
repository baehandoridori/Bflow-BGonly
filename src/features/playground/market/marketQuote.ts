import { getCanonicalMarketQuoteWon } from './livePriceEngine.ts';
import type { MarketSnapshot } from './types.ts';

export function alignMarketSecond(nowMs: number): number {
  if (!Number.isFinite(nowMs)) throw new RangeError('market clock must be finite');
  return Math.floor(nowMs / 1000) * 1000;
}

export function getMarketSnapshotQuoteWon(
  snapshot: Pick<MarketSnapshot, 'adminEvents'>,
  stockId: string,
  nowMs: number,
): number {
  return getCanonicalMarketQuoteWon(
    stockId,
    alignMarketSecond(nowMs),
    snapshot.adminEvents,
  );
}
