import type { Holding, MarketCommand, MarketSnapshot, MarketStock, MarketTrend, PricePoint } from './types';

const INVALID_POINTS_MESSAGE = '1P 이상 안전한 정수로 입력해 주세요';
const INVALID_SHARES_MESSAGE = '1주 이상 안전한 정수로 입력해 주세요';
const INVALID_PRICE_MESSAGE = '현재 가격을 확인할 수 없어요';
const UNSAFE_ORDER_TOTAL_MESSAGE = '주문 금액을 안전하게 계산할 수 없어요';
const UNSAFE_BALANCE_MESSAGE = '잔액을 안전하게 계산할 수 없어요';
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = -MAX_SAFE_BIGINT;

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function safeSum(...values: number[]): number | null {
  const sum = values.reduce((total, value) => total + value, 0);
  return Number.isSafeInteger(sum) ? sum : null;
}

function safeAddAndSubtract(base: number, added: number, subtracted: number): number | null {
  if (![base, added, subtracted].every(Number.isSafeInteger)) return null;
  const result = BigInt(base) + BigInt(added) - BigInt(subtracted);
  return result >= MIN_SAFE_BIGINT && result <= MAX_SAFE_BIGINT ? Number(result) : null;
}

function effectiveOrderPriceWon(
  command: Extract<MarketCommand, { kind: 'buy' | 'sell' }>,
  currentPriceWon?: number,
): number {
  return currentPriceWon ?? command.quotedPriceWon;
}

function proportionalCostBasisWon(
  costBasisWon: number,
  soldQuantityShares: number,
  totalQuantityShares: number,
): number {
  if (soldQuantityShares === totalQuantityShares) return costBasisWon;
  const numerator = BigInt(costBasisWon) * BigInt(soldQuantityShares);
  const denominator = BigInt(totalQuantityShares);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return Number(quotient + (remainder * 2n >= denominator ? 1n : 0n));
}

export function holdingValueWon(holding: Holding, priceWon: number): number {
  const valueWon = holding.quantityShares * priceWon;
  if (
    !isNonNegativeSafeInteger(holding.quantityShares)
    || !isNonNegativeSafeInteger(priceWon)
    || !Number.isSafeInteger(valueWon)
  ) {
    throw new Error(UNSAFE_ORDER_TOTAL_MESSAGE);
  }
  return valueWon;
}

export interface MarketHoldingSummary {
  averagePriceWon: number | null;
  marketValueWon: number;
  unrealizedPnlWon: number;
  unrealizedPnlRate: number | null;
}

export function getMarketHoldingSummary(
  holding: Holding | null | undefined,
  currentPriceWon: number,
): MarketHoldingSummary {
  if (!holding || holding.quantityShares <= 0) {
    return {
      averagePriceWon: null,
      marketValueWon: 0,
      unrealizedPnlWon: 0,
      unrealizedPnlRate: null,
    };
  }

  const marketValueWon = holdingValueWon(holding, currentPriceWon);
  const unrealizedPnlWon = marketValueWon - holding.costBasisWon;
  return {
    averagePriceWon: Math.round(holding.costBasisWon / holding.quantityShares),
    marketValueWon,
    unrealizedPnlWon,
    unrealizedPnlRate: holding.costBasisWon > 0
      ? (unrealizedPnlWon / holding.costBasisWon) * 100
      : null,
  };
}

export function getBuyCostWon(quantityShares: number, priceWon: number): number {
  const costWon = quantityShares * priceWon;
  if (
    !isPositiveSafeInteger(quantityShares)
    || !isPositiveSafeInteger(priceWon)
    || !Number.isSafeInteger(costWon)
  ) {
    throw new Error(UNSAFE_ORDER_TOTAL_MESSAGE);
  }
  return costWon;
}

export function maxBuyableShares(cashWon: number, priceWon: number): number {
  if (!isNonNegativeSafeInteger(cashWon) || !isPositiveSafeInteger(priceWon)) return 0;
  return Math.floor(cashWon / priceWon);
}

export function getSellProjection(
  holding: Holding,
  priceWon: number,
  quantityShares: number | 'all',
) {
  const soldQuantityShares = quantityShares === 'all' ? holding.quantityShares : quantityShares;
  const proceedsWon = getBuyCostWon(soldQuantityShares, priceWon);
  const soldCostBasisWon = proportionalCostBasisWon(
    holding.costBasisWon,
    soldQuantityShares,
    holding.quantityShares,
  );
  return { soldQuantityShares, proceedsWon, soldCostBasisWon };
}

export function getStockQuote(
  stock: Pick<MarketStock, 'referencePriceWon' | 'previousCloseWon'>,
) {
  const changeWon = stock.referencePriceWon - stock.previousCloseWon;
  const changeRate = stock.previousCloseWon > 0
    ? Math.round((changeWon / stock.previousCloseWon) * 1000) / 10
    : 0;
  const trend: MarketTrend = changeWon > 0 ? 'up' : changeWon < 0 ? 'down' : 'flat';
  return { changeWon, changeRate, trend };
}

export function toReturnSeries(series: PricePoint[]): number[] {
  const first = series[0]?.priceWon ?? 0;
  if (first <= 0) return series.map(() => 0);
  return series.map((point) => ((point.priceWon - first) / first) * 100);
}

export function getSharedReturnDomain(seriesGroups: number[][]) {
  const values = seriesGroups.flat();
  return values.length === 0 ? { min: 0, max: 0 } : { min: Math.min(...values), max: Math.max(...values) };
}

export function getNumericGeometry(
  values: number[],
  width: number,
  height: number,
  domain?: { min: number; max: number },
) {
  if (values.length === 0) return [] as Array<{ x: number; y: number }>;
  if (values.length === 1) return [{ x: width / 2, y: height / 2 }];
  const min = domain?.min ?? Math.min(...values);
  const max = domain?.max ?? Math.max(...values);
  if (max === min) return values.map((_value, index) => ({ x: (index / (values.length - 1)) * width, y: height / 2 }));
  return values.map((value, index) => ({
    x: (index / (values.length - 1)) * width,
    y: height - ((value - min) / (max - min)) * height,
  }));
}

export function getChartGeometry(
  series: PricePoint[],
  width: number,
  height: number,
  domain?: { min: number; max: number },
) {
  return getNumericGeometry(series.map((point) => point.priceWon), width, height, domain);
}

export function getChartHoverBands(points: Array<{ x: number }>, width: number) {
  return points.map((point, index) => {
    const left = index === 0
      ? 0
      : Math.max(0, Math.min(width, (points[index - 1].x + point.x) / 2));
    const right = index === points.length - 1
      ? width
      : Math.max(0, Math.min(width, (point.x + points[index + 1].x) / 2));
    return { x: left, width: Math.max(0, right - left) };
  });
}

export function getAccountSummary(snapshot: MarketSnapshot) {
  const holdingsValueWon = snapshot.account.holdings.reduce((sum, holding) => {
    const stock = snapshot.stocks.find((item) => item.id === holding.stockId);
    const valueWon = stock ? holdingValueWon(holding, stock.referencePriceWon) : 0;
    const next = safeSum(sum, valueWon);
    if (next === null) throw new Error(UNSAFE_BALANCE_MESSAGE);
    return next;
  }, 0);
  const totalCostBasisWon = snapshot.account.holdings.reduce((sum, holding) => {
    const next = safeSum(sum, holding.costBasisWon);
    if (next === null) throw new Error(UNSAFE_BALANCE_MESSAGE);
    return next;
  }, 0);
  const totalAssetsWon = safeSum(snapshot.account.cashWon, holdingsValueWon);
  if (totalAssetsWon === null) throw new Error(UNSAFE_BALANCE_MESSAGE);
  const unrealizedPnlWon = holdingsValueWon - totalCostBasisWon;
  const realizedPnlWon = snapshot.account.realizedPnlThisMonthWon;
  const monthlyUnrealizedChangeWon = unrealizedPnlWon - snapshot.account.unrealizedPnlAtMonthStartWon;
  const monthlyTotalPnlWon = realizedPnlWon + monthlyUnrealizedChangeWon;
  if (
    !Number.isSafeInteger(unrealizedPnlWon)
    || !Number.isSafeInteger(monthlyUnrealizedChangeWon)
    || !Number.isSafeInteger(monthlyTotalPnlWon)
  ) throw new Error(UNSAFE_BALANCE_MESSAGE);
  return {
    walletPoints: snapshot.account.walletPoints,
    lifetimeEarnedPoints: snapshot.account.lifetimeEarnedPoints,
    cashWon: snapshot.account.cashWon,
    holdingsValueWon,
    totalAssetsWon,
    realizedPnlWon,
    unrealizedPnlWon,
    monthlyUnrealizedChangeWon,
    monthlyTotalPnlWon,
  };
}

function validateHolding(holding: Holding): string | null {
  if (!isPositiveSafeInteger(holding.quantityShares)) return '보유 수량을 확인할 수 없어요';
  if (!isNonNegativeSafeInteger(holding.costBasisWon)) return '보유 원가를 확인할 수 없어요';
  return null;
}

export function validateMarketCommand(
  snapshot: MarketSnapshot,
  command: MarketCommand,
  currentPriceWon?: number,
): string | null {
  if (command.kind === 'favorite' || command.kind === 'read-reason') {
    return snapshot.stocks.some((stock) => stock.id === command.stockId) ? null : '종목을 찾지 못했어요';
  }

  if (command.kind === 'transfer') {
    if (!isPositiveSafeInteger(command.points)) return INVALID_POINTS_MESSAGE;
    const available = command.direction === 'wallet-to-broker'
      ? snapshot.account.walletPoints
      : snapshot.account.cashWon;
    if (command.points > available) {
      return command.direction === 'wallet-to-broker'
        ? '포인트 지갑 잔액이 부족해요'
        : '꺼낼 수 있는 예수금이 부족해요';
    }
    const destination = command.direction === 'wallet-to-broker'
      ? snapshot.account.cashWon
      : snapshot.account.walletPoints;
    return safeSum(destination, command.points) === null ? UNSAFE_BALANCE_MESSAGE : null;
  }

  if (!snapshot.stocks.some((stock) => stock.id === command.stockId)) return '종목을 찾지 못했어요';
  if (
    !isPositiveSafeInteger(command.quotedRevision)
    || command.quotedRevision !== snapshot.revision
  ) return '가격이 바뀌었어요. 현재 가격을 확인하고 다시 주문해 주세요.';
  const priceWon = effectiveOrderPriceWon(command, currentPriceWon);
  if (!isPositiveSafeInteger(priceWon)) return INVALID_PRICE_MESSAGE;

  if (command.kind === 'buy') {
    if (!isPositiveSafeInteger(command.quantityShares)) return INVALID_SHARES_MESSAGE;
    const costWon = command.quantityShares * priceWon;
    if (!Number.isSafeInteger(costWon)) return UNSAFE_ORDER_TOTAL_MESSAGE;
    if (costWon > snapshot.account.cashWon) return '예수금이 부족해요';
    const holding = snapshot.account.holdings.find((item) => item.stockId === command.stockId);
    if (holding) {
      const holdingError = validateHolding(holding);
      if (holdingError) return holdingError;
      if (safeSum(holding.quantityShares, command.quantityShares) === null) return '보유 수량을 안전하게 계산할 수 없어요';
      if (safeSum(holding.costBasisWon, costWon) === null) return '보유 원가를 안전하게 계산할 수 없어요';
    }
    return null;
  }

  if (command.quantityShares !== 'all' && !isPositiveSafeInteger(command.quantityShares)) {
    return INVALID_SHARES_MESSAGE;
  }
  const holding = snapshot.account.holdings.find((item) => item.stockId === command.stockId);
  if (!holding) return '보유한 주식이 없어요';
  const holdingError = validateHolding(holding);
  if (holdingError) return holdingError;
  const soldQuantityShares = command.quantityShares === 'all'
    ? holding.quantityShares
    : command.quantityShares;
  if (soldQuantityShares > holding.quantityShares) return '보유 주식 수량이 부족해요';
  const proceedsWon = soldQuantityShares * priceWon;
  if (!Number.isSafeInteger(proceedsWon)) return UNSAFE_ORDER_TOTAL_MESSAGE;
  const soldCostBasisWon = proportionalCostBasisWon(
    holding.costBasisWon,
    soldQuantityShares,
    holding.quantityShares,
  );
  if (safeSum(snapshot.account.cashWon, proceedsWon) === null) return UNSAFE_BALANCE_MESSAGE;
  const realizedPnlWon = safeAddAndSubtract(
    snapshot.account.realizedPnlThisMonthWon,
    proceedsWon,
    soldCostBasisWon,
  );
  return realizedPnlWon === null ? UNSAFE_BALANCE_MESSAGE : null;
}

export function applyMarketCommand(
  snapshot: MarketSnapshot,
  command: MarketCommand,
  currentPriceWon?: number,
): MarketSnapshot {
  const error = validateMarketCommand(snapshot, command, currentPriceWon);
  if (error) throw new Error(error);
  const next = structuredClone(snapshot);
  next.revision += 1;

  if (command.kind === 'favorite') {
    next.favoriteStockIds = command.wished
      ? Array.from(new Set([...next.favoriteStockIds, command.stockId]))
      : next.favoriteStockIds.filter((id) => id !== command.stockId);
    if (next.beginnerMission === 'favorite' && command.wished) next.beginnerMission = 'reason';
    return next;
  }

  if (command.kind === 'read-reason') {
    if (next.beginnerMission === 'reason') next.beginnerMission = 'first-order';
    return next;
  }

  if (command.kind === 'transfer') {
    if (command.direction === 'wallet-to-broker') {
      next.account.walletPoints -= command.points;
      next.account.cashWon += command.points;
    } else {
      next.account.walletPoints += command.points;
      next.account.cashWon -= command.points;
    }
    return next;
  }

  const priceWon = effectiveOrderPriceWon(command, currentPriceWon);
  const existing = next.account.holdings.find((item) => item.stockId === command.stockId);

  if (command.kind === 'buy') {
    const costWon = getBuyCostWon(command.quantityShares, priceWon);
    if (existing) {
      existing.quantityShares += command.quantityShares;
      existing.costBasisWon += costWon;
    } else {
      next.account.holdings.push({
        stockId: command.stockId,
        quantityShares: command.quantityShares,
        costBasisWon: costWon,
      });
    }
    next.account.cashWon -= costWon;
    if (next.beginnerMission === 'first-order') next.beginnerMission = 'complete';
    return next;
  }

  const projection = getSellProjection(existing!, priceWon, command.quantityShares);
  existing!.quantityShares -= projection.soldQuantityShares;
  existing!.costBasisWon -= projection.soldCostBasisWon;
  next.account.cashWon += projection.proceedsWon;
  const realizedPnlWon = safeAddAndSubtract(
    next.account.realizedPnlThisMonthWon,
    projection.proceedsWon,
    projection.soldCostBasisWon,
  );
  if (realizedPnlWon === null) throw new Error(UNSAFE_BALANCE_MESSAGE);
  next.account.realizedPnlThisMonthWon = realizedPnlWon;
  if (existing!.quantityShares === 0) {
    next.account.holdings = next.account.holdings.filter((item) => item.stockId !== command.stockId);
  }
  return next;
}
