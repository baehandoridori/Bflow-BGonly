import { useLayoutEffect, useRef, type RefObject } from 'react';
import {
  CONTENT_SWAP_KEYFRAMES,
  CONTENT_SWAP_MS,
  INITIAL_SWAP_STATE,
  nextSwapState,
  swapDirectionBetween,
  type SwapDirection,
  type SwapState,
} from '@/utils/contentSwap';
import { EASE_CSS, animateEl } from '@/utils/motion';

/**
 * 열린 상세 창의 '교체' 여부(움직임 폴리싱 11번). 창이 닫혀 있으면 key 를 null 로 넘긴다.
 * 첫 열림에는 false, 열린 채 다른 항목으로 바뀐 뒤로는 true — 안쪽 내용의 '.bf-swap-in' 을 켤지 정한다.
 * 상세 창이 바뀌어도 살아 있는 쪽(바깥 셸·부모)에서 부른다. 렌더 중 계산이라 새 내용의 첫 그림부터 맞다.
 */
export function useSwapIn(key: string | null | undefined): boolean {
  const state = useRef<SwapState>(INITIAL_SWAP_STATE);
  state.current = nextSwapState(state.current, key);
  return state.current.swapped;
}

/**
 * 마지막으로 바뀐 방향 — 같은 목록에서 뒤쪽 항목으로 가면 1(오른쪽에서 들어옴), 앞쪽이면 -1, 목록 밖이면 0.
 * 다음에 바뀔 때까지 그 값을 유지한다(그림은 바뀌는 순간의 방향만 읽는다).
 */
export function useSwapDirection(key: string | null | undefined, order: readonly string[]): SwapDirection {
  const state = useRef<{ key: string | null; direction: SwapDirection }>({ key: key ?? null, direction: 0 });
  const next = key ?? null;
  if (state.current.key !== next) {
    state.current = { key: next, direction: swapDirectionBetween(order, state.current.key, next) };
  }
  return state.current.direction;
}

/**
 * 리마운트 없이(안쪽 상태 보존) key 가 바뀔 때 ref 요소의 내용만 140ms 에 4px 아래에서 떠오르게 한다.
 * 첫 렌더에는 돌지 않는다. 그리기 전에 시작하므로 새 내용이 한 번 비쳤다가 사라지는 깜빡임이 없다.
 * 동작 줄이기면 opacity 만 100ms.
 */
export function useSwapFade(ref: RefObject<HTMLElement>, key: string | null | undefined, reduce: boolean): void {
  const previous = useRef(key ?? null);
  useLayoutEffect(() => {
    const next = key ?? null;
    if (previous.current === next) return;
    const hadPrevious = previous.current !== null;
    previous.current = next;
    if (!hadPrevious || next === null) return;
    const animation = animateEl(
      ref.current,
      CONTENT_SWAP_KEYFRAMES,
      { duration: reduce ? CONTENT_SWAP_MS.reduced : CONTENT_SWAP_MS.content, easing: EASE_CSS.out },
      reduce,
    );
    return () => animation?.cancel();
  }, [key, reduce, ref]);
}
