import { Minus, Plus, WalletCards } from 'lucide-react';

import { getMarketHoldingSummary } from '@/features/playground/market/domain';
import { formatShares, formatWon } from '@/features/playground/market/format';
import {
  MARKET_SHARE_CHOICES,
  type MarketOrderController,
  type MarketShareChoice,
} from './useMarketOrderController';

interface MarketOrderPanelProps {
  controller: MarketOrderController;
}

const MARKET_SHARE_CHOICE_LABELS: Record<MarketShareChoice, string> = {
  1: '1주',
  5: '5주',
  10: '10주',
  max: '최대',
};

function signedWon(value: number): string {
  if (value > 0) return `+${formatWon(value)}`;
  if (value < 0) return `-${formatWon(Math.abs(value))}`;
  return `±${formatWon(0)}`;
}

function signedRate(value: number): string {
  if (value > 0) return `+${value.toFixed(2)}%`;
  if (value < 0) return `-${Math.abs(value).toFixed(2)}%`;
  return '±0.00%';
}

export function MarketOrderPanel({ controller }: MarketOrderPanelProps) {
  const { snapshot, stock } = controller;
  const preview = controller.previewBySide.buy ?? controller.previewBySide.sell;
  if (!snapshot || !stock || !preview) return null;

  const holding = snapshot.account.holdings.find((item) => item.stockId === stock.id);
  const holdingSummary = getMarketHoldingSummary(holding, preview.quotedPriceWon);
  const holdingQuantity = holding?.quantityShares ?? 0;
  const pnlTone = holdingSummary.unrealizedPnlWon > 0
    ? 'text-market-up'
    : holdingSummary.unrealizedPnlWon < 0
      ? 'text-market-down'
      : 'text-market-flat';
  const sellReason = controller.validationBySide.sell
    ?? (controller.controlsDisabled
      ? controller.error ?? '주문 정보를 확인하는 중이에요.'
      : '이 수량을 판매할 수 있어요.');
  const buyReason = controller.validationBySide.buy
    ?? (controller.controlsDisabled
      ? controller.error ?? '주문 정보를 확인하는 중이에요.'
      : '이 수량을 구매할 수 있어요.');

  const controlClass = 'cursor-pointer transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out motion-reduce:transition-none active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card';

  return (
    <div className="min-w-0">
      <section
        data-market-order-section="quote"
        aria-label="현재 가격과 예수금"
        className="grid grid-cols-2 gap-3 rounded-xl bg-bg-primary/45 p-3"
      >
        <div>
          <p className="text-xs font-semibold text-text-secondary">현재 가격</p>
          <p className="mt-1 text-base font-bold tabular-nums text-text-primary">
            {formatWon(preview.quotedPriceWon)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-text-secondary">예수금</p>
          <p className="mt-1 text-base font-bold tabular-nums text-text-primary">
            {formatWon(snapshot.account.cashWon)}
          </p>
        </div>
        <button
          id="order-open-account"
          type="button"
          disabled={controller.controlsDisabled}
          onClick={controller.onOpenAccount}
          className={`${controlClass} col-span-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-border/35 hover:text-text-primary`}
        >
          <WalletCards aria-hidden="true" size={17} />
          내 계좌에서 예수금 확인
        </button>
      </section>

      <fieldset
        data-market-order-section="quantity"
        disabled={controller.controlsDisabled}
        className="mt-4 min-w-0 disabled:opacity-60"
      >
        <legend className="text-sm font-bold text-text-primary">몇 주 주문할까요?</legend>
        <label htmlFor="market-order-quantity" className="mt-2 block text-xs font-semibold text-text-secondary">
          주문 수량
        </label>
        <div className="mt-2 grid min-h-12 grid-cols-[44px_minmax(0,1fr)_44px] overflow-hidden rounded-xl border border-bg-border bg-bg-primary/45 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
          <button
            type="button"
            onClick={() => controller.stepQuantity(-1)}
            aria-label="수량 1주 빼기"
            className={`${controlClass} inline-flex min-h-11 min-w-11 items-center justify-center text-text-secondary hover:bg-bg-border/35 hover:text-text-primary`}
          >
            <Minus aria-hidden="true" size={18} />
          </button>
          <div className="flex min-w-0 items-center justify-center gap-1 border-x border-bg-border px-2">
            <input
              id="market-order-quantity"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={controller.quantityInput}
              onChange={(event) => controller.setQuantityInput(event.target.value)}
              className="min-h-11 min-w-0 flex-1 bg-transparent text-center text-lg font-bold tabular-nums text-text-primary outline-none"
            />
            <span className="shrink-0 text-sm text-text-secondary" aria-hidden="true">주</span>
          </div>
          <button
            type="button"
            onClick={() => controller.stepQuantity(1)}
            aria-label="수량 1주 더하기"
            className={`${controlClass} inline-flex min-h-11 min-w-11 items-center justify-center text-text-secondary hover:bg-bg-border/35 hover:text-text-primary`}
          >
            <Plus aria-hidden="true" size={18} />
          </button>
        </div>
      </fieldset>

      <div
        data-market-order-section="presets"
        role="group"
        aria-label="빠른 수량 선택"
        className="mt-2 grid grid-cols-4 gap-2"
      >
        {MARKET_SHARE_CHOICES.map((choice) => (
          <button
            key={String(choice)}
            type="button"
            disabled={controller.controlsDisabled}
            aria-pressed={controller.selectedChoice === choice}
            aria-label={choice === 'max' ? '구매 가능한 최대' : MARKET_SHARE_CHOICE_LABELS[choice]}
            aria-describedby={choice === 'max' ? 'market-order-max-help' : undefined}
            title={choice === 'max' ? '구매 가능한 최대 수량' : undefined}
            onClick={() => controller.selectChoice(choice)}
            className={`${controlClass} min-h-11 rounded-lg border border-bg-border px-2 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-border/35 hover:text-text-primary aria-pressed:border-text-secondary aria-pressed:bg-bg-border/60 aria-pressed:text-text-primary`}
          >
            {MARKET_SHARE_CHOICE_LABELS[choice]}
          </button>
        ))}
      </div>

      <p id="market-order-max-help" className="mt-2 text-xs leading-5 text-text-secondary">
        최대는 구매 가능한 수량 기준이에요.
      </p>

      <dl
        data-market-order-section="availability"
        className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-bg-primary/45 p-3 text-sm"
      >
        <div>
          <dt className="text-xs font-semibold text-text-secondary">판매 가능</dt>
          <dd className="mt-1 font-bold tabular-nums text-market-down">
            {formatShares(controller.availableSellShares)}
          </dd>
        </div>
        <div className="text-right">
          <dt className="text-xs font-semibold text-text-secondary">구매 가능</dt>
          <dd className="mt-1 font-bold tabular-nums text-market-up">
            {formatShares(controller.availableBuyShares)}
          </dd>
        </div>
      </dl>

      <dl
        data-market-order-section="estimates"
        className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-bg-primary/45 p-3 text-sm"
      >
        <div>
          <dt className="text-xs font-semibold text-text-secondary">판매 예상 금액</dt>
          <dd className="mt-1 font-bold tabular-nums text-text-primary">
            {formatWon(controller.previewBySide.sell?.estimatedTotalWon ?? 0)}
          </dd>
        </div>
        <div className="text-right">
          <dt className="text-xs font-semibold text-text-secondary">구매 예상 금액</dt>
          <dd className="mt-1 font-bold tabular-nums text-text-primary">
            {formatWon(controller.previewBySide.buy?.estimatedTotalWon ?? 0)}
          </dd>
        </div>
      </dl>

      <section
        data-market-order-section="actions"
        aria-label="현재가 주문 선택"
        className="mt-3 grid grid-cols-2 gap-2"
      >
        <div className="min-w-0">
          <button
            id="market-order-sell-action"
            type="button"
            disabled={controller.controlsDisabled || controller.validationBySide.sell !== null}
            onClick={(event) => controller.openConfirmation('sell', event.currentTarget)}
            aria-describedby="market-order-sell-reason"
            className={`${controlClass} min-h-12 w-full rounded-xl bg-market-down px-3 py-3 text-sm font-extrabold text-bg-primary hover:bg-market-down/90`}
          >
            현재가 팔기
          </button>
          <p
            id="market-order-sell-reason"
            tabIndex={-1}
            className="mt-2 text-xs leading-5 text-text-secondary"
            aria-live="polite"
          >
            {sellReason}
          </p>
        </div>
        <div className="min-w-0">
          <button
            id="market-order-buy-action"
            type="button"
            disabled={controller.controlsDisabled || controller.validationBySide.buy !== null}
            onClick={(event) => controller.openConfirmation('buy', event.currentTarget)}
            aria-describedby="market-order-buy-reason"
            className={`${controlClass} min-h-12 w-full rounded-xl bg-market-up px-3 py-3 text-sm font-extrabold text-bg-primary hover:bg-market-up/90`}
          >
            현재가 사기
          </button>
          <p
            id="market-order-buy-reason"
            tabIndex={-1}
            className="mt-2 text-xs leading-5 text-text-secondary"
            aria-live="polite"
          >
            {buyReason}
          </p>
        </div>
      </section>

      <section
        data-market-order-section="holding"
        aria-labelledby="market-order-holding-heading"
        className="mt-4 border-t border-bg-border pt-4"
      >
        <h3 id="market-order-holding-heading" className="text-sm font-bold text-text-primary">내 보유 요약</h3>
        {holdingSummary.averagePriceWon === null ? (
          <p className="mt-3 rounded-xl bg-bg-primary/45 p-3 text-sm font-semibold text-text-primary">
            아직 보유한 주식이 없어요
          </p>
        ) : (
          <dl className="mt-2 space-y-2 text-sm">
            <div className="flex items-start justify-between gap-4 py-1">
              <dt className="text-text-secondary">내 주식 평균</dt>
              <dd className="font-semibold tabular-nums text-text-primary">
                {formatWon(holdingSummary.averagePriceWon)}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4 py-1">
              <dt className="text-text-secondary">현재 손익</dt>
              <dd className={`text-right font-semibold tabular-nums ${pnlTone}`}>
                <span className="block">{signedWon(holdingSummary.unrealizedPnlWon)}</span>
                <span className="block text-xs">{signedRate(holdingSummary.unrealizedPnlRate ?? 0)}</span>
              </dd>
            </div>
          </dl>
        )}
        <dl className="mt-2 space-y-2 text-sm">
          <div className="flex items-start justify-between gap-4 py-1">
            <dt className="text-text-secondary">보유 수량</dt>
            <dd className="font-semibold tabular-nums text-text-primary">{formatShares(holdingQuantity)}</dd>
          </div>
          <div className="flex items-start justify-between gap-4 py-1">
            <dt className="text-text-secondary">현재 평가금</dt>
            <dd className="font-semibold tabular-nums text-text-primary">
              {formatWon(holdingSummary.marketValueWon)}
            </dd>
          </div>
        </dl>
      </section>

      <section data-market-order-section="note" className="mt-4 text-center">
        {controller.error && (
          <p className="mb-2 text-sm font-semibold text-text-primary" role="status" aria-live="polite">
            {controller.error}
          </p>
        )}
        <p className="text-xs leading-5 text-text-secondary">
          실제 주문 전에는 현재 가격과 수량을 한 번 더 확인합니다.
        </p>
      </section>
    </div>
  );
}
