import { useRef, useState } from 'react';
import { WalletCards } from 'lucide-react';

import { getAccountSummary, holdingValuePoints } from '@/features/playground/market/domain';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { PointTransferDialog } from './PointTransferDialog';

interface MarketAccountViewProps {
  onOpenStock(stockId: string): void;
  onOpenMarketHome(): void;
}

type TransferDirection = 'wallet-to-broker' | 'broker-to-wallet';

const PENDING_ACCOUNT_MENU_ITEMS = ['거래내역', '주문내역', '수익분석', '계좌관리'] as const;

function formatPoints(points: number): string {
  return `${points.toLocaleString('ko-KR')}P`;
}

function signedPoints(points: number): string {
  if (points === 0) return '±0P';
  return `${points > 0 ? '+' : '-'}${formatPoints(Math.abs(points))}`;
}

function resultClass(points: number): string {
  if (points > 0) return 'text-market-up';
  if (points < 0) return 'text-market-down';
  return 'text-market-flat';
}

function signedRate(points: number, rate: number): string {
  if (points === 0) return '±0.0% 보합';
  return `${points > 0 ? '+' : '-'}${Math.abs(rate).toFixed(1)}% ${points > 0 ? '상승' : '하락'}`;
}

export function MarketAccountView({ onOpenStock, onOpenMarketHome }: MarketAccountViewProps) {
  const snapshot = useMarketPreviewStore((state) => state.visible);
  const mutating = useMarketPreviewStore((state) => state.mutating);
  const currentUser = useAuthStore((state) => state.currentUser);
  const [transferDirection, setTransferDirection] = useState<TransferDirection | null>(null);
  const depositOpenerRef = useRef<HTMLButtonElement>(null);
  const withdrawalOpenerRef = useRef<HTMLButtonElement>(null);

  if (!snapshot) return null;

  const summary = getAccountSummary(snapshot);
  const accountTitle = currentUser?.name
    ? `${currentUser.name}님의 투자 계좌`
    : '내 투자 계좌';

  return (
    <>
      <div className="mx-auto grid w-full max-w-[980px] grid-cols-1 gap-8 px-5 py-8 lg:grid-cols-[184px_minmax(0,1fr)] lg:gap-16 lg:px-8 lg:py-10">
        <nav aria-label="계좌 메뉴" className="min-w-0 self-start">
          <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-1">
            <li className="min-w-0">
              <button
                type="button"
                aria-current="page"
                className="flex min-h-11 w-full cursor-pointer items-center rounded-xl bg-accent/15 px-3 py-2 text-left text-sm font-bold text-text-primary transition-colors duration-200 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                자산
              </button>
            </li>
            {PENDING_ACCOUNT_MENU_ITEMS.map((item) => (
              <li key={item} className="min-w-0">
                <div
                  aria-disabled="true"
                  className="flex min-h-11 min-w-0 flex-col justify-center rounded-xl px-3 py-2 text-text-secondary lg:items-start"
                >
                  <span className="break-keep text-sm font-semibold">{item}</span>
                  <span className="mt-0.5 text-xs">준비 중</span>
                </div>
              </li>
            ))}
          </ul>
        </nav>

        <div className="w-full max-w-[520px] min-w-0 space-y-8">
          <header>
            <h1
              id="market-page-title"
              tabIndex={-1}
              className="break-words text-3xl font-bold tracking-tight text-text-primary outline-none"
            >
              {accountTitle}
            </h1>
            <div className="mt-6 flex items-center gap-2">
              <WalletCards aria-hidden="true" size={20} className="shrink-0 text-accent-sub" />
              <p className="text-sm font-semibold text-text-secondary">총자산</p>
            </div>
            <p className="mt-2 text-4xl font-bold tabular-nums text-text-primary">
              {formatPoints(summary.totalAssetsPoints)}
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-bg-border pt-5">
              <p className="min-w-0 text-sm text-text-secondary">
                포인트 지갑 잔액{' '}
                <strong className="whitespace-nowrap font-semibold tabular-nums text-text-primary">
                  {formatPoints(summary.walletPoints)}
                </strong>
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  ref={depositOpenerRef}
                  type="button"
                  disabled={mutating}
                  onClick={() => setTransferDirection('wallet-to-broker')}
                  className="min-h-11 cursor-pointer rounded-xl bg-accent px-4 py-2 text-sm font-bold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  넣기
                </button>
                <button
                  ref={withdrawalOpenerRef}
                  type="button"
                  disabled={mutating}
                  onClick={() => setTransferDirection('broker-to-wallet')}
                  className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-4 py-2 text-sm font-bold text-text-primary transition-colors duration-200 hover:bg-bg-border/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  빼기
                </button>
              </div>
            </div>
          </header>

          <section className="border-t border-bg-border pt-7" aria-labelledby="available-cash-heading">
            <h2 id="available-cash-heading" className="text-lg font-bold text-text-primary">
              쓸 수 있는 포인트
            </h2>
            <div className="mt-4 flex min-h-16 items-center justify-between gap-5">
              <div className="min-w-0">
                <p className="font-semibold text-text-primary">내 포인트 예수금</p>
                <p className="mt-1 text-sm leading-6 text-text-secondary">
                  주식을 바로 살 수 있는 포인트
                </p>
              </div>
              <p className="shrink-0 text-xl font-bold tabular-nums text-text-primary">
                {formatPoints(summary.cashPoints)}
              </p>
            </div>
          </section>

          <section className="border-t border-bg-border pt-7" aria-labelledby="holdings-list-heading">
            <h2 id="holdings-list-heading" className="text-lg font-bold text-text-primary">
              현재 내 투자 현황
            </h2>
            {snapshot.account.holdings.length > 0 ? (
              <div className="mt-3 divide-y divide-bg-border">
                {snapshot.account.holdings.map((holding) => {
                  const stock = snapshot.stocks.find((item) => item.id === holding.stockId);
                  if (!stock) return null;
                  const value = holdingValuePoints(holding, stock.pricePoints);
                  const pnl = value - holding.costBasisPoints;
                  const rate = holding.costBasisPoints > 0
                    ? (pnl / holding.costBasisPoints) * 100
                    : 0;
                  return (
                    <button
                      key={holding.stockId}
                      type="button"
                      onClick={() => onOpenStock(holding.stockId)}
                      className="flex min-h-[72px] w-full min-w-0 cursor-pointer items-center justify-between gap-4 whitespace-normal py-4 text-left transition-colors duration-200 hover:bg-bg-border/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <span className="min-w-0 truncate font-semibold text-text-primary">
                        {stock.name}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold tabular-nums text-text-primary">
                          {formatPoints(value)}
                        </span>
                        <span className={`mt-1 block text-sm font-semibold tabular-nums ${resultClass(pnl)}`}>
                          {signedPoints(pnl)} · {signedRate(pnl, rate)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-bg-border bg-bg-card p-5">
                <p className="text-sm text-text-secondary">아직 보유한 주식이 없어요</p>
                <button
                  type="button"
                  onClick={onOpenMarketHome}
                  className="mt-4 min-h-11 cursor-pointer rounded-xl bg-accent px-4 py-2 text-sm font-bold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  시장 홈에서 주식 둘러보기
                </button>
              </div>
            )}
          </section>

          <section className="border-t border-bg-border pt-7" aria-labelledby="investment-results-heading">
            <h2 id="investment-results-heading" className="text-lg font-bold text-text-primary">
              내 투자 실적
            </h2>
            <p className="mt-1 text-sm text-text-secondary">이번 달 기준</p>
            <dl className="mt-4 divide-y divide-bg-border text-sm">
              <div className="flex min-h-12 items-center justify-between gap-5 py-3 first:pt-0">
                <dt className="text-text-secondary">이번 달 전체 결과</dt>
                <dd className={`font-semibold tabular-nums ${resultClass(summary.monthlyTotalPnlPoints)}`}>
                  {signedPoints(summary.monthlyTotalPnlPoints)}
                </dd>
              </div>
              <div className="flex min-h-12 items-center justify-between gap-5 py-3">
                <dt className="text-text-secondary">확정된 결과</dt>
                <dd className={`font-semibold tabular-nums ${resultClass(summary.realizedPnlPoints)}`}>
                  {signedPoints(summary.realizedPnlPoints)}
                </dd>
              </div>
              <div className="flex min-h-12 items-center justify-between gap-5 py-3 last:pb-0">
                <dt className="text-text-secondary">보유 중 변화</dt>
                <dd className={`font-semibold tabular-nums ${resultClass(summary.monthlyUnrealizedChangePoints)}`}>
                  {signedPoints(summary.monthlyUnrealizedChangePoints)}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <PointTransferDialog
        direction="wallet-to-broker"
        open={transferDirection === 'wallet-to-broker'}
        openerRef={depositOpenerRef}
        onClose={() => setTransferDirection(null)}
      />
      <PointTransferDialog
        direction="broker-to-wallet"
        open={transferDirection === 'broker-to-wallet'}
        openerRef={withdrawalOpenerRef}
        onClose={() => setTransferDirection(null)}
      />
    </>
  );
}
