import { ArrowLeft, WalletCards } from 'lucide-react';

import { getAccountSummary, holdingValuePoints } from '@/features/playground/market/domain';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';
import { useAuthStore } from '@/stores/useAuthStore';

interface MarketAccountViewProps {
  onOpenStock(stockId: string): void;
  onOpenMarketHome(): void;
}

function formatPoints(points: number): string {
  return `${points.toLocaleString('ko-KR')}P`;
}

function signedPoints(points: number): string {
  if (points === 0) return '±0P';
  return `${points > 0 ? '+' : '-'}${formatPoints(Math.abs(points))}`;
}

function resultClass(points: number): string {
  return points === 0 ? 'text-text-secondary' : 'text-text-primary';
}

function signedRate(points: number, rate: number): string {
  if (points === 0) return '±0.0% 보합';
  return `${points > 0 ? '+' : '-'}${Math.abs(rate).toFixed(1)}% ${points > 0 ? '상승' : '하락'}`;
}

export function MarketAccountView({ onOpenStock, onOpenMarketHome }: MarketAccountViewProps) {
  const snapshot = useMarketPreviewStore((state) => state.visible);
  const userName = useAuthStore((state) => state.currentUser?.name ?? '한솔');

  if (!snapshot) return null;

  const summary = getAccountSummary(snapshot);

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-7 sm:px-7 sm:py-9">
      <h1 id="market-page-title" tabIndex={-1} className="text-3xl font-bold tracking-tight text-text-primary outline-none">
        {userName}님의 투자 계좌
      </h1>
      <button
        type="button"
        onClick={onOpenMarketHome}
        className="mt-5 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-bg-border px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ArrowLeft aria-hidden="true" size={17} />
        시장 홈
      </button>

      <div className="mt-8 grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[184px_minmax(0,520px)]">
        <nav className="rounded-2xl border border-bg-border bg-bg-card p-3" aria-label="투자 계좌 메뉴">
          <ul className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-5 lg:grid-cols-1">
            <li className="rounded-xl bg-accent/15 px-3 py-3 font-semibold text-text-primary" aria-current="page">자산</li>
            {['거래내역', '주문내역', '수익분석', '계좌관리'].map((item) => (
              <li key={item} className="px-3 py-3 text-text-secondary">{item}</li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-8">
          <section aria-labelledby="account-total-heading">
            <div className="flex items-center gap-2">
              <WalletCards aria-hidden="true" size={20} className="text-accent-sub" />
              <h2 id="account-total-heading" className="text-sm font-semibold text-text-primary">투자 계좌 총자산</h2>
            </div>
            <p className="mt-3 text-4xl font-bold tabular-nums text-text-primary">{formatPoints(summary.totalAssetsPoints)}</p>
            <p className="mt-2 text-sm text-text-secondary">
              포인트 지갑 잔액 {formatPoints(summary.walletPoints)}
            </p>
          </section>

          <section className="border-t border-bg-border pt-7" aria-labelledby="available-cash-heading">
            <h2 id="available-cash-heading" className="text-lg font-bold text-text-primary">쓸 수 있는 포인트</h2>
            <div className="mt-4 flex items-center justify-between gap-5">
              <div className="min-w-0">
                <p className="font-semibold text-text-primary">내 포인트 예수금</p>
                <p className="mt-1 text-sm leading-6 text-text-secondary">주식을 바로 살 수 있는 포인트</p>
              </div>
              <p className="shrink-0 text-xl font-bold tabular-nums text-text-primary">{formatPoints(summary.cashPoints)}</p>
            </div>
          </section>

          <section className="border-t border-bg-border pt-7" aria-labelledby="holdings-list-heading">
            <h2 id="holdings-list-heading" className="text-lg font-bold text-text-primary">현재 내 투자 현황</h2>
            {snapshot.account.holdings.length > 0 ? (
              <div className="mt-3 divide-y divide-bg-border">
                {snapshot.account.holdings.map((holding) => {
                  const stock = snapshot.stocks.find((item) => item.id === holding.stockId);
                  if (!stock) return null;
                  const value = holdingValuePoints(holding, stock.pricePoints);
                  const pnl = value - holding.costBasisPoints;
                  const rate = holding.costBasisPoints > 0 ? (pnl / holding.costBasisPoints) * 100 : 0;
                  return (
                    <button
                      key={holding.stockId}
                      type="button"
                      onClick={() => onOpenStock(holding.stockId)}
                      className="flex min-h-16 w-full min-w-0 cursor-pointer items-center justify-between gap-4 whitespace-normal py-4 text-left transition-colors duration-200 hover:bg-bg-border/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-text-primary">{stock.name}</span>
                        <span className="mt-1 block text-sm text-text-secondary">{stock.symbol}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold tabular-nums text-text-primary">{formatPoints(value)}</span>
                        <span className={`mt-1 block text-sm font-semibold tabular-nums ${resultClass(pnl)}`}>
                          {signedPoints(pnl)} · {signedRate(pnl, rate)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-sm text-text-secondary">아직 보유한 주식이 없어요.</p>
            )}
          </section>

          <section className="border-t border-bg-border pt-7" aria-labelledby="investment-results-heading">
            <h2 id="investment-results-heading" className="text-lg font-bold text-text-primary">내 투자 실적</h2>
            <p className="mt-1 text-sm text-text-secondary">이번 달 기준</p>
            <dl className="mt-4 divide-y divide-bg-border text-sm">
              <div className="flex items-center justify-between gap-5 py-3 first:pt-0">
                <dt className="text-text-secondary">이번 달 전체 결과</dt>
                <dd className={`font-semibold tabular-nums ${resultClass(summary.monthlyTotalPnlPoints)}`}>
                  {signedPoints(summary.monthlyTotalPnlPoints)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-5 py-3">
                <dt className="text-text-secondary">확정된 결과</dt>
                <dd className={`font-semibold tabular-nums ${resultClass(summary.realizedPnlPoints)}`}>
                  {signedPoints(summary.realizedPnlPoints)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-5 py-3 last:pb-0">
                <dt className="text-text-secondary">보유 중 변화</dt>
                <dd className={`font-semibold tabular-nums ${resultClass(summary.monthlyUnrealizedChangePoints)}`}>
                  {signedPoints(summary.monthlyUnrealizedChangePoints)}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
