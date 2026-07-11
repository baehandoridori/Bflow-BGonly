import { useState, type ReactNode } from 'react';
import { ArrowLeft, Briefcase, Star } from 'lucide-react';

import { getStockQuote, holdingValueWon } from '@/features/playground/market/domain';
import { formatShares, formatWon } from '@/features/playground/market/format';
import type {
  MarketBarInterval,
  MarketChartRange,
  MarketStock,
  MarketTrend,
} from '@/features/playground/market/types';
import { useMarketChartPreference } from '@/features/playground/market/useMarketChartPreference';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';
import { MarketPriceChart } from './MarketPriceChart';

interface StockDetailViewProps {
  stockId: string;
  nowMs: number;
  currentPriceWon?: number;
  orderPanel?: ReactNode;
  onOpenAccount(): void;
  onOpenMarketHome(): void;
}

function trendClass(trend: MarketTrend): string {
  if (trend === 'up') return 'text-market-up';
  if (trend === 'down') return 'text-market-down';
  return 'text-market-flat';
}

function movementSummary(stock: MarketStock) {
  const quote = getStockQuote(stock);
  if (quote.trend === 'up') {
    return {
      quote,
      compact: `▲ +${formatWon(quote.changeWon)} (+${quote.changeRate.toFixed(1)}%)`,
      sentence: `오늘 ${formatWon(quote.changeWon)}, ${quote.changeRate.toFixed(1)}% 올랐어요`,
    };
  }
  if (quote.trend === 'down') {
    return {
      quote,
      compact: `▼ -${formatWon(Math.abs(quote.changeWon))} (${quote.changeRate.toFixed(1)}%)`,
      sentence: `오늘 ${formatWon(Math.abs(quote.changeWon))}, ${Math.abs(quote.changeRate).toFixed(1)}% 내렸어요`,
    };
  }
  return {
    quote,
    compact: '― ±0원 (0.0%)',
    sentence: '오늘 가격 변화 없이 보합이에요',
  };
}

function formatNewsDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function StockDetailView({
  stockId,
  nowMs,
  currentPriceWon: quotedPriceWon,
  orderPanel,
  onOpenAccount,
  onOpenMarketHome,
}: StockDetailViewProps) {
  const snapshot = useMarketPreviewStore((state) => state.visible);
  const mutating = useMarketPreviewStore((state) => state.mutating);
  const execute = useMarketPreviewStore((state) => state.execute);
  const [chartStyle, setChartStyle] = useMarketChartPreference();
  const [chartInterval, setChartInterval] = useState<MarketBarInterval>('1m');
  const [chartRange, setChartRange] = useState<MarketChartRange>('today');

  if (!snapshot) return null;

  const stock = snapshot.stocks.find((item) => item.id === stockId);
  if (!stock) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-9 sm:px-7">
        <h1 id="market-page-title" tabIndex={-1} className="text-2xl font-bold text-text-primary outline-none">
          종목을 찾지 못했어요
        </h1>
        <p className="mt-3 text-sm leading-6 text-text-secondary">시장 홈에서 다른 회사를 다시 선택해 주세요.</p>
        <button
          id="stock-open-market-home"
          type="button"
          onClick={onOpenMarketHome}
          className="mt-6 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          시장 홈으로
        </button>
      </div>
    );
  }

  const currentPriceWon = quotedPriceWon ?? stock.referencePriceWon;
  const movement = movementSummary({ ...stock, referencePriceWon: currentPriceWon });
  const wished = snapshot.favoriteStockIds.includes(stock.id);
  const holding = snapshot.account.holdings.find((item) => item.stockId === stock.id);
  const currentHoldingValue = holding ? holdingValueWon(holding, currentPriceWon) : 0;
  const holdingPnl = holding ? currentHoldingValue - holding.costBasisWon : 0;
  const holdingPnlRate = holding && holding.costBasisWon > 0
    ? (holdingPnl / holding.costBasisWon) * 100
    : 0;
  const relatedNews = snapshot.news.filter((item) => item.stockId === stock.id);

  const toggleFavorite = () => {
    if (mutating) return;
    void execute({
      kind: 'favorite',
      requestId: crypto.randomUUID(),
      stockId: stock.id,
      wished: !wished,
    });
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-5 pt-7 pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:px-7 sm:pt-9 xl:max-w-[1200px] xl:pb-9">
      <div className="flex min-w-0 flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,760px)_360px] xl:gap-x-6 xl:gap-y-4 xl:[grid-template-areas:'company_order'_'price_order'_'reason_order'_'chart_order'_'holding_.'_'news_.']">
        <section
          aria-label="회사 한 줄 설명"
          className="min-w-0 rounded-2xl border border-bg-border bg-bg-card p-5 sm:p-6 xl:[grid-area:company]"
        >
          <p className="text-sm font-semibold text-text-secondary">회사 한 줄 설명</p>
          <p className="mt-3 text-lg font-semibold leading-8 text-text-primary">{stock.description}</p>
        </section>

        <section
          aria-label="현재 가격과 오늘의 변화"
          className="min-w-0 rounded-2xl border border-bg-border bg-bg-card p-5 sm:p-6 xl:[grid-area:price]"
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              id="stock-open-market-home"
              type="button"
              onClick={onOpenMarketHome}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowLeft aria-hidden="true" size={17} />
              시장 홈
            </button>
            <button
              id="stock-open-account"
              type="button"
              onClick={onOpenAccount}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Briefcase aria-hidden="true" size={17} />
              내 계좌
            </button>
            <button
              type="button"
              aria-label={`${stock.name} ${wished ? '찜 해제' : '찜하기'}`}
              aria-pressed={wished}
              disabled={mutating}
              onClick={toggleFavorite}
              className="ml-auto inline-flex h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-bg-border px-3 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:border-accent/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Star aria-hidden="true" size={18} fill={wished ? 'currentColor' : 'none'} />
              <span className="hidden sm:inline">찜</span>
            </button>
          </div>

          <p className="mt-6 text-sm font-semibold text-text-secondary">{stock.symbol} · {stock.character}</p>
          <h1
            id="market-page-title"
            tabIndex={-1}
            className="mt-1 text-3xl font-bold tracking-tight text-text-primary outline-none"
          >
            {stock.name}
          </h1>
          <p className="mt-5 text-4xl font-bold tabular-nums text-text-primary transition-colors duration-200 motion-reduce:transition-none">{formatWon(currentPriceWon)}</p>
          <p className={`mt-3 text-base font-bold tabular-nums ${trendClass(movement.quote.trend)}`}>
            {movement.compact}
          </p>
          <p className="mt-2 text-sm leading-6 text-text-secondary">{movement.sentence}</p>
        </section>

        <section
          aria-labelledby="price-reason-heading"
          className="min-w-0 rounded-2xl border border-bg-border bg-bg-card p-5 sm:p-6 xl:[grid-area:reason]"
        >
          <h2 id="price-reason-heading" className="text-lg font-bold text-text-primary">오늘 움직인 이유</h2>
          <p className="mt-3 text-base leading-7 text-text-primary">{stock.reason}</p>
        </section>

        <section
          aria-labelledby="price-chart-heading"
          className="min-w-0 rounded-2xl border border-bg-border bg-bg-card p-5 sm:p-6 xl:[grid-area:chart]"
        >
          <h2 id="price-chart-heading" className="text-lg font-bold text-text-primary">가격 그래프</h2>
          <div className="mt-5">
            <MarketPriceChart
              stock={{ ...stock, referencePriceWon: currentPriceWon }}
              events={snapshot.adminEvents}
              nowMs={nowMs}
              style={chartStyle}
              interval={chartInterval}
              range={chartRange}
              onStyleChange={setChartStyle}
              onIntervalChange={setChartInterval}
              onRangeChange={setChartRange}
            />
          </div>
        </section>

        <section
          aria-labelledby="holding-heading"
          className="min-w-0 rounded-2xl border border-bg-border bg-bg-card p-5 sm:p-6 xl:[grid-area:holding]"
        >
          <h2 id="holding-heading" className="text-lg font-bold text-text-primary">내 보유 상태</h2>
          {holding ? (
            <>
              <dl className="mt-4 divide-y divide-bg-border text-sm">
                <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
                  <dt className="text-text-secondary">보유 수량</dt>
                  <dd className="font-semibold tabular-nums text-text-primary">{formatShares(holding.quantityShares)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-text-secondary">투자 원금</dt>
                  <dd className="font-semibold tabular-nums text-text-primary">{formatWon(holding.costBasisWon)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-text-secondary">현재 가치</dt>
                  <dd className="font-semibold tabular-nums text-text-primary">{formatWon(currentHoldingValue)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
                  <dt className="text-text-secondary">평가손익</dt>
                  <dd className={`font-semibold tabular-nums ${trendClass(holdingPnl > 0 ? 'up' : holdingPnl < 0 ? 'down' : 'flat')}`}>
                    {holdingPnl > 0 ? '▲ +' : holdingPnl < 0 ? '▼ -' : '― ±'}
                    {formatWon(Math.abs(holdingPnl))}
                    {' · '}
                    {holdingPnl > 0 ? '+' : holdingPnl < 0 ? '-' : '±'}{Math.abs(holdingPnlRate).toFixed(1)}%
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs leading-5 text-text-secondary">아직 팔지 않아 결과가 바뀔 수 있어요.</p>
            </>
          ) : (
            <div className="mt-4 rounded-xl bg-bg-primary/45 p-4">
              <p className="font-semibold text-text-primary">아직 보유하지 않음</p>
              <p className="mt-1 text-sm text-text-secondary">예수금을 옮긴 뒤 1주부터 시작할 수 있어요</p>
            </div>
          )}
        </section>

        {orderPanel && (
          <aside
            aria-labelledby="easy-order-heading"
            className="min-w-0 rounded-2xl border border-bg-border bg-bg-card p-5 sm:p-6 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-10rem)] xl:self-start xl:overflow-y-auto xl:[grid-area:order]"
          >
            <h2 id="easy-order-heading" tabIndex={-1} className="text-lg font-bold text-text-primary outline-none">간편 주문</h2>
            <p className="mt-2 text-xs leading-5 text-text-secondary">
              회사 확인 → 이유와 그래프 확인 → 원하는 정수 주식 수량으로 시작
            </p>
            <div className="mt-5">{orderPanel}</div>
          </aside>
        )}

        <section
          aria-labelledby="recent-news-heading"
          className="min-w-0 rounded-2xl border border-bg-border bg-bg-card p-5 sm:p-6 xl:[grid-area:news]"
        >
          <h2 id="recent-news-heading" className="text-lg font-bold text-text-primary">최근 소식</h2>
          {relatedNews.length > 0 ? (
            <ul className="mt-4 divide-y divide-bg-border">
              {relatedNews.map((item) => (
                <li key={item.id} className="py-4 first:pt-0 last:pb-0">
                  <p className="font-semibold leading-6 text-text-primary">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-text-secondary">{item.summary}</p>
                  <time dateTime={item.publishedAt} className="mt-2 block text-xs text-text-secondary">
                    {formatNewsDate(item.publishedAt)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text-secondary">최근 등록된 소식이 없어요.</p>
          )}
        </section>
      </div>
    </div>
  );
}
