import type { MarketOrderController } from './useMarketOrderController';

interface MarketMobileOrderDockProps {
  controller: MarketOrderController;
}

export function MarketMobileOrderDock({ controller }: MarketMobileOrderDockProps) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-bg-border bg-bg-card/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl xl:hidden"
      aria-label="빠른 주식 주문"
    >
      <div className="mx-auto grid w-full max-w-xl grid-cols-2 gap-3">
        <button
          type="button"
          disabled={controller.controlsDisabled || controller.halted}
          onClick={(event) => controller.openSheet('buy', event.currentTarget)}
          className="min-h-11 cursor-pointer rounded-xl bg-market-up px-4 py-3 text-sm font-bold text-bg-primary transition-colors duration-200 motion-reduce:transition-none hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {controller.halted ? '거래 정지' : '사기'}
        </button>
        <button
          type="button"
          disabled={controller.controlsDisabled || controller.halted}
          onClick={(event) => controller.openSheet('sell', event.currentTarget)}
          className="min-h-11 cursor-pointer rounded-xl bg-market-down px-4 py-3 text-sm font-bold text-bg-primary transition-colors duration-200 motion-reduce:transition-none hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {controller.halted ? '거래 정지' : '팔기'}
        </button>
      </div>
    </div>
  );
}
