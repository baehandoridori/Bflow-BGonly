import type {
  CandlestickData,
  CandlestickSeries,
  ChartOptions,
  ColorType,
  DeepPartial,
  HistogramData,
  HistogramSeries,
  ISeriesApi,
  LineData,
  LineSeries,
  MouseEventHandler,
  SeriesType,
  Time,
  UTCTimestamp,
  createChart,
} from 'lightweight-charts';

import {
  limitMarketChartCandles,
  toSafeMarketChartCandle,
} from './marketChartUi.ts';
import type { MarketCandle, MarketChartStyle } from './types';

export interface MarketChartTheme {
  backgroundColor: string;
  textColor: string;
  gridColor: string;
  borderColor: string;
  marketUpColor: string;
  marketDownColor: string;
  marketFlatColor: string;
}

export interface MarketChartRuntime {
  createChart: typeof createChart;
  LineSeries: typeof LineSeries;
  CandlestickSeries: typeof CandlestickSeries;
  HistogramSeries: typeof HistogramSeries;
}

export interface CreateMarketChartAdapterOptions {
  container: HTMLElement;
  runtime: MarketChartRuntime;
  theme: MarketChartTheme;
  onCrosshairCandle?: (candle: MarketCandle | null) => void;
}

export interface MarketChartAdapter {
  render(input: {
    candles: readonly MarketCandle[];
    style: MarketChartStyle;
    fitContent: boolean;
    seriesKey: string;
  }): void;
  applyTheme(theme: MarketChartTheme): void;
  resize(width: number, height: number): void;
  fitContent(): void;
  destroy(): void;
}

type LineSeriesApi = ISeriesApi<'Line'>;
type CandlestickSeriesApi = ISeriesApi<'Candlestick'>;
type PriceSeriesApi = LineSeriesApi | CandlestickSeriesApi;
type VolumeSeriesApi = ISeriesApi<'Histogram'>;

interface MarketChartPoint {
  candle: MarketCandle;
  time: UTCTimestamp;
}

function chartOptions(theme: MarketChartTheme): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: {
        type: 'solid' as ColorType.Solid,
        color: theme.backgroundColor,
      },
      textColor: theme.textColor,
      attributionLogo: true,
    },
    grid: {
      vertLines: { color: theme.gridColor },
      horzLines: { color: theme.gridColor },
    },
    rightPriceScale: { borderColor: theme.borderColor },
    timeScale: { borderColor: theme.borderColor },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      mouseWheel: true,
      pinch: true,
      axisPressedMouseMove: { time: true, price: true },
      axisDoubleClickReset: true,
    },
  };
}

function candlestickOptions(theme: MarketChartTheme) {
  return {
    upColor: theme.marketUpColor,
    downColor: theme.marketDownColor,
    borderUpColor: theme.marketUpColor,
    borderDownColor: theme.marketDownColor,
    wickUpColor: theme.marketUpColor,
    wickDownColor: theme.marketDownColor,
  };
}

function logSkippedCandle(candle: MarketCandle, reason: string): void {
  if (import.meta.env?.DEV) {
    console.warn(`[market-chart] ${reason}`, candle);
  }
}

function prepareMarketChartPoints(
  candles: readonly MarketCandle[],
): readonly MarketChartPoint[] {
  const points: MarketChartPoint[] = [];
  let previousTime = Number.NEGATIVE_INFINITY;

  for (const candle of limitMarketChartCandles(candles)) {
    const safe = toSafeMarketChartCandle(candle);
    if (!safe) {
      logSkippedCandle(candle, '유효하지 않은 OHLCV 봉을 차트에서 제외했습니다.');
      continue;
    }
    if (safe.utcSeconds <= previousTime) {
      logSkippedCandle(candle, '시간이 중복되거나 정렬되지 않은 봉을 차트에서 제외했습니다.');
      continue;
    }
    previousTime = safe.utcSeconds;
    points.push({ candle, time: safe.utcSeconds as UTCTimestamp });
  }

  return points;
}

function toLineData(points: readonly MarketChartPoint[]): LineData<UTCTimestamp>[] {
  return points.map(({ candle, time }) => ({
    time,
    value: candle.closeWon,
  }));
}

function toCandlestickData(
  points: readonly MarketChartPoint[],
): CandlestickData<UTCTimestamp>[] {
  return points.map(({ candle, time }) => ({
    time,
    open: candle.openWon,
    high: candle.highWon,
    low: candle.lowWon,
    close: candle.closeWon,
  }));
}

function toVolumeData(
  points: readonly MarketChartPoint[],
  theme: MarketChartTheme,
): HistogramData<UTCTimestamp>[] {
  return points.map(({ candle, time }) => ({
    time,
    value: candle.volumeShares,
    color: candle.closeWon >= candle.openWon
      ? theme.marketUpColor
      : theme.marketDownColor,
  }));
}

function sameMarketChartPoint(left: MarketChartPoint, right: MarketChartPoint): boolean {
  return left.time === right.time
    && left.candle.openWon === right.candle.openWon
    && left.candle.highWon === right.candle.highWon
    && left.candle.lowWon === right.candle.lowWon
    && left.candle.closeWon === right.candle.closeWon
    && left.candle.volumeShares === right.candle.volumeShares;
}

function canUpdateLastPoint(
  previous: readonly MarketChartPoint[],
  next: readonly MarketChartPoint[],
): boolean {
  if (previous.length === 0 || next.length === 0) return false;

  if (next.length === previous.length) {
    for (let index = 0; index < next.length - 1; index += 1) {
      if (!sameMarketChartPoint(previous[index], next[index])) return false;
    }
    return previous.at(-1)?.time === next.at(-1)?.time;
  }

  if (next.length === previous.length + 1) {
    return previous.every((point, index) => sameMarketChartPoint(point, next[index]));
  }

  return false;
}

export function createMarketChartAdapter({
  container,
  runtime,
  theme: initialTheme,
  onCrosshairCandle,
}: CreateMarketChartAdapterOptions): MarketChartAdapter {
  const chart = runtime.createChart(container, chartOptions(initialTheme));
  let theme = initialTheme;
  let priceSeries: PriceSeriesApi | null = null;
  let priceStyle: MarketChartStyle | null = null;
  let renderedSeriesKey: string | null = null;
  let points: readonly MarketChartPoint[] = [];
  let candleByTime = new Map<number, MarketCandle>();
  let destroyed = false;
  const crosshairHandler: MouseEventHandler<Time> = ({ time }) => {
    const selected = typeof time === 'number'
      ? candleByTime.get(time) ?? null
      : null;
    onCrosshairCandle?.(selected);
  };
  let volumeSeries!: VolumeSeriesApi;
  let volumeSeriesCreated = false;
  let subscriptionAttempted = false;

  try {
    volumeSeries = chart.addSeries(runtime.HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    }, 1);
    volumeSeriesCreated = true;
    subscriptionAttempted = true;
    chart.subscribeCrosshairMove(crosshairHandler);
  } catch (error) {
    if (subscriptionAttempted) {
      try {
        chart.unsubscribeCrosshairMove(crosshairHandler);
      } catch {
        // 원래 초기화 오류를 보존하면서 가능한 자원만 정리한다.
      }
    }
    if (volumeSeriesCreated) {
      try {
        chart.removeSeries(volumeSeries as ISeriesApi<SeriesType>);
      } catch {
        // chart.remove까지 계속 진행한다.
      }
    }
    try {
      chart.remove();
    } catch {
      // 호출자에게는 최초 초기화 오류를 다시 전달한다.
    }
    throw error;
  }

  const removePriceSeries = () => {
    if (!priceSeries) return;
    chart.removeSeries(priceSeries as ISeriesApi<SeriesType>);
    priceSeries = null;
  };

  const createPriceSeries = (style: MarketChartStyle): PriceSeriesApi => {
    if (style === 'candlestick') {
      return chart.addSeries(runtime.CandlestickSeries, candlestickOptions(theme), 0);
    }
    return chart.addSeries(runtime.LineSeries, { color: theme.marketFlatColor }, 0);
  };

  const setPriceData = (nextPoints: readonly MarketChartPoint[]) => {
    if (!priceSeries || !priceStyle) return;
    if (priceStyle === 'candlestick') {
      (priceSeries as CandlestickSeriesApi).setData(toCandlestickData(nextPoints));
      return;
    }
    (priceSeries as LineSeriesApi).setData(toLineData(nextPoints));
  };

  const updatePrice = (point: MarketChartPoint) => {
    if (!priceSeries || !priceStyle) return;
    if (priceStyle === 'candlestick') {
      (priceSeries as CandlestickSeriesApi).update(toCandlestickData([point])[0]);
      return;
    }
    (priceSeries as LineSeriesApi).update(toLineData([point])[0]);
  };

  return {
    render({ candles, style, fitContent, seriesKey }) {
      if (destroyed) return;
      const nextPoints = prepareMarketChartPoints(candles);
      const styleChanged = priceStyle !== style;
      const seriesChanged = renderedSeriesKey !== seriesKey;
      const visibleRange = styleChanged && priceSeries
        ? chart.timeScale().getVisibleLogicalRange()
        : null;

      if (styleChanged) {
        removePriceSeries();
        priceStyle = style;
        priceSeries = createPriceSeries(style);
      }

      if (!styleChanged && !seriesChanged && canUpdateLastPoint(points, nextPoints)) {
        const lastPoint = nextPoints.at(-1);
        if (lastPoint) {
          updatePrice(lastPoint);
          volumeSeries.update(toVolumeData([lastPoint], theme)[0]);
        }
      } else {
        setPriceData(nextPoints);
        volumeSeries.setData(toVolumeData(nextPoints, theme));
      }

      points = nextPoints;
      renderedSeriesKey = seriesKey;
      candleByTime = new Map(nextPoints.map(({ candle, time }) => [time, candle]));
      if (visibleRange) chart.timeScale().setVisibleLogicalRange(visibleRange);
      if (fitContent) chart.timeScale().fitContent();
    },

    applyTheme(nextTheme) {
      if (destroyed) return;
      theme = nextTheme;
      chart.applyOptions(chartOptions(theme));
      if (priceSeries && priceStyle === 'candlestick') {
        (priceSeries as CandlestickSeriesApi).applyOptions(candlestickOptions(theme));
      } else if (priceSeries) {
        (priceSeries as LineSeriesApi).applyOptions({ color: theme.marketFlatColor });
      }
      volumeSeries.setData(toVolumeData(points, theme));
    },

    resize(width, height) {
      if (destroyed) return;
      chart.resize(width, height);
    },

    fitContent() {
      if (destroyed) return;
      chart.timeScale().fitContent();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      chart.unsubscribeCrosshairMove(crosshairHandler);
      removePriceSeries();
      chart.removeSeries(volumeSeries as ISeriesApi<SeriesType>);
      chart.remove();
      points = [];
      renderedSeriesKey = null;
      candleByTime.clear();
    },
  };
}
