/**
 * 내 할일 위젯 모션 선호 훅.
 *
 * framer-motion useReducedMotion()을 래핑한다. 반환은 boolean | null(초기 미확정 null)이라
 * `=== true`로 좁혀 항상 boolean을 준다 — null/false는 모션 ON(기본). OS '동작 줄이기'가 켜진
 * 사용자만 reduce=true가 되어 신규 모션이 즉시/비활성으로 떨어진다.
 */
import { useReducedMotion } from 'framer-motion';

export function useMotionPref(): { reduce: boolean } {
  return { reduce: useReducedMotion() === true };
}
