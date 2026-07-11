import { useEffect, useMemo } from 'react';

import type { MarketRoute, PlaygroundAction } from '@/features/playground/routes';
import { buildMarketQuoteWonByStockId } from '@/features/playground/market/marketQuote';
import { useMarketClock } from '@/features/playground/market/useMarketClock';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';
import { MarketAccountView } from './MarketAccountView';
import { MarketDataBoundary } from './MarketDataBoundary';
import { MarketHome } from './MarketHome';
import { MarketNav } from './MarketNav';
import { selectMarketLoadingVariant } from './marketDataBoundaryView';
import { StockDetailView } from './StockDetailView';

interface MarketRouterProps {
  route: MarketRoute;
  onNavigate(action: PlaygroundAction): void;
  onExit(): void;
}

export function MarketRouter({ route, onNavigate, onExit }: MarketRouterProps) {
  const visibleSnapshot = useMarketPreviewStore((state) => state.visible);
  const hasVisibleSnapshot = visibleSnapshot !== null;
  const nowMs = useMarketClock();
  const quoteWonByStockId = useMemo(() => (
    visibleSnapshot
      ? buildMarketQuoteWonByStockId(visibleSnapshot, nowMs)
      : {}
  ), [nowMs, visibleSnapshot]);

  useEffect(() => {
    if (!hasVisibleSnapshot) return;
    if (route.kind === 'home' && route.focusRequest?.target === 'all-stocks') return;
    const frame = requestAnimationFrame(() => document.getElementById('market-page-title')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [hasVisibleSnapshot, route]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-bg-primary">
      <MarketNav active={route.kind} onNavigate={onNavigate} onExit={onExit} />
      <MarketDataBoundary loadingVariant={selectMarketLoadingVariant(route)}>
        <div className="h-full min-h-0 overflow-y-auto">
          {route.kind === 'home' && (
            <MarketHome
              focusAllStocksRequestId={route.focusRequest?.target === 'all-stocks'
                ? route.focusRequest.id
                : null}
              quoteWonByStockId={quoteWonByStockId}
              onOpenStock={(stockId) => onNavigate({ kind: 'open-stock', stockId })}
            />
          )}
          {route.kind === 'stock' && (
            <StockDetailView
              stockId={route.stockId}
              nowMs={nowMs}
              currentPriceWon={quoteWonByStockId[route.stockId]}
              onOpenAccount={() => onNavigate({ kind: 'open-account' })}
              onOpenMarketHome={() => onNavigate({ kind: 'market-home' })}
            />
          )}
          {route.kind === 'account' && (
            <MarketAccountView
              quoteWonByStockId={quoteWonByStockId}
              onOpenStock={(stockId) => onNavigate({ kind: 'open-stock', stockId })}
              onOpenMarketHome={() => onNavigate({ kind: 'market-home' })}
            />
          )}
        </div>
      </MarketDataBoundary>
    </div>
  );
}
