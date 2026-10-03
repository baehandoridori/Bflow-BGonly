/**
 * 끌어서 옮기기의 '잡았다 → 옮긴다 → 놓았다' 세 박자 (움직임 폴리싱 16번 drag-landing).
 *
 * - 옮긴다: 끄는 막대가 칸을 넘을 때 순간이동하지 않고 이전 자리에서 새 자리로 0.12초 미끄러진다
 *   (translate 만, 합성 스레드). 크기만 바뀌는 늘이기는 미끄러지지 않고 바로 맞춘다.
 * - 놓았다: 손을 떼는 즉시(저장을 기다리지 않음) 1 → 1.03 → 1 '톡' + 테두리 링이 한 번 빛났다 사라진다.
 *   저장에 실패하면 지금처럼 원래 자리로 돌아가고 링도 거둔다 — 반짝임은 '저장 완료' 표시가 아니다.
 * - 새로 만든 일정: 유리 막대가 녹아 사라지고, 진짜 막대가 굳어지듯 진해지며 한 번 빛난다.
 *
 * node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
 */

/** 끄는 막대가 칸을 넘을 때 미끄러지는 길이(ms) — 바탕 A '빠름'. */
export const DRAG_SLIDE_MS = 120;
/** 놓을 때 '톡' 길이(ms). */
export const LAND_MS = 420;
/** 놓을 때 커지는 정도. */
export const LAND_SCALE = 1.03;
/** 착지 링이 사라지는 길이(ms) — CSS .bf-land-ring 과 같은 값. */
export const LAND_RING_MS = 450;
/** 착지 표시를 거두는 시점(ms). 링·톡이 다 끝난 뒤. */
export const LAND_CLEAR_MS = 650;
/** 새 일정 막대가 굳어지는 길이(ms) — CSS .calendar-bar-born 과 같은 값. */
export const BORN_MS = 320;
/** 새 일정 빛 링 길이(ms) — CSS .bf-land-ring.is-born 과 같은 값. */
export const BORN_RING_MS = 600;
/** 새 일정 표시를 거두는 시점(ms). 저장이 늦어 막대가 늦게 붙어도 이 안이면 굳어지는 모습을 보인다. */
export const BORN_KEEP_MS = 1000;
/** '만들기'를 누르면 유리 막대가 녹는 길이(ms) — CSS .calendar-drag-ghost-layer.is-leaving 과 같은 값. */
export const GHOST_LEAVE_MS = 150;

/**
 * 녹던 유리 막대 범위가 바뀌는 순간, 다 녹을 때까지 남겨 둘 범위(남기지 않으면 null).
 *
 * 저장이 녹는 시간(GHOST_LEAVE_MS)보다 빨리 끝나면 생성 창이 닫히며 범위가 사라지는데, 그 순간 유리 막대를 떼면
 * 반쯤 녹은 채 툭 사라졌다. 녹던 범위(previousLeavingRange)가 사라졌는데 그릴 범위(nextRange)도 없으면 그것을 남긴다
 * (거두는 건 부른 쪽의 타이머). 저장에 실패해 창이 남으면(범위가 그대로) 남기지 않는다 — 유리 막대가 다시 보인다.
 * 녹기 전에 창을 닫으면(취소) 녹던 범위가 없었으니 남기지 않는다.
 */
/**
 * 남긴 유리 막대를 거두는 시점(ms). 녹는 전환은 '녹는 중' 표시가 그려진 다음 프레임에 시작하는데, 저장이 같은 순간
 * 끝나면 남기기 타이머가 그보다 먼저 시작될 수 있다 — 세 프레임쯤 여유를 둔다(다 녹은 뒤라 보이지 않는다).
 */
export const GHOST_LINGER_MS = GHOST_LEAVE_MS + 50;

export function createGhostLingerOnChange<R>(previousLeavingRange: R | null, nextRange: R | null): R | null {
  return previousLeavingRange !== null && nextRange === null ? previousLeavingRange : null;
}

export interface SlideBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 이전 자리(prev)에서 새 자리(next)로 미끄러질 거리. 미끄러질 필요가 없으면 null.
 * - 위치가 그대로면 null(오른쪽·아래로 늘이기도 여기서 걸러진다).
 * - 크기가 바뀌었는데 오른쪽·아래 모서리가 그대로면(왼쪽 늘이기) null — 늘이기는 바로 맞춘다.
 * - 그 밖에는 왼쪽 위 모서리 기준으로 미끄러진다(주를 넘어가며 조각 폭이 바뀌는 경우 포함).
 */
export function dragSlideOffset(prev: SlideBox, next: SlideBox, epsilon = 0.5): { dx: number; dy: number } | null {
  const dx = prev.left - next.left;
  const dy = prev.top - next.top;
  if (Math.abs(dx) < epsilon && Math.abs(dy) < epsilon) return null;
  const sameSize = Math.abs(prev.width - next.width) < epsilon && Math.abs(prev.height - next.height) < epsilon;
  if (!sameSize) {
    const dRight = (prev.left + prev.width) - (next.left + next.width);
    const dBottom = (prev.top + prev.height) - (next.top + next.height);
    if (Math.abs(dRight) < epsilon && Math.abs(dBottom) < epsilon) return null;
  }
  return { dx, dy };
}

/** getComputedStyle(el).translate 값('12px 4px' · '12px' · 'none')을 숫자로. */
export function parseTranslate(value: string | null | undefined): { x: number; y: number } {
  if (!value || value === 'none') return { x: 0, y: 0 };
  const [x = '0', y = '0'] = value.trim().split(/\s+/);
  const px = (part: string) => {
    const n = Number.parseFloat(part);
    return Number.isFinite(n) ? n : 0;
  };
  return { x: px(x), y: px(y) };
}

/**
 * 놓을 때 '톡' 키프레임 — 개별 scale 속성만 쓴다(요소의 transform·rotate·translate 와 섞이지 않는다).
 * 1 → 1.03(30% 지점, out 곡선) → 1(spring 곡선으로 살짝 넘쳤다 돌아옴).
 */
export function landingKeyframes(outEase: string, springEase: string): Keyframe[] {
  return [
    { scale: '1', easing: outEase },
    { scale: String(LAND_SCALE), offset: 0.3, easing: springEase },
    { scale: '1' },
  ];
}

/** 착지 표시 상태 — 같은 대상을 또 놓아도 seq 가 바뀌어 React key 로 다시 튼다. */
export interface LandingMark {
  key: string;
  seq: number;
}

/** seq 가 같을 때만 거둔다 — 그 사이 다른 착지가 시작됐으면 그대로 둔다. */
export function clearLandingIf<T extends { seq: number }>(current: T | null, seq: number): T | null {
  return current && current.seq === seq ? null : current;
}

/**
 * 타임라인 막대가 손을 따라오는 나머지 거리(px).
 * 화면에는 하루 단위로 스냅된 자리(renderedDelta 일)가 그려져 있고, 손과의 차이만 transform 으로 메운다.
 * 날짜가 바뀔 때만 다시 그리고(React), 그 사이 움직임은 이 값만 고친다.
 */
export function residualOffset(pointerDx: number, renderedDelta: number, dayWidth: number): number {
  return pointerDx - renderedDelta * dayWidth;
}
