import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { resolveIntervalForRange } from '../src/features/playground/market/chartSeries.ts';
import { createMarketPreviewSeed } from '../src/features/playground/market/seed.ts';

const PREFERENCE_PATH = 'src/features/playground/market/useMarketChartPreference.ts';
const CHART_UI_PATH = 'src/features/playground/market/marketChartUi.ts';
const DISPLAY_SERIES_PATH = 'src/features/playground/market/marketDisplaySeries.ts';
const CANVAS_PATH = 'src/views/playground/market/MarketChartCanvas.tsx';

test('chart style starts as line, restores candlestick, and ignores invalid storage', async () => {
  assert.equal(existsSync(PREFERENCE_PATH), true, 'chart preference hook must exist');
  const preference = await import('../src/features/playground/market/useMarketChartPreference.ts');
  const values = new Map<string, string>();
  const writes: Array<[string, string]> = [];
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      writes.push([key, value]);
      values.set(key, value);
    },
  };

  assert.equal(preference.readMarketChartStyle(storage), 'line');
  values.set(preference.MARKET_CHART_STYLE_STORAGE_KEY, 'candlestick');
  assert.equal(preference.readMarketChartStyle(storage), 'candlestick');
  values.set(preference.MARKET_CHART_STYLE_STORAGE_KEY, '{"account":{"cashWon":999999}}');
  assert.equal(preference.readMarketChartStyle(storage), 'line');

  preference.writeMarketChartStyle(storage, 'candlestick');
  assert.deepEqual(writes, [[
    'bflow:playground-market:chart-style:v2',
    'candlestick',
  ]]);
  assert.doesNotMatch(JSON.stringify(writes), /account|cashWon|holding/i);
});

test('range compatibility promotes overly dense intervals', () => {
  assert.equal(resolveIntervalForRange('today', '1m'), '1m');
  assert.equal(resolveIntervalForRange('week', '5m'), '15m');
  assert.equal(resolveIntervalForRange('month', '15m'), '1h');
  assert.equal(resolveIntervalForRange('six-months', '1h'), '1d');
  assert.equal(resolveIntervalForRange('all', '1m'), '1d');
});

test('long-range display candles stay within a representative sampler budget', async () => {
  assert.equal(existsSync(DISPLAY_SERIES_PATH), true, 'display candle fast path must exist');
  const displaySeries = await import('../src/features/playground/market/marketDisplaySeries.ts');
  const endMs = Date.parse('2026-07-12T00:00:00Z');
  const startMs = endMs - 600 * 24 * 60 * 60_000;
  const events = Array.from({ length: 10 }, (_, index) => ({
    id: `budget-event-${index}`,
    stockId: 'display-budget-profile',
    kind: 'trend' as const,
    title: `장기 이벤트 ${index}`,
    impactBps: index + 1,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    revision: 1,
  }));
  let sampleCalls = 0;
  const request = {
    profile: {
      stockId: 'display-budget-profile',
      basePriceWon: 1000,
      volatilityBps: 100,
      phase: 0.25,
    },
    startMs,
    endMs,
    nowMs: endMs - 1,
    events,
    interval: '1d' as const,
    samplePriceWon: (_profile: unknown, atMs: number) => {
      sampleCalls += 1;
      return 1000 + Math.floor((atMs / 60_000) % 11);
    },
  };
  const candles = displaySeries.buildMarketDisplayCandles(request);
  const firstCallCount = sampleCalls;
  sampleCalls = 0;
  displaySeries.buildMarketDisplayCandles(request);

  assert.equal(candles.length, 600);
  assert.ok(firstCallCount <= 600 * 26, `first call used ${firstCallCount} samples`);
  assert.ok(firstCallCount >= 600 * 2, 'each bar keeps at least open and close samples');
  assert.ok(sampleCalls <= 26, `cached repeat used ${sampleCalls} samples`);
});

test('a future event does not invalidate completed historical display bars', async () => {
  const { buildMarketDisplayCandles } = await import(
    '../src/features/playground/market/marketDisplaySeries.ts'
  );
  const startMs = Date.parse('2026-07-09T00:00:00Z');
  const endMs = Date.parse('2026-07-11T00:00:00Z');
  let sampleCalls = 0;
  const samplePriceWon = (_profile: unknown, atMs: number) => {
    sampleCalls += 1;
    return 1000 + Math.floor((atMs - startMs) / 60_000) % 17;
  };
  const request = {
    profile: {
      stockId: 'future-event-cache-profile',
      basePriceWon: 1000,
      volatilityBps: 100,
      phase: 0.5,
    },
    startMs,
    endMs,
    nowMs: endMs + 24 * 60 * 60_000,
    events: [],
    interval: '1d' as const,
    samplePriceWon,
  };
  buildMarketDisplayCandles(request);
  sampleCalls = 0;
  buildMarketDisplayCandles({
    ...request,
    events: [{
      id: 'future-only',
      stockId: request.profile.stockId,
      kind: 'shock-up',
      title: '과거 봉 뒤에 시작하는 이벤트',
      impactBps: 1000,
      startsAt: new Date(endMs + 2 * 24 * 60 * 60_000).toISOString(),
      endsAt: new Date(endMs + 3 * 24 * 60 * 60_000).toISOString(),
      revision: 1,
    }],
  });

  assert.equal(sampleCalls, 0);
});

test('completed display bars are cached but the forming bar is resampled', async () => {
  assert.equal(existsSync(DISPLAY_SERIES_PATH), true, 'display candle fast path must exist');
  const { buildMarketDisplayCandles } = await import(
    '../src/features/playground/market/marketDisplaySeries.ts'
  );
  const startMs = Date.parse('2026-07-10T00:00:00Z');
  const firstNowMs = Date.parse('2026-07-11T12:00:10Z');
  let sampleCalls = 0;
  const samplePriceWon = (_profile: unknown, atMs: number) => {
    sampleCalls += 1;
    return 1000 + Math.floor((atMs - startMs) / 1000);
  };
  const request = {
    profile: {
      stockId: 'display-cache-profile',
      basePriceWon: 1000,
      volatilityBps: 0,
      phase: 0,
    },
    startMs,
    endMs: firstNowMs + 1,
    nowMs: firstNowMs,
    events: [],
    interval: '1d' as const,
    samplePriceWon,
  };

  const first = buildMarketDisplayCandles(request);
  const firstCallCount = sampleCalls;
  sampleCalls = 0;
  const second = buildMarketDisplayCandles(request);

  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.ok(sampleCalls > 0, 'forming day must be sampled again');
  assert.ok(sampleCalls < firstCallCount, 'completed day must come from cache');
  assert.equal(second.at(-1)?.closeWon, samplePriceWon(null, firstNowMs));
});

test('chart UI helpers cap bars, select the nearest bar, and describe OHLC text', async () => {
  assert.equal(existsSync(CHART_UI_PATH), true, 'testable chart UI helpers must exist');
  const chartUi = await import('../src/features/playground/market/marketChartUi.ts');
  const candles = Array.from({ length: 605 }, (_, index) => ({
    startsAt: new Date(Date.parse('2026-07-11T12:00:00Z') + index * 60_000).toISOString(),
    openWon: 1000 + index,
    highWon: 1020 + index,
    lowWon: 980 + index,
    closeWon: 1010 + index,
    newsIds: [],
  }));

  const limited = chartUi.limitMarketChartCandles(candles);
  assert.equal(limited.length, 600);
  assert.equal(limited[0].startsAt, candles[5].startsAt);
  assert.equal(chartUi.nearestMarketCandleIndex(-10, 100, 5, 10), 0);
  assert.equal(chartUi.nearestMarketCandleIndex(10, 100, 5, 10), 0);
  assert.equal(chartUi.nearestMarketCandleIndex(50, 100, 5, 10), 2);
  assert.equal(chartUi.nearestMarketCandleIndex(90, 100, 5, 10), 4);
  assert.equal(chartUi.nearestMarketCandleIndex(120, 100, 5, 10), 4);
  assert.equal(chartUi.nearestMarketCandleIndex(14, 720, 600, 14), 0);
  assert.equal(chartUi.nearestMarketCandleIndex(360, 720, 600, 14), 300);
  assert.equal(chartUi.nearestMarketCandleIndex(706, 720, 600, 14), 599);

  const summary = chartUi.formatMarketCandleSummary('JBBJ', candles[0]);
  for (const text of ['JBBJ', '7월', '시가 1,000원', '고가 1,020원', '저가 980원', '종가 1,010원']) {
    assert.match(summary, new RegExp(text));
  }
});

test('canvas uses DPR, semantic theme colors, and one keyboard range summary', () => {
  assert.equal(existsSync(CANVAS_PATH), true, 'market chart canvas must exist');
  const source = readFileSync(CANVAS_PATH, 'utf8');

  assert.match(source, /<canvas/);
  assert.match(source, /window\.devicePixelRatio/);
  assert.match(source, /getComputedStyle\(/);
  for (const token of [
    '--color-market-up',
    '--color-market-down',
    '--color-market-flat',
    '--color-market-news',
    '--color-bg-border',
  ]) {
    assert.match(source, new RegExp(token));
  }
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}/i);
  assert.equal((source.match(/type="range"/g) ?? []).length, 1);
  assert.match(source, /aria-valuetext=\{selectedSummary\}/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /nearestMarketCandleIndex\([^)]*CHART_PADDING/s);
  assert.match(source, /limitMarketChartCandles\(candles\)/);
});

test('canvas only announces OHLC after pointer or keyboard interaction', () => {
  const source = readFileSync(CANVAS_PATH, 'utf8');
  const liveRegion = source.match(
    /<p[^>]*aria-live="polite"[^>]*>[\s\S]*?\{([A-Za-z]+Summary)\}[\s\S]*?<\/p>/,
  );

  assert.ok(liveRegion, 'one polite live region must remain for user selections');
  assert.equal(liveRegion[1], 'announcedSummary');
  assert.match(source, /const \[announcedSummary, setAnnouncedSummary\]/);
  assert.match(source, /setAnnouncedSummary\(/);
  assert.doesNotMatch(
    source,
    /<p className="mt-3 min-h-12[^>]*aria-live="polite"/,
  );
});

test('chart controls expose every approved style, interval, and range label', () => {
  const source = readFileSync('src/views/playground/market/MarketPriceChart.tsx', 'utf8');
  for (const label of [
    '선',
    '캔들',
    '1분',
    '5분',
    '10분',
    '15분',
    '1시간',
    '1일',
    '오늘',
    '1주',
    '1개월',
    '6개월',
    '전체',
  ]) {
    assert.match(source, new RegExp(`['\"]${label}['\"]`));
  }
  assert.match(source, /resolveIntervalForRange/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /motion-reduce:transition-none/);
});

test('market clock pauses while hidden and catches up once when visible', () => {
  const source = readFileSync('src/features/playground/market/useMarketClock.ts', 'utf8');
  const scheduleStart = source.indexOf('const schedule');
  const visibilityStart = source.indexOf('const handleVisibility', scheduleStart);
  assert.ok(scheduleStart >= 0 && visibilityStart > scheduleStart);
  assert.match(source.slice(scheduleStart, visibilityStart), /document\.visibilityState\s*!==\s*'visible'/);
  assert.match(source, /alignMarketSecond\(Date\.now\(\)\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
  assert.match(source, /document\.removeEventListener\('visibilitychange'/);
  assert.match(source, /clearTimeout\(timer\)/);
});

test('one immutable live quote map is shared by market routes', async () => {
  const marketQuote = await import('../src/features/playground/market/marketQuote.ts');
  assert.equal(
    typeof marketQuote.buildMarketQuoteWonByStockId,
    'function',
    'quote map builder must exist',
  );
  const snapshot = createMarketPreviewSeed();
  const before = structuredClone(snapshot);
  const nowMs = Date.parse('2026-07-11T12:34:56.789Z');
  const quoteWonByStockId = marketQuote.buildMarketQuoteWonByStockId(snapshot, nowMs);

  assert.deepEqual(Object.keys(quoteWonByStockId).sort(), snapshot.stocks.map((stock) => stock.id).sort());
  for (const stock of snapshot.stocks) {
    assert.equal(
      quoteWonByStockId[stock.id],
      marketQuote.getMarketSnapshotQuoteWon(snapshot, stock.id, nowMs),
    );
  }
  assert.deepEqual(snapshot, before);
  assert.equal('quoteWonByStockId' in snapshot, false);
  assert.equal('quoteWonByStockId' in snapshot.account, false);

  const router = readFileSync('src/views/playground/market/MarketRouter.tsx', 'utf8');
  assert.equal((router.match(/buildMarketQuoteWonByStockId\(/g) ?? []).length, 1);
  assert.match(router, /useMarketClock\(\)/);
  assert.match(router, /useMemo\(/);
  assert.match(router, /<MarketHome[\s\S]*quoteWonByStockId=\{quoteWonByStockId\}/);
  assert.match(router, /<StockDetailView[\s\S]*currentPriceWon=\{quoteWonByStockId\[route\.stockId\]/);
  assert.match(router, /<MarketAccountView[\s\S]*quoteWonByStockId=\{quoteWonByStockId\}/);

  const detail = readFileSync('src/views/playground/market/StockDetailView.tsx', 'utf8');
  const chart = readFileSync('src/views/playground/market/MarketPriceChart.tsx', 'utf8');
  assert.doesNotMatch(detail, /useMarketClock|getMarketSnapshotQuoteWon/);
  assert.match(detail, /currentPriceWon/);
  assert.match(detail, /nowMs/);
  assert.match(detail, /<MarketOrderPanel[\s\S]*currentPriceWon=\{currentPriceWon\}/);
  assert.match(chart, /closeWon:\s*stock\.referencePriceWon/);

  const account = readFileSync('src/views/playground/market/MarketAccountView.tsx', 'utf8');
  const rows = readFileSync('src/views/playground/market/MarketRows.tsx', 'utf8');
  assert.match(account, /quoteWonByStockId/);
  assert.match(rows, /currentPriceWon/);
});
