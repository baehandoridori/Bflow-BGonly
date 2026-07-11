import type { ReactNode } from 'react';

import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';

interface MarketDataBoundaryProps {
  children: ReactNode;
  loadingVariant: 'market' | 'account';
}

function MarketAccountSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto grid w-full max-w-[980px] grid-cols-1 gap-8 px-5 py-8 animate-pulse motion-reduce:animate-none lg:grid-cols-[184px_minmax(0,1fr)] lg:gap-16 lg:px-8 lg:py-10"
    >
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-1">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="min-h-11 rounded-xl bg-bg-border/35"
          />
        ))}
      </div>

      <div className="w-full max-w-[520px] min-w-0 space-y-8">
        <div>
          <div className="h-9 w-3/5 rounded-xl bg-bg-border/45" />
          <div className="mt-6 h-5 w-20 rounded-lg bg-bg-border/35" />
          <div className="mt-2 h-10 w-48 max-w-full rounded-xl bg-bg-border/45" />
          <div className="mt-5 flex min-h-16 items-center justify-between gap-4 border-t border-bg-border pt-5">
            <div className="h-5 w-44 max-w-[55%] rounded-lg bg-bg-border/30" />
            <div className="flex gap-2">
              <div className="h-11 w-16 rounded-xl bg-bg-border/45" />
              <div className="h-11 w-16 rounded-xl bg-bg-border/35" />
            </div>
          </div>
        </div>

        <section className="border-t border-bg-border pt-7">
          <div className="h-6 w-36 rounded-lg bg-bg-border/45" />
          <div className="mt-4 flex min-h-16 items-center justify-between gap-5">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-5 w-36 max-w-full rounded-lg bg-bg-border/35" />
              <div className="h-4 w-52 max-w-full rounded-lg bg-bg-border/25" />
            </div>
            <div className="h-6 w-24 rounded-lg bg-bg-border/40" />
          </div>
        </section>

        <section className="border-t border-bg-border pt-7">
          <div className="h-6 w-40 rounded-lg bg-bg-border/45" />
          <div className="mt-3 divide-y divide-bg-border">
            {Array.from({ length: 2 }, (_, index) => (
              <div key={index} className="flex min-h-[72px] items-center justify-between gap-4 py-4">
                <div className="h-5 w-28 rounded-lg bg-bg-border/35" />
                <div className="space-y-2">
                  <div className="ml-auto h-5 w-24 rounded-lg bg-bg-border/40" />
                  <div className="h-4 w-32 rounded-lg bg-bg-border/25" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-bg-border pt-7">
          <div className="h-6 w-28 rounded-lg bg-bg-border/45" />
          <div className="mt-2 h-4 w-20 rounded-lg bg-bg-border/25" />
          <div className="mt-4 divide-y divide-bg-border">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex min-h-12 items-center justify-between gap-5 py-3">
                <div className="h-4 w-28 rounded-lg bg-bg-border/30" />
                <div className="h-4 w-20 rounded-lg bg-bg-border/35" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function MarketDataBoundary({ children, loadingVariant }: MarketDataBoundaryProps) {
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
        className="min-h-0 flex-1 overflow-auto"
        aria-busy={loading || undefined}
        aria-live="polite"
      >
        <span className="sr-only">시장 정보를 불러오는 중</span>
        {loadingVariant === 'account' ? <MarketAccountSkeleton /> : (
          <div className="px-5 py-8 sm:px-7">
            <div className="mx-auto w-full max-w-5xl animate-pulse space-y-6 motion-reduce:animate-none">
              <div className="h-28 rounded-2xl bg-bg-border/45" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="h-48 rounded-2xl bg-bg-border/35" />
                <div className="h-48 rounded-2xl bg-bg-border/35" />
              </div>
              <div className="h-72 rounded-2xl bg-bg-border/30" />
            </div>
          </div>
        )}
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
