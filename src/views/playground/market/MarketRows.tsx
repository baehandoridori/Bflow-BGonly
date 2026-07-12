import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Star } from 'lucide-react';

import {
  getNumericGeometry,
  getSharedReturnDomain,
  getStockQuote,
  toReturnSeries,
} from '@/features/playground/market/domain';
import { formatWon } from '@/features/playground/market/format';
import type {
  MarketQuoteContext,
  MarketStock,
  MarketTrend,
} from '@/features/playground/market/types';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';

export interface FavoriteStockCardProps {
  stock: MarketStock;
  quoteContext: MarketQuoteContext;
  wished: boolean;
  onOpen(): void;
  onToggleFavorite(): void;
}

export interface StockListRowProps extends FavoriteStockCardProps {}

interface MarketRowsScale {
  returnDomain: { min: number; max: number };
  timeDomain: { min: number; max: number };
}

interface MarketRowsScaleProviderProps {
  stocks: MarketStock[];
  quoteContext: MarketQuoteContext;
  children: ReactNode;
}

const MarketRowsScaleContext = createContext<MarketRowsScale | null>(null);

export function MarketRowsScaleProvider({
  stocks,
  quoteContext,
  children,
}: MarketRowsScaleProviderProps) {
  const scale = useMemo<MarketRowsScale>(() => {
    const seriesGroups = stocks.map((stock) => toReturnSeries([
      ...(quoteContext.sparklineByStockId[stock.id] ?? []),
    ]));
    const timestamps = stocks.flatMap((stock) => (
      (quoteContext.sparklineByStockId[stock.id] ?? [])
        .map((point) => Date.parse(point.at))
        .filter(Number.isFinite)
    ));
    return {
      returnDomain: getSharedReturnDomain(seriesGroups),
      timeDomain: timestamps.length > 0
        ? { min: Math.min(...timestamps), max: Math.max(...timestamps) }
        : { min: 0, max: 1 },
    };
  }, [quoteContext, stocks]);

  return (
    <MarketRowsScaleContext.Provider value={scale}>
      {children}
    </MarketRowsScaleContext.Provider>
  );
}

function quoteText(currentPriceWon: number, previousCloseWon: number) {
  const quote = getStockQuote({
    referencePriceWon: currentPriceWon,
    previousCloseWon,
  });
  if (quote.trend === 'up') {
    return {
      ...quote,
      marker: '▲',
      amount: `+${formatWon(quote.changeWon)}`,
      rate: `+${quote.changeRate.toFixed(1)}%`,
      wording: '상승',
    };
  }
  if (quote.trend === 'down') {
    return {
      ...quote,
      marker: '▼',
      amount: `-${formatWon(Math.abs(quote.changeWon))}`,
      rate: `${quote.changeRate.toFixed(1)}%`,
      wording: '하락',
    };
  }
  return {
    ...quote,
    marker: '―',
    amount: '±0원',
    rate: '0.0%',
    wording: '보합',
  };
}

function trendClass(trend: MarketTrend): string {
  if (trend === 'up') return 'text-market-up';
  if (trend === 'down') return 'text-market-down';
  return 'text-market-flat';
}

function AccessibleSparkline({
  stock,
  quoteContext,
}: Pick<FavoriteStockCardProps, 'stock' | 'quoteContext'>) {
  const shared = useContext(MarketRowsScaleContext);
  const currentPriceWon = quoteContext.quoteWonByStockId[stock.id] ?? 1;
  const previousCloseWon = quoteContext.previousCloseWonByStockId[stock.id]
    ?? currentPriceWon;
  const series = quoteContext.sparklineByStockId[stock.id] ?? [];
  const returnSeries = toReturnSeries([...series]);
  const returnDomain = shared?.returnDomain ?? getSharedReturnDomain([returnSeries]);
  const parsedTimes = series.map((point) => Date.parse(point.at));
  const localTimes = parsedTimes.filter(Number.isFinite);
  const timeDomain = shared?.timeDomain ?? (localTimes.length > 0
    ? { min: Math.min(...localTimes), max: Math.max(...localTimes) }
    : { min: 0, max: 1 });
  const width = 160;
  const height = 56;
  const baseGeometry = getNumericGeometry(returnSeries, width, height, returnDomain);
  const timeSpan = Math.max(1, timeDomain.max - timeDomain.min);
  const geometry = baseGeometry.map((point, index) => ({
    x: Number.isFinite(parsedTimes[index])
      ? ((parsedTimes[index] - timeDomain.min) / timeSpan) * width
      : point.x,
    y: point.y,
  }));
  const points = geometry.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const quote = quoteText(currentPriceWon, previousCloseWon);
  const first = series[0]?.priceWon ?? currentPriceWon;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${stock.name} 오늘 가격 그래프. ${formatWon(first)}에서 ${formatWon(currentPriceWon)}로 ${quote.wording}했어요.`}
      className={`h-14 w-full min-w-28 ${trendClass(quote.trend)}`}
      preserveAspectRatio="none"
    >
      <title>{stock.name} 오늘 가격 변화</title>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function FavoriteButton({
  id,
  className = '',
  stock,
  wished,
  onToggleFavorite,
}: Pick<FavoriteStockCardProps, 'stock' | 'wished' | 'onToggleFavorite'> & {
  id?: string;
  className?: string;
}) {
  const mutating = useMarketPreviewStore((state) => state.mutating);

  return (
    <button
      id={id}
      type="button"
      aria-label={`${stock.name} ${wished ? '찜 해제' : '찜하기'}`}
      aria-pressed={wished}
      disabled={mutating}
      onClick={onToggleFavorite}
      className={`${className} flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-bg-border bg-bg-card text-text-secondary transition-colors duration-200 hover:border-accent/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <Star aria-hidden="true" size={19} fill={wished ? 'currentColor' : 'none'} />
    </button>
  );
}

export function FavoriteStockCard({
  stock,
  quoteContext,
  wished,
  onOpen,
  onToggleFavorite,
}: FavoriteStockCardProps) {
  const currentPriceWon = quoteContext.quoteWonByStockId[stock.id] ?? 1;
  const previousCloseWon = quoteContext.previousCloseWonByStockId[stock.id]
    ?? currentPriceWon;
  const quote = quoteText(currentPriceWon, previousCloseWon);
  const mutating = useMarketPreviewStore((state) => state.mutating);

  return (
    <article className="relative min-w-0 rounded-2xl border border-bg-border bg-bg-card">
      <button
        id={`stock-card-open-${stock.id}`}
        type="button"
        disabled={mutating}
        onClick={onOpen}
        className="min-h-60 w-full min-w-0 cursor-pointer whitespace-normal rounded-2xl p-5 pr-16 text-left transition-colors duration-200 hover:bg-bg-border/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="block min-w-0">
          <span className="block truncate text-lg font-bold text-text-primary">{stock.name}</span>
          <span className="mt-1 block text-sm text-text-secondary">{stock.symbol} · {stock.character}</span>
        </span>
        <span className="mt-5 block text-2xl font-bold tabular-nums text-text-primary transition-colors duration-200 motion-reduce:transition-none">
          {formatWon(currentPriceWon)}
        </span>
        <span className={`mt-1 block text-sm font-semibold tabular-nums ${trendClass(quote.trend)}`}>
          {quote.marker} {quote.amount} · {quote.rate} {quote.wording}
        </span>
        <span className="mt-4 block">
          <AccessibleSparkline stock={stock} quoteContext={quoteContext} />
        </span>
        <span className="mt-4 block text-sm leading-6 text-text-secondary">
          {stock.reason}
        </span>
      </button>
      <FavoriteButton
        stock={stock}
        wished={wished}
        onToggleFavorite={onToggleFavorite}
        className="absolute right-3 top-3"
      />
    </article>
  );
}

export function StockListRow({
  stock,
  quoteContext,
  wished,
  onOpen,
  onToggleFavorite,
}: StockListRowProps) {
  const currentPriceWon = quoteContext.quoteWonByStockId[stock.id] ?? 1;
  const previousCloseWon = quoteContext.previousCloseWonByStockId[stock.id]
    ?? currentPriceWon;
  const quote = quoteText(currentPriceWon, previousCloseWon);
  const mutating = useMarketPreviewStore((state) => state.mutating);

  return (
    <article className="flex min-w-0 items-stretch gap-2 rounded-2xl border border-bg-border bg-bg-card p-2">
      <button
        id={`stock-row-open-${stock.id}`}
        type="button"
        disabled={mutating}
        onClick={onOpen}
        className="grid min-h-28 min-w-0 flex-1 cursor-pointer grid-cols-1 gap-3 whitespace-normal rounded-xl px-3 py-3 text-left transition-colors duration-200 hover:bg-bg-border/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 lg:grid-cols-[minmax(9rem,1.2fr)_minmax(8rem,0.9fr)_minmax(8rem,1fr)_minmax(10rem,1.5fr)] lg:items-center"
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-bold text-text-primary">{stock.name}</span>
          <span className="mt-1 block text-sm text-text-secondary">{stock.symbol} · {stock.character}</span>
        </span>
        <span className="min-w-0">
          <span className="block text-base font-bold tabular-nums text-text-primary transition-colors duration-200 motion-reduce:transition-none">
            {formatWon(currentPriceWon)}
          </span>
          <span className={`mt-1 block text-sm font-semibold tabular-nums ${trendClass(quote.trend)}`}>
            {quote.marker} {quote.amount} · {quote.rate} {quote.wording}
          </span>
        </span>
        <span className="min-w-0">
          <AccessibleSparkline stock={stock} quoteContext={quoteContext} />
        </span>
        <span className="min-w-0 text-sm leading-6 text-text-secondary">
          {stock.reason}
        </span>
      </button>
      <FavoriteButton
        id={`stock-list-favorite-${stock.id}`}
        stock={stock}
        wished={wished}
        onToggleFavorite={onToggleFavorite}
        className="self-center"
      />
    </article>
  );
}
