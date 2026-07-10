import type { ReactNode } from 'react';

import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';

interface MarketDataBoundaryProps {
  children: ReactNode;
}

export function MarketDataBoundary({ children }: MarketDataBoundaryProps) {
  const visible = useMarketPreviewStore((state) => state.visible);
  const loading = useMarketPreviewStore((state) => state.loading);
  const error = useMarketPreviewStore((state) => state.error);
  const load = useMarketPreviewStore((state) => state.load);

  if (!visible && error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-5 py-10" role="alert">
        <div className="w-full max-w-md rounded-2xl border border-bg-border bg-bg-card p-6 text-center">
          <p className="text-lg font-semibold text-text-primary">시장 정보를 불러오지 못했어요</p>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            잠시 뒤 다시 시도하면 현재 시장 정보를 이어서 볼 수 있어요.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-5 min-h-11 cursor-pointer rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
          >
            다시 불러오기
          </button>
        </div>
      </div>
    );
  }

  if (!visible) {
    return (
      <div
        className="min-h-0 flex-1 overflow-auto px-5 py-8 sm:px-7"
        aria-busy={loading || undefined}
        aria-live="polite"
      >
        <span className="sr-only">시장 정보를 불러오는 중</span>
        <div className="mx-auto w-full max-w-5xl animate-pulse space-y-6 motion-reduce:animate-none">
          <div className="h-28 rounded-2xl bg-bg-border/45" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="h-48 rounded-2xl bg-bg-border/35" />
            <div className="h-48 rounded-2xl bg-bg-border/35" />
          </div>
          <div className="h-72 rounded-2xl bg-bg-border/30" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        aria-live="polite"
        className={error
          ? 'pointer-events-none absolute right-4 top-3 z-30 max-w-sm rounded-xl border border-bg-border bg-bg-card px-4 py-3 text-sm font-semibold text-text-primary shadow-xl'
          : 'sr-only'}
      >
        {error ?? ''}
      </div>
      {children}
    </div>
  );
}
