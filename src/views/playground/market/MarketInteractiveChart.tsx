import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
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
import {
  resolveMarketChartFitDecision,
  resolveMarketChartKeyboardIndex,
  resolveMarketChartSelectedIndex,
} from '@/features/playground/market/marketChartUi';
import type {
  MarketCandle,
  MarketChartStyle,
} from '@/features/playground/market/types';

interface MarketInteractiveChartProps {
  stockName: string;
  candles: readonly MarketCandle[];
  style: MarketChartStyle;
  seriesKey: string;
  fitContentKey: string | null;
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
  seriesKey,
  fitContentKey,
  resetKey,
  onSelectedCandle,
}: MarketInteractiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MarketChartAdapter | null>(null);
  const selectedCandleCallbackRef = useRef(onSelectedCandle);
  const candlesRef = useRef(candles);
  const selectedCandleStartsAtRef = useRef<string | null>(null);
  const selectedSeriesKeyRef = useRef(seriesKey);
  const initialSelectedIndex = Math.max(0, candles.length - 1);
  const selectedIndexRef = useRef(initialSelectedIndex);
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
  const fittedContentKeyRef = useRef<string | null>(null);
  const renderedThemeKeyRef = useRef('');
  const handledResetKeyRef = useRef(resetKey);
  const [retryKey, setRetryKey] = useState(0);
  const [chartError, setChartError] = useState<string | null>(null);
  selectedCandleCallbackRef.current = onSelectedCandle;
  candlesRef.current = candles;

  useEffect(() => {
    const selectedStartsAt = selectedCandleStartsAtRef.current;
    const preserveSelection = selectedSeriesKeyRef.current === seriesKey;
    const selectionDecision = resolveMarketChartSelectedIndex(
      candles,
      selectedStartsAt,
      preserveSelection,
    );
    const nextIndex = selectionDecision.selectedIndex;
    if (selectionDecision.resetSelection) {
      selectedCandleStartsAtRef.current = null;
    }
    selectedSeriesKeyRef.current = seriesKey;
    selectedIndexRef.current = nextIndex;
    setSelectedIndex(nextIndex);
    if (selectionDecision.resetSelection) selectedCandleCallbackRef.current(null);
  }, [candles, seriesKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let adapter: MarketChartAdapter | null = null;
    let observer: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    let cleaned = false;
    let active = true;

    try {
      const theme = readMarketChartTheme(container);
      adapter = createMarketChartAdapter({
        container,
        runtime: LIGHTWEIGHT_CHARTS_RUNTIME,
        theme,
        onCrosshairCandle: (candle) => {
          const currentCandles = candlesRef.current;
          const matchingIndex = candle === null
            ? -1
            : currentCandles.findIndex((item) => item.startsAt === candle.startsAt);
          const nextIndex = matchingIndex >= 0
            ? matchingIndex
            : Math.max(0, currentCandles.length - 1);
          selectedCandleStartsAtRef.current = candle?.startsAt ?? null;
          selectedIndexRef.current = nextIndex;
          setSelectedIndex(nextIndex);
          selectedCandleCallbackRef.current(candle);
        },
      });
      adapterRef.current = adapter;
      fittedContentKeyRef.current = null;
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
      if (typeof MutationObserver !== 'undefined') {
        themeObserver = new MutationObserver(() => {
          if (!active || !adapter) return;
          try {
            const nextTheme = readMarketChartTheme(container);
            const nextThemeKey = JSON.stringify(nextTheme);
            if (nextThemeKey !== renderedThemeKeyRef.current) {
              adapter.applyTheme(nextTheme);
              renderedThemeKeyRef.current = nextThemeKey;
            }
          } catch {
            setChartError('차트를 불러오지 못했어요');
          }
        });
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'style', 'data-color-mode'],
        });
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
      themeObserver?.disconnect();
      if (adapterRef.current === adapter) adapterRef.current = null;
      adapter?.destroy();
    };
  }, [retryKey]);

  useEffect(() => {
    const adapter = adapterRef.current;
    const container = containerRef.current;
    if (!adapter || !container) return;

    const fitDecision = resolveMarketChartFitDecision(
      fittedContentKeyRef.current,
      fitContentKey,
    );
    try {
      const theme = readMarketChartTheme(container);
      const themeKey = JSON.stringify(theme);
      if (themeKey !== renderedThemeKeyRef.current) {
        adapter.applyTheme(theme);
        renderedThemeKeyRef.current = themeKey;
      }
      adapter.render({
        candles,
        style,
        fitContent: fitDecision.fitContent,
        seriesKey,
      });
      fittedContentKeyRef.current = fitDecision.fittedKey;
    } catch {
      setChartError('차트를 불러오지 못했어요');
    }
  }, [candles, fitContentKey, retryKey, seriesKey, style]);

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

  const selectCandleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextIndex = resolveMarketChartKeyboardIndex(
      selectedIndexRef.current,
      candles.length,
      event.key,
    );
    if (nextIndex === null) return;
    event.preventDefault();
    const nextCandle = candles[nextIndex];
    if (!nextCandle) return;
    selectedCandleStartsAtRef.current = nextCandle.startsAt;
    selectedIndexRef.current = nextIndex;
    setSelectedIndex(nextIndex);
    selectedCandleCallbackRef.current(nextCandle);
  };

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-bg-border bg-bg-primary/45 focus-within:ring-2 focus-within:ring-accent"
      onDoubleClick={fitChartContent}
    >
      <p id="market-chart-keyboard-help" className="sr-only">
        차트에 포커스한 뒤 왼쪽·오른쪽 화살표로 봉을 이동하고 Home·End 키로 처음과 마지막 봉을 선택할 수 있어요.
      </p>
      <div
        key={retryKey}
        ref={containerRef}
        role="region"
        tabIndex={0}
        aria-label={`${stockName} 가격과 거래량 차트, ${selectedIndex + 1}/${candles.length}번째 봉`}
        aria-describedby="market-chart-keyboard-help"
        onKeyDown={selectCandleFromKeyboard}
        className="h-[320px] w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
