import { createElement, type ReactElement } from 'react';

import type { MarketRoute } from '../../../features/playground/routes';

export type MarketLoadingVariant = 'market' | 'account';
export type MarketBoundaryState = 'loading' | 'error' | 'content';

interface MarketBoundarySnapshot {
  hasVisibleSnapshot: boolean;
  error: string | null;
}

interface MarketLoadingSkeletonProps {
  variant: MarketLoadingVariant;
}

export function selectMarketLoadingVariant(route: MarketRoute): MarketLoadingVariant {
  return route.kind === 'account' ? 'account' : 'market';
}

export function resolveMarketBoundaryState({
  hasVisibleSnapshot,
  error,
}: MarketBoundarySnapshot): MarketBoundaryState {
  if (hasVisibleSnapshot) return 'content';
  return error ? 'error' : 'loading';
}

function MarketAccountSkeleton(): ReactElement {
  return createElement(
    'div',
    {
      'aria-hidden': 'true',
      className: 'mx-auto grid w-full max-w-[980px] grid-cols-1 gap-8 px-5 py-8 animate-pulse motion-reduce:animate-none lg:grid-cols-[184px_minmax(0,1fr)] lg:gap-16 lg:px-8 lg:py-10',
    },
    createElement(
      'nav',
      { 'aria-label': '계좌 메뉴 로딩 중', className: 'min-w-0 self-start' },
      createElement(
        'ul',
        { className: 'grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-1' },
        Array.from({ length: 5 }, (_, index) => createElement(
          'li',
          { key: index, className: 'min-w-0' },
          createElement('div', { className: 'min-h-11 rounded-xl bg-bg-border/35' }),
        )),
      ),
    ),
    createElement(
      'div',
      { className: 'w-full max-w-[520px] min-w-0 space-y-8' },
      createElement(
        'div',
        null,
        createElement('div', { className: 'h-9 w-3/5 rounded-xl bg-bg-border/45' }),
        createElement('div', { className: 'mt-6 h-5 w-20 rounded-lg bg-bg-border/35' }),
        createElement('div', { className: 'mt-2 h-10 w-48 max-w-full rounded-xl bg-bg-border/45' }),
        createElement(
          'div',
          { className: 'mt-5 flex min-h-16 items-center justify-between gap-4 border-t border-bg-border pt-5' },
          createElement('div', { className: 'h-5 w-44 max-w-[55%] rounded-lg bg-bg-border/30' }),
          createElement(
            'div',
            { className: 'flex gap-2' },
            createElement('div', { className: 'h-11 w-16 rounded-xl bg-bg-border/45' }),
            createElement('div', { className: 'h-11 w-16 rounded-xl bg-bg-border/35' }),
          ),
        ),
      ),
      createElement(
        'section',
        { className: 'border-t border-bg-border pt-7' },
        createElement('div', { className: 'h-6 w-36 rounded-lg bg-bg-border/45' }),
        createElement(
          'div',
          { className: 'mt-4 flex min-h-16 items-center justify-between gap-5' },
          createElement(
            'div',
            { className: 'min-w-0 flex-1 space-y-2' },
            createElement('div', { className: 'h-5 w-36 max-w-full rounded-lg bg-bg-border/35' }),
            createElement('div', { className: 'h-4 w-52 max-w-full rounded-lg bg-bg-border/25' }),
          ),
          createElement('div', { className: 'h-6 w-24 rounded-lg bg-bg-border/40' }),
        ),
      ),
      createElement(
        'section',
        { className: 'border-t border-bg-border pt-7' },
        createElement('div', { className: 'h-6 w-40 rounded-lg bg-bg-border/45' }),
        createElement(
          'div',
          { className: 'mt-3 divide-y divide-bg-border' },
          Array.from({ length: 2 }, (_, index) => createElement(
            'div',
            { key: index, className: 'flex min-h-[72px] items-center justify-between gap-4 py-4' },
            createElement('div', { className: 'h-5 w-28 rounded-lg bg-bg-border/35' }),
            createElement(
              'div',
              { className: 'space-y-2' },
              createElement('div', { className: 'ml-auto h-5 w-24 rounded-lg bg-bg-border/40' }),
              createElement('div', { className: 'h-4 w-32 rounded-lg bg-bg-border/25' }),
            ),
          )),
        ),
      ),
      createElement(
        'section',
        { className: 'border-t border-bg-border pt-7' },
        createElement('div', { className: 'h-6 w-28 rounded-lg bg-bg-border/45' }),
        createElement('div', { className: 'mt-2 h-4 w-20 rounded-lg bg-bg-border/25' }),
        createElement(
          'div',
          { className: 'mt-4 divide-y divide-bg-border' },
          Array.from({ length: 3 }, (_, index) => createElement(
            'div',
            { key: index, className: 'flex min-h-12 items-center justify-between gap-5 py-3' },
            createElement('div', { className: 'h-4 w-28 rounded-lg bg-bg-border/30' }),
            createElement('div', { className: 'h-4 w-20 rounded-lg bg-bg-border/35' }),
          )),
        ),
      ),
    ),
  );
}

function MarketDefaultSkeleton(): ReactElement {
  return createElement(
    'div',
    { 'aria-hidden': 'true', className: 'px-5 py-8 sm:px-7' },
    createElement(
      'div',
      { className: 'mx-auto w-full max-w-5xl animate-pulse space-y-6 motion-reduce:animate-none' },
      createElement('div', { className: 'h-28 rounded-2xl bg-bg-border/45' }),
      createElement(
        'div',
        { className: 'grid grid-cols-1 gap-4 sm:grid-cols-2' },
        createElement('div', { className: 'h-48 rounded-2xl bg-bg-border/35' }),
        createElement('div', { className: 'h-48 rounded-2xl bg-bg-border/35' }),
      ),
      createElement('div', { className: 'h-72 rounded-2xl bg-bg-border/30' }),
    ),
  );
}

export function MarketLoadingSkeleton({ variant }: MarketLoadingSkeletonProps): ReactElement {
  return variant === 'account'
    ? createElement(MarketAccountSkeleton)
    : createElement(MarketDefaultSkeleton);
}
