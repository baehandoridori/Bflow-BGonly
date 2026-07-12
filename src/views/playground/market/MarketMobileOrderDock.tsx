import type { MarketOrderController } from './useMarketOrderController';

interface MarketMobileOrderDockProps {
  controller: MarketOrderController;
}

export function MarketMobileOrderDock({ controller }: MarketMobileOrderDockProps) {
  const dockDisabled = controller.controlsDisabled || controller.halted;
  const disabledReason = controller.halted
    ? '현재 거래가 잠시 멈췄어요.'
    : controller.controlsDisabled
      ? controller.error
        ?? (controller.refreshRequired
          ? '최신 시장 정보를 다시 불러온 뒤 주문할 수 있어요.'
          : controller.pendingResolution
            ? '이전 주문 결과를 확인한 뒤 새 주문을 열 수 있어요.'
            : controller.submitting
              ? '주문을 처리하고 있어요.'
              : '주문 정보를 준비하고 있어요.')
      : null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-bg-border bg-bg-card/95 pt-3 pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur-xl xl:hidden"
      aria-label="빠른 주식 주문"
    >
      <div className="mx-auto grid w-full max-w-xl grid-cols-2 gap-3">
        <button
          type="button"
          disabled={dockDisabled}
          aria-describedby={disabledReason ? 'market-order-dock-status' : undefined}
          onClick={(event) => controller.openSheet(event.currentTarget, 'sell')}
          className="min-h-11 cursor-pointer rounded-xl bg-market-down px-4 py-3 text-sm font-extrabold text-bg-primary transition-[background-color,opacity,transform] duration-150 ease-out motion-reduce:transition-none hover:bg-market-down/90 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card disabled:cursor-not-allowed disabled:opacity-50 disabled:transform-none"
        >
          현재가 팔기
        </button>
        <button
          type="button"
          disabled={dockDisabled}
          aria-describedby={disabledReason ? 'market-order-dock-status' : undefined}
          onClick={(event) => controller.openSheet(event.currentTarget, 'buy')}
          className="min-h-11 cursor-pointer rounded-xl bg-market-up px-4 py-3 text-sm font-extrabold text-bg-primary transition-[background-color,opacity,transform] duration-150 ease-out motion-reduce:transition-none hover:bg-market-up/90 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card disabled:cursor-not-allowed disabled:opacity-50 disabled:transform-none"
        >
          현재가 사기
        </button>
        {disabledReason && (
          <p
            id="market-order-dock-status"
            role="status"
            aria-live="polite"
            className="col-span-2 text-center text-xs leading-5 text-text-secondary"
          >
            {disabledReason}
          </p>
        )}
      </div>
    </div>
  );
}
