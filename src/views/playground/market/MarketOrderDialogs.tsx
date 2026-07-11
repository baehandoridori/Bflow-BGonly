import { ArrowLeft, Check } from 'lucide-react';

import { formatShares, formatWon } from '@/features/playground/market/format';
import { MarketActionDialog } from './MarketActionDialog';
import { MarketOrderPanel } from './MarketOrderPanel';
import type { MarketOrderController } from './useMarketOrderController';

interface MarketOrderDialogsProps {
  controller: MarketOrderController;
}

function dialogTitle(controller: MarketOrderController): string {
  if (controller.surface === 'mobile-order') return `${controller.stock?.name ?? '종목'} 주문`;
  if (controller.surface === 'confirm') return controller.confirmation?.side === 'buy'
    ? '사기 전에 한 번 확인해요'
    : '팔기 전에 한 번 확인해요';
  if (controller.surface === 'limit-review') return '원하는 가격 주문을 검토해요';
  return '원하는 가격에 주문하기';
}

export function MarketOrderDialogs({ controller }: MarketOrderDialogsProps) {
  const confirmation = controller.confirmation;
  const limitReview = controller.limitReview;

  return (
    <MarketActionDialog
      open={controller.surface !== null}
      title={dialogTitle(controller)}
      description={controller.surface === 'mobile-order'
        ? '정수 주식 수량을 고른 뒤 주문 내용을 확인합니다.'
        : controller.surface === 'confirm'
          ? '현재 가격, 수량, 예수금과 보유 수량을 마지막으로 확인합니다.'
          : '원하는 가격과 정수 주식 수량을 입력하는 미리보기입니다.'}
      focusKey={controller.surface}
      openerRef={controller.openerRef}
      onClose={controller.close}
    >
      {controller.surface === 'mobile-order' && <MarketOrderPanel controller={controller} />}

      {controller.surface === 'confirm' && confirmation && (
        <div>
          <dl className="space-y-3 rounded-2xl bg-bg-primary/45 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-text-secondary">주문</dt>
              <dd className="font-semibold text-text-primary">{confirmation.side === 'buy' ? '사기' : '팔기'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-secondary">수량</dt>
              <dd className="font-semibold tabular-nums text-text-primary">{formatShares(confirmation.quantityShares)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-secondary">확인 가격</dt>
              <dd className="font-semibold tabular-nums text-text-primary">{formatWon(confirmation.quotedPriceWon)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-secondary">예상 합계</dt>
              <dd className="font-semibold tabular-nums text-text-primary">{formatWon(confirmation.estimatedTotalWon)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-secondary">현재 예수금</dt>
              <dd className="font-semibold tabular-nums text-text-primary">{formatWon(confirmation.availableCashWon)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-secondary">현재 보유 수량</dt>
              <dd className="font-semibold tabular-nums text-text-primary">{formatShares(confirmation.availableShares)}</dd>
            </div>
          </dl>
          <p className="mt-3 min-h-5 text-sm font-semibold text-text-primary" aria-live="polite">
            {controller.error ?? ''}
          </p>
          {controller.pendingResolution && (
            <p className="mt-1 text-xs leading-5 text-text-secondary">
              주문 결과를 받지 못했어요. 같은 주문을 다시 확인하면 중복 주문 없이 결과만 확인합니다.
            </p>
          )}
          <button
            type="button"
            disabled={controller.confirmDisabled}
            onClick={() => void controller.confirm()}
            className="mt-2 min-h-12 w-full cursor-pointer rounded-xl bg-accent px-4 py-3 text-sm font-bold text-on-accent transition-colors duration-200 motion-reduce:transition-none hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {controller.submitting
              ? controller.pendingResolution ? '주문 결과를 확인하는 중…' : '주문을 저장하는 중…'
              : controller.pendingResolution
                ? '주문 결과 다시 확인'
                : `${formatShares(confirmation.quantityShares)} ${confirmation.side === 'buy' ? '사기' : '팔기'}`}
          </button>
          {controller.pendingResolution && (
            <button
              type="button"
              disabled={controller.submitting}
              onClick={() => void controller.reloadPending()}
              className="mt-2 min-h-11 w-full cursor-pointer rounded-xl border border-bg-border px-4 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              시장 정보 다시 불러오기
            </button>
          )}
        </div>
      )}

      {controller.surface === 'limit-edit' && (
        <fieldset disabled={controller.controlsDisabled} className="min-w-0 disabled:opacity-60">
          <legend className="sr-only">지정가 주문 미리보기 입력</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['buy', 'sell'] as const).map((side) => (
              <button
                key={side}
                type="button"
                aria-pressed={controller.limitDraft.side === side}
                onClick={() => controller.updateLimitDraft({ side })}
                className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
              >
                {side === 'buy' ? '사기' : '팔기'}
              </button>
            ))}
          </div>
          <label htmlFor="market-limit-price" className="mt-5 block text-sm font-semibold text-text-primary">원하는 가격</label>
          <input
            id="market-limit-price"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={controller.limitDraft.desiredPriceInput}
            onChange={(event) => controller.updateLimitDraft({ desiredPriceInput: event.target.value })}
            className="mt-2 min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 text-base tabular-nums text-text-primary outline-none transition-colors duration-200 motion-reduce:transition-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          <label htmlFor="market-limit-quantity" className="mt-5 block text-sm font-semibold text-text-primary">주문 수량</label>
          <input
            id="market-limit-quantity"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={controller.limitDraft.quantityInput}
            onChange={(event) => controller.updateLimitDraft({ quantityInput: event.target.value })}
            className="mt-2 min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 text-base tabular-nums text-text-primary outline-none transition-colors duration-200 motion-reduce:transition-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          <p className="mt-3 min-h-5 text-sm font-semibold text-text-primary" aria-live="polite">{controller.error ?? ''}</p>
          <button
            type="button"
            onClick={controller.reviewLimit}
            className="mt-2 min-h-12 w-full cursor-pointer rounded-xl bg-accent px-4 py-3 text-sm font-bold text-on-accent transition-colors duration-200 motion-reduce:transition-none hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            입력 내용 검토하기
          </button>
        </fieldset>
      )}

      {controller.surface === 'limit-review' && limitReview && (
        <div>
          <div className="rounded-2xl bg-bg-primary/45 p-4">
            <p className="text-xs font-semibold text-text-secondary">실제로 저장되지 않는 미리보기</p>
            <p className="mt-3 text-base font-bold leading-7 text-text-primary">
              가격이 {formatWon(limitReview.desiredPriceWon)}가 되면 {formatShares(limitReview.quantityShares)} {limitReview.side === 'buy' ? '사기' : '팔기'}
            </p>
            <p className="mt-2 text-sm text-text-secondary">예상 합계 {formatWon(limitReview.estimatedTotalWon)}</p>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={controller.editLimit}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-bg-border px-4 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowLeft aria-hidden="true" size={17} />
              다시 입력
            </button>
            <button
              type="button"
              onClick={controller.finishLimitPreview}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-on-accent transition-colors duration-200 motion-reduce:transition-none hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Check aria-hidden="true" size={17} />
              지정가 주문 모양 확인
            </button>
          </div>
        </div>
      )}
    </MarketActionDialog>
  );
}
