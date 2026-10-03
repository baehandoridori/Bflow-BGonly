import type { Transition } from 'framer-motion';
import { EASE, EASE_CSS, MOTION_MS } from './motion.ts';

/* ═══════════════════════════════════════════════════════════════
   미끄러지는 선택 표시 — 순수 계산 (움직임 폴리싱 7번 sliding-indicator)

   선택된 칸마다 배경을 껐다 켜는 대신, 표시 하나(절대 위치)를 칸 위로 옮긴다.
   - 쉬는 동안: 표시는 transform: translate3d(x, y, 0) + (축에 따라) width/height 로 칸에 딱 맞는다.
   - 옮길 때: 새 자리·새 크기를 '바로' 적용한 뒤, 이전 자리·크기에서 출발하는 transform
     (translate + scale) 하나를 WAAPI 로 풀어 준다(FLIP). 폭 자체를 애니메이션하지 않으므로
     합성 스레드에서만 돌고, 무거운 화면을 그리는 동안에도 끊기지 않는다.
   - 연타: 진행 중이면 지금 보이는 자리(계산된 transform)에서 새 목표로 이어 간다.

   node --test 가 그대로 import 하도록 DOM·React 런타임 의존이 없다.
   ═══════════════════════════════════════════════════════════════ */

/** 표시가 따라가는 축. x=가로 탭·밑줄(세로 자리는 CSS), y=세로 메뉴·목록(가로 자리는 CSS), both=칸을 통째로 덮는 알약. */
export type SlideAxis = 'x' | 'y' | 'both';

export interface SlideRect { x: number; y: number; w: number; h: number }

export interface SlideTiming { duration: number; easing: string }

export type SlideTimingName = 'rail' | 'tab' | 'list';

/** 사양(설계 7번) 박자. */
export const SLIDE_TIMING: Readonly<Record<SlideTimingName, SlideTiming>> = Object.freeze({
  /** 세로 메뉴(사이드바·설정 메뉴): 260ms, 튕김이 거의 없는 곡선. */
  rail: Object.freeze({ duration: MOTION_MS.slow, easing: 'cubic-bezier(0.3, 1.25, 0.5, 1)' }),
  /** 가로 탭·세그먼트·밑줄: 220ms, 들어오는 곡선. */
  tab: Object.freeze({ duration: 220, easing: EASE_CSS.out }),
  /** 목록 강조 막대(빠른 검색·@멘션·#태그): 120ms, 작은 반응 곡선. */
  list: Object.freeze({ duration: MOTION_MS.fast, easing: EASE_CSS.snap }),
});

/**
 * 이미 framer layoutId 로 미끄러지는 탭(대시보드·씬 목록 부서 탭)의 박자 — 가로 탭과 같은 220ms·out 곡선.
 * (예전 spring stiffness 400·damping 30 은 다른 탭보다 빠르고 끝이 끈적였다.)
 */
export const SLIDE_LAYOUT_TRANSITION: Transition = { duration: 0.22, ease: EASE.out };

/** 숫자 배지 '톡'(늘 때). */
export const BADGE_POP_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(1)' },
  { transform: 'scale(1.25)', offset: 0.4 },
  { transform: 'scale(1)' },
];
export const BADGE_POP_TIMING = Object.freeze({ duration: 220, easing: EASE_CSS.snap });
/** 0 이 될 때 작게 줄며 사라짐 — [제자리, 목표] 두 키프레임(framer 가 'none' 에서 scale(0) 으로 출발하지 않게). */
export const BADGE_EXIT_TRANSFORM: readonly [string, string] = ['scale(1)', 'scale(0.6)'];
export const BADGE_EXIT_MS = MOTION_MS.fast;

/** 배지 숫자가 바뀔 때 '톡'을 줄지. 처음 그릴 때(이전 값 없음)와 줄어들 때는 조용히. */
export function shouldPopBadge(previous: number | null, next: number): boolean {
  return previous !== null && next > 0 && next > previous;
}

interface OffsetNode {
  offsetLeft: number;
  offsetTop: number;
  offsetWidth: number;
  offsetHeight: number;
  offsetParent: unknown;
  clientLeft?: number;
  clientTop?: number;
}

/**
 * item 의 테두리 상자를 container 안쪽(padding 가장자리) 기준 좌표로 잰다. 절대 위치 표시의 left/top 0 과 같은 기준이다.
 * offset* 은 레이아웃 값이라 조상의 transform(창이 떠오르는 scale 등)에 흔들리지 않는다.
 * container 가 offsetParent 사슬에 없으면(position 이 static) null — 호출한 쪽이 사각형 차이로 대신한다.
 */
export function measureWithin(item: OffsetNode, container: unknown): SlideRect | null {
  let x = 0;
  let y = 0;
  let node: OffsetNode | null = item;
  while (node && node !== container) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const parent = node.offsetParent as OffsetNode | null;
    if (parent && parent !== container) {
      // 중간 offsetParent 의 테두리 두께 — offsetLeft 는 부모의 테두리 안쪽에서 잰 값이다.
      x += parent.clientLeft ?? 0;
      y += parent.clientTop ?? 0;
    }
    node = parent;
  }
  if (node !== container) return null;
  return { x, y, w: item.offsetWidth, h: item.offsetHeight };
}

interface RectLike { left: number; top: number; width: number; height: number }

/** measureWithin 을 쓸 수 없을 때: 화면 사각형 차이 + container 의 테두리·스크롤 보정. */
export function rectWithin(
  itemRect: RectLike,
  containerRect: RectLike,
  container: { clientLeft: number; clientTop: number; scrollLeft: number; scrollTop: number },
): SlideRect {
  return {
    x: itemRect.left - containerRect.left - container.clientLeft + container.scrollLeft,
    y: itemRect.top - containerRect.top - container.clientTop + container.scrollTop,
    w: itemRect.width,
    h: itemRect.height,
  };
}

/** 칸보다 안쪽에 그리는 표시(예: 좌우 12px 들여 쓴 밑줄). */
export function insetRect(rect: SlideRect, inset?: { x?: number; y?: number }): SlideRect {
  const ix = inset?.x ?? 0;
  const iy = inset?.y ?? 0;
  if (!ix && !iy) return rect;
  return { x: rect.x + ix, y: rect.y + iy, w: Math.max(0, rect.w - ix * 2), h: Math.max(0, rect.h - iy * 2) };
}

const usesX = (axis: SlideAxis) => axis !== 'y';
const usesY = (axis: SlideAxis) => axis !== 'x';
const px = (value: number) => `${Math.round(value * 100) / 100}px`;
const num = (value: number) => String(Math.round(value * 10000) / 10000);

/** 쉬는 동안의 표시 스타일. 축에 없는 값(위치·크기)은 CSS 가 정한다. */
export function restingStyle(rect: SlideRect, axis: SlideAxis): { transform: string; width?: string; height?: string } {
  const style: { transform: string; width?: string; height?: string } = {
    transform: `translate3d(${px(usesX(axis) ? rect.x : 0)}, ${px(usesY(axis) ? rect.y : 0)}, 0px)`,
  };
  if (usesX(axis)) style.width = px(rect.w);
  if (usesY(axis)) style.height = px(rect.h);
  return style;
}

/** 축 기준으로 같은 자리·같은 크기인지(0.5px 이내). */
export function sameSlideRect(a: SlideRect, b: SlideRect, axis: SlideAxis, epsilon = 0.5): boolean {
  const close = (p: number, q: number) => Math.abs(p - q) <= epsilon;
  if (usesX(axis) && (!close(a.x, b.x) || !close(a.w, b.w))) return false;
  if (usesY(axis) && (!close(a.y, b.y) || !close(a.h, b.h))) return false;
  return true;
}

/**
 * from(지금 보이는 자리) → to(새 자리) 로 미끄러지는 transform 키프레임. 표시는 이미 to 의 크기로 바뀌어 있으므로
 * 출발 프레임은 from 크기 / to 크기 만큼 줄이거나 늘린 모습이다(transform-origin 0 0).
 * 움직일 게 없으면 null.
 */
export function slideKeyframes(from: SlideRect, to: SlideRect, axis: SlideAxis): Keyframe[] | null {
  if (sameSlideRect(from, to, axis)) return null;
  const sx = usesX(axis) && to.w > 0 ? from.w / to.w : 1;
  const sy = usesY(axis) && to.h > 0 ? from.h / to.h : 1;
  const fx = usesX(axis) ? from.x : 0;
  const fy = usesY(axis) ? from.y : 0;
  const tx = usesX(axis) ? to.x : 0;
  const ty = usesY(axis) ? to.y : 0;
  return [
    { transform: `translate3d(${px(fx)}, ${px(fy)}, 0px) scale(${num(sx)}, ${num(sy)})` },
    { transform: `translate3d(${px(tx)}, ${px(ty)}, 0px) scale(1, 1)` },
  ];
}

/**
 * 계산된 transform(getComputedStyle) 과 지금 레이아웃 크기로 '보이는' 자리를 되짚는다 — 연타 때 진행 중 위치에서 이어 가려고.
 * 'none'·읽을 수 없는 값이면 null.
 */
export function visualSlideRect(computedTransform: string | null | undefined, layout: SlideRect): SlideRect | null {
  if (!computedTransform || computedTransform === 'none') return null;
  const match = /^matrix(3d)?\(([^)]*)\)$/.exec(computedTransform.trim());
  if (!match) return null;
  const values = match[2].split(',').map((part) => Number(part.trim()));
  if (values.some((value) => !Number.isFinite(value))) return null;
  const is3d = Boolean(match[1]);
  if ((is3d && values.length !== 16) || (!is3d && values.length !== 6)) return null;
  const a = values[0];
  const d = is3d ? values[5] : values[3];
  const e = is3d ? values[12] : values[4];
  const f = is3d ? values[13] : values[5];
  return { x: e, y: f, w: layout.w * a, h: layout.h * d };
}

/**
 * 목록 상자 안에서 칸이 보이도록 scrollTop 을 가장 적게 옮긴 값. 이미 다 보이면 null.
 * (element.scrollIntoView 는 overflow:hidden 인 바깥 상자까지 끌고 간다 — tasks/lessons.md 2026-10-02)
 */
export function nearestScrollTop(scrollTop: number, viewHeight: number, itemTop: number, itemHeight: number): number | null {
  if (itemTop < scrollTop) return Math.max(0, itemTop);
  if (itemTop + itemHeight > scrollTop + viewHeight) return itemTop + itemHeight - viewHeight;
  return null;
}

/** 강조 막대가 따라가는 목록(빠른 검색·@멘션·#태그)에서 고른 줄이 보이게 목록 상자 하나만 '즉시' 스크롤한다. */
export function revealInList(container: HTMLElement | null, item: HTMLElement | null | undefined): void {
  if (!container || !item) return;
  const rect = measureWithin(item, container)
    ?? rectWithin(item.getBoundingClientRect(), container.getBoundingClientRect(), container);
  const next = nearestScrollTop(container.scrollTop, container.clientHeight, rect.y, rect.h);
  if (next !== null) container.scrollTop = next;
}

export interface SlidePlanInput {
  axis: SlideAxis;
  /** 새로 잰 목표 자리. */
  target: SlideRect;
  /** 표시가 보이는 중이면 지금 놓인(쉬는) 자리, 숨어 있었으면 null. */
  previous: SlideRect | null;
  /** 미끄러지는 중이면 지금 '보이는' 자리(계산된 transform 으로 되짚은 값). */
  visual: SlideRect | null;
  /** 미끄러지는 애니메이션이 돌고 있는지. */
  running: boolean;
  /** 이번 갱신이 선택 이동(키 변경)인지. 크기 변화·목록 교체면 false. */
  keyMoved: boolean;
  /** 동작 줄이기·목록 교체 직후 등 미끄러짐을 막아야 하는지. */
  blockSlide: boolean;
}

export type SlidePlan =
  | { kind: 'keep' }
  | { kind: 'place'; frames: Keyframe[] | null };

/**
 * 한 번의 갱신에서 할 일을 정한다.
 * - 목표가 지금 자리와 같으면 그대로(keep) — 미끄러지는 중이라도 끊지 않는다.
 * - 아니면 새 자리에 놓고(place), 키가 바뀌었거나 이미 미끄러지는 중이면 보이는 자리에서 이어 미끄러진다.
 * - 숨어 있다 나타나는 경우·막힌 경우는 미끄러짐 없이 놓는다.
 */
export function planSlide(input: SlidePlanInput): SlidePlan {
  const { axis, target, previous, visual, running, keyMoved, blockSlide } = input;
  if (previous && sameSlideRect(previous, target, axis)) return { kind: 'keep' };
  const from = previous ? (running ? visual ?? previous : previous) : null;
  if (!from || blockSlide || !(keyMoved || running)) return { kind: 'place', frames: null };
  return { kind: 'place', frames: slideKeyframes(from, target, axis) };
}
