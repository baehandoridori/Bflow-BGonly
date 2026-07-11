import { WalletCards } from 'lucide-react';

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
  custom: '직접 입력',
};

export function MarketOrderPanel({ controller }: MarketOrderPanelProps) {
  const {
    snapshot,
    stock,
    side,
    choice,
    customSharesInput,
    frozenPreview,
    halted,
    controlsDisabled,
    validation,
    error,
  } = controller;
  if (!snapshot || !stock || !frozenPreview) return null;

  const projectedCashWon = side === 'buy'
    ? frozenPreview.availableCashWon - frozenPreview.estimatedTotalWon
    : frozenPreview.availableCashWon + frozenPreview.estimatedTotalWon;
  const projectedShares = side === 'buy'
    ? frozenPreview.availableShares + frozenPreview.quantityShares
    : frozenPreview.availableShares - frozenPreview.quantityShares;

  return (
    <div className="min-w-0">
      <p className="text-sm leading-6 text-text-secondary">
        현재 가격 <strong className="tabular-nums text-text-primary">{formatWon(frozenPreview.quotedPriceWon)}</strong>
        {' · '}예수금 <strong className="tabular-nums text-text-primary">{formatWon(snapshot.account.cashWon)}</strong>
      </p>

      <fieldset disabled={controlsDisabled || halted} className="mt-5 min-w-0 disabled:opacity-60">
        <legend className="sr-only">간편 주문 종류와 수량</legend>
        <div className="grid grid-cols-2 rounded-xl bg-bg-primary/55 p-1">
          {(['buy', 'sell'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={side === item}
              onClick={() => controller.selectSide(item)}
              className="min-h-11 cursor-pointer rounded-lg px-3 py-2 text-sm font-bold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:bg-bg-card aria-pressed:text-text-primary"
            >
              {item === 'buy' ? '사기' : '팔기'}
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm font-bold text-text-primary">
          {side === 'buy' ? '현재 가격으로 바로 사기' : '보유한 주식에서 골라 팔기'}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-2">
          {MARKET_SHARE_CHOICES.map((item) => (
            <button
              key={String(item)}
              type="button"
              aria-pressed={choice === item}
              onClick={() => controller.selectChoice(item)}
              className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
            >
              {MARKET_SHARE_CHOICE_LABELS[item]}
            </button>
          ))}
        </div>

        {choice === 'custom' && (
          <div className="mt-3">
            <label htmlFor="market-custom-order-shares" className="text-sm font-semibold text-text-primary">
              {side === 'buy' ? '살 수량' : '팔 수량'}
            </label>
            <div className="relative mt-2">
              <input
                id="market-custom-order-shares"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={customSharesInput}
                onChange={(event) => controller.setCustomSharesInput(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 pr-10 text-base tabular-nums text-text-primary outline-none transition-colors duration-200 motion-reduce:transition-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-text-secondary">주</span>
            </div>
          </div>
        )}
      </fieldset>

      <dl className="mt-4 space-y-3 rounded-xl bg-bg-primary/45 p-4 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-text-secondary">{side === 'buy' ? '예상 주문 금액' : '예상 받을 금액'}</dt>
          <dd className="font-semibold tabular-nums text-text-primary">
            {validation === null ? formatWon(frozenPreview.estimatedTotalWon) : '확인 필요'}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-text-secondary">주문 후 예수금</dt>
          <dd className="font-semibold tabular-nums text-text-primary">
            {validation === null ? formatWon(projectedCashWon) : '확인 필요'}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-text-secondary">주문 후 보유 수량</dt>
          <dd className="font-semibold tabular-nums text-text-primary">
            {validation === null ? formatShares(projectedShares) : '확인 필요'}
          </dd>
        </div>
      </dl>

      <p id="market-order-error" className="mt-3 min-h-5 text-sm font-semibold text-text-primary" aria-live="polite">
        {halted ? '현재 거래가 잠시 멈췄어요.' : error ?? validation ?? ''}
      </p>
      <button
        type="button"
        disabled={controlsDisabled || validation !== null || halted}
        onClick={(event) => controller.openConfirmation(event.currentTarget)}
        aria-describedby="market-order-error"
        className="mt-2 min-h-12 w-full cursor-pointer rounded-xl bg-accent px-4 py-3 text-sm font-bold text-on-accent transition-colors duration-200 motion-reduce:transition-none hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card disabled:cursor-not-allowed disabled:opacity-50"
      >
        {halted
          ? '거래 정지 중'
          : validation ?? `${formatShares(frozenPreview.quantityShares)} ${side === 'buy' ? '사기' : '팔기'}`}
      </button>

      <button
        id="order-open-account"
        type="button"
        disabled={controlsDisabled}
        onClick={controller.onOpenAccount}
        className="mt-2 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <WalletCards aria-hidden="true" size={18} />
        내 계좌에서 예수금 확인
      </button>

      <div className="mt-5 border-t border-bg-border pt-5">
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={(event) => controller.openLimit(event.currentTarget)}
          className="min-h-11 w-full cursor-pointer rounded-xl px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          원하는 가격에 주문하기
        </button>
        <p className="mt-2 text-xs leading-5 text-text-secondary">지정가 주문은 입력과 확인 모양만 미리 볼 수 있어요.</p>
      </div>
    </div>
  );
}
