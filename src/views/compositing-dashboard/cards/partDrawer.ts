/**
 * 파트 접기/펼치기 서랍 (움직임 폴리싱 5번 compositing-card-fixes).
 *
 * 예전에는 펼칠 때 칸이 처음부터 넘침 허용 + 최소 320px 로 붙어서, 아래 파트 제목줄이 먼저 '툭' 내려앉은 뒤
 * 나머지만 미끄러졌고, 접자마자 다시 펼치면 카드가 아래 파트 제목줄 위로 삐져나왔다.
 * 이제는:
 *   - 펼침: 칸 높이 0(또는 접히던 중의 지금 높이) → 실제 높이 280ms, 그동안 칸 밖으로 안 나온다(overflow hidden).
 *           끝나면 인라인 값을 비워 높이 제한 없음·넘침 허용(핀 카드 그림자·떠오름이 잘리지 않게).
 *   - 접힘: 지금 높이 → 0 280ms + 살짝 위로 흐려짐. 끝나면 호출한 쪽이 언마운트.
 * 'none' 에서는 max-height 가 전환되지 않으므로 출발 높이를 숫자로 먼저 박고 한 번 계산시킨 뒤 목표값을 준다.
 *
 * DOM 만 다루는 순수 도우미 — node --test 가 그대로 import 하도록 런타임 의존이 없다.
 */

export const PART_DRAWER_MS = 280;
export const PART_DRAWER_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const FADE_TRANSITION = 'opacity 180ms ease, transform 220ms ease';
/** 서랍이 움직이는 동안의 전환. */
export const PART_DRAWER_TRANSITION = `max-height ${PART_DRAWER_MS}ms ${PART_DRAWER_EASE}, ${FADE_TRANSITION}`;
/**
 * 출발 높이를 박는 순간의 전환 — max-height 만 빼서 지금 높이에 멈춘다.
 * transition:none 으로 멈추면 접히며 흐려지던 투명도까지 끝값으로 튀었다가 다시 돌아온다.
 */
export const PART_DRAWER_HOLD = FADE_TRANSITION;
/** transitionend 가 오지 않을 때(출발=목표 높이 등)의 안전 마감. */
export const PART_DRAWER_FALLBACK_MS = PART_DRAWER_MS + 150;

type DrawerStyle = Pick<CSSStyleDeclaration, 'maxHeight' | 'overflow' | 'transition' | 'opacity' | 'transform'>;

export interface DrawerElement {
  style: DrawerStyle;
  readonly offsetHeight: number;
  readonly scrollHeight: number;
  getBoundingClientRect(): { height: number };
  addEventListener(type: 'transitionend', listener: (event: TransitionEvent) => void): void;
  removeEventListener(type: 'transitionend', listener: (event: TransitionEvent) => void): void;
}

export interface RunPartDrawerOptions {
  /** 방금 마운트된 서랍 — 높이 0 에서 출발한다. 아니면 지금 보이는 높이(접히던/펼치던 중 포함)에서 출발. */
  fromZero?: boolean;
  /** 끝까지 갔을 때 한 번. 취소되면 부르지 않는다. */
  onSettled?: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** 펼친 채 멈춘 모습 — 인라인 값을 모두 비운다(높이 제한 없음·넘침 허용). */
export function settlePartDrawerOpen(el: Pick<DrawerElement, 'style'>): void {
  el.style.maxHeight = '';
  el.style.overflow = '';
  el.style.transition = '';
  el.style.opacity = '';
  el.style.transform = '';
}

/**
 * 서랍을 펼치거나(open=true) 접는다. 돌려준 함수를 부르면 취소된다(반대로 다시 누름·언마운트).
 */
export function runPartDrawer(el: DrawerElement, open: boolean, options: RunPartDrawerOptions = {}): () => void {
  const {
    fromZero = false,
    onSettled,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  const start = fromZero ? 0 : el.getBoundingClientRect().height;
  el.style.overflow = 'hidden';
  el.style.transition = PART_DRAWER_HOLD;
  el.style.maxHeight = `${start}px`;
  if (open) {
    el.style.opacity = '';
    el.style.transform = '';
  }
  // 출발 높이를 한 번 계산시킨다 — 그래야 다음 max-height 가 '뚝'이 아니라 전환으로 이어진다.
  void el.offsetHeight;
  el.style.transition = PART_DRAWER_TRANSITION;
  if (open) {
    el.style.maxHeight = `${el.scrollHeight}px`;
  } else {
    el.style.maxHeight = '0px';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
  }

  let finished = false;
  const onEnd = (event: TransitionEvent) => {
    if ((event.target as unknown) === el && event.propertyName === 'max-height') finish();
  };
  const timer = setTimer(() => finish(), PART_DRAWER_FALLBACK_MS);
  el.addEventListener('transitionend', onEnd);

  function stop() {
    finished = true;
    el.removeEventListener('transitionend', onEnd);
    clearTimer(timer);
  }
  function finish() {
    if (finished) return;
    stop();
    if (open) settlePartDrawerOpen(el);
    onSettled?.();
  }

  return () => {
    if (!finished) stop();
  };
}
