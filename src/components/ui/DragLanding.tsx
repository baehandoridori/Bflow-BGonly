import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { cn } from '@/utils/cn';
import { animateEl, EASE_CSS } from '@/utils/motion';
import {
  DRAG_SLIDE_MS,
  LAND_MS,
  dragSlideOffset,
  landingKeyframes,
  parseTranslate,
  type SlideBox,
} from '@/utils/dragLanding';

/* ═══════════════════════════════════════════════════════════════
   끌어서 옮기기의 '옮긴다 → 놓았다' (움직임 폴리싱 16번 drag-landing)

   둘 다 부모 요소에 붙는 빈 조각이라, 막대·블록 마크업을 쪼개지 않고 안에 넣기만 하면 된다.
   - DragSlideAnchor: 끄는 동안 부모가 칸을 넘으면 이전 자리에서 0.12초 미끄러져 온다(개별 translate 속성,
     WAAPI). 위치는 그리는 쪽이 바로 바꾸고, 그려진 뒤 차이만큼 되돌렸다가 0 으로 푼다(FLIP).
   - DropLanding: 붙는 순간 부모가 1 → 1.03 → 1 '톡'(개별 scale 속성) + 테두리 링이 한 번 빛났다 사라진다.
     다시 틀 때는 부모가 key 를 바꿔 새로 붙인다 — 클래스로 animation 을 껐다 켜지 않는다.
   transform 을 쓰지 않으므로 호버 확대·framer 의 transform·마일스톤 rotate 와 섞이지 않는다.
   '동작 줄이기'면 미끄러짐·톡 없이 링만 남는다(링은 CSS 에서 동작 줄이기에도 보이게 따로 둔다).
   ═══════════════════════════════════════════════════════════════ */

/** 끄는 동안 스크롤되는 상자(시간표)는 이 속성을 달아 둔다 — 스크롤과 위치 변화를 구분한다. */
export const DRAG_SLIDE_FRAME_ATTR = 'data-drag-slide-frame';

function measureSlideBox(host: HTMLElement): SlideBox {
  const rect = host.getBoundingClientRect();
  // 들림(scale)은 가운데 기준이라 중심은 그대로다. 크기는 scale 이 빠진 레이아웃 값을 쓴다.
  const width = host.offsetWidth || rect.width;
  const height = host.offsetHeight || rect.height;
  let left = rect.left + rect.width / 2 - width / 2;
  let top = rect.top + rect.height / 2 - height / 2;
  const frame = host.closest<HTMLElement>(`[${DRAG_SLIDE_FRAME_ATTR}]`);
  if (frame) {
    const box = frame.getBoundingClientRect();
    left += frame.scrollLeft - box.left;
    top += frame.scrollTop - box.top;
  }
  return { left, top, width, height };
}

export function DragSlideAnchor({
  slideKey,
  registry,
  reduce,
}: {
  /** 같은 끌기 안에서 같은 조각을 가리키는 이름(일정 identity + 몇 번째 주 조각 등). */
  slideKey: string;
  /** 끌기마다 새로 만드는 자리 기록. 요소가 다른 줄·열로 옮겨 새로 붙어도 이어서 미끄러진다. */
  registry: Map<string, SlideBox>;
  reduce: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<Animation | null>(null);

  // 의존성 없이 매 커밋마다 — 부모가 다시 그려졌다면 자리가 바뀌었을 수 있다.
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    // 미끄러지는 중에 또 칸을 넘으면, 지금 보이는 자리(이전 레이아웃 + 남은 translate)에서 다시 출발한다.
    let carried = { x: 0, y: 0 };
    const running = animationRef.current;
    if (running) {
      if (running.playState === 'running' && typeof getComputedStyle === 'function') {
        carried = parseTranslate(getComputedStyle(host).translate);
      }
      running.cancel();
      animationRef.current = null;
    }
    const next = measureSlideBox(host);
    const prev = registry.get(slideKey);
    registry.set(slideKey, next);
    if (!prev || reduce || typeof host.animate !== 'function') return;
    const offset = dragSlideOffset({ ...prev, left: prev.left + carried.x, top: prev.top + carried.y }, next);
    if (!offset) return;
    animationRef.current = host.animate(
      [{ translate: `${offset.dx}px ${offset.dy}px` }, { translate: '0px 0px' }],
      { duration: DRAG_SLIDE_MS, easing: EASE_CSS.out },
    );
  });

  // 떼어질 때 미끄러짐을 취소하지 않는다 — 요소와 함께 사라지고, 개발 모드(StrictMode)의 가짜 떼었다 붙이기에서
  // 취소하면 새 열로 옮겨 붙은 블록이 미끄러지지 못하고 순간이동한다(다음 실행이 남은 거리를 이어 받는다).

  return <span ref={ref} hidden aria-hidden="true" />;
}

export function DropLanding({
  color,
  variant = 'land',
  className,
}: {
  /** 링 색. 없으면 액센트. */
  color?: string;
  /** land: 놓은 자리 '톡' + 링(450ms). born: 새로 만든 막대의 빛 링(600ms) — 굳어지는 모습은 부모 CSS 가 맡는다. */
  variant?: 'land' | 'born';
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (variant !== 'land') return undefined;
    // 동작 줄이기(OS 설정)면 scale 이 빠져 남는 게 없어 null — 링만 보인다.
    // framer 훅 대신 animateEl 의 기본 판정(matchMedia)을 쓴다 — 붙는 순간 한 번만 보면 된다.
    const animation = animateEl(
      ref.current?.parentElement,
      landingKeyframes(EASE_CSS.out, EASE_CSS.spring),
      { duration: LAND_MS, easing: 'linear' },
    );
    return () => animation?.cancel();
    // 붙는 순간 한 번만 돈다. 다시 틀 때는 부모가 key 를 바꾼다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = color ? ({ '--land-color': color } as CSSProperties) : undefined;
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn('bf-land-ring', variant === 'born' && 'is-born', className)}
      style={style}
    />
  );
}
