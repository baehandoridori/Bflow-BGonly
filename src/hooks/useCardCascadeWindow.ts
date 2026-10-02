import { useEffect, useState } from 'react';
import { CARD_CASCADE_WINDOW_MS } from '@/utils/viewTransitionMotion';

/**
 * 카드 차례 등장(.bf-card-cascade)을 처음 그려질 때만 켜 둔다(움직임 폴리싱 12번 + 15번 통합).
 * 카드가 처음 생긴 순간(ready)부터 등장이 끝날 때까지 true, 그 뒤로는 false — 정렬로 DOM 순서가 바뀌어도
 * 옮겨진 카드의 등장 애니메이션이 다시 돌지 않는다(미끄러짐은 useGridFlip 이 맡는다).
 */
export function useCardCascadeWindow(ready: boolean): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (!ready || !active) return undefined;
    const timer = window.setTimeout(() => setActive(false), CARD_CASCADE_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [ready, active]);
  return active;
}
