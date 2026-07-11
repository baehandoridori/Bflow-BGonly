import { useEffect, useMemo, useState } from 'react';

import type { MarketRoute, PlaygroundAction } from '@/features/playground/routes';
import { buildMarketQuoteWonByStockId } from '@/features/playground/market/marketQuote';
import { useMarketClock } from '@/features/playground/market/useMarketClock';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';
import { MarketAccountView } from './MarketAccountView';
import { MarketDataBoundary } from './MarketDataBoundary';
import { MarketHome } from './MarketHome';
import { MarketMobileOrderDock } from './MarketMobileOrderDock';
import { MarketNav } from './MarketNav';
import { MarketOrderDialogs } from './MarketOrderDialogs';
import { MarketOrderPanel } from './MarketOrderPanel';
import { selectMarketLoadingVariant } from './marketDataBoundaryView';
import { StockDetailView } from './StockDetailView';
import { useMarketOrderController } from './useMarketOrderController';

interface MarketRouterProps {
  route: MarketRoute;
  onNavigate(action: PlaygroundAction): void;
  onExit(): void;
  authorizedHansol: boolean;
}

interface MarketStockRouteProps {
  stockId: string;
  nowMs: number;
  currentPriceWon: number;
  onOpenAccount(): void;
  onOpenMarketHome(): void;
}

function useDesktopOrderLayout(): boolean {
  const [desktop, setDesktop] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches
  ));
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1280px)');
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return desktop;
}

function MarketStockRoute({
  stockId,
  nowMs,
  currentPriceWon,
  onOpenAccount,
  onOpenMarketHome,
}: MarketStockRouteProps) {
  const desktopOrderLayout = useDesktopOrderLayout();
  const controller = useMarketOrderController({
    stockId,
    currentPriceWon,
    nowMs,
    onOpenAccount,
  });
  useEffect(() => {
    if (desktopOrderLayout && controller.surface === 'mobile-order') controller.close();
  }, [controller.surface, desktopOrderLayout]);
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div data-market-scroll-container className="h-full min-h-0 overflow-y-auto">
        <StockDetailView
          stockId={stockId}
          nowMs={nowMs}
          currentPriceWon={currentPriceWon}
          orderPanel={desktopOrderLayout ? <MarketOrderPanel controller={controller} /> : null}
          onOpenAccount={onOpenAccount}
          onOpenMarketHome={onOpenMarketHome}
        />
      </div>
      {!desktopOrderLayout && <MarketMobileOrderDock controller={controller} />}
      <MarketOrderDialogs controller={controller} />
    </div>
  );
}

export function MarketRouter({ route, onNavigate, onExit, authorizedHansol }: MarketRouterProps) {
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
        {route.kind === 'stock' ? (
          <MarketStockRoute
            stockId={route.stockId}
            nowMs={nowMs}
            currentPriceWon={quoteWonByStockId[route.stockId] ?? 1}
            onOpenAccount={() => onNavigate({ kind: 'open-account' })}
            onOpenMarketHome={() => onNavigate({ kind: 'market-home' })}
          />
        ) : (
          <div className="h-full min-h-0 overflow-y-auto">
            {route.kind === 'home' && (
              <MarketHome
                focusAllStocksRequestId={route.focusRequest?.target === 'all-stocks'
                  ? route.focusRequest.id
                  : null}
                quoteWonByStockId={quoteWonByStockId}
                authorizedHansol={authorizedHansol}
                onOpenStock={(stockId) => onNavigate({ kind: 'open-stock', stockId })}
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
        )}
      </MarketDataBoundary>
    </div>
  );
}
