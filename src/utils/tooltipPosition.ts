/* ═══════════════════════════════════════════════════════════════
   설명 말풍선 자리 잡기 (움직임 폴리싱 2번 tooltip-anchor, 2026-10)

   - 말풍선은 가리킨 곳 '바로 위 가운데'에 뜨고, 위에 자리가 없으면 아래로 내려간다.
   - 화면 가장자리 8px 안쪽으로 밀어 넣는다. 폭은 줄이지 않는다(오른쪽 끝에서 글자가 접히지 않게).
   - 결과는 상자의 왼쪽 위 모서리(left, top)다. 화면에는 transform: translate3d(left, top, 0) 하나로 놓는다
     — left/top 으로 옮기면 움직일 때마다 배치를 다시 계산하므로 쓰지 않는다.
   - 한 번 뜬 뒤 옆으로 옮기면(마지막 숨김 후 300ms 안) 기다리지 않고 바로 옮겨 간다(웜업).

   node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
   ═══════════════════════════════════════════════════════════════ */

/** 화면 가장자리 여백(px). */
export const TOOLTIP_EDGE = 8;
/** 마지막으로 숨긴 뒤 이 시간 안에 다른 대상에 올리면 기다림·등장 효과 없이 바로 옮겨 간다. */
export const TOOLTIP_WARM_MS = 300;
/** 커서를 따라가는 말풍선: 커서 위 12px / 아래 16px(커서 그림을 덮지 않게). */
export const FOLLOW_GAP_ABOVE = 12;
export const FOLLOW_GAP_BELOW = 16;

export interface TooltipSize { width: number; height: number }
export interface TooltipViewport { width: number; height: number }
/** 가리킨 대상의 가로 기준점(x)과 위·아래 끝(top·bottom). 커서라면 top = bottom = 커서 y. */
export interface TooltipAnchor { x: number; top: number; bottom: number }
/** 말풍선 상자의 왼쪽 위 모서리와 아래로 내려갔는지. */
export interface TooltipPlacement { left: number; top: number; below: boolean }

export interface PlaceTooltipOptions {
  /** 대상 위쪽과의 간격. 기본 6. */
  gapAbove?: number;
  /** 대상 아래쪽과의 간격. 기본은 gapAbove 와 같다. */
  gapBelow?: number;
  /** 자리가 있으면 아래에 둔다(헤더처럼 화면 맨 위 줄 — 종 아이콘의 빨간 배지를 덮지 않게). */
  preferBelow?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * 대상 위 가운데에 말풍선을 놓는다. 위에 자리가 없으면 아래, 아래도 없으면 더 넓은 쪽.
 * 가로는 가장자리 8px 안쪽으로 밀어 넣는다(말풍선이 화면보다 넓으면 왼쪽 8px 에 붙인다).
 */
export function placeAnchoredTooltip(
  anchor: TooltipAnchor,
  size: TooltipSize,
  viewport: TooltipViewport,
  options: PlaceTooltipOptions = {},
): TooltipPlacement {
  const gapAbove = options.gapAbove ?? 6;
  const gapBelow = options.gapBelow ?? gapAbove;
  const width = Math.max(0, size.width);
  const height = Math.max(0, size.height);
  const left = clamp(anchor.x - width / 2, TOOLTIP_EDGE, Math.max(TOOLTIP_EDGE, viewport.width - TOOLTIP_EDGE - width));

  const aboveBottom = anchor.top - gapAbove; // 위에 둘 때 상자 아래 끝
  const belowTop = anchor.bottom + gapBelow; // 아래에 둘 때 상자 위 끝
  const fitsAbove = aboveBottom - height >= TOOLTIP_EDGE;
  const fitsBelow = belowTop + height <= viewport.height - TOOLTIP_EDGE;
  const below = options.preferBelow
    ? fitsBelow || !fitsAbove
    : !fitsAbove && (fitsBelow || viewport.height - belowTop > aboveBottom);

  const maxTop = Math.max(TOOLTIP_EDGE, viewport.height - TOOLTIP_EDGE - height);
  const top = clamp(below ? belowTop : aboveBottom - height, TOOLTIP_EDGE, maxTop);
  // 반 픽셀에 놓이면 글자가 흐려진다 — 정수로.
  return { left: Math.round(left), top: Math.round(top), below };
}

/** 아래에 띄울 때 가리킨 대상 아래 끝과 띄우는 간격. */
export const TARGET_GAP_BELOW = 6;

/**
 * 커서를 따라가는 말풍선(앱 전체 title 말풍선). 커서 위 가운데, 위쪽에 자리가 없으면 커서 아래.
 * targetBottom 을 주면 아래에 띄울 때 그 대상 아래로 내려 대상을 덮지 않는다(헤더 버튼 — 종의 빨간 배지까지).
 * 가로는 계속 커서를 따라간다.
 */
export function placeFollowTooltip(
  cursor: { x: number; y: number },
  size: TooltipSize,
  viewport: TooltipViewport,
  options: { preferBelow?: boolean; targetBottom?: number } = {},
): TooltipPlacement {
  const bottom = options.targetBottom === undefined
    ? cursor.y
    : Math.max(cursor.y, options.targetBottom + TARGET_GAP_BELOW - FOLLOW_GAP_BELOW);
  return placeAnchoredTooltip(
    { x: cursor.x, top: cursor.y, bottom },
    size,
    viewport,
    { gapAbove: FOLLOW_GAP_ABOVE, gapBelow: FOLLOW_GAP_BELOW, preferBelow: options.preferBelow },
  );
}

/**
 * '아래로 띄우는 영역'(헤더, data-tooltip-placement="below") 규칙이 이 대상에 맞는지.
 * 영역의 띠(헤더 막대) 안에서 시작하는 대상만 아래로 — 헤더 안에 그려지지만 막대 아래로 펼쳐지는
 * 알림 창 내용(창 높이만큼 긴 너비 조절 손잡이 등)은 평소처럼 가리킨 곳 위에 띄운다.
 */
export function inBelowTooltipZone(targetTop: number, zoneBottom: number): boolean {
  return targetTop < zoneBottom;
}

/** 자리 잡기 결과를 transform 문자열로. 위치 바꿈은 이 값 하나만 갈아 끼운다(합성 스레드). */
export function tooltipTransform(placement: Pick<TooltipPlacement, 'left' | 'top'>): string {
  return `translate3d(${placement.left}px, ${placement.top}px, 0)`;
}

/**
 * 막대(일정·타임라인)에 고정하는 말풍선의 기준점. 막대 가운데를 쓰되, 긴 막대(한 주를 꽉 채운 일정 등)는
 * 처음 올린 커서에서 reach 안쪽으로 당긴다 — 커서에서 멀리 떨어진 곳에 뜨지 않게.
 */
export function barTooltipAnchor(
  rect: { left: number; right: number; top: number; bottom: number },
  clientX: number,
  reach = 120,
): TooltipAnchor {
  const center = (rect.left + rect.right) / 2;
  const min = Math.max(rect.left + 16, clientX - reach);
  const max = Math.min(rect.right - 16, clientX + reach);
  return { x: min <= max ? clamp(center, min, max) : center, top: rect.top, bottom: rect.bottom };
}

/** 두 상자가 겹치는지(테스트·화면 점검용). */
export function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** 웜업 기록. 숨긴 시각만 기억한다(지금 떠 있는지는 쓰는 쪽이 안다). 스크롤·클릭·Esc 로 닫으면 reset. */
export interface TooltipWarmth {
  isWarm(now: number): boolean;
  markHidden(now: number): void;
  reset(): void;
}

export function createTooltipWarmth(windowMs = TOOLTIP_WARM_MS): TooltipWarmth {
  let hiddenAt = Number.NEGATIVE_INFINITY;
  return {
    isWarm: (now) => now - hiddenAt < windowMs,
    markHidden: (now) => { hiddenAt = now; },
    reset: () => { hiddenAt = Number.NEGATIVE_INFINITY; },
  };
}
