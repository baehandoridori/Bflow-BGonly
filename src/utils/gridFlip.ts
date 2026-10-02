/* ═══════════════════════════════════════════════════════════════
   목록 재배치 미끄러짐(FLIP) 계획 — 움직임 폴리싱 15번 reflow-on-filter

   필터·정렬·검색을 바꾸거나 순서가 바뀔 때, 남는 카드는 '원래 자리 → 새 자리'로 미끄러지고
   새로 보이는 카드는 살짝 떠오르며 나타난다. 이 파일은 측정값(사각형)만 받아
   '누가 얼마나 움직일지'를 정하는 순수 함수다. DOM·WAAPI 는 src/hooks/useGridFlip.ts 가 맡는다.

   - 움직임은 transform(translate) 과 opacity 뿐이라 합성 스레드에서 돈다.
     framer `layout` 처럼 크기를 scale 로 맞추지 않으므로 글자가 찌그러지지 않는다.
   - 카드가 아주 많으면(기본 150장 초과) 아무것도 움직이지 않고 바로 바뀐다.
   - 화면 밖에서 화면 밖으로 가는 카드는 건너뛴다(보이지 않는 일을 하지 않는다).

   node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
   ═══════════════════════════════════════════════════════════════ */

export interface FlipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 수치 사양(설계 15번): 남는 카드 320ms, 새 카드 200ms·8px, 지연 min(i×12, 150)ms, 150장 상한. */
export const GRID_FLIP = Object.freeze({
  moveMs: 320,
  enterMs: 200,
  enterOffsetPx: 8,
  staggerStepMs: 12,
  staggerMaxMs: 150,
  maxItems: 150,
  /** 이보다 작게 움직이면 움직이지 않은 것으로 본다(소수점 반올림 떨림 방지). */
  minShiftPx: 0.5,
});

/** 캐릭터 카드를 끌어 놓은 뒤: 내가 놓은 순간(1.5초 안의 순서 변경)만, 40장 이하일 때만 미끄러진다. */
export const CARD_DROP_FLIP = Object.freeze({
  armMs: 1500,
  maxItems: 40,
});

/**
 * 캘린더 태그·캘린더 체크: 필터를 바꾼 직후(이 시간 안)에 새로 마운트된 일정 막대만 떠오른다.
 * 같은 커밋에서 생기므로 보통 몇 ms 안이다. 달 넘김 등 다른 이유로 생긴 막대는 해당하지 않는다.
 */
export const FILTER_REVEAL_WINDOW_MS = 400;

export function shouldRevealOnMount(revealAt: number, now: number, windowMs: number = FILTER_REVEAL_WINDOW_MS): boolean {
  if (!(revealAt > 0)) return false;
  const elapsed = now - revealAt;
  return elapsed >= 0 && elapsed < windowMs;
}

/** 미끄러짐 곡선 — 바탕 A 의 out 곡선(--ease-out)과 같다. */
export const GRID_FLIP_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

export interface GridFlipMove {
  id: string;
  dx: number;
  dy: number;
}

export interface GridFlipEnter {
  id: string;
  delay: number;
}

export interface GridFlipPlan {
  moves: GridFlipMove[];
  enters: GridFlipEnter[];
}

export interface GridFlipPlanOptions {
  /** 보이는 영역(스크롤 상자 ∩ 창). 주면 이 밖에서 밖으로 가는 카드는 건너뛴다. */
  viewport?: FlipRect | null;
  maxItems?: number;
  /** false 면 새로 보이는 카드에 떠오름을 걸지 않는다(항목이 자기 등장 움직임을 이미 가진 경우). */
  enter?: boolean;
  staggerStepMs?: number;
  staggerMaxMs?: number;
  minShiftPx?: number;
}

export function rectsIntersect(a: FlipRect, b: FlipRect): boolean {
  return a.left < b.left + b.width
    && a.left + a.width > b.left
    && a.top < b.top + b.height
    && a.top + a.height > b.top;
}

/** 새로 보이는 카드의 등장 지연: min(i × 12, 150)ms. i 는 '실제로 떠오르는' 카드 중 순서. */
export function enterDelayMs(index: number, stepMs: number = GRID_FLIP.staggerStepMs, maxMs: number = GRID_FLIP.staggerMaxMs): number {
  return Math.min(Math.max(0, index) * stepMs, maxMs);
}

/**
 * 바뀌기 전(before)·후(after) 사각형으로 움직임을 정한다. after 의 넣은 순서 = 화면(DOM) 순서.
 * 카드가 너무 많으면 null(움직이지 않고 바로 바뀜).
 */
export function planGridFlip(
  before: ReadonlyMap<string, FlipRect>,
  after: ReadonlyMap<string, FlipRect>,
  options: GridFlipPlanOptions = {},
): GridFlipPlan | null {
  const {
    viewport = null,
    maxItems = GRID_FLIP.maxItems,
    enter = true,
    staggerStepMs = GRID_FLIP.staggerStepMs,
    staggerMaxMs = GRID_FLIP.staggerMaxMs,
    minShiftPx = GRID_FLIP.minShiftPx,
  } = options;
  if (before.size > maxItems || after.size > maxItems) return null;

  const moves: GridFlipMove[] = [];
  const enters: GridFlipEnter[] = [];
  const visible = (rect: FlipRect) => !viewport || rectsIntersect(rect, viewport);

  for (const [id, next] of after) {
    const previous = before.get(id);
    if (previous) {
      const dx = previous.left - next.left;
      const dy = previous.top - next.top;
      if (Math.abs(dx) < minShiftPx && Math.abs(dy) < minShiftPx) continue;
      if (!visible(previous) && !visible(next)) continue;
      moves.push({ id, dx: round(dx), dy: round(dy) });
      continue;
    }
    if (!enter || !visible(next)) continue;
    enters.push({ id, delay: enterDelayMs(enters.length, staggerStepMs, staggerMaxMs) });
  }
  return { moves, enters };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 남는 카드: 이전 자리에서 새 자리로. 끝값 translate(0) 은 애니메이션이 끝나면 사라진다(fill 없음). */
export function moveKeyframes(dx: number, dy: number): Keyframe[] {
  return [
    { transform: `translate(${dx}px, ${dy}px)` },
    { transform: 'translate(0px, 0px)' },
  ];
}

/** 새로 보이는 카드: 8px 아래·투명에서 떠오른다. */
export function enterKeyframes(offsetPx: number = GRID_FLIP.enterOffsetPx): Keyframe[] {
  return [
    { opacity: 0, transform: `translateY(${offsetPx}px)` },
    { opacity: 1, transform: 'translateY(0px)' },
  ];
}
