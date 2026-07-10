import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyMarketCommand,
  getAccountSummary,
  getSellProjection,
  getStockQuote,
  holdingValuePoints,
  validateMarketCommand,
} from '../src/features/playground/market/domain.ts';
import { createMarketPreviewSeed } from '../src/features/playground/market/seed.ts';

test('seed has the approved eight companies and account totals', () => {
  const snapshot = createMarketPreviewSeed();
  assert.deepEqual(snapshot.stocks.map((stock) => stock.name), [
    'JBBJ', 'YouTube', '메타코미디', 'Netflix', 'Adobe', 'Wacom', 'Slack', 'Google Drive',
  ]);
  assert.deepEqual(getAccountSummary(snapshot), {
    walletPoints: 18450,
    cashPoints: 3640,
    holdingsValuePoints: 7705,
    totalAssetsPoints: 11345,
    realizedPnlPoints: 1240,
    unrealizedPnlPoints: 205,
    monthlyUnrealizedChangePoints: 205,
    monthlyTotalPnlPoints: 1445,
  });
  assert.deepEqual(getStockQuote(snapshot.stocks[0]), { changePoints: 142, changeRate: 8.4, trend: 'up' });
  assert.equal(snapshot.beginnerMission, 'reason');
});

test('monthly profit subtracts the month-start unrealized baseline', () => {
  const snapshot = createMarketPreviewSeed();
  snapshot.account.unrealizedPnlAtMonthStartPoints = 80;
  const summary = getAccountSummary(snapshot);
  assert.equal(summary.unrealizedPnlPoints, 205);
  assert.equal(summary.monthlyUnrealizedChangePoints, 125);
  assert.equal(summary.monthlyTotalPnlPoints, 1365);
});

test('week, month and all series span distinct date ranges and end at current price', () => {
  const stock = createMarketPreviewSeed().stocks[0];
  const span = (period: 'today' | 'week' | 'month' | 'all') => (
    Date.parse(stock.series[period].at(-1)!.at) - Date.parse(stock.series[period][0].at)
  );
  assert.ok(span('today') < span('week'));
  assert.ok(span('week') < span('month'));
  assert.ok(span('month') < span('all'));
  for (const period of ['today', 'week', 'month', 'all'] as const) {
    assert.equal(stock.series[period].at(-1)?.pricePoints, stock.pricePoints);
    const marker = stock.series[period].find((point) => point.newsId === 'jbbj-news');
    assert.equal(marker?.at, new Date('2026-07-11T15:00:00+09:00').toISOString());
    const times = stock.series[period].map((point) => Date.parse(point.at));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  }
});

test('seed is repeatable and links every stock news marker across all periods', () => {
  const first = createMarketPreviewSeed();
  assert.deepEqual(createMarketPreviewSeed(), first);
  const expectedNewsAt = new Date('2026-07-11T15:00:00+09:00').toISOString();
  for (const stock of first.stocks) {
    const newsId = `${stock.id}-news`;
    const news = first.news.find((item) => item.id === newsId);
    assert.equal(news?.stockId, stock.id);
    assert.equal(new Date(news!.publishedAt).toISOString(), expectedNewsAt);
    for (const period of ['today', 'week', 'month', 'all'] as const) {
      const markers = stock.series[period].filter((point) => point.newsId === newsId);
      assert.equal(markers.length, 1);
      assert.equal(markers[0].at, expectedNewsAt);
      assert.equal(stock.series[period].at(-1)?.pricePoints, stock.pricePoints);
    }
  }
});

test('wallet transfer changes cash but never changes investment result', () => {
  const before = createMarketPreviewSeed();
  const after = applyMarketCommand(before, {
    kind: 'transfer', requestId: 'deposit-1', direction: 'wallet-to-broker', points: 1000,
  });
  assert.equal(after.account.walletPoints, 17450);
  assert.equal(after.account.cashPoints, 4640);
  assert.equal(getAccountSummary(after).monthlyTotalPnlPoints, 1445);
});

test('invalid commands explain why the action is unavailable', () => {
  const snapshot = createMarketPreviewSeed();
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'transfer', requestId: 'bad', direction: 'wallet-to-broker', points: 999999,
  }), '포인트 지갑 잔액이 부족해요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'buy', requestId: 'bad-buy', stockId: 'jbbj', points: 999999,
  }), '예수금이 부족해요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'sell', requestId: 'bad-sell', stockId: 'google-drive', ratioBps: 2500,
  }), '보유한 주식이 없어요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'transfer', requestId: 'bad-withdraw', direction: 'broker-to-wallet', points: 3641,
  }), '꺼낼 수 있는 예수금이 부족해요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'transfer', requestId: 'zero-transfer', direction: 'wallet-to-broker', points: 0,
  }), '1P 이상 입력해 주세요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'buy', requestId: 'fractional-buy', stockId: 'jbbj', points: 1.5,
  }), '1P 이상 입력해 주세요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'buy', requestId: 'missing-stock', stockId: 'missing', points: 100,
  }), '종목을 찾지 못했어요');
});

test('point commands reject unsafe integers before balance and quantity math', () => {
  const snapshot = createMarketPreviewSeed();
  const unsafePoints = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'transfer', requestId: 'unsafe-transfer', direction: 'wallet-to-broker', points: unsafePoints,
  }), '1P 이상 입력해 주세요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'buy', requestId: 'unsafe-buy', stockId: 'jbbj', points: unsafePoints,
  }), '1P 이상 입력해 주세요');

  snapshot.account.cashPoints = Number.MAX_SAFE_INTEGER;
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'buy', requestId: 'unsafe-quantity', stockId: 'google-drive', points: Number.MAX_SAFE_INTEGER,
  }), '주문 수량을 안전하게 계산할 수 없어요');

  const unsafeSellQuantity = createMarketPreviewSeed();
  unsafeSellQuantity.account.cashPoints = 1_000_000;
  unsafeSellQuantity.stocks.find((stock) => stock.id === 'google-drive')!.pricePoints = 1;
  assert.equal(validateMarketCommand(unsafeSellQuantity, {
    kind: 'buy', requestId: 'unsafe-sell-quantity', stockId: 'google-drive', points: 1_000_000,
  }), '주문 수량을 안전하게 계산할 수 없어요');

  const unsafeCostAllocation = createMarketPreviewSeed();
  unsafeCostAllocation.account.cashPoints = 100_000_000;
  unsafeCostAllocation.stocks.find((stock) => stock.id === 'google-drive')!.pricePoints = 1_000_000;
  assert.equal(validateMarketCommand(unsafeCostAllocation, {
    kind: 'buy', requestId: 'unsafe-cost-allocation', stockId: 'google-drive', points: 100_000_000,
  }), '주문 수량을 안전하게 계산할 수 없어요');
});

test('buy and sell use integer micro-shares', () => {
  const seed = createMarketPreviewSeed();
  const bought = applyMarketCommand(seed, {
    kind: 'buy', requestId: 'buy-1', stockId: 'google-drive', points: 500,
  });
  const holding = bought.account.holdings.find((item) => item.stockId === 'google-drive');
  assert.ok(holding && Number.isInteger(holding.quantityMicros));
  assert.ok(bought.account.cashPoints < seed.account.cashPoints);
  const sold = applyMarketCommand(bought, {
    kind: 'sell', requestId: 'sell-1', stockId: 'google-drive', ratioBps: 2500,
  });
  const remaining = sold.account.holdings.find((item) => item.stockId === 'google-drive');
  assert.ok(remaining && Number.isInteger(remaining.quantityMicros));
});

test('repeated one-point buys and full liquidation conserve every stock account result', () => {
  for (const stock of createMarketPreviewSeed().stocks) {
    let snapshot = createMarketPreviewSeed();
    const before = getAccountSummary(snapshot);
    const buyCount = snapshot.account.cashPoints;
    for (let count = 0; count < buyCount; count += 1) {
      snapshot = applyMarketCommand(snapshot, {
        kind: 'buy', requestId: `${stock.id}-tiny-buy-${count}`, stockId: stock.id, points: 1,
      });
      const afterBuy = getAccountSummary(snapshot);
      assert.equal(afterBuy.totalAssetsPoints, before.totalAssetsPoints, `${stock.id}: assets drifted at buy ${count + 1}`);
      assert.equal(afterBuy.monthlyTotalPnlPoints, before.monthlyTotalPnlPoints, `${stock.id}: P&L drifted at buy ${count + 1}`);
    }

    const afterBuys = getAccountSummary(snapshot);
    assert.equal(afterBuys.totalAssetsPoints, before.totalAssetsPoints, `${stock.id}: assets drifted after buys`);
    assert.equal(afterBuys.monthlyTotalPnlPoints, before.monthlyTotalPnlPoints, `${stock.id}: P&L drifted after buys`);

    snapshot = applyMarketCommand(snapshot, {
      kind: 'sell', requestId: `${stock.id}-full-liquidation`, stockId: stock.id, ratioBps: 10000,
    });
    const afterSale = getAccountSummary(snapshot);
    assert.equal(snapshot.account.holdings.some((holding) => holding.stockId === stock.id), false);
    assert.equal(afterSale.totalAssetsPoints, before.totalAssetsPoints, `${stock.id}: assets drifted after sale`);
    assert.equal(afterSale.monthlyTotalPnlPoints, before.monthlyTotalPnlPoints, `${stock.id}: P&L drifted after sale`);
  }
});

test('full sale removes the holding and conserves cash and cost basis', () => {
  const seed = createMarketPreviewSeed();
  const holding = seed.account.holdings.find((item) => item.stockId === 'jbbj')!;
  const stock = seed.stocks.find((item) => item.id === 'jbbj')!;
  const projection = getSellProjection(holding, stock.pricePoints, 10000);
  const sold = applyMarketCommand(seed, {
    kind: 'sell', requestId: 'sell-all', stockId: 'jbbj', ratioBps: 10000,
  });
  assert.equal(projection.soldQuantityMicros, holding.quantityMicros);
  assert.equal(projection.soldCostPoints, holding.costBasisPoints);
  assert.equal(sold.account.holdings.some((item) => item.stockId === 'jbbj'), false);
  assert.equal(sold.account.cashPoints, seed.account.cashPoints + projection.proceedsPoints);
  assert.equal(
    sold.account.realizedPnlThisMonthPoints,
    seed.account.realizedPnlThisMonthPoints + projection.proceedsPoints - projection.soldCostPoints,
  );
});

test('beginner mission advances through favorite, reason, then first order', () => {
  const seed = createMarketPreviewSeed();
  seed.beginnerMission = 'favorite';
  const favorited = applyMarketCommand(seed, {
    kind: 'favorite', requestId: 'fav-1', stockId: 'adobe', wished: true,
  });
  assert.equal(favorited.beginnerMission, 'reason');
  const read = applyMarketCommand(favorited, {
    kind: 'read-reason', requestId: 'read-1', stockId: 'adobe',
  });
  assert.equal(read.beginnerMission, 'first-order');
  const ordered = applyMarketCommand(read, {
    kind: 'buy', requestId: 'buy-mission', stockId: 'adobe', points: 100,
  });
  assert.equal(ordered.beginnerMission, 'complete');
});

test('custom sell percentage stays between one and one hundred percent', () => {
  const snapshot = createMarketPreviewSeed();
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'sell', requestId: 'sell-low', stockId: 'jbbj', ratioBps: 99,
  }), '1%부터 100%까지 입력해 주세요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'sell', requestId: 'sell-fraction', stockId: 'jbbj', ratioBps: 101,
  }), '매도 비율은 1% 단위로 입력해 주세요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'sell', requestId: 'sell-custom', stockId: 'jbbj', ratioBps: 3300,
  }), null);
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'sell', requestId: 'sell-high', stockId: 'jbbj', ratioBps: 10001,
  }), '1%부터 100%까지 입력해 주세요');
});

test('flat-price buy then partial sell does not invent a loss', () => {
  const seed = createMarketPreviewSeed();
  const bought = applyMarketCommand(seed, {
    kind: 'buy', requestId: 'tiny-buy', stockId: 'google-drive', points: 5,
  });
  const realizedBefore = bought.account.realizedPnlThisMonthPoints;
  const sold = applyMarketCommand(bought, {
    kind: 'sell', requestId: 'half-sell', stockId: 'google-drive', ratioBps: 5000,
  });
  assert.equal(sold.account.realizedPnlThisMonthPoints, realizedBefore);
});

test('one-point flat-price partial sell does not invent realized profit', () => {
  const seed = createMarketPreviewSeed();
  const bought = applyMarketCommand(seed, {
    kind: 'buy', requestId: 'one-point-buy', stockId: 'google-drive', points: 1,
  });
  const realizedBefore = bought.account.realizedPnlThisMonthPoints;
  const sold = applyMarketCommand(bought, {
    kind: 'sell', requestId: 'one-point-half-sell', stockId: 'google-drive', ratioBps: 5000,
  });
  assert.equal(sold.account.realizedPnlThisMonthPoints, realizedBefore);
  assert.equal(getAccountSummary(sold).monthlyTotalPnlPoints, getAccountSummary(bought).monthlyTotalPnlPoints);
  assert.equal(sold.account.holdings.some((item) => item.stockId === 'google-drive'), false);
});

test('every partial sell preserves the pre-sale rounded holding value', () => {
  const snapshot = createMarketPreviewSeed();
  for (const holding of snapshot.account.holdings) {
    const stock = snapshot.stocks.find((item) => item.id === holding.stockId)!;
    const beforeValue = holdingValuePoints(holding, stock.pricePoints);
    for (let percent = 1; percent < 100; percent += 1) {
      const projection = getSellProjection(holding, stock.pricePoints, percent * 100);
      const remaining = { ...holding, quantityMicros: holding.quantityMicros - projection.soldQuantityMicros };
      assert.equal(projection.proceedsPoints + holdingValuePoints(remaining, stock.pricePoints), beforeValue);
    }
  }
});

test('buy rejects a non-positive or unsafe quote before quantity math', () => {
  for (const pricePoints of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const snapshot = createMarketPreviewSeed();
    snapshot.stocks[0].pricePoints = pricePoints;
    assert.equal(validateMarketCommand(snapshot, {
      kind: 'buy', requestId: 'bad-quote', stockId: snapshot.stocks[0].id, points: 100,
    }), '현재 가격을 확인할 수 없어요');
  }
});
