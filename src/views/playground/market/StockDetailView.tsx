import { ArrowLeft, Briefcase } from 'lucide-react';

import { getStockQuote, holdingValuePoints } from '@/features/playground/market/domain';
import type { MarketStock, MarketTrend } from '@/features/playground/market/types';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';

interface StockDetailViewProps {
  stockId: string;
  onOpenAccount(): void;
  onOpenMarketHome(): void;
}

function formatPoints(points: number): string {
  return `${points.toLocaleString('ko-KR')}P`;
}

function trendClass(trend: MarketTrend): string {
  if (trend === 'up' || trend === 'down') return 'text-text-primary';
  return 'text-text-secondary';
}

function movementSentence(stock: MarketStock): string {
  const quote = getStockQuote(stock);
  if (quote.trend === 'up') {
    return `오늘 +${formatPoints(quote.changePoints)}, +${quote.changeRate.toFixed(1)}% 상승했어요.`;
  }
  if (quote.trend === 'down') {
    return `오늘 -${formatPoints(Math.abs(quote.changePoints))}, ${quote.changeRate.toFixed(1)}% 하락했어요.`;
  }
  return '오늘 ±0P, 0.0%로 가격 변화가 없어요.';
}

export function StockDetailView({ stockId, onOpenAccount, onOpenMarketHome }: StockDetailViewProps) {
  const snapshot = useMarketPreviewStore((state) => state.visible);

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

  const quote = getStockQuote(stock);
  const holding = snapshot.account.holdings.find((item) => item.stockId === stock.id);
  const currentHoldingValue = holding ? holdingValuePoints(holding, stock.pricePoints) : 0;
  const holdingPnl = holding ? currentHoldingValue - holding.costBasisPoints : 0;
  const holdingPnlRate = holding && holding.costBasisPoints > 0
    ? (holdingPnl / holding.costBasisPoints) * 100
    : 0;
  const todaySeries = stock.series.today;
  const startPrice = todaySeries[0]?.pricePoints ?? stock.previousClosePoints;
  const relatedNews = snapshot.news.filter((item) => item.stockId === stock.id);

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-7 sm:px-7 sm:py-9">
      <h1 id="market-page-title" tabIndex={-1} className="text-3xl font-bold tracking-tight text-text-primary outline-none">
        {stock.name}
      </h1>
      <p className="mt-1 text-sm text-text-secondary">{stock.symbol} · {stock.character}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenMarketHome}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-bg-border px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          시장 홈
        </button>
        <button
          type="button"
          onClick={onOpenAccount}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-bg-border px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Briefcase aria-hidden="true" size={17} />
          내 계좌 보기
        </button>
      </div>

      <div className="mt-8 space-y-4">
        <section className="rounded-2xl border border-bg-border bg-bg-card p-5" aria-labelledby="company-description-heading">
          <h2 id="company-description-heading" className="text-sm font-semibold text-text-secondary">회사 한 줄 설명</h2>
          <p className="mt-3 text-lg font-semibold leading-7 text-text-primary">{stock.description}</p>
        </section>

        <section className="rounded-2xl border border-bg-border bg-bg-card p-5" aria-labelledby="current-price-heading">
          <h2 id="current-price-heading" className="text-sm font-semibold text-text-secondary">현재 가격과 오늘의 변화</h2>
          <p className="mt-3 text-3xl font-bold tabular-nums text-text-primary">{formatPoints(stock.pricePoints)}</p>
          <p className={`mt-2 text-sm font-semibold tabular-nums ${trendClass(quote.trend)}`}>
            {quote.trend === 'up' ? '▲ ' : quote.trend === 'down' ? '▼ ' : '― '}
            {movementSentence(stock)}
          </p>
        </section>

        <section className="rounded-2xl border border-bg-border bg-bg-card p-5" aria-labelledby="movement-reason-heading">
          <h2 id="movement-reason-heading" className="text-sm font-semibold text-text-secondary">오늘 움직인 이유</h2>
          <p className="mt-3 text-base leading-7 text-text-primary">{stock.reason}</p>
        </section>

        <section className="rounded-2xl border border-bg-border bg-bg-card p-5" aria-labelledby="price-chart-heading">
          <h2 id="price-chart-heading" className="text-sm font-semibold text-text-secondary">가격 그래프</h2>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-bg-primary/55 p-4">
            <div>
              <p className="text-xs text-text-secondary">오늘 시작 가격</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-text-primary">{formatPoints(startPrice)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-text-secondary">현재 가격</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-text-primary">{formatPoints(stock.pricePoints)}</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-bg-border bg-bg-card p-5" aria-labelledby="holding-heading">
          <h2 id="holding-heading" className="text-sm font-semibold text-text-secondary">내 보유 상태</h2>
          {holding ? (
            <dl className="mt-4 divide-y divide-bg-border text-sm">
              <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
                <dt className="text-text-secondary">투자한 포인트</dt>
                <dd className="font-semibold tabular-nums text-text-primary">{formatPoints(holding.costBasisPoints)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-text-secondary">현재 가치</dt>
                <dd className="font-semibold tabular-nums text-text-primary">{formatPoints(currentHoldingValue)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
                <dt className="text-text-secondary">평가손익</dt>
                <dd className="font-semibold tabular-nums text-text-primary">
                  {holdingPnl === 0
                    ? '±0P · ±0.0% 보합'
                    : `${holdingPnl > 0 ? '+' : '-'}${formatPoints(Math.abs(holdingPnl))} · ${holdingPnl > 0 ? '+' : '-'}${Math.abs(holdingPnlRate).toFixed(1)}% ${holdingPnl > 0 ? '상승' : '하락'}`}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="mt-3">
              <p className="font-semibold text-text-primary">아직 보유하지 않음</p>
              <p className="mt-1 text-sm text-text-secondary">100P부터 시작할 수 있어요.</p>
            </div>
          )}
          {holding && <p className="mt-4 text-xs leading-5 text-text-secondary">아직 팔지 않아 결과가 바뀔 수 있어요.</p>}
        </section>

        <section className="rounded-2xl border border-bg-border bg-bg-card p-5" aria-labelledby="simple-order-heading">
          <h2 id="simple-order-heading" className="text-sm font-semibold text-text-secondary">간편 주문</h2>
          <p className="mt-3 text-base text-text-primary">
            지금 쓸 수 있는 예수금 <strong className="tabular-nums">{formatPoints(snapshot.account.cashPoints)}</strong>
          </p>
        </section>

        <section className="rounded-2xl border border-bg-border bg-bg-card p-5" aria-labelledby="recent-news-heading">
          <h2 id="recent-news-heading" className="text-sm font-semibold text-text-secondary">최근 소식</h2>
          {relatedNews.length > 0 ? (
            <ul className="mt-3 divide-y divide-bg-border">
              {relatedNews.map((item) => (
                <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="font-semibold leading-6 text-text-primary">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-text-secondary">{item.summary}</p>
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
