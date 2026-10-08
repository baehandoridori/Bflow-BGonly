import type { Transition, Variants } from 'framer-motion';

/* ═══════════════════════════════════════════════════
   달 넘김 슬라이드 (캘린더 월 화면 · 대시보드 캘린더 위젯 공용)
   - transform 을 '문자열'로 넘겨야 framer-motion 이 WAAPI(합성 스레드)로 돌린다.
     y 같은 개별 값은 메인 스레드가 매 프레임 계산해서, 렌더가 끼어들면 슬라이드가 멈칫한다.
   - 끝값은 transitionEnd 로 'none'. translateY(0) 이 남으면 fixed 자손의 기준 상자가 바뀐다.
   - 방향은 AnimatePresence custom 으로 넘긴다. 나가는 달은 마지막 렌더의 props 에 묶여 있어서,
     방향을 props 로만 주면 '다음 달 → 이전 달'처럼 방향을 바꿀 때 예전 방향으로 빠져나간다.
   - 나가는 달과 들어오는 달은 같은 격자 칸(1/1)에 겹친다. popLayout 처럼 측정·절대 배치를 하지 않는다.
   ═══════════════════════════════════════════════════ */

export type MonthSlide = { direction: number; instant: boolean };

export function createMonthSlideVariants(
  distancePx: number,
  enterTransition: Transition,
  exitTransition: Transition,
): Variants {
  return {
    enter: ({ direction }: MonthSlide) => ({
      opacity: 0,
      transform: `translateY(${direction > 0 ? distancePx : -distancePx}px)`,
    }),
    center: {
      opacity: 1,
      transform: 'translateY(0px)',
      transitionEnd: { transform: 'none' },
      transition: enterTransition,
    },
    exit: ({ direction, instant }: MonthSlide) => (instant
      ? { opacity: 0, transition: { duration: 0 } }
      : {
        opacity: 0,
        transform: `translateY(${direction > 0 ? -distancePx : distancePx}px)`,
        transition: exitTransition,
      }),
  };
}

/** 나가는 달과 들어오는 달을 한 칸에 겹친다. */
export const MONTH_STACK_STYLE = { gridTemplate: 'minmax(0, 1fr) / minmax(0, 1fr)' } as const;
export const MONTH_LAYER_STYLE = { gridArea: '1 / 1' } as const;
