function formatInteger(value: number): string {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

export function formatPoints(points: number): string {
  return `${formatInteger(points)}P`;
}

export function formatWon(won: number): string {
  return `${formatInteger(won)}원`;
}

export function formatShares(quantityShares: number): string {
  return `${formatInteger(quantityShares)}주`;
}
