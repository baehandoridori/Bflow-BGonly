/**
 * 댓글 목록 모양 — 씬 댓글 B안 §5.2~§5.5 (v1.147.0). 화면이 그릴 항목 줄을 만드는 순수 함수 모음.
 *
 *  - 본문 목록에는 원댓글만. 답글은 원댓글 아래 '답글 N개 · 마지막 시각 · 새 N' 한 줄(누르면 스레드 창).
 *  - 같은 리테이크(revision_id)의 댓글·활동은 카드 하나로 접는다. 카드 자리는 첫 활동(등록) 시각.
 *  - 리테이크가 아닌 시스템 활동(단계 변경 등)은 한 줄.
 *  - 같은 사람이 5분 안에 이어 쓴 원댓글은 아바타·머리 줄을 생략(묶음). 카드·활동·날짜 줄이 끼면 끊긴다.
 *  - 날짜가 바뀌는 곳에 '오늘' / '11월 3일 월요일' 줄('전체' 탭에서만).
 *  - 탭: 전체 · 안 읽음 · 리테이크 · @나 — 숫자는 그 탭에 남는 항목 수.
 * node --test 로 바로 검사한다(@/ 별칭·DOM 없음).
 */

export interface FeedCommentLike {
  id: string;
  userId: string;
  userName: string;
  createdAt: string;
  parentCommentId?: string | null;
  revisionId?: string | null;
  mentions?: readonly string[] | null;
}

export interface FeedEventLike {
  id: string;
  at: string;
  revisionId?: string;
  tone?: string;
  /** 활동 기록의 원래 종류(revision_add 등) — 리테이크 활동 문장에 쓴다. */
  actionType?: string;
}

export type CommentFeedFilter = 'all' | 'unread' | 'retake' | 'mine';

export interface FeedPerson {
  id: string;
  name: string;
}

export interface CommentThreadSummary {
  count: number;
  /** 참여자(처음 나온 순서, 최대 3명). */
  participants: FeedPerson[];
  lastAt: string;
  /** 안 읽은 것 수. */
  newCount: number;
}

export type CommentFeedItem<C extends FeedCommentLike, E extends FeedEventLike> =
  | { kind: 'day'; key: string; label: string }
  | {
    kind: 'comment';
    key: string;
    comment: C;
    /** 앞 원댓글과 같은 사람·5분 안 — 아바타·머리 줄 생략. */
    grouped: boolean;
    replies: C[];
    replySummary: CommentThreadSummary | null;
    /** 이 줄이 대신 보여 주는 댓글 id(원댓글 + 답글) — 첫 안 읽은 댓글·알림 이동이 목록 자리를 찾을 때. */
    anchorIds: string[];
  }
  | {
    kind: 'retake';
    key: string;
    revisionId: string;
    at: string;
    comments: C[];
    events: E[];
    commentSummary: CommentThreadSummary | null;
    anchorIds: string[];
  }
  | { kind: 'activity'; key: string; event: E };

export interface CommentFeedCounts {
  roots: number;
  retakes: number;
  unread: number;
  mine: number;
}

export interface BuildCommentFeedInput<C extends FeedCommentLike, E extends FeedEventLike> {
  comments: readonly C[];
  events: readonly E[];
  filter: CommentFeedFilter;
  isUnread: (comment: C) => boolean;
  /** @나 탭 — 이 이름이 mentions 에 든 댓글. */
  meName: string | null;
  now?: Date;
}

export const COMMENT_GROUP_WINDOW_MS = 5 * 60 * 1000;
const MAX_PARTICIPANTS = 3;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function timeOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function byTime<T>(get: (item: T) => string) {
  return (a: T, b: T) => timeOf(get(a)) - timeOf(get(b));
}

/** 날짜 줄 글자 — 오늘이면 '오늘', 아니면 '11월 3일 월요일'(올해가 아니면 앞에 'YYYY년'). */
export function commentDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return '오늘';
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
  return d.getFullYear() === now.getFullYear() ? base : `${d.getFullYear()}년 ${base}`;
}

/** 같은 날인지 비교하는 열쇠(이 PC 시간대). */
export function commentDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'invalid';
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 같은 사람이 5분 안에 이어 썼나(앞 글보다 늦고 5분 이내). */
export function isGroupedWithPrevious(prev: FeedCommentLike | null | undefined, next: FeedCommentLike): boolean {
  if (!prev || prev.userId !== next.userId) return false;
  const gap = timeOf(next.createdAt) - timeOf(prev.createdAt);
  return gap >= 0 && gap <= COMMENT_GROUP_WINDOW_MS;
}

/** 스레드 창 안 목록처럼 댓글만 이어진 줄 — 각 줄이 앞 줄과 묶이는지. 날짜가 바뀌면 끊는다. */
export function groupedFlags(list: readonly FeedCommentLike[]): boolean[] {
  return list.map((item, index) => index > 0
    && commentDayKey(list[index - 1].createdAt) === commentDayKey(item.createdAt)
    && isGroupedWithPrevious(list[index - 1], item));
}

export function summarizeThread<C extends FeedCommentLike>(list: readonly C[], isUnread: (comment: C) => boolean): CommentThreadSummary | null {
  if (list.length === 0) return null;
  const participants: FeedPerson[] = [];
  for (const item of list) {
    if (participants.some((p) => p.id === item.userId)) continue;
    participants.push({ id: item.userId, name: item.userName });
    if (participants.length >= MAX_PARTICIPANTS) break;
  }
  return {
    count: list.length,
    participants,
    lastAt: list[list.length - 1].createdAt,
    newCount: list.filter(isUnread).length,
  };
}

/** 답글의 답글(옛 기록)까지 맨 위 원댓글로 올라간다. 고리가 있으면 거기서 멈춘다. */
function topAncestor<C extends FeedCommentLike>(comment: C, byId: Map<string, C>): C {
  let current = comment;
  const seen = new Set<string>([comment.id]);
  while (current.parentCommentId) {
    const parent = byId.get(current.parentCommentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current;
}

/**
 * 스레드 창에 그릴 글 — 본문 요약('답글 N개'·'댓글 N개')과 같은 묶음 규칙(코드 리뷰).
 *  - 원댓글 스레드: 맨 위 원댓글이 그 글인 답글 전부(답글의 답글 같은 옛 기록 포함, 리테이크 묶음은 제외).
 *  - 리테이크 스레드: 그 리테이크 댓글 + 리테이크 댓글에 단 옛 답글(revision_id 없이 저장된 것).
 * 시간 순서.
 */
export function threadMembers<C extends FeedCommentLike>(
  comments: readonly C[],
  target: { rootId: string } | { revisionId: string },
): C[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const picked = comments.filter((comment) => {
    if ('revisionId' in target) {
      if (comment.revisionId) return comment.revisionId === target.revisionId;
      const top = topAncestor(comment, byId);
      return top.id !== comment.id && top.revisionId === target.revisionId;
    }
    if (comment.revisionId || comment.id === target.rootId) return false;
    const top = topAncestor(comment, byId);
    return top.id === target.rootId && !top.revisionId;
  });
  return picked.sort(byTime((c) => c.createdAt));
}

type Entry<C extends FeedCommentLike, E extends FeedEventLike> =
  | { kind: 'comment'; at: string; key: string; comment: C; replies: C[] }
  | { kind: 'retake'; at: string; key: string; revisionId: string; comments: C[]; events: E[] }
  | { kind: 'activity'; at: string; key: string; event: E };

export function buildCommentFeed<C extends FeedCommentLike, E extends FeedEventLike>(
  input: BuildCommentFeedInput<C, E>,
): { items: CommentFeedItem<C, E>[]; counts: CommentFeedCounts } {
  const { comments, events, filter, isUnread, meName } = input;
  const now = input.now ?? new Date();
  const byId = new Map(comments.map((c) => [c.id, c]));

  const roots = new Map<string, { comment: C; replies: C[] }>();
  const retakes = new Map<string, { comments: C[]; events: E[] }>();
  const retakeOf = (revisionId: string) => {
    let bundle = retakes.get(revisionId);
    if (!bundle) {
      bundle = { comments: [], events: [] };
      retakes.set(revisionId, bundle);
    }
    return bundle;
  };

  // 원댓글 먼저(답글이 원댓글보다 먼저 와도 자리를 찾게).
  // 원댓글이 지워진 답글(부모를 못 찾음)도 스스로 원댓글이 된다.
  for (const comment of comments) {
    if (comment.revisionId) continue;
    if (topAncestor(comment, byId).id === comment.id) roots.set(comment.id, { comment, replies: [] });
  }
  for (const comment of comments) {
    if (comment.revisionId) {
      retakeOf(comment.revisionId).comments.push(comment);
      continue;
    }
    const top = topAncestor(comment, byId);
    if (top.id === comment.id) continue;
    // 리테이크 댓글에 단 옛 답글은 그 리테이크 묶음으로.
    if (top.revisionId) {
      retakeOf(top.revisionId).comments.push(comment);
      continue;
    }
    roots.get(top.id)?.replies.push(comment);
  }

  const activities: E[] = [];
  for (const event of events) {
    if (event.revisionId) retakeOf(event.revisionId).events.push(event);
    else activities.push(event);
  }

  const entries: Entry<C, E>[] = [];
  for (const { comment, replies } of roots.values()) {
    replies.sort(byTime((c) => c.createdAt));
    entries.push({ kind: 'comment', at: comment.createdAt, key: `c:${comment.id}`, comment, replies });
  }
  for (const [revisionId, bundle] of retakes) {
    bundle.comments.sort(byTime((c) => c.createdAt));
    bundle.events.sort(byTime((e) => e.at));
    const times = [...bundle.events.map((e) => e.at), ...bundle.comments.map((c) => c.createdAt)];
    const at = times.reduce((min, t) => (timeOf(t) < timeOf(min) ? t : min), times[0]);
    entries.push({ kind: 'retake', at, key: `r:${revisionId}`, revisionId, comments: bundle.comments, events: bundle.events });
  }
  for (const event of activities) {
    entries.push({ kind: 'activity', at: event.at, key: `e:${event.id}`, event });
  }
  entries.sort((a, b) => timeOf(a.at) - timeOf(b.at) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const mentionsMe = (c: C) => !!meName && (c.mentions ?? []).includes(meName);
  const passes = (entry: Entry<C, E>, which: CommentFeedFilter): boolean => {
    if (which === 'all') return true;
    if (which === 'retake') return entry.kind === 'retake';
    if (entry.kind === 'activity') return false;
    const list = entry.kind === 'comment' ? [entry.comment, ...entry.replies] : entry.comments;
    return which === 'unread' ? list.some(isUnread) : list.some(mentionsMe);
  };

  const counts: CommentFeedCounts = {
    roots: entries.filter((e) => e.kind === 'comment').length,
    retakes: entries.filter((e) => e.kind === 'retake').length,
    unread: entries.filter((e) => passes(e, 'unread')).length,
    mine: entries.filter((e) => passes(e, 'mine')).length,
  };

  const items: CommentFeedItem<C, E>[] = [];
  let lastDay: string | null = null;
  let prevComment: C | null = null;
  for (const entry of entries) {
    if (!passes(entry, filter)) continue;
    if (filter === 'all') {
      const day = commentDayKey(entry.at);
      if (day !== lastDay) {
        lastDay = day;
        items.push({ kind: 'day', key: `d:${day}`, label: commentDayLabel(entry.at, now) });
        prevComment = null;
      }
    }
    if (entry.kind === 'comment') {
      items.push({
        kind: 'comment',
        key: entry.key,
        comment: entry.comment,
        grouped: isGroupedWithPrevious(prevComment, entry.comment),
        replies: entry.replies,
        replySummary: summarizeThread(entry.replies, isUnread),
        anchorIds: [entry.comment.id, ...entry.replies.map((r) => r.id)],
      });
      prevComment = entry.comment;
    } else if (entry.kind === 'retake') {
      items.push({
        kind: 'retake',
        key: entry.key,
        revisionId: entry.revisionId,
        at: entry.at,
        comments: entry.comments,
        events: entry.events,
        commentSummary: summarizeThread(entry.comments, isUnread),
        anchorIds: entry.comments.map((c) => c.id),
      });
      prevComment = null;
    } else {
      items.push({ kind: 'activity', key: entry.key, event: entry.event });
      prevComment = null;
    }
  }
  return { items, counts };
}

// ─── 리테이크 카드·활동 줄 ───────────────────────────────────────────

export type RetakePhase = 'open' | 'in_progress' | 'assignee_done' | 'resolved' | 'deleted' | 'other';

/** 활동 한 줄의 단계(색) — 원래 종류가 없으면 예전 tone 으로 짐작한다. */
export function retakeActivityPhase(event: Pick<FeedEventLike, 'actionType' | 'tone'>): RetakePhase {
  switch (event.actionType) {
    case 'revision_add': return 'open';
    case 'revision_in_progress': return 'in_progress';
    case 'revision_assignee_done': return 'assignee_done';
    case 'revision_resolve':
    case 'revision_final_resolve': return 'resolved';
    case 'revision_delete': return 'deleted';
    default: break;
  }
  if (event.actionType) return 'other';
  switch (event.tone) {
    case 'revision_add': return 'open';
    case 'revision_in_progress': return 'in_progress';
    case 'revision_resolve': return 'resolved';
    case 'revision_delete': return 'deleted';
    default: return 'other';
  }
}

/** '{이름} 님이 …' 뒤에 오는 말. */
export function retakeActivitySentence(event: Pick<FeedEventLike, 'actionType' | 'tone'>): string {
  if (event.actionType === 'revision_reassign') return '담당자를 바꿨어요';
  switch (retakeActivityPhase(event)) {
    case 'open': return '리테이크를 등록했어요';
    case 'in_progress': return '작업을 시작했어요';
    case 'assignee_done': return '담당 작업을 끝냈어요';
    case 'resolved': return '해결로 표시했어요';
    case 'deleted': return '리테이크를 지웠어요';
    default: return '리테이크를 고쳤어요';
  }
}

export type RetakeCardStatus = 'open' | 'in_progress' | 'assignee_done' | 'resolved' | 'deleted' | 'unknown';

export const RETAKE_STATUS_LABEL: Record<RetakeCardStatus, string> = {
  open: '대기',
  in_progress: '진행중',
  assignee_done: '담당 완료',
  resolved: '해결됨',
  deleted: '지워짐',
  unknown: '불러오는 중',
};

export function retakeCardStatus(
  revision: { status?: string | null; finalResolvedAt?: string | null } | null | undefined,
  deleted: boolean,
): RetakeCardStatus {
  if (deleted && !revision) return 'deleted';
  if (!revision) return 'unknown';
  if (revision.finalResolvedAt || revision.status === 'resolved') return 'resolved';
  if (revision.status === 'assignee_done') return 'assignee_done';
  if (revision.status === 'in_progress') return 'in_progress';
  return 'open';
}

export type RetakeAction = 'start' | 'complete' | 'reopen_mine' | 'resolve' | 'reopen';

export const RETAKE_ACTION_LABEL: Record<RetakeAction, string> = {
  start: '작업 시작',
  complete: '담당 완료',
  reopen_mine: '다시 진행',
  resolve: '해결',
  reopen: '다시 열기',
};

/**
 * 스레드 창 리테이크 카드 아래 버튼 — 지금 앱의 권한과 같게(새 명령 없음).
 *  - 내가 담당: 대기 → 작업 시작 / 진행중 → 담당 완료 / 내 담당 완료(아직 해결 전) → 다시 진행.
 *  - 요청자·컴포지터(canFinal): 모두 담당 완료 → 해결 / 해결됨 → 다시 열기.
 */
export function availableRetakeActions(input: {
  status: RetakeCardStatus;
  myState: 'pending' | 'in_progress' | 'done' | null;
  canFinal: boolean;
}): RetakeAction[] {
  const { status, myState, canFinal } = input;
  if (status === 'deleted' || status === 'unknown') return [];
  if (status === 'resolved') return canFinal ? ['reopen'] : [];
  const actions: RetakeAction[] = [];
  if (myState === 'pending') actions.push('start');
  else if (myState === 'in_progress') actions.push('complete');
  if (status === 'assignee_done' && canFinal) actions.push('resolve');
  if (myState === 'done') actions.push('reopen_mine');
  return actions;
}
