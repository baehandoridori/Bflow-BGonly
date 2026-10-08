/* ═══════════════════════════════════════════════════════════════
   창·메뉴 공통 박자 (움직임 폴리싱 8번 popup-rhythm, 2026-10)

   - 큰 창: 뒤 배경이 150ms 동안 어두워지고(.bf-scrim-in), 창은 6px 아래·98% 크기에서 180ms 에 떠오른다(.bf-modal-in).
   - 작은 메뉴: 누른 자리 쪽 모서리에서 140ms 에 피어난다(.bf-pop, 기준점은 --pop-origin).
     메뉴가 누른 자리보다 위로 뒤집혀 열리면 출발 방향도 뒤집는다(.bf-pop-up).
   - 일괄 변경 바: 아래에서 16px 올라오며 180ms(.bf-bulk-in). 숫자는 바뀔 때만 140ms '톡'(WAAPI).
   - 닫힘은 바로 — 퇴장 움직임은 두지 않는다(다음 동작을 막지 않게).
   - 동작 줄이기: 움직임 없이 opacity 만 100ms (CSS 는 src/styles/motion-popups-panels.css 의 reduce 블록).

   CSS 클래스와 키프레임은 src/styles/motion-popups-panels.css 에 있다. 이 파일은 기준점 계산(순수 함수)만 맡아
   node --test 가 그대로 import 한다(@/ 별칭·외부 패키지 X).
   ═══════════════════════════════════════════════════════════════ */

/** 박자(ms). CSS 의 같은 이름 클래스와 값이 같아야 한다(tests/motion/popups-panels-popup-rhythm.test.ts). */
export const POPUP_MS = Object.freeze({
  /** 뒤 배경 어두워짐 */
  scrim: 150,
  /** 큰 창 떠오름 */
  modal: 180,
  /** 작은 메뉴 피어남 */
  pop: 140,
  /** 일괄 변경 바 올라옴 */
  bulk: 180,
  /** 숫자 '톡' */
  tick: 140,
  /** 동작 줄이기 — opacity 만 */
  reduced: 100,
});

/** 일괄 변경 바의 선택 개수가 바뀔 때 숫자만 살짝 아래에서 올라오며 또렷해진다. */
export const COUNT_TICK_KEYFRAMES: Keyframe[] = [
  { opacity: 0.4, transform: 'translateY(4px)' },
  { opacity: 1, transform: 'none' },
];

export interface PopPoint { x: number; y: number }
export interface PopBox { left: number; top: number; width: number; height: number }
export interface PopOrigin {
  /** 메뉴 상자 안에서의 기준점(px) */
  x: number;
  y: number;
  /** 메뉴가 누른 자리보다 위에 열렸는가 — 그러면 아래에서 위로 피어난다. */
  up: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * 누른 지점(point)에서 피어나도록 메뉴 상자(box) 안의 기준점을 구한다.
 * 화면 끝에서 메뉴가 왼쪽·위로 밀려나면 기준점도 오른쪽·아래 모서리 쪽으로 따라간다.
 */
export function popOriginFromPoint(point: PopPoint, box: PopBox): PopOrigin {
  const width = Math.max(0, box.width);
  const height = Math.max(0, box.height);
  const x = Math.round(clamp(point.x - box.left, 0, width));
  const y = Math.round(clamp(point.y - box.top, 0, height));
  return { x, y, up: height > 0 && y > height / 2 };
}

export interface PopAnchorRect { left: number; top: number; right: number; bottom: number }

/**
 * 누른 버튼(anchor) 아래(또는 위)에 붙는 메뉴의 기준점. 버튼 가운데 x, 메뉴가 붙은 쪽 버튼 가장자리 y 를 누른 지점으로 본다.
 */
export function popOriginFromAnchor(anchor: PopAnchorRect, box: PopBox): PopOrigin {
  const anchorMidY = (anchor.top + anchor.bottom) / 2;
  const opensBelow = box.top >= anchorMidY;
  return popOriginFromPoint(
    { x: (anchor.left + anchor.right) / 2, y: opensBelow ? anchor.bottom : anchor.top },
    box,
  );
}

/** 메뉴 요소에 붙일 클래스. 위로 뒤집혀 열리면 출발 방향도 뒤집는다. */
export function popClassName(origin: PopOrigin | null | undefined): string {
  return origin?.up ? 'bf-pop bf-pop-up' : 'bf-pop';
}

/** 메뉴 요소의 인라인 style 에 펼쳐 넣는 기준점 변수. 기준점을 모르면 비워 둔다(CSS 기본값 top right). */
export function popOriginStyle(origin: PopOrigin | null | undefined): Record<string, string> {
  return origin ? { '--pop-origin': `${origin.x}px ${origin.y}px` } : {};
}

export interface PopViewport { width: number; height: number }

/**
 * 커서 자리에 여는 우클릭 메뉴가 화면 밖으로 나가지 않게 왼쪽 위 좌표를 고친다.
 * 오른쪽·아래는 8px, 왼쪽·위는 4px 여백(기존 ContextMenu·EventQuickEdit 규칙 그대로).
 */
export function clampMenuToViewport(point: PopPoint, size: { width: number; height: number }, viewport: PopViewport): PopPoint {
  let { x, y } = point;
  if (x + size.width > viewport.width - 8) x = viewport.width - size.width - 8;
  if (y + size.height > viewport.height - 8) y = viewport.height - size.height - 8;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  return { x, y };
}
