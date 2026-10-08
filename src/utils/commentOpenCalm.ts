/**
 * 움직임 폴리싱 4번 `comment-open-calm` — 댓글 칸을 열 때 차분하게.
 *
 * 씬 상세(←/→ 로 씬을 넘길 때마다 패널이 새로 만들어진다)·캐릭터 상세의 댓글 패널이 쓰는 판단만 모았다.
 * - 불러오는 동안: 0.15초 안에 오면 아무것도 안 보이고, 넘기면 회색 말풍선 자리. '의견 없음'은 정말 없을 때만,
 *   실패하면 '댓글을 불러오지 못했어요 · 다시 불러오기'. 이미 보여 준 목록은 뒤이은 실패로 지우지 않는다.
 * - 처음 열 때: 맨 아래(최신)에, 새 댓글이 있으면 '새 댓글' 줄을 화면 가운데에 둔 채 나타난다(위에서 미끄러지지 않음).
 * - '새 댓글' 줄: 읽음 처리는 지금처럼 곧바로, 줄은 그 뒤 4초 동안 남았다가 자리를 지킨 채 옅어진다.
 * - 위로 올려 읽는 중 새 댓글이 오면 끌어내리지 않고 '새 댓글 N개 ↓' 알약으로 알린다.
 *
 * 런타임 import 가 없어 node --test 에서 바로 불러 쓴다(tests/motion/comments-notify-comment-open-calm.test.ts).
 */

/** 이 시간 안에 댓글이 오면 자리표시(회색 말풍선)도 보이지 않는다. CSS animation-delay 와 같은 값. */
export const COMMENT_SKELETON_DELAY_MS = 150;
/** '새 댓글' 줄이 읽음 처리된 뒤 옅어지기 시작할 때까지. */
export const COMMENT_UNREAD_DIVIDER_FADE_DELAY_MS = 4000;
/** 바닥에서 이만큼 안이면 '바닥 근처'로 보고 새 댓글을 따라 내려간다. */
export const COMMENT_NEAR_BOTTOM_PX = 80;
/** 바닥에 붙어 있다고 보는 여유. 이 안이면 내용이 커져도 곧바로(움직임 없이) 바닥에 다시 붙인다. */
export const COMMENT_STICK_BOTTOM_PX = 8;
/** 처음 연 뒤 반응·이미지로 높이가 늘어나는 동안 자리를 지켜 주는 시간(사용자가 휠·포인터를 쓰면 즉시 끝). */
export const COMMENT_OPEN_PIN_WINDOW_MS = 1000;
/** 댓글은 왔는데 읽음 기록만 늦으면 이만큼 기다린 뒤 '새 댓글' 줄 없이 먼저 보여 준다(목록을 무작정 가리지 않음). */
export const COMMENT_READ_STATE_WAIT_MS = 1500;

export type CommentLoadStatus = 'loading' | 'ready' | 'error';

/** 조회가 끝났을 때 다음 상태. 한 번 보여 준 목록(ready)은 뒤이은 실패(실시간 재조회 등)로 오류 화면이 되지 않는다. */
export function commentLoadStatusAfter(prev: CommentLoadStatus, outcome: 'success' | 'failure'): CommentLoadStatus {
  if (outcome === 'success') return 'ready';
  return prev === 'ready' ? 'ready' : 'error';
}

export interface CommentScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function commentListDistanceFromBottom(m: CommentScrollMetrics): number {
  return Math.max(0, m.scrollHeight - m.clientHeight - m.scrollTop);
}

/** 목록 내용 기준 위치(px) — 스크롤 상자 맨 위에서 잰 top 과 높이. */
export interface CommentScrollAnchor {
  top: number;
  height: number;
}

/**
 * 처음 열 때 둘 scrollTop. 기준(새 댓글 줄·알림에서 찾아온 댓글)이 있으면 그 가운데를 화면 가운데에,
 * 없으면 맨 아래. 범위 밖이면 0~맨 아래로 자른다(새 댓글이 몇 개 안 되면 결국 맨 아래).
 */
export function commentOpenScrollTop(
  m: Pick<CommentScrollMetrics, 'scrollHeight' | 'clientHeight'>,
  anchor: CommentScrollAnchor | null,
): number {
  const max = Math.max(0, m.scrollHeight - m.clientHeight);
  if (!anchor) return max;
  const centered = anchor.top + anchor.height / 2 - m.clientHeight / 2;
  return Math.min(max, Math.max(0, Math.round(centered)));
}

export type CommentOpenPinTarget = 'focus' | 'divider' | 'bottom';

/** 처음 자리: 알림에서 찾아온 댓글 > 새 댓글 줄 > 맨 아래. */
export function commentOpenPinTarget(input: { focusCommentId: string | null; dividerCommentId: string | null }): CommentOpenPinTarget {
  if (input.focusCommentId) return 'focus';
  if (input.dividerCommentId) return 'divider';
  return 'bottom';
}

export type CommentArrivalAction = 'stick' | 'follow' | 'pill' | 'none';

/**
 * 목록에 새 항목이 생겼을 때(처음 연 뒤) 할 일. distanceFromBottom 은 새 항목이 그려지기 '전' 바닥까지 거리.
 * - stick: 바닥에 붙어 있었다 → 움직임 없이 바닥에 다시 붙인다(새 말풍선은 자기 등장 움직임으로 보인다).
 * - follow: 내가 보낸 댓글이거나 바닥 근처였다 → 바닥까지 부드럽게(동작 줄이기면 즉시).
 * - pill: 위를 읽는 중에 팀원 댓글이 화면 아래쪽에 생겼다 → 끌어내리지 않고 '새 댓글 N개 ↓'.
 * - none: 위를 읽는 중 활동 줄만 늘었거나 새 댓글이 화면 안·위쪽에 생겼다.
 */
export function commentArrivalAction(input: { mineAdded: number; othersBelow: number; distanceFromBottom: number }): CommentArrivalAction {
  if (input.distanceFromBottom <= COMMENT_STICK_BOTTOM_PX) return 'stick';
  if (input.mineAdded > 0) return 'follow';
  if (input.distanceFromBottom < COMMENT_NEAR_BOTTOM_PX) return 'follow';
  if (input.othersBelow > 0) return 'pill';
  return 'none';
}

/** 새로 생긴 댓글 id 를 내 것/팀원 것으로 나눈다(이미 본 id 는 제외 — 실시간 재조회로 같은 댓글이 다시 와도 새것이 아니다). */
export function splitNewCommentIds(
  knownIds: ReadonlySet<string>,
  comments: ReadonlyArray<{ id: string; userId: string }>,
  currentUserId: string | null | undefined,
): { mine: string[]; others: string[] } {
  const mine: string[] = [];
  const others: string[] = [];
  for (const comment of comments) {
    if (knownIds.has(comment.id)) continue;
    if (currentUserId && comment.userId === currentUserId) mine.push(comment.id);
    else others.push(comment.id);
  }
  return { mine, others };
}

export interface UnreadDividerState {
  /** 줄이 붙는 댓글(처음 안 읽은 댓글) id */
  id: string;
  /** 그 댓글을 쓴 시각 — 읽음 기록이 이 시각에 닿으면 읽은 것 */
  createdAt: string;
  /** 4초가 지나 옅어지는 중/옅어짐 — 자리는 그대로 둔다 */
  fading: boolean;
}

/**
 * 패널마다 '새 댓글' 줄을 정했는지(captured)와 그 줄. 정하기 전엔 줄 자리를 아직 모른다.
 * 처음 연 뒤 실시간으로 온 팀원 댓글에는 줄을 새로 만들지 않는다 — 4초 뒤 옅어진 빈 틈이 대화 중간에 남았다.
 * (그런 댓글은 '새 댓글 N개 ↓' 알약·바닥 따라가기로 알리고, 읽음은 그 댓글 말풍선이 보이면 처리한다.)
 */
export interface UnreadDividerSlot {
  captured: boolean;
  divider: UnreadDividerState | null;
}

export const UNREAD_DIVIDER_UNCAPTURED: UnreadDividerSlot = { captured: false, divider: null };

/**
 * '새 댓글' 줄은 처음 자리를 잡을 때(댓글·읽음 기록이 모두 왔을 때) 한 번만 정하고, 그 뒤엔 그 자리에 남는다.
 * 읽음 처리로 '처음 안 읽은 댓글'이 사라져도 줄을 없애지 않는다(없애면 아래 내용이 한 줄 당겨지고, 그걸 따라 화면이 다시 움직였다).
 * 그때 안 읽은 댓글이 없었으면 '줄 없음'으로 정해 두고, 나중에 온 댓글에도 줄을 만들지 않는다.
 */
export function captureUnreadDivider(
  slot: UnreadDividerSlot,
  firstUnread: { id: string; createdAt: string } | null,
): UnreadDividerSlot {
  if (slot.captured) return slot;
  return {
    captured: true,
    divider: firstUnread ? { id: firstUnread.id, createdAt: firstUnread.createdAt, fading: false } : null,
  };
}

/** 지금 줄을 붙일 댓글. 정하기 전(처음 그리는 순간)엔 지금 첫 안 읽은 댓글, 정한 뒤엔 정한 자리만(없으면 줄 없음). */
export function unreadDividerCommentId(slot: UnreadDividerSlot, firstUnreadCommentId: string | null): string | null {
  return slot.captured ? (slot.divider?.id ?? null) : firstUnreadCommentId;
}

/**
 * 줄이 붙은 댓글을 읽었는지(= 4초 뒤 옅어지기 시작할 때) — 읽음 기록 시각이 그 댓글을 쓴 시각에 닿았을 때.
 * '첫 안 읽은 댓글이 바뀌었는가'로 보면, 줄이 붙은 댓글이 읽기 전에 실시간으로 지워졌을 때도 옅어지기 시작했다.
 */
export function isUnreadDividerRead(divider: UnreadDividerState | null, lastReadAt: string | null): boolean {
  if (!divider || divider.fading || !lastReadAt) return false;
  const readMs = Date.parse(lastReadAt);
  const createdMs = Date.parse(divider.createdAt);
  if (!Number.isFinite(readMs) || !Number.isFinite(createdMs)) return false;
  return readMs >= createdMs;
}

export function newCommentsPillLabel(count: number): string {
  return `새 댓글 ${Math.max(1, Math.floor(count))}개`;
}
