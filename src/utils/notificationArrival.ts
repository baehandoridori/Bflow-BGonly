/* ═══════════════════════════════════════════════════════════════
   알림이 와서 → 열고 → 건너뛰어 → 도착하기까지 (움직임 폴리싱 18번 notification-journey)

   종·배지가 반응하는 기준
   - '실시간으로 방금 온' 알림만 반응한다. 실시간 수신 경로(dispatchNotification 등)가 안 읽은 수를 늘렸을 때만
     markLiveNotificationArrival 을 부른다. 앱 시작 때 디스크에서 불러오는 알림·놓친 알림 모으기·계정 전환은
     이 신호를 내지 않으므로 종이 흔들리지 않는다.
   - 나를 직접 부른 알림(멘션·담당 배정·피드백 요청, 나를 지정한 새 리테이크·리테이크 다시 알림)만 종이 '딩동'
     흔들리고, 나머지는 배지만 '톡'.
   - 여러 개가 한꺼번에 와도 반응은 한 번 — 종 흔들림과 배지 톡은 각자 1초에 한 번까지.

   종 주변의 은은한 빛(notification-bell.css, v1.127.5)은 상태 기반이라 여기서 건드리지 않는다.
   node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
   ═══════════════════════════════════════════════════════════════ */

/** 나를 직접 부른 알림 — 종 '딩동' 대상. (일정 알림은 종의 강한 빛 대상이지만 흔들지는 않는다) */
export const CALLS_ME_NOTIFICATION_TYPES: ReadonlySet<string> = new Set(['mention', 'acting_feedback', 'scene_assignment']);

/**
 * 리테이크 알림 중 나를 직접 부른 것 — 나를 담당·알림 대상으로 지정한 새 리테이크('add')와 누군가 다시 알려 준 것('reminder').
 * 담당 완료·진행 상태 같은 자동 알림은 배지만 '톡'.
 */
export const CALLS_ME_REVISION_ACTIONS: ReadonlySet<string> = new Set(['add', 'reminder']);

export function isCallingMeNotification(type: string, metadata?: { revisionAction?: unknown } | null): boolean {
  if (CALLS_ME_NOTIFICATION_TYPES.has(type)) return true;
  return type === 'revision'
    && typeof metadata?.revisionAction === 'string'
    && CALLS_ME_REVISION_ACTIONS.has(metadata.revisionAction);
}

/** 종 흔들림 제한 — 1초에 한 번. */
export const BELL_RING_THROTTLE_MS = 1000;
/** 배지 톡 제한 — 종과 따로 1초에 한 번. */
export const BADGE_POP_THROTTLE_MS = 1000;
/** 신호 유효 시간 — 종이 화면에 없을 때 온 신호를 한참 뒤에 엉뚱하게 터뜨리지 않는다. */
export const LIVE_ARRIVAL_TTL_MS = 1500;

export interface LiveArrival {
  /** 묶인 신호 중 하나라도 나를 부른 알림이면 true. */
  callsMe: boolean;
  at: number;
  /** 신호를 낸 순간의 알림 계정 — 그사이 계정이 바뀌었으면 버린다. */
  userId: string | null;
}

/** 아직 처리 안 된 신호에 새 신호를 합친다(같은 계정·유효 시간 안이면 하나로). */
export function mergeLiveArrival(
  prev: LiveArrival | null,
  type: string,
  userId: string | null,
  now: number,
  metadata?: { revisionAction?: unknown } | null,
): LiveArrival {
  const callsMe = isCallingMeNotification(type, metadata);
  if (prev && prev.userId === userId && now - prev.at <= LIVE_ARRIVAL_TTL_MS) {
    return { callsMe: prev.callsMe || callsMe, at: now, userId };
  }
  return { callsMe, at: now, userId };
}

let pendingArrival: LiveArrival | null = null;
const arrivalListeners = new Set<() => void>();

/** 실시간으로 방금 받은 알림이 안 읽은 수를 늘렸을 때 부른다. metadata 는 리테이크 알림이 나를 부른 것인지 가릴 때 쓴다. */
export function markLiveNotificationArrival(
  type: string,
  userId: string | null,
  now: number = Date.now(),
  metadata?: { revisionAction?: unknown } | null,
): void {
  pendingArrival = mergeLiveArrival(pendingArrival, type, userId, now, metadata);
  arrivalListeners.forEach((listener) => {
    try { listener(); } catch { /* 반응 실패가 알림 수신을 막지 않게 */ }
  });
}

/** 쌓인 신호를 한 번만 꺼낸다. 다른 계정 것이거나 오래됐으면 버리고 null. */
export function takeLiveNotificationArrival(userId: string | null, now: number = Date.now()): LiveArrival | null {
  const arrival = pendingArrival;
  pendingArrival = null;
  if (!arrival || arrival.userId !== userId || now - arrival.at > LIVE_ARRIVAL_TTL_MS) return null;
  return arrival;
}

export function subscribeLiveNotificationArrival(listener: () => void): () => void {
  arrivalListeners.add(listener);
  return () => { arrivalListeners.delete(listener); };
}

export interface BellReactionClock {
  lastRingAt: number;
  lastPopAt: number;
}

export const INITIAL_BELL_CLOCK: BellReactionClock = Object.freeze({ lastRingAt: -Infinity, lastPopAt: -Infinity });

/** 이번 도착에 종을 흔들지·배지를 톡 할지. 두 제한은 서로 따로 센다. */
export function decideBellReaction(
  arrival: Pick<LiveArrival, 'callsMe'>,
  clock: BellReactionClock,
  now: number,
): { ring: boolean; pop: boolean; clock: BellReactionClock } {
  const ring = arrival.callsMe && now - clock.lastRingAt >= BELL_RING_THROTTLE_MS;
  const pop = now - clock.lastPopAt >= BADGE_POP_THROTTLE_MS;
  return {
    ring,
    pop,
    clock: { lastRingAt: ring ? now : clock.lastRingAt, lastPopAt: pop ? now : clock.lastPopAt },
  };
}

/* ─── 움직임 값 (사양: 설계 문서 18번 수치) ───────────────────── */

/** 종 '딩동' — 좌우로 짧게(축 50% 15%, 600ms ease-out). */
export const BELL_RING_DEGREES = [0, 18, -14, 9, -4, 0] as const;
export const BELL_RING_KEYFRAMES: Keyframe[] = BELL_RING_DEGREES.map((deg) => ({ transform: `rotate(${deg}deg)` }));
export const BELL_RING_MS = 600;
export const BELL_RING_ORIGIN = '50% 15%';

/** 배지 톡 — 1 → 1.28 → 1, 260ms, 살짝 넘치는 곡선. */
export const BADGE_POP_KEYFRAMES: Keyframe[] = [{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }];
export const BADGE_POP_MS = 260;
export const BADGE_POP_EASING = 'cubic-bezier(0.18, 0.88, 0.34, 1.28)';

/** 배지 숫자 굴림 — 늘면 아래에서, 줄면 위에서 굴러 들어온다(150ms). */
export const BADGE_ROLL_MS = 150;
export function badgeRollKeyframes(direction: 'up' | 'down'): Keyframe[] {
  return [{ transform: `translateY(${direction === 'up' ? 70 : -70}%)` }, { transform: 'translateY(0)' }];
}

/** 지운 줄 — 오른쪽으로 24px 밀려나며 사라짐(150ms). 아래 줄은 36px 아래에서 미끄러져 올라옴(220ms out). */
export const NOTIFICATION_ROW_EXIT_KEYFRAMES: Keyframe[] = [
  { opacity: 1, transform: 'translateX(0)' },
  { opacity: 0, transform: 'translateX(24px)' },
];
export const NOTIFICATION_ROW_EXIT_MS = 150;
export const NOTIFICATION_ROW_SHIFT_MS = 220;

/** 도착한 줄 — 보라 테두리가 두 번 은은하게 켜졌다 꺼짐(1.4초). 동작 줄이기면 1.4초 동안 정지 표시. */
export const ARRIVAL_RING_MS = 1400;
export function arrivalRingKeyframes(reduce: boolean): Keyframe[] {
  return reduce
    ? [{ opacity: 0.9 }, { opacity: 0.9 }]
    : [{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }];
}

/** 도착 테두리를 켠다. 다시 도착하면 처음부터 다시(WAAPI 라 클래스 토글 깜빡임이 없다). */
export function playArrivalRing(el: Element | null | undefined, reduce: boolean): Animation | null {
  if (!el || typeof (el as { animate?: unknown }).animate !== 'function') return null;
  el.getAnimations?.().forEach((animation) => animation.cancel());
  return el.animate(arrivalRingKeyframes(reduce), { duration: ARRIVAL_RING_MS, easing: 'ease-in-out' });
}

/* ─── 씬 목록 강조 카드로 데려다주기 — 한 강조에 한 번 ────────── */

/** 씬 목록 강조가 켜져 있는 시간(ScenesView 의 자동 해제 4초)과 같다. */
export const HIGHLIGHT_SCROLL_ONCE_MS = 4000;
let lastHighlightScroll: { key: string; at: number } | null = null;

/**
 * 강조 한 번을 가리는 열쇠 — 씬 번호만으로는 다른 파트의 같은 번호 씬(EP05_A 의 a001 → EP05_B 의 a001)을 같은 강조로 봐서
 * 4초 안에 이어 건너뛰면 두 번째 카드로 데려다주지 않았다. 시트(파트) 이름을 함께 쓴다.
 */
export function highlightScrollKey(sheetNames: ReadonlyArray<string | null | undefined>, sceneId: string): string {
  return `${sheetNames.map((name) => name ?? '').join('|')}::${sceneId}`;
}

/**
 * 강조된 카드가 스크롤을 데려가도 되는지. 같은 강조(같은 파트의 같은 씬, highlightScrollKey)는 4초 안에 한 번만 — 카드가 다시 마운트돼도
 * (목록 다시 그리기·보기 전환) 사용자가 스크롤한 자리에서 다시 끌어당기지 않는다.
 */
export function claimHighlightScroll(key: string, now: number = Date.now()): boolean {
  if (lastHighlightScroll && lastHighlightScroll.key === key && now - lastHighlightScroll.at < HIGHLIGHT_SCROLL_ONCE_MS) return false;
  lastHighlightScroll = { key, at: now };
  return true;
}

/* ─── 지운 뒤 아래 줄이 미끄러져 올라오기(FLIP) ───────────────── */

export interface NotificationRowPosition {
  key: string;
  top: number;
  /** 바로 바깥의 움직이는 줄(묶음) — 안쪽 줄은 묶음이 움직인 만큼을 빼고 자기 몫만 움직인다. */
  parentKey: string | null;
}

/**
 * 지우기 전 위치(before)와 지운 뒤 위치(after)로 각 줄이 되돌아가 있어야 할 거리(px)를 구한다.
 * 묶음 안의 줄은 묶음과 함께 움직이므로 자기 몫(절대 이동 − 묶음 이동)만 남긴다. 1px 미만은 뺀다.
 */
export function notificationRowShifts(
  before: ReadonlyMap<string, number>,
  after: readonly NotificationRowPosition[],
): Map<string, number> {
  const absolute = new Map<string, number>();
  for (const row of after) {
    const previous = before.get(row.key);
    if (previous !== undefined) absolute.set(row.key, previous - row.top);
  }
  const shifts = new Map<string, number>();
  for (const row of after) {
    const own = absolute.get(row.key);
    if (own === undefined) continue;
    const parentShift = row.parentKey ? absolute.get(row.parentKey) ?? 0 : 0;
    const shift = own - parentShift;
    if (Math.abs(shift) >= 1) shifts.set(row.key, shift);
  }
  return shifts;
}

/** 알림 카드(오른쪽 아래) 종류별 클래스 — 왼쪽 색 막대 색을 정한다(motion-comments-notify.css). */
export function notificationToastClassName(type: string): string {
  return `bflow-toast--${type}`;
}
