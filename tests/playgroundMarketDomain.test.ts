import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyMarketCommand,
  getAccountSummary,
  getBuyCostWon,
  getChartGeometry,
  getChartHoverBands,
  getSellProjection,
  getSharedReturnDomain,
  getStockQuote,
  holdingValueWon,
  maxBuyableShares,
  toReturnSeries,
  validateMarketCommand,
} from '../src/features/playground/market/domain.ts';
import { formatPoints, formatShares, formatWon } from '../src/features/playground/market/format.ts';
import { createMarketPreviewSeed } from '../src/features/playground/market/seed.ts';
import type { MarketCommand, MarketSnapshot } from '../src/features/playground/market/types.ts';

function withBrokerCash(cashWon = 20_000): MarketSnapshot {
  return applyMarketCommand(createMarketPreviewSeed(), {
    kind: 'transfer',
    requestId: `deposit-${cashWon}`,
    direction: 'wallet-to-broker',
    points: cashWon,
  });
}

test('seed has the approved eight companies and exact empty million-point account', () => {
  const snapshot = createMarketPreviewSeed();
  assert.deepEqual(snapshot.stocks.map((stock) => stock.name), [
    'JBBJ', 'YouTube', '메타코미디', 'Netflix', 'Adobe', 'Wacom', 'Slack', 'Google Drive',
  ]);
  assert.deepEqual(snapshot.account, {
    walletPoints: 1_000_000,
    lifetimeEarnedPoints: 1_000_000,
    cashWon: 0,
    realizedPnlThisMonthWon: 0,
    unrealizedPnlAtMonthStartWon: 0,
    holdings: [],
  });
  assert.deepEqual(getAccountSummary(snapshot), {
    walletPoints: 1_000_000,
    lifetimeEarnedPoints: 1_000_000,
    cashWon: 0,
    holdingsValueWon: 0,
    totalAssetsWon: 0,
    realizedPnlWon: 0,
    unrealizedPnlWon: 0,
    monthlyUnrealizedChangeWon: 0,
    monthlyTotalPnlWon: 0,
  });
  assert.deepEqual(getStockQuote(snapshot.stocks[0]), {
    changeWon: 142,
    changeRate: 8.4,
    trend: 'up',
  });
  assert.equal(snapshot.beginnerMission, 'reason');
});

test('buying three whole shares at 1,842 won spends exactly 5,526 won', () => {
  const before = withBrokerCash(10_000);
  const bought = applyMarketCommand(before, {
    kind: 'buy',
    requestId: 'buy-three',
    stockId: 'jbbj',
    quantityShares: 3,
    quotedPriceWon: 1_842,
  });

  assert.equal(getBuyCostWon(3, 1_842), 5_526);
  assert.equal(bought.account.cashWon, 4_474);
  assert.deepEqual(bought.account.holdings, [{
    stockId: 'jbbj',
    quantityShares: 3,
    costBasisWon: 5_526,
  }]);
  assert.equal(holdingValueWon(bought.account.holdings[0], 1_842), 5_526);
});

test('selling two shares returns quoted proceeds and keeps integer proportional cost and PnL', () => {
  const bought = applyMarketCommand(withBrokerCash(10_000), {
    kind: 'buy',
    requestId: 'buy-before-partial-sale',
    stockId: 'jbbj',
    quantityShares: 3,
    quotedPriceWon: 1_842,
  });
  const holding = bought.account.holdings[0];
  const projection = getSellProjection(holding, 2_000, 2);
  assert.deepEqual(projection, {
    soldQuantityShares: 2,
    proceedsWon: 4_000,
    soldCostBasisWon: 3_684,
  });

  const sold = applyMarketCommand(bought, {
    kind: 'sell',
    requestId: 'sell-two',
    stockId: 'jbbj',
    quantityShares: 2,
    quotedPriceWon: 2_000,
  });
  assert.equal(sold.account.cashWon, 8_474);
  assert.equal(sold.account.realizedPnlThisMonthWon, 316);
  assert.deepEqual(sold.account.holdings, [{
    stockId: 'jbbj',
    quantityShares: 1,
    costBasisWon: 1_842,
  }]);
  assert.ok(Number.isInteger(sold.account.holdings[0].costBasisWon));
  assert.ok(Number.isInteger(sold.account.realizedPnlThisMonthWon));
});

test('selling all removes the holding and allocates all remaining cost basis', () => {
  const bought = applyMarketCommand(withBrokerCash(10_000), {
    kind: 'buy',
    requestId: 'buy-before-all-sale',
    stockId: 'jbbj',
    quantityShares: 3,
    quotedPriceWon: 1_842,
  });
  const projection = getSellProjection(bought.account.holdings[0], 1_900, 'all');
  assert.deepEqual(projection, {
    soldQuantityShares: 3,
    proceedsWon: 5_700,
    soldCostBasisWon: 5_526,
  });

  const sold = applyMarketCommand(bought, {
    kind: 'sell',
    requestId: 'sell-all',
    stockId: 'jbbj',
    quantityShares: 'all',
    quotedPriceWon: 1_900,
  });
  assert.equal(sold.account.holdings.length, 0);
  assert.equal(sold.account.cashWon, 10_174);
  assert.equal(sold.account.realizedPnlThisMonthWon, 174);
});

test('realized PnL rejects a final unsafe result even when JS rounding looks safe', () => {
  const snapshot = createMarketPreviewSeed();
  snapshot.account.realizedPnlThisMonthWon = Number.MAX_SAFE_INTEGER;
  snapshot.account.holdings = [{ stockId: 'jbbj', quantityShares: 1, costBasisWon: 1 }];
  const command: MarketCommand = {
    kind: 'sell',
    requestId: 'unsafe-final-pnl',
    stockId: 'jbbj',
    quantityShares: 'all',
    quotedPriceWon: 2,
  };

  assert.equal(validateMarketCommand(snapshot, command), '잔액을 안전하게 계산할 수 없어요');
  assert.throws(() => applyMarketCommand(snapshot, command), /잔액을 안전하게 계산할 수 없어요/);
});

test('zero, negative, fractional and unsafe share quantities fail validation', () => {
  const snapshot = withBrokerCash(100_000);
  for (const quantityShares of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateMarketCommand(snapshot, {
      kind: 'buy',
      requestId: `invalid-${quantityShares}`,
      stockId: 'jbbj',
      quantityShares,
      quotedPriceWon: 1_842,
    }), '1주 이상 안전한 정수로 입력해 주세요');
    assert.equal(validateMarketCommand(snapshot, {
      kind: 'sell',
      requestId: `invalid-sell-${quantityShares}`,
      stockId: 'jbbj',
      quantityShares,
      quotedPriceWon: 1_842,
    }), '1주 이상 안전한 정수로 입력해 주세요');
  }
});

test('orders reject invalid prices, unsafe multiplication and unavailable balances', () => {
  const snapshot = withBrokerCash(10_000);
  for (const quotedPriceWon of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateMarketCommand(snapshot, {
      kind: 'buy', requestId: `bad-price-${quotedPriceWon}`, stockId: 'jbbj', quantityShares: 1, quotedPriceWon,
    }), '현재 가격을 확인할 수 없어요');
  }
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'buy', requestId: 'unsafe-total', stockId: 'jbbj', quantityShares: Number.MAX_SAFE_INTEGER, quotedPriceWon: 2,
  }), '주문 금액을 안전하게 계산할 수 없어요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'buy', requestId: 'too-expensive', stockId: 'jbbj', quantityShares: 6, quotedPriceWon: 1_842,
  }), '예수금이 부족해요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'sell', requestId: 'no-holding', stockId: 'jbbj', quantityShares: 1, quotedPriceWon: 1_842,
  }), '보유한 주식이 없어요');
});

test('the explicit current price overrides the command quote for optimistic calculation', () => {
  const snapshot = withBrokerCash(10_000);
  const command: MarketCommand = {
    kind: 'buy',
    requestId: 'current-price',
    stockId: 'jbbj',
    quantityShares: 2,
    quotedPriceWon: 1_842,
  };
  const bought = applyMarketCommand(snapshot, command, 2_000);
  assert.equal(bought.account.cashWon, 6_000);
  assert.equal(bought.account.holdings[0].costBasisWon, 4_000);
});

test('maximum buy and account transfer keep whole won and lifetime ranking points stable', () => {
  const seed = createMarketPreviewSeed();
  const deposited = applyMarketCommand(seed, {
    kind: 'transfer', requestId: 'deposit', direction: 'wallet-to-broker', points: 5_527,
  });
  assert.equal(deposited.account.walletPoints, 994_473);
  assert.equal(deposited.account.lifetimeEarnedPoints, 1_000_000);
  assert.equal(deposited.account.cashWon, 5_527);
  assert.equal(maxBuyableShares(deposited.account.cashWon, 1_842), 3);

  const withdrawn = applyMarketCommand(deposited, {
    kind: 'transfer', requestId: 'withdraw', direction: 'broker-to-wallet', points: 527,
  });
  assert.equal(withdrawn.account.walletPoints, 995_000);
  assert.equal(withdrawn.account.lifetimeEarnedPoints, 1_000_000);
  assert.equal(withdrawn.account.cashWon, 5_000);
});

test('beginner mission advances through favorite, reason, then first whole-share order', () => {
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
  const funded = applyMarketCommand(read, {
    kind: 'transfer', requestId: 'fund-mission', direction: 'wallet-to-broker', points: 1_000,
  });
  const ordered = applyMarketCommand(funded, {
    kind: 'buy', requestId: 'buy-mission', stockId: 'adobe', quantityShares: 1, quotedPriceWon: 770,
  });
  assert.equal(ordered.beginnerMission, 'complete');
});

test('monthly profit subtracts the month-start unrealized baseline', () => {
  const snapshot = applyMarketCommand(withBrokerCash(10_000), {
    kind: 'buy', requestId: 'buy-for-summary', stockId: 'jbbj', quantityShares: 2, quotedPriceWon: 1_800,
  });
  snapshot.account.unrealizedPnlAtMonthStartWon = 20;
  const summary = getAccountSummary(snapshot);
  assert.equal(summary.holdingsValueWon, 3_684);
  assert.equal(summary.unrealizedPnlWon, 84);
  assert.equal(summary.monthlyUnrealizedChangeWon, 64);
  assert.equal(summary.monthlyTotalPnlWon, 64);
});

test('seed series remain deterministic, ordered and end at the reference price', () => {
  const first = createMarketPreviewSeed();
  assert.deepEqual(createMarketPreviewSeed(), first);
  const expectedNewsAt = new Date('2026-07-11T15:00:00+09:00').toISOString();
  for (const stock of first.stocks) {
    const spans = (['today', 'week', 'month', 'all'] as const).map((period) => (
      Date.parse(stock.series[period].at(-1)!.at) - Date.parse(stock.series[period][0].at)
    ));
    assert.ok(spans[0] < spans[1] && spans[1] < spans[2] && spans[2] < spans[3]);
    for (const period of ['today', 'week', 'month', 'all'] as const) {
      const series = stock.series[period];
      assert.equal(series.at(-1)?.priceWon, stock.referencePriceWon);
      assert.equal(series.filter((point) => point.newsId === `${stock.id}-news`).length, 1);
      assert.equal(series.find((point) => point.newsId)?.at, expectedNewsAt);
      const times = series.map((point) => Date.parse(point.at));
      assert.deepEqual(times, [...times].sort((a, b) => a - b));
    }
  }
});

test('formatters keep P, won and whole-share units distinct', () => {
  assert.equal(formatPoints(1_000_000), '1,000,000P');
  assert.equal(formatWon(5_526), '5,526원');
  assert.equal(formatShares(3), '3주');
});

test('chart geometry uses the local won domain and handles one point', () => {
  assert.deepEqual(getChartGeometry([{ at: 'a', priceWon: 500 }], 100, 40), [{ x: 50, y: 20 }]);
  const points = getChartGeometry([
    { at: 'a', priceWon: 100 }, { at: 'b', priceWon: 200 }, { at: 'c', priceWon: 150 },
  ], 100, 40);
  assert.deepEqual(points, [{ x: 0, y: 40 }, { x: 50, y: 0 }, { x: 100, y: 20 }]);
  assert.deepEqual(getChartGeometry([
    { at: 'a', priceWon: 610 }, { at: 'b', priceWon: 610 },
  ], 100, 40), [{ x: 0, y: 20 }, { x: 100, y: 20 }]);
});

test('chart hover bands meet halfway between the visible points', () => {
  assert.deepEqual(getChartHoverBands([], 720), []);
  assert.deepEqual(getChartHoverBands([{ x: 360 }], 720), [{ x: 0, width: 720 }]);
  assert.deepEqual(getChartHoverBands([{ x: 12 }, { x: 360 }, { x: 708 }], 720), [
    { x: 0, width: 186 },
    { x: 186, width: 348 },
    { x: 534, width: 186 },
  ]);
});

test('compact sparklines share one normalized return domain', () => {
  const stocks = createMarketPreviewSeed().stocks.slice(0, 2);
  const returns = stocks.map((stock) => toReturnSeries(stock.series.today));
  const allReturns = returns.flat();
  assert.deepEqual(getSharedReturnDomain(returns), {
    min: Math.min(...allReturns), max: Math.max(...allReturns),
  });
});
