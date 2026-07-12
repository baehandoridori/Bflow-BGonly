import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts';

import {
  createMarketChartAdapter,
  type MarketChartAdapter,
  type MarketChartRuntime,
  type MarketChartTheme,
} from '@/features/playground/market/marketChartAdapter';
import type {
  MarketBarInterval,
  MarketCandle,
  MarketChartRange,
  MarketChartStyle,
} from '@/features/playground/market/types';

interface MarketInteractiveChartProps {
  stockName: string;
  candles: readonly MarketCandle[];
  style: MarketChartStyle;
  interval: MarketBarInterval;
  range: MarketChartRange;
  resetKey: number;
  onSelectedCandle(candle: MarketCandle | null): void;
}

const CHART_HEIGHT = 320;
const LIGHTWEIGHT_CHARTS_RUNTIME: MarketChartRuntime = {
  createChart,
  LineSeries,
  CandlestickSeries,
  HistogramSeries,
};
const THEME_FALLBACKS = {
  '--color-bg-primary': '15 17 23',
  '--color-bg-border': '45 48 65',
  '--color-text-secondary': '139 141 163',
  '--color-market-up': '244 124 103',
  '--color-market-down': '100 160 235',
  '--color-market-flat': '157 163 173',
} as const;

function readMarketChartTheme(container: HTMLElement): MarketChartTheme {
  const computedStyle = getComputedStyle(container);
  const color = (
    token: keyof typeof THEME_FALLBACKS,
    alpha?: number,
  ) => {
    const channels = computedStyle.getPropertyValue(token).trim() || THEME_FALLBACKS[token];
    return `rgb(${channels}${alpha === undefined ? '' : ` / ${alpha}`})`;
  };

  return {
    backgroundColor: color('--color-bg-primary'),
    textColor: color('--color-text-secondary'),
    gridColor: color('--color-bg-border', 0.55),
    borderColor: color('--color-bg-border'),
    marketUpColor: color('--color-market-up'),
    marketDownColor: color('--color-market-down'),
    marketFlatColor: color('--color-market-flat'),
  };
}

export function MarketInteractiveChart({
  stockName,
  candles,
  style,
  interval,
  range,
  resetKey,
  onSelectedCandle,
}: MarketInteractiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MarketChartAdapter | null>(null);
  const selectedCandleCallbackRef = useRef(onSelectedCandle);
  const renderedRangeRef = useRef<MarketChartRange | null>(null);
  const renderedThemeKeyRef = useRef('');
  const handledResetKeyRef = useRef(resetKey);
  const [retryKey, setRetryKey] = useState(0);
  const [chartError, setChartError] = useState<string | null>(null);
  selectedCandleCallbackRef.current = onSelectedCandle;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let adapter: MarketChartAdapter | null = null;
    let observer: ResizeObserver | null = null;
    let cleaned = false;
    let active = true;

    try {
      const theme = readMarketChartTheme(container);
      adapter = createMarketChartAdapter({
        container,
        runtime: LIGHTWEIGHT_CHARTS_RUNTIME,
        theme,
        onCrosshairCandle: (candle) => selectedCandleCallbackRef.current(candle),
      });
      adapterRef.current = adapter;
      renderedRangeRef.current = null;
      renderedThemeKeyRef.current = JSON.stringify(theme);

      const resize = (width: number, height: number) => {
        if (!active) return;
        adapter?.resize(
          Math.max(1, Math.round(width)),
          Math.max(1, Math.round(height || CHART_HEIGHT)),
        );
      };
      const bounds = container.getBoundingClientRect();
      resize(bounds.width, bounds.height);

      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry) return;
          try {
            resize(entry.contentRect.width, entry.contentRect.height);
          } catch {
            setChartError('차트를 불러오지 못했어요');
          }
        });
        observer.observe(container);
      }
      setChartError(null);
    } catch {
      setChartError('차트를 불러오지 못했어요');
    }

    return () => {
      if (cleaned) return;
      cleaned = true;
      active = false;
      observer?.disconnect();
      if (adapterRef.current === adapter) adapterRef.current = null;
      adapter?.destroy();
    };
  }, [retryKey]);

  useEffect(() => {
    const adapter = adapterRef.current;
    const container = containerRef.current;
    if (!adapter || !container) return;

    const fitContent = renderedRangeRef.current !== range;
    try {
      const theme = readMarketChartTheme(container);
      const themeKey = JSON.stringify(theme);
      if (themeKey !== renderedThemeKeyRef.current) {
        adapter.applyTheme(theme);
        renderedThemeKeyRef.current = themeKey;
      }
      adapter.render({ candles, style, fitContent });
      renderedRangeRef.current = range;
    } catch {
      setChartError('차트를 불러오지 못했어요');
    }
  }, [candles, interval, range, retryKey, style]);

  useEffect(() => {
    if (handledResetKeyRef.current === resetKey) return;
    handledResetKeyRef.current = resetKey;
    try {
      adapterRef.current?.fitContent();
    } catch {
      setChartError('차트를 불러오지 못했어요');
    }
  }, [resetKey]);

  const fitChartContent = () => {
    try {
      adapterRef.current?.fitContent();
    } catch {
      setChartError('차트를 불러오지 못했어요');
    }
  };

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-bg-border bg-bg-primary/45 focus-within:ring-2 focus-within:ring-accent"
      onDoubleClick={fitChartContent}
    >
      <div
        key={retryKey}
        ref={containerRef}
        role="region"
        aria-label={`${stockName} 가격과 거래량 차트`}
        className="h-[320px] w-full"
      />
      {chartError ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center bg-bg-primary/95 px-5 text-center"
        >
          <p className="text-sm font-semibold text-text-primary">차트를 불러오지 못했어요</p>
          <p className="mt-1 text-xs leading-5 text-text-secondary">가격 정보와 주문 기능은 그대로 이용할 수 있어요.</p>
          <button
            type="button"
            onClick={() => {
              setChartError(null);
              setRetryKey((previous) => previous + 1);
            }}
            className="mt-4 min-h-11 rounded-xl border border-bg-border px-4 py-2 text-sm font-semibold text-text-primary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            차트 다시 불러오기
          </button>
        </div>
      ) : null}
    </div>
  );
}
