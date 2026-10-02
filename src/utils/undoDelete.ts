/**
 * 움직임 폴리싱 20번 `safety-net` 중 '되돌리기' — 알림 창 '전체 삭제'와 댓글 휴지통.
 *
 * - 알림 '전체 삭제': 줄들이 0.15초에 옅어지고 빈 창이 된 뒤 오른쪽 아래에 '알림을 모두 지웠어요 · 되돌리기'.
 *   누르면 지운 알림이 그대로(읽음 표시까지) 돌아오고 줄들이 0.18초에 다시 나타난다. 로컬 목록만 되살린다.
 * - 댓글 휴지통: 말풍선이 오른쪽 12px 로 밀리며 0.15초에 사라지고, 아래 말풍선들이 그 자리로 0.22초에 올라온다.
 *   5초 동안 '댓글을 지웠어요 · 되돌리기'. 서버에서는 5초가 지나야 지운다. 그 사이 다른 씬으로 넘어가거나
 *   창을 닫으면(트레이로 숨기·최소화 포함) 기다리지 않고 바로 지운다.
 * - 알림 카드 아래 2px 막대가 5초 동안 줄어든다(동작 줄이기면 줄지 않고 옅어지기만).
 *
 * 런타임 import 는 같은 폴더의 motion.ts(런타임 의존 없음)뿐이라 node --test 에서 바로 불러 쓴다
 * (tests/motion/comments-notify-safety-net-undo.test.ts).
 */
import { EASE, EASE_CSS, MOTION_MS, fadePreset, type MotionPreset } from './motion.ts';

/** '되돌리기'를 누를 수 있는 시간. 댓글은 이 시간이 지나야 서버에서 지운다. */
export const UNDO_WINDOW_MS = 5000;

/** 알림 '전체 삭제' — 줄들이 옅어지는 길이(사라질 때 곡선 in). */
export const NOTIFICATION_CLEAR_FADE_MS = 150;
/** 알림 되돌리기 — 줄들이 다시 나타나는 길이(곡선 out). */
export const NOTIFICATION_RESTORE_FADE_MS = 180;

/** 댓글 휴지통 — 말풍선이 오른쪽으로 12px 밀리며 옅어진다(150ms, 곡선 in). */
export const COMMENT_DELETE_EXIT_MS = 150;
export const COMMENT_DELETE_EXIT_KEYFRAMES: Keyframe[] = [
  { opacity: 1, transform: 'translateX(0px)' },
  { opacity: 0, transform: 'translateX(12px)' },
];
/** 지운 자리로 아래 말풍선들이 올라오는(되돌리면 비켜 주는) 길이와 곡선 — 220ms, out. */
export const COMMENT_REFLOW_MS = 220;
export const COMMENT_REFLOW_EASING = EASE_CSS.out;
/** 줄 미끄러짐 WAAPI 의 id — 다음 미끄러짐이 시작될 때 이전 것만 골라 멈춘다. */
export const COMMENT_REFLOW_ANIMATION_ID = 'comment-reflow';

/* ─── 되돌리기 창 ─────────────────────────────────────────────── */

export type UndoOutcome = 'undone' | 'expired';

export interface UndoWindow {
  /** 되돌린다. 아직 정해지지 않았을 때만 — 되돌렸으면 true. */
  undo(): boolean;
  /** 기다리지 않고 지금 확정한다(창 닫기·다른 씬 이동·알림 카드 닫기). 확정했으면 true. */
  expire(): boolean;
  /** 정해진 결과. 아직이면 null. */
  readonly outcome: UndoOutcome | null;
}

export interface UndoWindowOptions {
  durationMs?: number;
  onUndo: () => void;
  onExpire: () => void;
  /** 어느 쪽으로든 정해진 직후 한 번(알림 카드 닫기 등). */
  onSettle?: (outcome: UndoOutcome) => void;
  /** 테스트용 시계. 기본은 setTimeout/clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * '되돌리기' 시간 창. durationMs 가 지나면 확정(onExpire), 그 전에 undo() 면 되돌림(onUndo).
 * 결과는 딱 한 번만 정해진다 — 되돌린 뒤의 확정, 확정한 뒤의 되돌림, 두 번째 확정은 모두 무시한다.
 */
export function createUndoWindow(options: UndoWindowOptions): UndoWindow {
  const {
    durationMs = UNDO_WINDOW_MS,
    onUndo,
    onExpire,
    onSettle,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;
  let outcome: UndoOutcome | null = null;
  let handle: unknown = null;

  const settle = (next: UndoOutcome): boolean => {
    if (outcome) return false;
    outcome = next;
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
    try {
      if (next === 'undone') onUndo();
      else onExpire();
    } finally {
      onSettle?.(next);
    }
    return true;
  };

  handle = setTimer(() => {
    handle = null;
    settle('expired');
  }, durationMs);

  return {
    undo: () => settle('undone'),
    expire: () => settle('expired'),
    get outcome() {
      return outcome;
    },
  };
}

/* ─── 알림 '전체 삭제' 되돌리기 ───────────────────────────────── */

/**
 * 되살릴 목록 — 그 사이 새로 온 알림(current, 더 새것)은 위에 그대로 두고, 지운 알림(snapshot)은 원래 순서대로 그 아래.
 * 같은 id 는 새 쪽(current)을 남긴다. 같은 알림 묶음(identity) 정리와 50개 제한은 저장소가 이어서 한다.
 */
export function mergeRestoredList<T extends { id: string }>(current: readonly T[], snapshot: readonly T[]): T[] {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...snapshot.filter((item) => !ids.has(item.id))];
}

/** 되돌리기를 누른 순간 — 알림 창이 열려 있으면 다음 그림에서 줄들을 다시 나타나게 한다. */
let restoreFadeMarkedAt = Number.NEGATIVE_INFINITY;
/** 되돌리기 표시가 유효한 시간 — 그 뒤에 창을 열면 그냥 연다(창 자체가 피어나므로). */
export const RESTORE_FADE_TTL_MS = 1000;

export function markNotificationRestoreFade(now: number = Date.now()): void {
  restoreFadeMarkedAt = now;
}

/** 표시를 꺼내 쓴다(한 번만 true). */
export function takeNotificationRestoreFade(now: number = Date.now()): boolean {
  const hit = now - restoreFadeMarkedAt <= RESTORE_FADE_TTL_MS;
  restoreFadeMarkedAt = Number.NEGATIVE_INFINITY;
  return hit;
}

/* ─── 댓글 지연 삭제 ─────────────────────────────────────────── */

/** 다시 불러온 목록에서 지우는 중(되돌리기 대기·서버 삭제 중)인 댓글을 뺀다 — 실시간 재조회로 되살아나지 않게. */
export function withoutPendingDeletes<T extends { id: string }>(list: readonly T[], pending: { has(id: string): boolean }): T[] {
  return list.filter((item) => !pending.has(item.id));
}

/**
 * 되돌린 댓글을 시간 순서 제자리에 다시 넣는다(같은 시각이면 그 뒤에). 이미 있으면 목록을 그대로 돌려준다.
 */
export function insertCommentByTime<T extends { id: string; createdAt: string }>(list: readonly T[], comment: T): T[] {
  if (list.some((item) => item.id === comment.id)) return list as T[];
  const at = new Date(comment.createdAt).getTime();
  const index = list.findIndex((item) => new Date(item.createdAt).getTime() > at);
  if (index < 0) return [...list, comment];
  return [...list.slice(0, index), comment, ...list.slice(index)];
}

const COMMENT_RESTORE_FULL: MotionPreset = {
  ...fadePreset(NOTIFICATION_RESTORE_FADE_MS, EASE.out),
  // 나갈 때는 다른 말풍선과 같이 제자리에서 옅어지기만(120ms, in).
  exit: { opacity: 0, transition: { duration: MOTION_MS.fast / 1000, ease: EASE.in } },
};
const COMMENT_RESTORE_REDUCED: MotionPreset = fadePreset(MOTION_MS.fast);

/** 되돌린 말풍선 — 떠오르지 않고 제자리에서 다시 나타난다(180ms). 동작 줄이기면 120ms. */
export function commentRestoreFade(reduce: boolean): MotionPreset {
  return reduce ? COMMENT_RESTORE_REDUCED : COMMENT_RESTORE_FULL;
}

/* ─── 줄 위치 재기(FLIP) ─────────────────────────────────────── */

export interface FlipRowPosition {
  key: string;
  top: number;
  /** 같은 표시를 가진 가장 가까운 바깥 줄(답글 → 부모 말풍선). 바깥 줄과 함께 움직인 만큼은 빼고 민다. */
  parentKey: string | null;
}

/**
 * root 안에서 attribute 를 가진 줄들의 지금 위치. 숨은 줄(display:none — 지우는 중인 말풍선과 그 안 답글)은 뺀다.
 */
export function measureFlipRows(root: ParentNode | null | undefined, attribute: string): FlipRowPosition[] {
  if (!root) return [];
  const rows: FlipRowPosition[] = [];
  root.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach((element) => {
    if (element.getClientRects().length === 0) return;
    rows.push({
      key: element.getAttribute(attribute) ?? '',
      top: element.getBoundingClientRect().top,
      parentKey: element.parentElement?.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null,
    });
  });
  return rows;
}
