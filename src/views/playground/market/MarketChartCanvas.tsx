import { useEffect, useMemo, useRef, useState } from 'react';

import {
  formatMarketCandleSummary,
  limitMarketChartCandles,
  nearestMarketCandleIndex,
} from '@/features/playground/market/marketChartUi';
import type { MarketCandle, MarketChartStyle } from '@/features/playground/market/types';

interface MarketChartCanvasProps {
  stockName: string;
  candles: readonly MarketCandle[];
  style: MarketChartStyle;
}

const CHART_HEIGHT = 280;
const CHART_PADDING = 14;
const TOKEN_FALLBACKS: Readonly<Record<string, string>> = {
  '--color-market-up': '244 124 103',
  '--color-market-down': '100 160 235',
  '--color-market-flat': '157 163 173',
  '--color-market-news': '164 142 255',
  '--color-bg-border': '45 48 65',
};

function canvasTokenColor(
  computedStyle: CSSStyleDeclaration,
  token: keyof typeof TOKEN_FALLBACKS,
  alpha = 1,
): string {
  const channels = computedStyle.getPropertyValue(token).trim() || TOKEN_FALLBACKS[token];
  return `rgb(${channels} / ${alpha})`;
}

export function MarketChartCanvas({ stockName, candles, style }: MarketChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visibleCandles = useMemo(() => limitMarketChartCandles(candles), [candles]);
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, visibleCandles.length - 1));
  const [announcedSummary, setAnnouncedSummary] = useState('');
  const tracksLatestRef = useRef(true);
  const lastIndex = Math.max(0, visibleCandles.length - 1);
  const selectedCandle = visibleCandles[Math.min(selectedIndex, lastIndex)] ?? null;
  const selectedSummary = selectedCandle
    ? formatMarketCandleSummary(stockName, selectedCandle)
    : `${stockName} 가격 정보가 아직 없어요.`;

  useEffect(() => {
    setSelectedIndex((previous) => (
      tracksLatestRef.current ? lastIndex : Math.min(previous, lastIndex)
    ));
  }, [lastIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || visibleCandles.length === 0) return;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width || 720));
      const height = Math.max(1, Math.round(bounds.height || CHART_HEIGHT));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const computedStyle = getComputedStyle(canvas);
      const upColor = canvasTokenColor(computedStyle, '--color-market-up');
      const downColor = canvasTokenColor(computedStyle, '--color-market-down');
      const flatColor = canvasTokenColor(computedStyle, '--color-market-flat');
      const newsColor = canvasTokenColor(computedStyle, '--color-market-news');
      const gridColor = canvasTokenColor(computedStyle, '--color-bg-border', 0.55);
      const plotWidth = Math.max(1, width - CHART_PADDING * 2);
      const plotHeight = Math.max(1, height - CHART_PADDING * 2);
      const rawMinimum = Math.min(...visibleCandles.map((candle) => candle.lowWon));
      const rawMaximum = Math.max(...visibleCandles.map((candle) => candle.highWon));
      const pricePadding = Math.max(1, (rawMaximum - rawMinimum) * 0.08);
      const minimum = rawMinimum - pricePadding;
      const maximum = rawMaximum + pricePadding;
      const priceSpan = Math.max(1, maximum - minimum);
      const xAt = (index: number) => CHART_PADDING + (
        visibleCandles.length === 1
          ? plotWidth / 2
          : (index / (visibleCandles.length - 1)) * plotWidth
      );
      const yAt = (priceWon: number) => (
        CHART_PADDING + (1 - (priceWon - minimum) / priceSpan) * plotHeight
      );

      context.strokeStyle = gridColor;
      context.lineWidth = 1;
      for (let row = 1; row <= 3; row += 1) {
        const y = CHART_PADDING + (plotHeight * row) / 4;
        context.beginPath();
        context.moveTo(CHART_PADDING, y);
        context.lineTo(width - CHART_PADDING, y);
        context.stroke();
      }

      if (style === 'line') {
        const firstClose = visibleCandles[0].closeWon;
        const lastClose = visibleCandles.at(-1)?.closeWon ?? firstClose;
        const lineColor = lastClose > firstClose
          ? upColor
          : lastClose < firstClose
            ? downColor
            : flatColor;
        const fill = context.createLinearGradient(0, CHART_PADDING, 0, height - CHART_PADDING);
        fill.addColorStop(0, lineColor.replace(' / 1)', ' / 0.2)'));
        fill.addColorStop(1, lineColor.replace(' / 1)', ' / 0)'));

        context.beginPath();
        visibleCandles.forEach((candle, index) => {
          const x = xAt(index);
          const y = yAt(candle.closeWon);
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.lineTo(xAt(visibleCandles.length - 1), height - CHART_PADDING);
        context.lineTo(xAt(0), height - CHART_PADDING);
        context.closePath();
        context.fillStyle = fill;
        context.fill();

        context.beginPath();
        visibleCandles.forEach((candle, index) => {
          const x = xAt(index);
          const y = yAt(candle.closeWon);
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.strokeStyle = lineColor;
        context.lineWidth = 2.5;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        context.stroke();
      } else {
        const step = plotWidth / Math.max(1, visibleCandles.length);
        const bodyWidth = Math.max(1, Math.min(12, step * 0.62));
        visibleCandles.forEach((candle, index) => {
          const x = xAt(index);
          const color = candle.closeWon > candle.openWon
            ? upColor
            : candle.closeWon < candle.openWon
              ? downColor
              : flatColor;
          context.strokeStyle = color;
          context.lineWidth = 1.25;
          context.beginPath();
          context.moveTo(x, yAt(candle.highWon));
          context.lineTo(x, yAt(candle.lowWon));
          context.stroke();

          const bodyTop = Math.min(yAt(candle.openWon), yAt(candle.closeWon));
          const bodyHeight = Math.max(2, Math.abs(yAt(candle.openWon) - yAt(candle.closeWon)));
          context.fillStyle = color;
          context.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
        });
      }

      visibleCandles.forEach((candle, index) => {
        if (candle.newsIds.length === 0) return;
        const x = xAt(index);
        context.strokeStyle = newsColor;
        context.lineWidth = 1;
        context.setLineDash([4, 5]);
        context.beginPath();
        context.moveTo(x, CHART_PADDING);
        context.lineTo(x, height - CHART_PADDING);
        context.stroke();
        context.setLineDash([]);
      });

      if (selectedCandle) {
        const selected = Math.min(selectedIndex, lastIndex);
        const x = xAt(selected);
        context.strokeStyle = flatColor;
        context.lineWidth = 1;
        context.setLineDash([3, 4]);
        context.beginPath();
        context.moveTo(x, CHART_PADDING);
        context.lineTo(x, height - CHART_PADDING);
        context.stroke();
        context.setLineDash([]);
      }
    };

    draw();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [lastIndex, selectedCandle, selectedIndex, style, visibleCandles]);

  const selectCandle = (nextIndex: number, announce: boolean) => {
    tracksLatestRef.current = nextIndex === lastIndex;
    setSelectedIndex(nextIndex);
    const nextCandle = visibleCandles[nextIndex];
    if (announce && nextCandle) {
      setAnnouncedSummary(formatMarketCandleSummary(stockName, nextCandle));
    }
  };

  const selectFromPointer = (pointerX: number, width: number) => {
    const nextIndex = nearestMarketCandleIndex(
      pointerX,
      width,
      visibleCandles.length,
      CHART_PADDING,
    );
    selectCandle(nextIndex, true);
  };

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl border border-bg-border bg-bg-primary/45 focus-within:ring-2 focus-within:ring-accent">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="block h-[280px] w-full"
        />
        <input
          type="range"
          min={0}
          max={lastIndex}
          step={1}
          value={Math.min(selectedIndex, lastIndex)}
          disabled={visibleCandles.length === 0}
          aria-label={`${stockName} 차트 시점 선택`}
          aria-valuetext={selectedSummary}
          onChange={(event) => {
            const nextIndex = Number(event.currentTarget.value);
            selectCandle(nextIndex, true);
          }}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            selectFromPointer(event.clientX - bounds.left, bounds.width);
          }}
          onPointerDown={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            selectFromPointer(event.clientX - bounds.left, bounds.width);
          }}
          className="absolute inset-0 h-full w-full cursor-crosshair opacity-0 focus:opacity-0 disabled:cursor-default"
        />
      </div>
      <p className="mt-3 min-h-12 text-sm leading-6 text-text-secondary">
        {selectedSummary}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcedSummary}
      </p>
    </div>
  );
}
