import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from '@/utils/motion';
import { createGroupSwapController, type GroupSwapController } from '@/utils/viewTransitionMotion';

export interface GroupSwapOptions {
  /** 다음(1)·이전(-1)·모름(0). 이전 키와 새 키를 받는다. */
  direction: (prevKey: string, nextKey: string) => -1 | 0 | 1;
  distancePx: number;
  durationMs: number;
  /** true 면 이번 전환은 연출 없이 바로(알림으로 씬 창을 바로 여는 중 등). */
  skip?: () => boolean;
  /**
   * 묶음을 담은 스크롤 상자. 주면 미끄러지는 동안 묶음이 오른쪽·아래로 밀린 만큼 생기는 넘침을 그 상자에서
   * 잠깐 숨긴다(패딩 없는 상자에서 스크롤바가 번쩍이지 않게). 패딩이 이동 거리를 흡수하는 상자는 필요 없다.
   */
  overflowGuard?: () => HTMLElement | null;
}

/**
 * 파트·에피소드를 바꿀 때 카드 묶음 한 덩어리를 방향에서 살짝 미끄러뜨려 들인다 (움직임 폴리싱 12번).
 * - 묶음 래퍼 하나에 WAAPI(transform·opacity — 합성 스레드). 카드마다 따로 움직이지 않는다.
 * - 판정·넘침 숨김·정리는 createGroupSwapController(React 밖, 단위 테스트)가 맡는다:
 *   처음 키는 그대로, 300ms 안 연타·skip 은 바로, 끝값을 남기지 않는다(fill 없음).
 * - '동작 줄이기'면 animateEl 이 움직임을 빼고 짧은 opacity 만 남긴다.
 * layout effect 라 새 내용의 첫 페인트부터 들어오는 모습으로 그려진다.
 */
export function useGroupSwapMotion(ref: RefObject<HTMLElement>, swapKey: string | null, options: GroupSwapOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controllerRef = useRef<GroupSwapController | null>(null);
  if (!controllerRef.current) controllerRef.current = createGroupSwapController();
  const controller = controllerRef.current;

  useLayoutEffect(() => {
    const { direction, distancePx, durationMs, skip, overflowGuard } = optionsRef.current;
    controller.update(swapKey, performance.now(), {
      el: ref.current,
      direction,
      distancePx,
      durationMs,
      skip,
      overflowBox: overflowGuard,
      reduce: prefersReducedMotion(),
    });
  }, [controller, ref, swapKey]);

  // 화면을 떠날 때 돌던 움직임 정리(숨긴 넘침도 되돌린다).
  useLayoutEffect(() => () => controller.dispose(), [controller]);
}
