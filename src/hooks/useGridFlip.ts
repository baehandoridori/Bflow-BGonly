import { useLayoutEffect, useRef, type RefObject } from 'react';

import {
  GRID_FLIP,
  GRID_FLIP_EASING,
  enterKeyframes,
  moveKeyframes,
  planGridFlip,
  type FlipRect,
} from '@/utils/gridFlip';

/**
 * 카드 격자·목록의 항목마다 '이전 자리 → 새 자리'로 미끄러뜨린다 (움직임 폴리싱 15번).
 * useStackFlip(줄 묶음 하나를 통째로 미는 주간 캘린더용)과 같은 측정 방식을 항목별 x/y 로 넓힌 것.
 *
 * - 각 항목에는 `idAttribute`(기본 data-flip-id) 로 바뀌어도 변하지 않는 키를 단다.
 * - flipKey 가 바뀐 첫 렌더에서 옛 자리를 잰다(DOM 이 아직 커밋 전). 커밋 직후(그리기 전) 새 자리를 재
 *   WAAPI transform 하나로 되돌렸다가 풀어 준다 — 합성 스레드에서 돌고 글자가 찌그러지지 않는다.
 * - 진행 중이던 움직임은 끊고 다시 잰다(옛 측정은 움직이던 '보이는 자리'라 이어서 미끄러진다).
 * - 새로 보이는 항목은 8px 아래·투명에서 떠오른다(지연 min(i×12,150)ms). enter:false 면 생략.
 * - 항목이 maxItems 를 넘거나, disabled(동작 줄이기·끌어 고르는 중 등)거나, scope 가 바뀌었으면
 *   (파트·화면 전환 — 그건 다른 전환이 맡는다) 움직이지 않고 바로 바뀐다.
 */
export interface GridFlipOptions {
  disabled?: boolean;
  scope?: string;
  idAttribute?: string;
  maxItems?: number;
  enter?: boolean;
  moveMs?: number;
  enterMs?: number;
}

type Measured = { rects: Map<string, FlipRect>; elements: Map<string, HTMLElement> };

const TOO_MANY = Symbol('too-many');

function measure(container: HTMLElement | null, attr: string, maxItems: number): Measured | typeof TOO_MANY | null {
  if (!container || typeof container.querySelectorAll !== 'function') return null;
  const nodes = container.querySelectorAll<HTMLElement>(`[${attr}]`);
  if (nodes.length > maxItems) return TOO_MANY;
  const rects = new Map<string, FlipRect>();
  const elements = new Map<string, HTMLElement>();
  nodes.forEach((element) => {
    const id = element.getAttribute(attr);
    if (!id) return;
    const box = element.getBoundingClientRect();
    rects.set(id, { left: box.left, top: box.top, width: box.width, height: box.height });
    elements.set(id, element);
  });
  return { rects, elements };
}

/** 스크롤 상자 ∩ 창 — 이 밖에서 밖으로 가는 항목은 움직이지 않는다. */
function visibleBox(container: HTMLElement): FlipRect {
  const box = container.getBoundingClientRect();
  const width = typeof window !== 'undefined' ? window.innerWidth : box.right;
  const height = typeof window !== 'undefined' ? window.innerHeight : box.bottom;
  const left = Math.max(0, box.left);
  const top = Math.max(0, box.top);
  return {
    left,
    top,
    width: Math.max(0, Math.min(width, box.right) - left),
    height: Math.max(0, Math.min(height, box.bottom) - top),
  };
}

export function useGridFlip(
  containerRef: RefObject<HTMLElement | null>,
  flipKey: string,
  options: GridFlipOptions = {},
): void {
  const committedKeyRef = useRef(flipKey);
  const committedScopeRef = useRef(options.scope);
  const snapshotRef = useRef<Measured | typeof TOO_MANY | null>(null);
  const runningRef = useRef<Animation[]>([]);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const attr = options.idAttribute ?? 'data-flip-id';
  const maxItems = options.maxItems ?? GRID_FLIP.maxItems;

  // 렌더 단계: 키가 바뀐 첫 렌더에서만 옛 자리를 잰다(StrictMode 이중 렌더는 이미 잰 값을 그대로 쓴다).
  if (committedKeyRef.current !== flipKey && snapshotRef.current === null && !options.disabled) {
    snapshotRef.current = measure(containerRef.current, attr, maxItems);
  }

  useLayoutEffect(() => {
    const { scope, disabled, enter = true, moveMs = GRID_FLIP.moveMs, enterMs = GRID_FLIP.enterMs } = optionsRef.current;
    const scopeChanged = committedScopeRef.current !== scope;
    committedScopeRef.current = scope;
    if (committedKeyRef.current === flipKey) {
      // 키가 그대로인 커밋 — 버려진 렌더가 잰 값이 나중 넘김에 섞이지 않게 비운다.
      snapshotRef.current = null;
      return;
    }
    committedKeyRef.current = flipKey;
    const before = snapshotRef.current;
    snapshotRef.current = null;
    for (const animation of runningRef.current) animation.cancel();
    runningRef.current = [];
    if (disabled || scopeChanged || !before || before === TOO_MANY) return;
    const container = containerRef.current;
    if (!container || typeof container.animate !== 'function') return;

    const after = measure(container, attr, maxItems);
    if (!after || after === TOO_MANY) return;
    const plan = planGridFlip(before.rects, after.rects, { viewport: visibleBox(container), maxItems, enter });
    if (!plan) return;
    const running: Animation[] = [];
    for (const move of plan.moves) {
      const element = after.elements.get(move.id);
      if (!element || typeof element.animate !== 'function') continue;
      running.push(element.animate(moveKeyframes(move.dx, move.dy), { duration: moveMs, easing: GRID_FLIP_EASING }));
    }
    for (const item of plan.enters) {
      const element = after.elements.get(item.id);
      if (!element || typeof element.animate !== 'function') continue;
      // backwards: 지연 동안에도 투명하게 기다린다(먼저 보였다가 사라지는 깜빡임 방지).
      running.push(element.animate(enterKeyframes(), {
        duration: enterMs,
        delay: item.delay,
        easing: GRID_FLIP_EASING,
        fill: 'backwards',
      }));
    }
    runningRef.current = running;
  });

  useLayoutEffect(() => () => {
    for (const animation of runningRef.current) animation.cancel();
    runningRef.current = [];
  }, []);
}
