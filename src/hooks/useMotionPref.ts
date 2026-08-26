/**
 * OS의 동작 줄이기 선호를 캘린더와 위젯에서 같은 형태로 사용한다.
 * 초기 null은 기본 모션으로 다루고, 명시적으로 true일 때만 모션을 줄인다.
 */
import { useReducedMotion } from 'framer-motion';

export function useMotionPref(): { reduce: boolean } {
  return { reduce: useReducedMotion() === true };
}
