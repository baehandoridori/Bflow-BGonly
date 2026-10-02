import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animateEl } from '@/utils/motion';
import { RAPID_SWAP_MS, groupSwapKeyframes } from '@/utils/viewTransitionMotion';

export interface GroupSwapOptions {
  /** 다음(1)·이전(-1)·모름(0). 이전 키와 새 키를 받는다. */
  direction: (prevKey: string, nextKey: string) => -1 | 0 | 1;
  distancePx: number;
  durationMs: number;
  /** true 면 이번 전환은 연출 없이 바로(알림으로 씬 창을 바로 여는 중 등). */
  skip?: () => boolean;
}

/**
 * 파트·에피소드를 바꿀 때 카드 묶음 한 덩어리를 방향에서 살짝 미끄러뜨려 들인다 (움직임 폴리싱 12번).
 * - 묶음 래퍼 하나에 WAAPI(transform·opacity — 합성 스레드). 카드마다 따로 움직이지 않는다.
 * - 끝값을 남기지 않는다(fill 없음) — transform 이 남으면 fixed 자손의 기준 상자가 바뀐다.
 * - 처음 마운트·처음 정해지는 키(null → 값)는 움직이지 않는다.
 * - 300ms 안에 다시 바뀌면(연타) 돌던 움직임을 끊고 바로 바꾼다.
 * - '동작 줄이기'면 animateEl 이 움직임을 빼고 짧은 opacity 만 남긴다.
 * layout effect 라 새 내용의 첫 페인트부터 들어오는 모습으로 그려진다.
 */
export function useGroupSwapMotion(ref: RefObject<HTMLElement>, swapKey: string | null, options: GroupSwapOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stateRef = useRef<{ key: string | null; at: number; animation: Animation | null }>({
    key: null,
    at: Number.NEGATIVE_INFINITY,
    animation: null,
  });

  useLayoutEffect(() => {
    const state = stateRef.current;
    const prevKey = state.key;
    state.key = swapKey;
    if (prevKey === null || swapKey === null || prevKey === swapKey) return;
    const now = performance.now();
    const rapid = now - state.at < RAPID_SWAP_MS;
    state.at = now;
    state.animation?.cancel();
    state.animation = null;
    const { direction, distancePx, durationMs, skip } = optionsRef.current;
    if (rapid || skip?.()) return;
    const animation = animateEl(ref.current, groupSwapKeyframes(direction(prevKey, swapKey), distancePx), { duration: durationMs });
    state.animation = animation;
    if (animation) animation.onfinish = () => { if (state.animation === animation) state.animation = null; };
  }, [ref, swapKey]);

  // 화면을 떠날 때 돌던 움직임 정리.
  useLayoutEffect(() => () => { stateRef.current.animation?.cancel(); }, []);
}
