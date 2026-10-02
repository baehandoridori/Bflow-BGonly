import { useLayoutEffect, useRef, type RefObject } from 'react';
import { EASE_CSS, MOTION_MS } from '@/utils/motion';
import { rowFlipShifts } from '@/utils/rowFlip';

/**
 * 목록 줄이 빠지거나 줄 높이가 바뀔 때, 남은 줄이 '툭' 점프하지 않고 제자리로 미끄러지게 한다(줄 단위 FLIP).
 *
 * - 줄에는 `data-flip-id`(안정된 id)를 단다. 컨테이너 바로 아래 자식만 잰다.
 * - layoutKey 가 바뀐 렌더에서 옛 위치를 재고(DOM 이 아직 커밋 전), 커밋 직후·그리기 전에 새 위치를 재서
 *   움직인 줄마다 WAAPI translateY(옛-새 → 0)를 건다. transform 하나라 합성 스레드에서 돈다.
 * - 움직이는 중에 다시 바뀌면 지금 보이는 위치에서 이어서 움직인다(옛 위치는 보이는 그대로 잰다).
 * - disabled(동작 줄이기 등)면 바로 바뀐다.
 * 한 줄 묶음 전체를 미끄러뜨리는 넘김은 useStackFlip 을 쓴다.
 */
export function useRowFlip(
  containerRef: RefObject<HTMLElement>,
  layoutKey: string,
  { disabled = false, duration = MOTION_MS.slow, easing = EASE_CSS.out }: { disabled?: boolean; duration?: number; easing?: string } = {},
): void {
  const committedKeyRef = useRef(layoutKey);
  const beforeRef = useRef<Map<string, number> | null>(null);
  const animationsRef = useRef(new Map<string, Animation>());

  if (committedKeyRef.current !== layoutKey && beforeRef.current === null && !disabled) {
    beforeRef.current = measure(containerRef.current);
  }

  useLayoutEffect(() => {
    if (committedKeyRef.current === layoutKey) {
      beforeRef.current = null;
      return;
    }
    committedKeyRef.current = layoutKey;
    const before = beforeRef.current;
    beforeRef.current = null;
    const container = containerRef.current;
    // 옛 움직임을 끊고 새 자리를 잰다(보이는 옛 위치는 이미 렌더 단계에서 쟀다).
    animationsRef.current.forEach((animation) => animation.cancel());
    animationsRef.current.clear();
    if (disabled || !before || !container) return;
    const elements = rowElements(container);
    const after = new Map<string, number>();
    elements.forEach((el, id) => after.set(id, el.getBoundingClientRect().top));
    for (const [id, dy] of rowFlipShifts(before, after)) {
      const el = elements.get(id);
      if (!el || typeof el.animate !== 'function') continue;
      const animation = el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0px)' }],
        { duration, easing },
      );
      animationsRef.current.set(id, animation);
      animation.onfinish = () => {
        if (animationsRef.current.get(id) === animation) animationsRef.current.delete(id);
      };
    }
  });

  useLayoutEffect(() => () => {
    animationsRef.current.forEach((animation) => animation.cancel());
    animationsRef.current.clear();
  }, []);
}

function rowElements(container: HTMLElement): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>();
  container.querySelectorAll<HTMLElement>(':scope > [data-flip-id]').forEach((el) => {
    const id = el.dataset.flipId;
    if (id) rows.set(id, el);
  });
  return rows;
}

function measure(container: HTMLElement | null): Map<string, number> | null {
  if (!container || typeof container.querySelectorAll !== 'function') return null;
  const tops = new Map<string, number>();
  rowElements(container).forEach((el, id) => tops.set(id, el.getBoundingClientRect().top));
  return tops;
}
