/**
 * 모션 순수 유틸 (단위 테스트 가능). 런타임 의존성 0.
 */

/**
 * 진입 stagger delay(초).
 * - reduce면 0 (동작 줄이기).
 * - index 0/음수면 0 (첫 항목은 지연 없음).
 * - 그 외 index * 0.025, 상한 0.3 (대량 리스트에서 마지막 항목이 과도하게 늦지 않게).
 */
export function clampStaggerDelay(index: number, reduce: boolean): number {
  if (reduce || index <= 0) return 0;
  return Math.min(index * 0.025, 0.3);
}
