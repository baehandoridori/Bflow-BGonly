import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { resolveIntervalForRange } from '../src/features/playground/market/chartSeries.ts';
import {
  getCanonicalMarketQuoteWon,
  getLivePriceWon,
  getMarketDailyCheckpoint,
} from '../src/features/playground/market/livePriceEngine.ts';
import { createMarketPreviewSeed } from '../src/features/playground/market/seed.ts';

const PREFERENCE_PATH = 'src/features/playground/market/useMarketChartPreference.ts';
const CHART_UI_PATH = 'src/features/playground/market/marketChartUi.ts';
const DISPLAY_SERIES_PATH = 'src/features/playground/market/marketDisplaySeries.ts';
const CANVAS_PATH = 'src/views/playground/market/MarketChartCanvas.tsx';
const PRICE_CHART_PATH = 'src/views/playground/market/MarketPriceChart.tsx';

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
  assert.equal(resolveIntervalForRange('1m', 'week'), '10m');
  assert.equal(resolveIntervalForRange('week', '5m'), '10m');
  assert.equal(resolveIntervalForRange('month', '15m'), '1h');
  assert.equal(resolveIntervalForRange('six-months', '1h'), '1d');
  assert.equal(resolveIntervalForRange('all', '1m'), '1d');
});

test('long-range display candles use exact daily engine checkpoints', async () => {
  assert.equal(existsSync(DISPLAY_SERIES_PATH), true, 'display candle fast path must exist');
  const displaySeries = await import('../src/features/playground/market/marketDisplaySeries.ts');
  const endMs = Date.parse('2026-07-12T00:00:00Z');
  const startMs = endMs - 600 * 24 * 60 * 60_000;
  const profile = {
    stockId: 'display-budget-profile',
    basePriceWon: 1000,
    volatilityBps: 100,
    phase: 0.25,
    baseMinuteVolume: 8000,
  };
  const candles = displaySeries.buildMarketDisplayCandles({
    profile,
    startMs,
    endMs,
    nowMs: endMs,
    events: [],
    interval: '1d' as const,
  });
  const firstCheckpoint = getMarketDailyCheckpoint(profile, startMs, []);

  assert.equal(candles.length, 600);
  assert.deepEqual(candles[0], {
    startsAt: new Date(startMs).toISOString(),
    openWon: firstCheckpoint.openWon,
    highWon: firstCheckpoint.highWon,
    lowWon: firstCheckpoint.lowWon,
    closeWon: firstCheckpoint.closeWon,
    volumeShares: firstCheckpoint.volumeShares,
    newsIds: [],
  });
  assert.match(readFileSync(DISPLAY_SERIES_PATH, 'utf8'), /getMarketDailyCheckpoint/);
});

test('six hundred daily bars leave render before cold checkpoint work starts', async () => {
  const displaySeries = await import('../src/features/playground/market/marketDisplaySeries.ts');
  assert.equal(
    typeof displaySeries.buildMarketDisplayCandlesProgressively,
    'function',
    'long daily ranges need a yielding display builder',
  );
  const endMs = Date.parse('2026-07-12T00:00:00Z');
  const controller = new AbortController();
  const startedAt = performance.now();
  const pending = displaySeries.buildMarketDisplayCandlesProgressively({
    profile: {
      stockId: 'progressive-display-budget-profile',
      basePriceWon: 1000,
      volatilityBps: 100,
      phase: 0.25,
      baseMinuteVolume: 8000,
    },
    startMs: endMs - 600 * 24 * 60 * 60_000,
    endMs,
    nowMs: endMs,
    events: [],
    interval: '1d',
  }, { signal: controller.signal });
  const schedulingMs = performance.now() - startedAt;
  controller.abort();

  assert.ok(schedulingMs < 100, `cold 600-day scheduling blocked ${schedulingMs.toFixed(1)}ms`);
  assert.deepEqual(await pending, []);
  const priceChart = readFileSync(PRICE_CHART_PATH, 'utf8');
  assert.match(priceChart, /buildMarketDisplayCandlesProgressively/);
  assert.match(priceChart, /AbortController/);
});

test('progressive daily display keeps exact synchronous candle semantics', async () => {
  const displaySeries = await import('../src/features/playground/market/marketDisplaySeries.ts');
  assert.equal(typeof displaySeries.buildMarketDisplayCandlesProgressively, 'function');
  const endMs = Date.parse('2026-07-12T00:00:00Z');
  const request = {
    profile: {
      stockId: 'progressive-display-exact-profile',
      basePriceWon: 1000,
      volatilityBps: 100,
      phase: 0.25,
      baseMinuteVolume: 8000,
    },
    startMs: endMs - 3 * 24 * 60 * 60_000,
    endMs,
    nowMs: endMs,
    events: [],
    interval: '1d' as const,
  };
  let yieldCount = 0;
  const progressive = await displaySeries.buildMarketDisplayCandlesProgressively(request, {
    yieldControl: async () => {
      yieldCount += 1;
    },
  });
  const synchronous = displaySeries.buildMarketDisplayCandles(request);

  assert.deepEqual(progressive, synchronous);
  assert.ok(yieldCount > progressive.length, `${yieldCount} yields for ${progressive.length} bars`);
});

test('daily chart refreshes forming UTC-day OHLCV without restarting its history', async () => {
  const displaySeries = await import('../src/features/playground/market/marketDisplaySeries.ts');
  const profile = {
    stockId: 'forming-daily-volume-profile',
    basePriceWon: 100_000,
    volatilityBps: 2400,
    phase: 0.27,
    baseMinuteVolume: 12_000,
  };
  const currentUtcDayStartMs = Date.parse('2026-07-11T00:00:00Z');
  const firstNowMs = Date.parse('2026-07-11T12:00:10Z');
  const buildAt = (nowMs: number) => displaySeries.buildMarketDisplayCandles({
    profile,
    startMs: currentUtcDayStartMs,
    endMs: nowMs + 1,
    nowMs,
    events: [],
    interval: '1d',
  })[0];
  const first = buildAt(firstNowMs);
  const second = buildAt(firstNowMs + 1000);

  assert.ok(second.volumeShares > first.volumeShares);
  const priceChart = readFileSync(PRICE_CHART_PATH, 'utf8');
  assert.match(priceChart, /currentUtcDayStartMs/);
  assert.match(priceChart, /currentDailyCandles/);
  assert.match(priceChart, /startMs:\s*currentDailyStartMs/);
  assert.match(priceChart, /endMs:\s*currentUtcDayStartMs/);
  assert.match(priceChart, /progressiveDailyState\.requestKey\s*===\s*progressiveRequestKey/);
});

test('today daily split excludes the previous KST day before UTC rollover', async () => {
  const displaySeries = await import('../src/features/playground/market/marketDisplaySeries.ts');
  const profile = {
    stockId: 'kst-today-daily-split-profile',
    basePriceWon: 100_000,
    volatilityBps: 2400,
    phase: 0.27,
    baseMinuteVolume: 12_000,
  };
  const nowMs = Date.parse('2026-07-11T16:00:00Z'); // 2026-07-12 01:00 KST
  const currentUtcDayStartMs = Date.parse('2026-07-11T00:00:00Z');
  const chartRangeStartMs = Date.parse('2026-07-11T15:00:00Z');
  const request = {
    profile,
    endMs: nowMs + 1,
    nowMs,
    events: [],
    interval: '1d' as const,
  };
  const exact = displaySeries.buildMarketDisplayCandles({
    ...request,
    startMs: chartRangeStartMs,
  });
  const historical = await displaySeries.buildMarketDisplayCandlesProgressively({
    ...request,
    startMs: chartRangeStartMs,
    endMs: currentUtcDayStartMs,
    nowMs: currentUtcDayStartMs,
  }, { yieldControl: async () => {} });
  const current = displaySeries.buildMarketDisplayCandles({
    ...request,
    startMs: Math.max(currentUtcDayStartMs, chartRangeStartMs),
  });
  const wrongUtcDay = displaySeries.buildMarketDisplayCandles({
    ...request,
    startMs: currentUtcDayStartMs,
  });

  assert.deepEqual([...historical, ...current], exact);
  assert.ok(wrongUtcDay[0].volumeShares > exact[0].volumeShares);
  const priceChart = readFileSync(PRICE_CHART_PATH, 'utf8');
  assert.match(priceChart, /currentDailyStartMs\s*=\s*Math\.max\(currentUtcDayStartMs,\s*chartRangeStartMs\)/);
  assert.match(priceChart, /startMs:\s*currentDailyStartMs/);
});

test('a future event does not invalidate completed historical display bars', async () => {
  const { buildMarketDisplayCandles } = await import(
    '../src/features/playground/market/marketDisplaySeries.ts'
  );
  const startMs = Date.parse('2026-07-09T00:00:00Z');
  const endMs = Date.parse('2026-07-11T00:00:00Z');
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
  };
  const before = buildMarketDisplayCandles(request);
  const after = buildMarketDisplayCandles({
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

  assert.deepEqual(after, before);
});

test('a display candle matches the exact price frozen by an overlapping halt', async () => {
  const { buildMarketDisplayCandles } = await import(
    '../src/features/playground/market/marketDisplaySeries.ts'
  );
  const { getLivePriceWon } = await import(
    '../src/features/playground/market/livePriceEngine.ts'
  );
  const profile = {
    stockId: 'halt-dependency-profile',
    basePriceWon: 1000,
    volatilityBps: 0,
    phase: 0,
  };
  const events = [{
    id: 'frozen-price-shock',
    stockId: profile.stockId,
    kind: 'shock-up' as const,
    title: '정지 직전 상승',
    impactBps: 1000,
    startsAt: '2026-07-11T00:00:00Z',
    endsAt: '2026-07-11T02:00:00Z',
    revision: 1,
  }, {
    id: 'long-halt',
    stockId: profile.stockId,
    kind: 'halt' as const,
    title: '장기 거래 정지',
    impactBps: 0,
    startsAt: '2026-07-11T01:00:00Z',
    endsAt: '2026-07-14T00:00:00Z',
    revision: 1,
  }];
  const startMs = Date.parse('2026-07-12T00:00:00Z');
  const endMs = Date.parse('2026-07-13T00:00:00Z');
  const exactPriceWon = getLivePriceWon(profile, startMs, events);
  const candle = buildMarketDisplayCandles({
    profile,
    startMs,
    endMs,
    nowMs: endMs,
    events,
    interval: '1d',
  })[0];

  assert.equal(exactPriceWon, 1100);
  assert.deepEqual(
    [candle.openWon, candle.highWon, candle.lowWon, candle.closeWon],
    [exactPriceWon, exactPriceWon, exactPriceWon, exactPriceWon],
  );
  assert.deepEqual(candle.newsIds, ['long-halt']);
});

test('recursive halt dependencies invalidate only the affected completed display bar', async () => {
  const { buildMarketDisplayCandles } = await import(
    '../src/features/playground/market/marketDisplaySeries.ts'
  );
  const { getLivePriceWon } = await import(
    '../src/features/playground/market/livePriceEngine.ts'
  );
  const profile = {
    stockId: 'recursive-halt-dependency-profile',
    basePriceWon: 1000,
    volatilityBps: 0,
    phase: 0,
  };
  const shock = {
    id: 'recursive-frozen-price-shock',
    stockId: profile.stockId,
    kind: 'shock-up' as const,
    title: '연쇄 정지 직전 상승',
    impactBps: 1000,
    startsAt: '2026-07-11T00:00:00Z',
    endsAt: '2026-07-11T02:00:00Z',
    revision: 1,
  };
  const halts = [{
    id: 'early-halt',
    stockId: profile.stockId,
    kind: 'halt' as const,
    title: '첫 거래 정지',
    impactBps: 0,
    startsAt: '2026-07-11T01:00:00Z',
    endsAt: '2026-07-11T04:00:00Z',
    revision: 1,
  }, {
    id: 'late-halt',
    stockId: profile.stockId,
    kind: 'halt' as const,
    title: '연장 거래 정지',
    impactBps: 0,
    startsAt: '2026-07-11T03:00:00Z',
    endsAt: '2026-07-14T00:00:00Z',
    revision: 1,
  }];
  const startMs = Date.parse('2026-07-12T00:00:00Z');
  const endMs = Date.parse('2026-07-13T00:00:00Z');
  const buildClose = (impactBps: number, revision: number) => {
    const events = [{ ...shock, impactBps, revision }, ...halts];
    const exactPriceWon = getLivePriceWon(profile, startMs, events);
    const candle = buildMarketDisplayCandles({
      profile,
      startMs,
      endMs,
      nowMs: endMs,
      events,
      interval: '1d',
    })[0];
    assert.deepEqual(candle.newsIds, ['late-halt']);
    return { exactPriceWon, displayPriceWon: candle.closeWon };
  };

  assert.deepEqual(buildClose(1000, 1), {
    exactPriceWon: 1100,
    displayPriceWon: 1100,
  });
  assert.deepEqual(buildClose(2000, 2), {
    exactPriceWon: 1200,
    displayPriceWon: 1200,
  });
});

test('completed display bars are cached but the forming bar is resampled', async () => {
  assert.equal(existsSync(DISPLAY_SERIES_PATH), true, 'display candle fast path must exist');
  const { buildMarketDisplayCandles } = await import(
    '../src/features/playground/market/marketDisplaySeries.ts'
  );
  const startMs = Date.parse('2026-07-10T00:00:00Z');
  const firstNowMs = Date.parse('2026-07-11T12:00:10Z');
  const secondNowMs = firstNowMs + 1000;
  const profile = {
    stockId: 'display-cache-profile',
    basePriceWon: 100_000,
    volatilityBps: 2400,
    phase: 0.27,
    baseMinuteVolume: 12_000,
  };
  const request = {
    profile,
    startMs,
    endMs: firstNowMs + 1,
    nowMs: firstNowMs,
    events: [],
    interval: '1d' as const,
  };

  const first = buildMarketDisplayCandles(request);
  const second = buildMarketDisplayCandles({
    ...request,
    endMs: secondNowMs + 1,
    nowMs: secondNowMs,
  });

  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.deepEqual(second[0], first[0], 'completed day must stay stable');
  assert.equal(second.at(-1)?.closeWon, getLivePriceWon(profile, secondNowMs, []));
  assert.ok((first.at(-1)?.volumeShares ?? -1) >= 0);
  assert.ok((second.at(-1)?.volumeShares ?? -1) >= (first.at(-1)?.volumeShares ?? 0));
});

test('chart UI helpers cap bars, select the nearest bar, and describe OHLC text', async () => {
  assert.equal(existsSync(CHART_UI_PATH), true, 'testable chart UI helpers must exist');
  const chartUi = await import('../src/features/playground/market/marketChartUi.ts');
  const candles = Array.from({ length: 1505 }, (_, index) => ({
    startsAt: new Date(Date.parse('2026-07-11T12:00:00Z') + index * 60_000).toISOString(),
    openWon: 1000 + index,
    highWon: 1020 + index,
    lowWon: 980 + index,
    closeWon: 1010 + index,
    volumeShares: 100 + index,
    newsIds: [],
  }));

  const limited = chartUi.limitMarketChartCandles(candles);
  assert.equal(chartUi.MAX_MARKET_CHART_BARS, 1500);
  assert.equal(limited.length, 1500);
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

test('one immutable engine quote context is shared by market routes', async () => {
  const marketQuote = await import('../src/features/playground/market/marketQuote.ts');
  assert.equal(
    typeof marketQuote.buildMarketQuoteContext,
    'function',
    'quote context builder must exist',
  );
  const snapshot = createMarketPreviewSeed();
  const before = structuredClone(snapshot);
  const nowMs = Date.parse('2026-07-13T14:34:56.789Z');
  const earlySameKstDayMs = Date.parse('2026-07-12T16:34:56.789Z');
  const previousCloseAtMs = Date.parse('2026-07-12T14:59:59.000Z');
  const quoteContext = marketQuote.buildMarketQuoteContext(snapshot, nowMs);
  const repeatedSameMinuteContext = marketQuote.buildMarketQuoteContext(snapshot, nowMs + 1000);
  const earlyContext = marketQuote.buildMarketQuoteContext(snapshot, earlySameKstDayMs);

  assert.deepEqual(
    Object.keys(quoteContext.quoteWonByStockId).sort(),
    snapshot.stocks.map((stock) => stock.id).sort(),
  );
  for (const stock of snapshot.stocks) {
    assert.equal(
      quoteContext.quoteWonByStockId[stock.id],
      getCanonicalMarketQuoteWon(stock.id, Math.floor(nowMs / 1000) * 1000, snapshot.adminEvents),
    );
    assert.equal(
      quoteContext.previousCloseWonByStockId[stock.id],
      getCanonicalMarketQuoteWon(stock.id, previousCloseAtMs, snapshot.adminEvents),
    );
    assert.equal(
      earlyContext.previousCloseWonByStockId[stock.id],
      quoteContext.previousCloseWonByStockId[stock.id],
      `${stock.id} must use the KST day boundary even across UTC dates`,
    );
    const sparkline = quoteContext.sparklineByStockId[stock.id];
    const repeatedSparkline = repeatedSameMinuteContext.sparklineByStockId[stock.id];
    assert.ok(sparkline.length >= 48 && sparkline.length <= 96, `${stock.id}: ${sparkline.length}`);
    assert.equal(sparkline.at(-1)?.priceWon, quoteContext.quoteWonByStockId[stock.id]);
    assert.equal(repeatedSparkline.length, sparkline.length);
    for (let index = 0; index < sparkline.length - 1; index += 1) {
      assert.strictEqual(
        repeatedSparkline[index],
        sparkline[index],
        `${stock.id} historical sparkline points must be reused within one minute`,
      );
    }
  }
  assert.deepEqual(snapshot, before);
  assert.equal('quoteWonByStockId' in snapshot, false);
  assert.equal('quoteWonByStockId' in snapshot.account, false);

  const router = readFileSync('src/views/playground/market/MarketRouter.tsx', 'utf8');
  assert.equal((router.match(/buildMarketQuoteContext\(/g) ?? []).length, 1);
  assert.match(router, /useMarketClock\(\)/);
  assert.match(router, /useMemo\(/);
  assert.match(router, /<MarketHome[\s\S]*quoteContext=\{quoteContext\}/);
  assert.match(router, /<MarketStockRoute[\s\S]*quoteContext=\{quoteContext\}/);
  assert.match(router, /<MarketAccountView[\s\S]*quoteWonByStockId=\{quoteContext\.quoteWonByStockId\}/);

  const detail = readFileSync('src/views/playground/market/StockDetailView.tsx', 'utf8');
  const chart = readFileSync('src/views/playground/market/MarketPriceChart.tsx', 'utf8');
  assert.doesNotMatch(detail, /useMarketClock|getMarketSnapshotQuoteWon/);
  assert.match(detail, /quoteContext/);
  assert.match(detail, /nowMs/);
  assert.match(router, /useMarketOrderController\(\{[\s\S]*currentPriceWon/);
  assert.match(router, /<StockDetailView[\s\S]*quoteContext=\{quoteContext\}/);
  assert.match(router, /<MarketOrderPanel controller=\{controller\}/);
  assert.match(chart, /closeWon:\s*stock\.referencePriceWon/);

  const account = readFileSync('src/views/playground/market/MarketAccountView.tsx', 'utf8');
  const rows = readFileSync('src/views/playground/market/MarketRows.tsx', 'utf8');
  assert.match(account, /quoteWonByStockId/);
  assert.match(rows, /sparklineByStockId/);
  assert.doesNotMatch(rows, /todaySeriesAtQuote|stock\.series\.today/);
});
