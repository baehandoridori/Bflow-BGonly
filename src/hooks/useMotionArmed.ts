import { useEffect, type RefObject } from 'react';

/**
 * 한 번 그려진 뒤 data-motion-armed 를 단다 (움직임 폴리싱 — 최종 성능 측정 지적 반영).
 *
 * 꺼진 단계 칸 채움·현재 단계 빛·카드 선택 체크는 쉬는 동안 상자를 만들지 않고(display: none), 켜질 때 CSS 의
 * @starting-style 에서 출발해 차오르거나 '톡' 튀어나온다(src/styles/motion-scene-check.css). 그런데 @starting-style 은
 * '처음 그려질 때'에도 쓰여서, 그대로 두면 카드가 새로 그려질 때마다 켜져 있던 칸이 전부 0 에서 차오른다.
 * 그래서 출발 모습은 이 표시가 붙은 묶음 안에서만 쓰고, 표시는 묶음이 실제로 한 번 그려진 다음(크기 감시 첫 알림 →
 * 다음 프레임)에 붙인다. 숨겨진 채 마운트된 묶음(display: none 조상)은 보이게 된 뒤에 붙는다.
 *
 * 감시는 모든 묶음이 하나를 같이 쓴다(카드 수십 장마다 감시를 만들지 않게).
 */
export const MOTION_ARMED_ATTR = 'data-motion-armed';

let sharedObserver: ResizeObserver | null = null;
let queued: Element[] = [];
let flushFrame = 0;

function flush(): void {
  flushFrame = 0;
  const targets = queued;
  queued = [];
  for (const target of targets) {
    if (target.isConnected) target.setAttribute(MOTION_ARMED_ATTR, '');
  }
}

function armObserver(): ResizeObserver | null {
  if (sharedObserver || typeof ResizeObserver === 'undefined') return sharedObserver;
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = entry.borderBoxSize?.[0];
      const width = box ? box.inlineSize : entry.contentRect.width;
      const height = box ? box.blockSize : entry.contentRect.height;
      if (width === 0 && height === 0) continue; // 아직 그려지지 않음(숨은 조상) — 보이게 되면 다시 알림이 온다
      observer.unobserve(entry.target);
      queued.push(entry.target);
    }
    if (queued.length > 0 && !flushFrame) flushFrame = requestAnimationFrame(flush);
  });
  sharedObserver = observer;
  return observer;
}

export function useMotionArmed(ref: RefObject<Element | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || el.hasAttribute(MOTION_ARMED_ATTR)) return undefined;
    const observer = armObserver();
    if (!observer) {
      // 크기 감시가 없는 환경: 두 프레임 뒤(첫 그림이 나간 뒤)에 붙인다.
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => el.setAttribute(MOTION_ARMED_ATTR, ''));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      const at = queued.indexOf(el);
      if (at >= 0) queued.splice(at, 1);
    };
  }, [ref]);
}
