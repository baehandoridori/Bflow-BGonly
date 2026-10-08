/* ═══════════════════════════════════════════════════════════════
   계속 움직이는 배경을 '지금 움직여도 되는가' (움직임 폴리싱 바탕 C, 2026-10)

   배경(대시보드·로그인 플렉서스, StarNest 두 종)은 B flow 를 보고 있을 때만 움직이면 된다.
   - 창이 가려짐(최소화·다른 탭)        → 바로 멈춤(어차피 안 보인다)
   - 위젯을 끌거나 크기를 바꾸는 중      → 0.3초에 걸쳐 멈춤(끌기에 컴퓨터를 양보)
   - 다른 프로그램을 쓰는 중(포커스 없음) → 1.5초에 걸쳐 천천히 멈춤
   - 다시 B flow 로 돌아오면             → 0.6초에 걸쳐 다시 움직임
   실제 감쇠·잠재우기는 frameLoop.ts 의 setActive 가 맡고, 이 파일은 상태를 모아 목표를 정한다.

   node --test 가 그대로 import 하도록 런타임 의존이 없다(창이 없는 환경에서는 늘 '움직여도 됨').
   ═══════════════════════════════════════════════════════════════ */

/** 배경 루프의 초당 최대 장 수. */
export const BACKGROUND_LOOP_MAX_FPS = 30;

/** 멈추고 이어 가는 데 걸리는 시간(ms). */
export const BACKGROUND_FADE_MS = Object.freeze({
  /** 다른 프로그램으로 옮겨 갔을 때 — 1~2초에 걸쳐 천천히 멈춘다. */
  blur: 1500,
  /** 위젯 끌기·크기 바꾸기 중. */
  hold: 300,
  /** 다시 움직일 때. */
  resume: 600,
});

export interface BackgroundActivityState {
  /** 창이 보이는지(document.visibilityState). */
  visible: boolean;
  /** 이 창이 키보드 포커스를 갖고 있는지(document.hasFocus()). */
  focused: boolean;
  /** 끌기처럼 잠시 멈춰 달라는 요청이 있는지. */
  held: boolean;
}

export interface BackgroundActivityTarget {
  active: boolean;
  fadeMs: number;
}

export function resolveBackgroundActivity(state: BackgroundActivityState): BackgroundActivityTarget {
  if (!state.visible) return { active: false, fadeMs: 0 };
  if (state.held) return { active: false, fadeMs: BACKGROUND_FADE_MS.hold };
  if (!state.focused) return { active: false, fadeMs: BACKGROUND_FADE_MS.blur };
  return { active: true, fadeMs: BACKGROUND_FADE_MS.resume };
}

/**
 * 첫 진입 덮개('Bflow.' 화면·로그인 카드) 아래에 미리 그린 대시보드 배경 — 덮개가 내려와 있는 동안은
 * 첫 장만 그리고 바로 쉰다(가려져 안 보이는데 초당 30장을 그리지 않게). 덮개가 걷히기 시작하면 창 상태대로
 * 서서히 이어 간다. 보이는 로그인 배경에는 쓰지 않는다(holdBackgroundLoops 는 전역이라 그것까지 멈춘다).
 */
export function withEntryCurtainHold(target: BackgroundActivityTarget, curtainDown: boolean): BackgroundActivityTarget {
  return curtainDown ? { active: false, fadeMs: 0 } : target;
}

/* ─── 잠시 멈춤 요청(위젯 끌기 등) ─────────────────────────────── */

let holdCount = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

/**
 * 배경 움직임을 잠시 멈춰 달라고 요청한다. 돌려받은 함수를 부르면 요청을 푼다(여러 번 불러도 한 번만 푼다).
 * 여러 곳이 동시에 요청하면 모두 풀릴 때까지 멈춘다.
 *   useEffect(() => (dragging ? holdBackgroundLoops() : undefined), [dragging]);
 */
export function holdBackgroundLoops(): () => void {
  holdCount += 1;
  if (holdCount === 1) notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holdCount = Math.max(0, holdCount - 1);
    if (holdCount === 0) notify();
  };
}

export function isBackgroundLoopHeld(): boolean {
  return holdCount > 0;
}

/* ─── 창 상태 읽기·구독 ──────────────────────────────────────── */

type DocLike = { visibilityState?: string; hasFocus?: () => boolean; addEventListener?: Document['addEventListener']; removeEventListener?: Document['removeEventListener'] };
type WinLike = { addEventListener?: Window['addEventListener']; removeEventListener?: Window['removeEventListener'] };

function currentDocument(): DocLike | null {
  return typeof document === 'undefined' ? null : (document as unknown as DocLike);
}

function currentWindow(): WinLike | null {
  return typeof window === 'undefined' ? null : (window as unknown as WinLike);
}

/** 지금 창 상태로 정한 목표. 창이 없는 환경에서는 '보이고 포커스 있음'으로 본다. */
export function readBackgroundActivity(): BackgroundActivityTarget {
  const doc = currentDocument();
  let focused = true;
  try {
    if (doc && typeof doc.hasFocus === 'function') focused = doc.hasFocus();
  } catch {
    focused = true;
  }
  return resolveBackgroundActivity({
    visible: !doc || doc.visibilityState !== 'hidden',
    focused,
    held: isBackgroundLoopHeld(),
  });
}

let detachWindowEvents: (() => void) | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

/** blur 직후에는 포커스가 창 안의 다른 틀로 옮겨 가는 중일 수 있어, 한 틱 뒤에 다시 읽는다. */
function scheduleNotify() {
  if (notifyTimer !== null) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    notify();
  }, 0);
}

function attachWindowEvents() {
  const win = currentWindow();
  const doc = currentDocument();
  if (!win?.addEventListener || !doc?.addEventListener) return;
  win.addEventListener('focus', scheduleNotify);
  win.addEventListener('blur', scheduleNotify);
  doc.addEventListener('visibilitychange', scheduleNotify);
  detachWindowEvents = () => {
    win.removeEventListener?.('focus', scheduleNotify);
    win.removeEventListener?.('blur', scheduleNotify);
    doc.removeEventListener?.('visibilitychange', scheduleNotify);
  };
}

/**
 * 창 포커스·가시성·잠시 멈춤 요청이 바뀌면 listener 를 부른다(값은 readBackgroundActivity 로 읽는다).
 * 창 이벤트는 첫 구독 때 붙이고 마지막 구독이 풀리면 뗀다.
 */
export function subscribeBackgroundActivity(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && !detachWindowEvents) attachWindowEvents();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detachWindowEvents?.();
      detachWindowEvents = null;
      if (notifyTimer !== null) {
        clearTimeout(notifyTimer);
        notifyTimer = null;
      }
    }
  };
}

/** 테스트용: 모든 요청·구독을 지운다. */
export function resetBackgroundActivityForTest() {
  holdCount = 0;
  listeners.clear();
  detachWindowEvents?.();
  detachWindowEvents = null;
  if (notifyTimer !== null) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
}
