import { useCallback, useState } from 'react';

import type { MarketChartStyle } from './types';

export const MARKET_CHART_STYLE_STORAGE_KEY = 'bflow:playground-market:chart-style:v2';

export interface MarketChartStyleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isMarketChartStyle(value: unknown): value is MarketChartStyle {
  return value === 'line' || value === 'candlestick';
}

export function readMarketChartStyle(
  storage: Pick<MarketChartStyleStorage, 'getItem'> | null | undefined,
): MarketChartStyle {
  if (!storage) return 'line';
  try {
    const savedStyle = storage.getItem(MARKET_CHART_STYLE_STORAGE_KEY);
    return isMarketChartStyle(savedStyle) ? savedStyle : 'line';
  } catch {
    return 'line';
  }
}

export function writeMarketChartStyle(
  storage: Pick<MarketChartStyleStorage, 'setItem'> | null | undefined,
  style: MarketChartStyle,
): void {
  if (!storage || !isMarketChartStyle(style)) return;
  try {
    storage.setItem(MARKET_CHART_STYLE_STORAGE_KEY, style);
  } catch {
    // 프라이버시 모드처럼 localStorage가 막혀도 화면 선택은 유지한다.
  }
}

export function useMarketChartPreference(): readonly [
  MarketChartStyle,
  (style: MarketChartStyle) => void,
] {
  const [style, setStyle] = useState<MarketChartStyle>(() => {
    try {
      return readMarketChartStyle(typeof window === 'undefined' ? null : window.localStorage);
    } catch {
      return 'line';
    }
  });

  const updateStyle = useCallback((nextStyle: MarketChartStyle) => {
    setStyle(nextStyle);
    try {
      writeMarketChartStyle(typeof window === 'undefined' ? null : window.localStorage, nextStyle);
    } catch {
      // localStorage getter 자체가 실패하는 환경에서도 화면 선택은 유지한다.
    }
  }, []);

  return [style, updateStyle] as const;
}
