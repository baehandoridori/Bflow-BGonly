import type { Holding, MarketCommand, MarketSnapshot, MarketStock, MarketTrend, PricePoint } from './types';

export const SHARE_SCALE = 1_000_000;
const UNSAFE_BUY_QUANTITY_MESSAGE = '주문 수량을 안전하게 계산할 수 없어요';

export function holdingValuePoints(holding: Holding, pricePoints: number): number {
  return Math.round((holding.quantityMicros * pricePoints) / SHARE_SCALE);
}

export function getBuyProjection(
  holding: Holding | undefined,
  pricePoints: number,
  spentPoints: number,
): { purchasedQuantityMicros: number } | null {
  const currentQuantityMicros = holding?.quantityMicros ?? 0;
  const currentCostBasisPoints = holding?.costBasisPoints ?? 0;
  const targetCostBasisPoints = currentCostBasisPoints + spentPoints;
  if (
    !Number.isSafeInteger(currentQuantityMicros)
    || currentQuantityMicros < 0
    || !Number.isSafeInteger(currentCostBasisPoints)
    || currentCostBasisPoints < 0
    || !Number.isSafeInteger(currentQuantityMicros * pricePoints)
    || !Number.isSafeInteger(targetCostBasisPoints)
  ) return null;

  const currentValuePoints = holding ? holdingValuePoints(holding, pricePoints) : 0;
  const targetValuePoints = currentValuePoints + spentPoints;
  const scaledTargetValue = targetValuePoints * SHARE_SCALE;
  if (!Number.isSafeInteger(targetValuePoints) || !Number.isSafeInteger(scaledTargetValue)) return null;

  const targetQuantityMicros = Math.round(scaledTargetValue / pricePoints);
  const addedQuantityMicros = targetQuantityMicros - currentQuantityMicros;
  if (
    !Number.isSafeInteger(targetQuantityMicros)
    || !Number.isSafeInteger(addedQuantityMicros)
    || addedQuantityMicros <= 0
    || !Number.isSafeInteger(targetQuantityMicros * pricePoints)
    || !Number.isSafeInteger(targetQuantityMicros * 10000)
    || !Number.isSafeInteger(targetCostBasisPoints * targetValuePoints)
  ) return null;

  const projectedValuePoints = Math.round((targetQuantityMicros * pricePoints) / SHARE_SCALE);
  return projectedValuePoints === targetValuePoints
    ? { purchasedQuantityMicros: addedQuantityMicros }
    : null;
}

export function getStockQuote(stock: Pick<MarketStock, 'pricePoints' | 'previousClosePoints'>) {
  const changePoints = stock.pricePoints - stock.previousClosePoints;
  const changeRate = stock.previousClosePoints > 0
    ? Math.round((changePoints / stock.previousClosePoints) * 1000) / 10
    : 0;
  const trend: MarketTrend = changePoints > 0 ? 'up' : changePoints < 0 ? 'down' : 'flat';
  return { changePoints, changeRate, trend };
}

export function toReturnSeries(series: PricePoint[]): number[] {
  const first = series[0]?.pricePoints ?? 0;
  if (first <= 0) return series.map(() => 0);
  return series.map((point) => ((point.pricePoints - first) / first) * 100);
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
  return getNumericGeometry(series.map((point) => point.pricePoints), width, height, domain);
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

export function getSellProjection(holding: Holding, pricePoints: number, ratioBps: number) {
  let soldQuantityMicros = ratioBps === 10000
    ? holding.quantityMicros
    : Math.max(1, Math.floor((holding.quantityMicros * ratioBps) / 10000));
  const currentValuePoints = holdingValuePoints(holding, pricePoints);
  let remainingQuantityMicros = holding.quantityMicros - soldQuantityMicros;
  const remainingValuePoints = remainingQuantityMicros === 0
    ? 0
    : holdingValuePoints({ ...holding, quantityMicros: remainingQuantityMicros }, pricePoints);
  if (remainingQuantityMicros > 0 && remainingValuePoints === 0) {
    soldQuantityMicros = holding.quantityMicros;
    remainingQuantityMicros = 0;
  }
  const remainingCostPoints = remainingQuantityMicros === 0
    ? 0
    : currentValuePoints > 0
      ? Math.round((holding.costBasisPoints * remainingValuePoints) / currentValuePoints)
      : Math.round((holding.costBasisPoints * remainingQuantityMicros) / holding.quantityMicros);
  const proceedsPoints = currentValuePoints - remainingValuePoints;
  const soldCostPoints = holding.costBasisPoints - remainingCostPoints;
  return { soldQuantityMicros, proceedsPoints, soldCostPoints };
}

export function getAccountSummary(snapshot: MarketSnapshot) {
  const holdingsValuePoints = snapshot.account.holdings.reduce((sum, holding) => {
    const stock = snapshot.stocks.find((item) => item.id === holding.stockId);
    return sum + (stock ? holdingValuePoints(holding, stock.pricePoints) : 0);
  }, 0);
  const totalCost = snapshot.account.holdings.reduce((sum, holding) => sum + holding.costBasisPoints, 0);
  const unrealizedPnlPoints = holdingsValuePoints - totalCost;
  const realizedPnlPoints = snapshot.account.realizedPnlThisMonthPoints;
  const monthlyUnrealizedChangePoints = unrealizedPnlPoints - snapshot.account.unrealizedPnlAtMonthStartPoints;
  return {
    walletPoints: snapshot.account.walletPoints,
    cashPoints: snapshot.account.cashPoints,
    holdingsValuePoints,
    totalAssetsPoints: snapshot.account.cashPoints + holdingsValuePoints,
    realizedPnlPoints,
    unrealizedPnlPoints,
    monthlyUnrealizedChangePoints,
    monthlyTotalPnlPoints: realizedPnlPoints + monthlyUnrealizedChangePoints,
  };
}

export function validateMarketCommand(snapshot: MarketSnapshot, command: MarketCommand): string | null {
  if ('points' in command && (!Number.isSafeInteger(command.points) || command.points <= 0)) return '1P 이상 입력해 주세요';
  if (command.kind === 'favorite') return snapshot.stocks.some((stock) => stock.id === command.stockId) ? null : '종목을 찾지 못했어요';
  if (command.kind === 'read-reason') return snapshot.stocks.some((stock) => stock.id === command.stockId) ? null : '종목을 찾지 못했어요';
  if (command.kind === 'transfer') {
    const available = command.direction === 'wallet-to-broker' ? snapshot.account.walletPoints : snapshot.account.cashPoints;
    return command.points <= available ? null : command.direction === 'wallet-to-broker'
      ? '포인트 지갑 잔액이 부족해요'
      : '꺼낼 수 있는 예수금이 부족해요';
  }
  const stock = snapshot.stocks.find((item) => item.id === command.stockId);
  if (!stock) return '종목을 찾지 못했어요';
  if (!Number.isSafeInteger(stock.pricePoints) || stock.pricePoints <= 0) return '현재 가격을 확인할 수 없어요';
  if (command.kind === 'buy') {
    if (command.points > snapshot.account.cashPoints) return '예수금이 부족해요';
    const holding = snapshot.account.holdings.find((item) => item.stockId === command.stockId);
    return getBuyProjection(holding, stock.pricePoints, command.points) === null
      ? UNSAFE_BUY_QUANTITY_MESSAGE
      : null;
  }
  if (!Number.isInteger(command.ratioBps) || command.ratioBps < 100 || command.ratioBps > 10000) return '1%부터 100%까지 입력해 주세요';
  if (command.ratioBps % 100 !== 0) return '매도 비율은 1% 단위로 입력해 주세요';
  const holding = snapshot.account.holdings.find((item) => item.stockId === command.stockId);
  if (!holding?.quantityMicros) return '보유한 주식이 없어요';
  return getSellProjection(holding, stock.pricePoints, command.ratioBps).proceedsPoints >= 1
    ? null
    : '받을 포인트가 1P보다 작아요. 더 큰 비율을 선택해 주세요';
}

export function applyMarketCommand(snapshot: MarketSnapshot, command: MarketCommand): MarketSnapshot {
  const error = validateMarketCommand(snapshot, command);
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
    const sign = command.direction === 'wallet-to-broker' ? 1 : -1;
    next.account.walletPoints -= sign * command.points;
    next.account.cashPoints += sign * command.points;
    return next;
  }

  const stock = next.stocks.find((item) => item.id === command.stockId)!;
  const existing = next.account.holdings.find((item) => item.stockId === command.stockId);

  if (command.kind === 'buy') {
    const projection = getBuyProjection(existing, stock.pricePoints, command.points);
    if (projection === null) throw new Error(UNSAFE_BUY_QUANTITY_MESSAGE);
    const spentPoints = command.points;
    if (existing) {
      existing.quantityMicros += projection.purchasedQuantityMicros;
      existing.costBasisPoints += spentPoints;
    } else {
      next.account.holdings.push({
        stockId: stock.id,
        quantityMicros: projection.purchasedQuantityMicros,
        costBasisPoints: spentPoints,
      });
    }
    next.account.cashPoints -= spentPoints;
    if (next.beginnerMission === 'first-order') next.beginnerMission = 'complete';
    return next;
  }

  const projection = getSellProjection(existing!, stock.pricePoints, command.ratioBps);
  existing!.quantityMicros -= projection.soldQuantityMicros;
  existing!.costBasisPoints -= projection.soldCostPoints;
  next.account.cashPoints += projection.proceedsPoints;
  next.account.realizedPnlThisMonthPoints += projection.proceedsPoints - projection.soldCostPoints;
  if (existing!.quantityMicros <= 0) next.account.holdings = next.account.holdings.filter((item) => item !== existing);
  return next;
}
