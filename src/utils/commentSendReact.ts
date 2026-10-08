/**
 * 움직임 폴리싱 19번 `comments-send-react` — 댓글 보내기·이모지 반응의 손맛.
 *
 * 씬 상세·캐릭터 상세 댓글 패널(본문 댓글·답글·오른쪽 스레드 창)이 쓰는 판단과 움직임 묶음만 모았다.
 * - 보낸 말풍선은 입력칸 쪽(아래)에서 8px 떠올라 자리 잡는다(220ms). 처음 불러온 댓글은 움직이지 않는다.
 * - 저장이 0.4초를 넘길 때만 '보내는 중'(살짝 흐림 + 작은 시계). 평소엔 말풍선에 아무 표시 없이 끝난다.
 * - 실패하면 말풍선을 남기고 빨간 테두리 + '보내지 못했어요 · 다시 보내기 · 지우기'.
 *   다시 보내기는 같은 댓글(같은 id)을 처음과 같은 저장 길로 다시 보낸다.
 * - 반응 칩: 패널을 열 때 이미 있던 칩은 가만히, 새로 생긴 칩만 '톡'. 숫자는 늘면 위로·줄면 아래로 굴러 바뀌고,
 *   0 이 되면 쏙 줄어들며 빠진다.
 * - 이모지 창: 스마일 버튼 쪽에서 피어나고, '더 많은 이모지'는 버튼 쪽 가장자리를 붙인 채 펼쳐진다(위로 열렸으면 위로).
 *
 * 런타임 import 는 같은 폴더의 motion.ts(런타임 의존 없음)뿐이라 node --test 에서 바로 불러 쓴다
 * (tests/motion/comments-notify-comments-send-react.test.ts).
 */
import { EASE, MOTION_MS, transformPreset, type MotionPreset } from './motion.ts';
import type { TargetAndTransition } from 'framer-motion';

/** 저장이 이보다 오래 걸릴 때만 말풍선에 '보내는 중'을 표시한다. */
export const COMMENT_SLOW_SEND_MS = 400;
/** 보낸 말풍선이 떠오르는 길이(목업 기준 220ms). */
export const COMMENT_BUBBLE_RISE_MS = 220;
/** 반응을 모두 취소한 칩이 줄어들며 빠지는 길이. */
export const REACTION_CHIP_LEAVE_MS = 140;

/**
 * 아직 서버에 없는 내 댓글의 상태.
 * - sending: 보내는 중(0.4초 전 — 화면 표시 없음)
 * - slow: 0.4초를 넘겨 아직 보내는 중(살짝 흐림 + 시계)
 * - failed: 보내지 못함(빨간 테두리 + 다시 보내기·지우기)
 */
export type CommentSendStatus = 'sending' | 'slow' | 'failed';

/** 화면에 드러나는 상태만 남긴다('sending' 은 화면 표시가 없어 다시 그리지 않는다). */
export function visibleCommentSendStatus(status: CommentSendStatus | null | undefined): 'slow' | 'failed' | null {
  return status === 'slow' || status === 'failed' ? status : null;
}

/**
 * 말풍선에 붙일 클래스. 기본 클래스는 늘 붙어 있어야 '보내는 중' 흐림이 풀릴 때도 0.2초에 걸쳐 또렷해진다.
 * 평소(저장됨·보내는 중 0.4초 전)엔 상태 클래스가 없다.
 */
export function commentSendBubbleClass(status: CommentSendStatus | null | undefined): string {
  const visible = visibleCommentSendStatus(status);
  return visible ? `comment-send-bubble comment-send-bubble--${visible}` : 'comment-send-bubble';
}

/**
 * 다시 불러온 목록(서버)에 아직 서버에 없는 내 댓글(보내는 중·보내지 못함)을 끼워 넣는다.
 * 실시간 재조회가 보내는 중인 말풍선을 잠깐 지웠다 되살리거나, 실패한 말풍선을 지워 버리지 않게 한다.
 * 서버 목록에 같은 id 가 이미 있으면 그건 저장된 것이라 서버 쪽을 쓰고 `saved` 로 알려 준다.
 */
export function mergeUnsentComments<T extends { id: string; createdAt: string }>(
  server: readonly T[],
  unsent: readonly T[],
): { list: T[]; saved: string[] } {
  if (unsent.length === 0) return { list: [...server], saved: [] };
  const serverIds = new Set(server.map((c) => c.id));
  const saved: string[] = [];
  const missing: T[] = [];
  for (const c of unsent) {
    if (serverIds.has(c.id)) saved.push(c.id);
    else missing.push(c);
  }
  if (missing.length === 0) return { list: [...server], saved };
  const list = [...server, ...missing].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  return { list, saved };
}

/**
 * '다시 보내기'가 '같은 id 가 이미 있다'(기본 키 중복)로 거절됐는지. 앞서 보낸 요청이 저장은 됐는데 응답만 끊긴 경우라
 * 저장된 것으로 받아들인다(댓글 id 는 이 PC 가 만든 것이라 같은 id 는 같은 댓글이다).
 * 메인 쪽 오류는 문구로만 넘어온다 — Postgres 문구('duplicate key value violates unique constraint "comments_pkey"')와 코드 23505 를 본다.
 */
export function isCommentAlreadySavedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : String((err as { message?: unknown } | null)?.message ?? '');
  return /duplicate key|23505|comments_pkey/i.test(message);
}

/* ─── 말풍선 등장 ─────────────────────────────────────────────── */

const BUBBLE_RISE_FULL: MotionPreset = (() => {
  const preset = transformPreset({ from: 'translateY(8px)', duration: COMMENT_BUBBLE_RISE_MS });
  // 나갈 때는 제자리에서 옅어지기만 — 지우는 순간의 움직임은 다른 항목(safety-net)이 맡는다.
  return { ...preset, exit: { opacity: 0, transition: { duration: MOTION_MS.fast / 1000, ease: EASE.in } } };
})();
const BUBBLE_RISE_REDUCED: MotionPreset = transformPreset({ from: 'translateY(8px)' }, true);

/**
 * 새로 생긴 말풍선(본문·답글·스레드 창)과 활동 줄 — 입력칸 쪽(아래) 8px 에서 떠오른다.
 * AnimatePresence initial={false} 안에서 써서 처음 불러온 목록은 움직이지 않는다.
 * 동작 줄이기면 opacity 만 120ms.
 */
export function commentBubbleRise(reduce: boolean): MotionPreset {
  return reduce ? BUBBLE_RISE_REDUCED : BUBBLE_RISE_FULL;
}

/* ─── 반응 칩 ─────────────────────────────────────────────────── */

/**
 * 이번 그림에서 '톡' 할 칩. 지난 그림 때 이미 반응을 다 불러온 상태(armed)였고, 그때 없던 이모지만.
 * 패널을 열 때(반응을 처음 불러올 때)·말풍선이 새로 그려질 때 이미 있던 칩은 튀지 않는다.
 */
export function freshReactionEmojis(armed: boolean, seen: ReadonlySet<string>, current: readonly string[]): Set<string> {
  if (!armed) return new Set();
  return new Set(current.filter((emoji) => !seen.has(emoji)));
}

/** 숫자 굴림 방향 — 늘면 위로(새 숫자가 아래에서), 줄면 아래로(새 숫자가 위에서). 같으면 없음. */
export function reactionCountRollDirection(prev: number, next: number): 'up' | 'down' | null {
  if (next > prev) return 'up';
  if (next < prev) return 'down';
  return null;
}

/** 칩이 머무는 모습. 빠지는 도중 다시 눌러 되돌아올 때 크기를 제자리로 돌린다. */
export const REACTION_CHIP_REST: TargetAndTransition = {
  opacity: 1,
  transform: 'scale(1)',
  transitionEnd: { transform: 'none' },
};

/**
 * 칩 바깥 칸의 시작 모습 = 머무는 모습(transitionEnd 없이). 바깥 칸은 처음 그릴 때 움직이지 않는다 — '톡'은 안쪽 칩(CSS)만 한다.
 * initial={false} 는 이미 그려진 말풍선 안에 나중에 생긴 칩에선 무시되고, 'none' 에서 출발해 scale(0)→1 로 0.3초 자라
 * 안쪽 '톡'(0.4→1.07→1)을 덮었다. 시작 값을 머무는 값과 같게 두면 framer 가 움직일 게 없어 건너뛴다.
 */
export const REACTION_CHIP_START = { opacity: 1, transform: 'scale(1)' } as const;

const CHIP_LEAVE_FULL: TargetAndTransition = {
  opacity: 0,
  // 'none' 에서 출발하면 framer 가 scale(0) 에서 출발시킨다 — 제자리 값을 명시한다.
  transform: ['scale(1)', 'scale(0.6)'],
  transition: { duration: REACTION_CHIP_LEAVE_MS / 1000, ease: EASE.in },
};
const CHIP_LEAVE_REDUCED: TargetAndTransition = {
  opacity: 0,
  transition: { duration: MOTION_MS.fast / 1000, ease: EASE.std },
};

/** 반응을 모두 취소한 칩 — 0.6배로 줄며 옅어진 뒤(140ms) 빠진다. 동작 줄이기면 옅어지기만. */
export function reactionChipExit(reduce: boolean): TargetAndTransition {
  return reduce ? CHIP_LEAVE_REDUCED : CHIP_LEAVE_FULL;
}

/* ─── 이모지 창 자리 ──────────────────────────────────────────── */

export interface EmojiPickerAnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface EmojiPickerPlacementInput {
  anchor: EmojiPickerAnchorRect | null;
  viewportWidth: number;
  viewportHeight: number;
  /** 지금 창 너비(빠른 7개 220 / 더 보기 280). */
  width: number;
  /**
   * 펼쳤을 때 너비(더 보기 280). 주면 처음 열 때부터 펼친 너비도 화면 안에 들어갈 왼쪽 자리를 잡아 둔다 —
   * 화면 오른쪽 끝 가까이서 '더 많은 이모지'를 눌러도 창이 왼쪽으로 튀지 않고 오른쪽으로만 넓어진다.
   */
  expandedWidth?: number;
  /** 위·아래를 정할 때 쓰는 접힌 창 높이 추정(빠른 7개). 펼쳐도 이 값으로 정해 창이 반대쪽으로 튀지 않는다. */
  collapsedHeight?: number;
  gap?: number;
  margin?: number;
}

export interface EmojiPickerPlacement {
  side: 'above' | 'below';
  left: number;
  /** side='below' 일 때 위 가장자리(버튼 바로 아래). */
  top?: number;
  /** side='above' 일 때 아래 가장자리(버튼 바로 위)를 화면 아래에서 잰 값 — 펼치면 위로 커진다. */
  bottom?: number;
  /** 버튼 반대쪽 화면 끝까지 남은 높이. 넘치면 창 안에서 스크롤. */
  maxHeight: number;
  /** 피어나는 기준점 x(창 왼쪽에서 잰 버튼 가운데). */
  originX: number;
}

/**
 * 이모지 창 자리. 기본은 버튼 위, 위에 접힌 창이 들어갈 자리도 없을 때만 아래.
 * 버튼 쪽 가장자리를 고정하므로 '더 많은 이모지'로 커져도 버튼 옆에 붙은 채 반대쪽으로만 자란다
 * (예전에는 펼칠 때 높이 추정 80→320 으로 위치를 다시 계산해 창이 위로 튀었다).
 */
export function emojiPickerPlacement(input: EmojiPickerPlacementInput): EmojiPickerPlacement {
  const { anchor, viewportWidth, viewportHeight, width } = input;
  const collapsedHeight = input.collapsedHeight ?? 80;
  const gap = input.gap ?? 8;
  const margin = input.margin ?? 8;
  if (!anchor) {
    return { side: 'below', left: margin, top: margin, maxHeight: Math.max(0, viewportHeight - margin * 2), originX: 0 };
  }
  const expandedWidth = Math.max(width, input.expandedWidth ?? width);
  // 펼친 너비까지 화면 안에 들어갈 왼쪽 — 펼칠 때 왼쪽 끝이 그대로다. 단 버튼(오른쪽 끝까지)은 지금 창 폭 안에 둔다.
  let left = Math.min(anchor.left, viewportWidth - expandedWidth - margin);
  left = Math.max(left, anchor.left + anchor.width - width);
  if (left + width > viewportWidth - margin) left = viewportWidth - width - margin;
  if (left < margin) left = margin;
  const originX = Math.round(Math.min(width, Math.max(0, anchor.left + anchor.width / 2 - left)));
  const aboveRoom = anchor.top - gap - margin;
  if (aboveRoom >= collapsedHeight) {
    return { side: 'above', left, bottom: viewportHeight - (anchor.top - gap), maxHeight: aboveRoom, originX };
  }
  const top = anchor.bottom + gap;
  return { side: 'below', left, top, maxHeight: Math.max(0, viewportHeight - top - margin), originX };
}
