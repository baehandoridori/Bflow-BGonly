import { useCallback, useEffect, useRef } from 'react';

/**
 * 커서와의 '거리'로 요소를 서서히 드러내는 훅.
 *
 * 칸에 hover 했을 때 툭 나타나는 방식은 칸 경계에서 깜빡이고 어디까지 눌러야 하는지도 모호하다.
 * Notion 캘린더처럼 커서가 가까워질수록 연속적으로 진해지게 하려고 거리 기반으로 계산한다.
 *
 * 대상은 `data-proximity-reveal` 을 단 요소. 각 요소의 `--reveal` 커스텀 속성에 0~1 을 써 넣고,
 * 실제 표현(투명도·크기·블러)은 CSS 가 정한다. DOM 을 다시 그리지 않으므로 React 리렌더가 없다.
 *
 * 리스너는 window 에 건다. 컨테이너에 걸면 그 노드가 교체될 때(월 전환처럼 AnimatePresence 가
 * 통째로 갈아끼울 때) 리스너만 떨어져 나간 옛 노드에 남아 조용히 동작을 멈춘다.
 */
export interface UseProximityRevealOptions {
  /** 이 거리(px)보다 멀면 0. 가까울수록 1 에 가까워진다. */
  radius?: number;
  /** 값이 1 로 붙는 속도. 클수록 아주 가까이서만 또렷해진다. */
  falloff?: number;
  /** 항상 1 로 둘 대상(누르고 있는 버튼 등)을 고르는 판별자. */
  isPinned?: (el: HTMLElement) => boolean;
  disabled?: boolean;
}

const SELECTOR = '[data-proximity-reveal]';

/**
 * rAF 가 없는 환경(테스트 하네스, 숨겨진 창)에서도 계산이 멈추지 않게 타이머로 대체한다.
 * 창이 숨겨지면 rAF 는 아예 발화하지 않아 버튼이 드러난 채로 굳을 수 있다.
 */
const nextFrame = (cb: () => void): number => (
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(() => cb())
    : (setTimeout(cb, 16) as unknown as number)
);
const cancelFrame = (id: number) => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
};

export function useProximityReveal(options: UseProximityRevealOptions = {}) {
  const { radius = 150, falloff = 1.6, isPinned, disabled = false } = options;

  const rafRef = useRef(0);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  // 핸들러가 stale closure 를 잡지 않도록 최신 값을 ref 로 들고 간다.
  const optsRef = useRef({ radius, falloff, isPinned });
  optsRef.current = { radius, falloff, isPinned };

  const apply = useCallback(() => {
    rafRef.current = 0;
    const { radius: r, falloff: f, isPinned: pinned } = optsRef.current;
    const p = pointerRef.current;
    if (typeof document === 'undefined') return;

    document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
      let t = 0;
      if (pinned?.(el)) {
        t = 1;
      } else if (p) {
        const box = el.getBoundingClientRect();
        // 보이지 않는 위치로 밀려난 요소는 계산할 필요가 없다.
        if (box.width > 0 && box.height > 0) {
          const dx = p.x - (box.left + box.width / 2);
          const dy = p.y - (box.top + box.height / 2);
          const ratio = 1 - Math.hypot(dx, dy) / r;
          t = ratio <= 0 ? 0 : ratio >= 1 ? 1 : Math.pow(ratio, f);
        }
      }
      el.style.setProperty('--reveal', t.toFixed(3));
    });
  }, []);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = nextFrame(apply);
  }, [apply]);

  /** 포인터가 안 움직여도 다시 계산해야 할 때(누름 시작/종료, 달 전환 등). */
  const refresh = useCallback(() => { schedule(); }, [schedule]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (disabled) {
      pointerRef.current = null;
      document.querySelectorAll<HTMLElement>(SELECTOR)
        .forEach((el) => el.style.setProperty('--reveal', '0'));
      return;
    }

    const onMove = (e: PointerEvent) => { pointerRef.current = { x: e.clientX, y: e.clientY }; schedule(); };
    const onLeave = () => { pointerRef.current = null; schedule(); };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      if (rafRef.current) cancelFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [disabled, schedule]);

  return { refresh };
}
