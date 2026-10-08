import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * 줄을 쌓아 둔 목록(주간 카드·일간 칸)이 한 칸씩 밀릴 때, 컨테이너 하나를 이전 자리에서
 * 새 자리로 미끄러뜨린다.
 *
 * - 각 줄에는 `data-flip-id`(날짜처럼 넘겨도 변하지 않는 키)를 단다. 넘김 전후로 모양이 그대로인
 *   줄은 `data-flip-anchor`, 포커스된 줄은 `data-flip-active` 를 단다.
 * - 바뀌기 직전 화면은 렌더 단계에서 잰다(DOM 이 아직 옛 상태). 바뀐 직후(useLayoutEffect, 그리기 전)
 *   새 위치를 재서, 기준 줄이 제자리에 보이도록 컨테이너를 되돌렸다가 0 으로 푼다.
 * - 움직임은 WAAPI transform 하나라 합성 스레드에서 돈다. 메인 스레드가 바빠도 끊기지 않고,
 *   framer `layout` 처럼 크기를 scale 로 맞추지 않으므로 글자가 찌그러지지 않는다.
 */

type Axis = 'x' | 'y';

type FlipRow = { start: number; index: number; anchor: boolean; active: boolean; element?: HTMLElement };
type FlipSnapshot = { rows: Map<string, FlipRow>; activeIndex: number };

export interface StackFlipOptions {
  axis?: Axis;
  /** 연타·동작 줄이기 등으로 미끄러짐 없이 바로 바꿔야 할 때. */
  disabled?: boolean;
  /**
   * 넘김 순서를 비교할 값(날짜 문자열 등). 기준 줄이 없을 만큼 크게 건너뛸 때
   * 이전 값보다 작으면 위(왼쪽)에서, 크면 아래(오른쪽)에서 밀려 들어온다.
   */
  order?: string | number;
  duration?: number;
  easing?: string;
}

const DEFAULT_DURATION = 380;
const DEFAULT_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
const JUMP_OFFSET_PX = 16;

function measureRows(container: HTMLElement | null, axis: Axis): FlipSnapshot | null {
  if (!container || typeof container.querySelectorAll !== 'function') return null;
  const rows = new Map<string, FlipRow>();
  let activeIndex = -1;
  container.querySelectorAll<HTMLElement>(':scope > [data-flip-id]').forEach((element, index) => {
    const id = element.dataset.flipId;
    if (!id) return;
    const rect = element.getBoundingClientRect();
    const active = element.dataset.flipActive === 'true';
    if (active && activeIndex === -1) activeIndex = index;
    rows.set(id, {
      start: axis === 'y' ? rect.top : rect.left,
      index,
      anchor: element.dataset.flipAnchor === 'true',
      active,
      element,
    });
  });
  return { rows, activeIndex };
}

/**
 * 기준 줄 고르기: 넘김 전후 모두 '접힌 줄'이면서 옛 포커스 줄과 가장 가까운 줄.
 * 그런 줄이 없으면 전후 모두 포커스였던 줄(2주 보기의 한 주씩 넘김)을 쓴다.
 */
export function pickStackFlipShift(before: FlipSnapshot, after: FlipSnapshot): number | null {
  let best: { shift: number; rank: number } | null = null;
  for (const [id, previous] of before.rows) {
    const next = after.rows.get(id);
    if (!next) continue;
    const sameShape = (previous.anchor && next.anchor) || (previous.active && next.active);
    if (!sameShape) continue;
    const distance = before.activeIndex >= 0 ? Math.abs(previous.index - before.activeIndex) : previous.index;
    // 접힌 줄이 포커스 줄보다 우선한다(포커스 줄은 내용에 따라 높이가 달라질 수 있다).
    const rank = (previous.anchor && next.anchor ? 0 : 1000) + distance;
    if (!best || rank < best.rank) best = { shift: previous.start - next.start, rank };
  }
  return best ? best.shift : null;
}

export function useStackFlip(
  containerRef: RefObject<HTMLElement>,
  flipKey: string,
  options: StackFlipOptions = {},
): void {
  const committedKeyRef = useRef(flipKey);
  const committedOrderRef = useRef(options.order);
  const snapshotRef = useRef<FlipSnapshot | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const axis = options.axis ?? 'y';

  // 렌더 단계: 키가 바뀐 첫 렌더에서만 옛 화면을 잰다. 이 시점의 DOM 은 아직 커밋 전이다.
  // (같은 키로 다시 렌더되면 이미 잰 값을 그대로 둔다 — StrictMode 이중 렌더 포함)
  if (committedKeyRef.current !== flipKey && snapshotRef.current === null && !options.disabled) {
    snapshotRef.current = measureRows(containerRef.current, axis);
  }

  // 커밋마다 돈다(의존성 없음). 키가 그대로인 커밋이면 그사이 화면이 바뀌었을 수 있으니
  // 남아 있는 옛 측정값을 버린다 — 버려진 렌더가 잰 값이 나중 넘김에 섞이지 않게.
  useLayoutEffect(() => {
    if (committedKeyRef.current === flipKey) {
      snapshotRef.current = null;
      return;
    }
    committedKeyRef.current = flipKey;
    const before = snapshotRef.current;
    snapshotRef.current = null;
    const { disabled, order, duration = DEFAULT_DURATION, easing = DEFAULT_EASING } = optionsRef.current;
    const previousOrder = committedOrderRef.current;
    committedOrderRef.current = order;
    const direction = previousOrder !== undefined && order !== undefined && order < previousOrder ? -1 : 1;
    const container = containerRef.current;
    if (!container) return;
    // 진행 중이던 미끄러짐은 끊는다. 새 위치를 잴 때 이전 움직임이 섞이지 않게 하고,
    // 연타로 즉시 전환할 때 옛 움직임이 남아 흔들리지 않게 한다.
    animationRef.current?.cancel();
    animationRef.current = null;
    if (disabled || !before || typeof container.animate !== 'function') return;

    const after = measureRows(container, axis);
    if (!after) return;
    const translate = axis === 'y' ? 'translateY' : 'translateX';
    const shift = pickStackFlipShift(before, after);
    if (shift !== null) {
      if (Math.abs(shift) < 0.5) return;
      animationRef.current = container.animate(
        [{ transform: `${translate}(${shift}px)` }, { transform: `${translate}(0px)` }],
        { duration, easing },
      );
      // 바깥에서 새로 밀려 들어온 줄만 투명에서 떠오르게 한다. CSS 등장 애니메이션을 클래스로
      // 켜고 끄면 연타가 끝날 때 이미 떠 있던 줄까지 다시 떠올라 깜빡이므로 여기서 직접 건다.
      for (const [id, row] of after.rows) {
        if (before.rows.has(id) || !row.element || typeof row.element.animate !== 'function') continue;
        row.element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Math.round(duration * 0.8), easing: 'ease-out' });
      }
      return;
    }
    // 이어지는 줄이 하나도 없을 만큼 건너뛰었다(미니 달력·사이드바로 멀리 이동 등).
    // 자리를 이어 붙일 수 없으니 넘긴 방향에서 살짝 밀려 들어오며 나타나게 한다.
    animationRef.current = container.animate(
      [
        { opacity: 0.35, transform: `${translate}(${direction < 0 ? -JUMP_OFFSET_PX : JUMP_OFFSET_PX}px)` },
        { opacity: 1, transform: `${translate}(0px)` },
      ],
      { duration: Math.round(duration * 0.8), easing },
    );
  });

  useLayoutEffect(() => () => {
    animationRef.current?.cancel();
    animationRef.current = null;
  }, []);
}
