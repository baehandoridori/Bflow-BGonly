import { useEffect } from 'react';
import { ArrowRight, CheckCircle2, Newspaper, Target } from 'lucide-react';

import { getStockQuote } from '@/features/playground/market/domain';
import type { MarketSnapshot, MarketStock } from '@/features/playground/market/types';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';
import {
  FavoriteStockCard,
  MarketRowsScaleProvider,
  StockListRow,
} from './MarketRows';

interface MarketHomeProps {
  focusAllStocksRequestId: number | null;
  onOpenStock(stockId: string): void;
}

const RECOMMENDED_IDS = ['jbbj', 'youtube', 'wacom'];

function marketCounts(stocks: MarketStock[]) {
  return stocks.reduce((counts, stock) => {
    const trend = getStockQuote(stock).trend;
    counts[trend] += 1;
    return counts;
  }, { up: 0, down: 0, flat: 0 });
}

function missionLabel(snapshot: MarketSnapshot): string {
  if (snapshot.beginnerMission === 'favorite') return '주식 하나 찜하기';
  if (snapshot.beginnerMission === 'reason') return '가격이 움직인 이유 읽기';
  return '100P로 첫 주문 연습하기';
}

export function MarketHome({ focusAllStocksRequestId, onOpenStock }: MarketHomeProps) {
  const snapshot = useMarketPreviewStore((state) => state.visible);
  const mutating = useMarketPreviewStore((state) => state.mutating);
  const execute = useMarketPreviewStore((state) => state.execute);
  const hasSnapshot = snapshot !== null;

  useEffect(() => {
    if (focusAllStocksRequestId === null) return;
    const heading = document.getElementById('all-stocks-heading');
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus();
  }, [focusAllStocksRequestId, hasSnapshot]);

  if (!snapshot) return null;

  const wished = new Set(snapshot.favoriteStockIds);
  const favoriteStocks = snapshot.stocks.filter((stock) => wished.has(stock.id));
  const featuredStocks = favoriteStocks.length > 0
    ? favoriteStocks.slice(0, 3)
    : RECOMMENDED_IDS
      .map((id) => snapshot.stocks.find((stock) => stock.id === id))
      .filter((stock): stock is MarketStock => Boolean(stock));
  const counts = marketCounts(snapshot.stocks);

  const toggleFavorite = (stock: MarketStock) => {
    if (mutating) return;
    void execute({
      kind: 'favorite',
      requestId: crypto.randomUUID(),
      stockId: stock.id,
      wished: !wished.has(stock.id),
    });
  };

  const openStockAfterReadingReason = async (stockId: string) => {
    if (mutating) return;
    await execute({
      kind: 'read-reason',
      requestId: crypto.randomUUID(),
      stockId,
    });
    onOpenStock(stockId);
  };

  const showAllFavorites = () => {
    const firstFavoriteId = favoriteStocks[0]?.id;
    const target = firstFavoriteId
      ? document.getElementById(`stock-row-open-${firstFavoriteId}`)
      : document.getElementById('all-stocks-heading');
    target?.scrollIntoView({ block: 'center' });
    target?.focus();
  };

  const runMissionAction = () => {
    if (snapshot.beginnerMission === 'favorite') {
      const target = document.getElementById(`stock-list-favorite-${snapshot.stocks[0]?.id ?? ''}`);
      target?.scrollIntoView({ block: 'center' });
      target?.focus();
      return;
    }
    if (snapshot.beginnerMission === 'reason') {
      const news = snapshot.news[0];
      if (news) void openStockAfterReadingReason(news.stockId);
      return;
    }
    const firstStock = snapshot.stocks[0];
    if (firstStock) onOpenStock(firstStock.id);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-7 sm:px-7 sm:py-9">
      <h1 id="market-page-title" tabIndex={-1} className="text-3xl font-bold tracking-tight text-text-primary outline-none">
        JBBJ 시장 홈
      </h1>

      <MarketRowsScaleProvider stocks={snapshot.stocks}>
        <section className="mt-7 rounded-2xl border border-bg-border bg-bg-card p-5 sm:p-6" aria-labelledby="market-today-heading">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-secondary">{snapshot.marketOpenLabel}</p>
              <h2 id="market-today-heading" className="mt-2 text-2xl font-bold text-text-primary">
                오늘의 JBBJ 시장
              </h2>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                회사의 역할과 오늘 움직인 이유부터 편하게 살펴보세요.
              </p>
            </div>
            <dl className="grid shrink-0 grid-cols-3 gap-2 text-center sm:min-w-72">
              <div className="rounded-xl bg-bg-primary/55 px-3 py-3">
                <dt className="text-xs text-text-secondary">상승 ▲</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-text-primary">{counts.up}개</dd>
              </div>
              <div className="rounded-xl bg-bg-primary/55 px-3 py-3">
                <dt className="text-xs text-text-secondary">하락 ▼</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-text-primary">{counts.down}개</dd>
              </div>
              <div className="rounded-xl bg-bg-primary/55 px-3 py-3">
                <dt className="text-xs text-text-secondary">보합 ―</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-text-primary">{counts.flat}개</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="mt-10" aria-labelledby="favorites-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="favorites-heading" className="text-xl font-bold text-text-primary">찜한 주식</h2>
              <p className="mt-1 text-sm text-text-secondary">
                {favoriteStocks.length > 0
                  ? '관심 있는 회사의 오늘 흐름을 먼저 보여드려요.'
                  : '아직 찜한 주식이 없어 초심자 추천을 보여드려요.'}
              </p>
            </div>
            {favoriteStocks.length >= 4 && (
              <button
                type="button"
                onClick={showAllFavorites}
                className="min-h-11 cursor-pointer rounded-xl px-3 py-2 text-sm font-semibold text-text-primary transition-colors duration-200 hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                찜한 주식 {favoriteStocks.length}개 모두 보기
              </button>
            )}
          </div>
          <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {featuredStocks.map((stock) => (
              <FavoriteStockCard
                key={stock.id}
                stock={stock}
                wished={wished.has(stock.id)}
                onOpen={() => void openStockAfterReadingReason(stock.id)}
                onToggleFavorite={() => toggleFavorite(stock)}
              />
            ))}
          </div>
        </section>

        <section className="mt-10" aria-labelledby="news-heading">
          <div className="flex items-center gap-2">
            <Newspaper aria-hidden="true" size={20} className="text-accent-sub" />
            <h2 id="news-heading" className="text-xl font-bold text-text-primary">
              오늘 가격에 영향을 준 소식
            </h2>
          </div>
          <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
            {snapshot.news.slice(0, 3).map((item) => {
              const stock = snapshot.stocks.find((candidate) => candidate.id === item.stockId);
              const quote = stock ? getStockQuote(stock) : null;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={mutating}
                  onClick={() => void openStockAfterReadingReason(item.stockId)}
                  className="min-w-0 cursor-pointer whitespace-normal rounded-2xl border border-bg-border bg-bg-card p-5 text-left transition-colors duration-200 hover:border-accent/55 hover:bg-bg-border/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-sm font-semibold text-text-primary">{stock?.name ?? '관련 종목'}</span>
                  <span className="mt-2 block text-base font-semibold leading-6 text-text-primary">{item.title}</span>
                  <span className="mt-3 block text-sm leading-6 text-text-secondary">
                    {quote && quote.trend === 'up'
                      ? `이 소식 뒤 오늘 ${Math.abs(quote.changeRate).toFixed(1)}% 올랐어요.`
                      : quote && quote.trend === 'down'
                        ? `이 소식 뒤 오늘 ${Math.abs(quote.changeRate).toFixed(1)}% 내렸어요.`
                        : '오늘 가격은 특별한 변화 없이 이어졌어요.'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-10 scroll-mt-5" aria-labelledby="all-stocks-heading">
          <h2 id="all-stocks-heading" tabIndex={-1} className="text-xl font-bold text-text-primary outline-none">
            모든 주식
          </h2>
          <p className="mt-1 text-sm text-text-secondary">8개 회사의 가격과 오늘 움직인 이유를 한 번에 비교해 보세요.</p>
          <div className="mt-4 space-y-3">
            {snapshot.stocks.map((stock) => (
              <div key={stock.id} className="min-w-0">
                <StockListRow
                  stock={stock}
                  wished={wished.has(stock.id)}
                  onOpen={() => void openStockAfterReadingReason(stock.id)}
                  onToggleFavorite={() => toggleFavorite(stock)}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 pb-5" aria-labelledby="beginner-mission-heading">
          <div className="flex items-center gap-2">
            <Target aria-hidden="true" size={20} className="text-accent-sub" />
            <h2 id="beginner-mission-heading" className="text-xl font-bold text-text-primary">초보 미션</h2>
          </div>
          {snapshot.beginnerMission === 'complete' ? (
            <details className="mt-4 rounded-2xl border border-bg-border bg-bg-card px-5 py-4">
              <summary className="cursor-pointer text-sm font-semibold text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 aria-hidden="true" size={18} className="text-accent-sub" />
                  첫 투자 둘러보기를 마쳤어요
                </span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-text-secondary">이제 관심 있는 회사를 자유롭게 둘러보세요.</p>
            </details>
          ) : (
            <button
              type="button"
              disabled={mutating}
              onClick={runMissionAction}
              className="mt-4 flex min-h-14 w-full min-w-0 cursor-pointer items-center justify-between gap-4 whitespace-normal rounded-2xl border border-accent/35 bg-accent/10 px-5 py-4 text-left transition-colors duration-200 hover:border-accent/65 hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>
                <span className="block text-xs font-semibold text-text-secondary">지금 할 일 한 가지</span>
                <span className="mt-1 block text-base font-bold text-text-primary">{missionLabel(snapshot)}</span>
              </span>
              <ArrowRight aria-hidden="true" size={20} className="shrink-0 text-accent-sub" />
            </button>
          )}
        </section>
      </MarketRowsScaleProvider>
    </div>
  );
}
