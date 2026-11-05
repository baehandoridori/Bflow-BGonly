import { commentNotificationReadTarget, markServerCommentNotificationsRead } from './commentNotificationServer.ts';

const sendServerCommentRead = () => (typeof window !== 'undefined' ? window.electronAPI?.commentNotificationsMarkRead : undefined);

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataValue(metadata: Record<string, unknown> | undefined | null, key: string): unknown {
  return metadata ? metadata[key] : undefined;
}

export function markNotificationDomainRead(
  type: string,
  metadata?: Record<string, unknown> | null,
) {
  const reactionNotificationId = asString(metadataValue(metadata, 'reactionNotificationId'));
  if (type === 'comment_reaction' && reactionNotificationId) {
    import('@/services/supabaseService')
      .then(({ markCommentReactionRead }) => markCommentReactionRead(reactionNotificationId))
      .catch((err) => console.warn('[notificationDomainRead] markCommentReactionRead 실패:', err));
  }

  const feedbackNotificationId = asString(metadataValue(metadata, 'feedbackNotificationId'));
  if (type === 'acting_feedback' && feedbackNotificationId) {
    import('@/services/supabaseService')
      .then(({ markFeedbackNotificationRead }) => markFeedbackNotificationRead(feedbackNotificationId))
      .catch((err) => console.warn('[notificationDomainRead] markFeedbackNotificationRead 실패:', err));
  }

  const assignmentNotificationId = asString(metadataValue(metadata, 'assignmentNotificationId'));
  if (type === 'scene_assignment' && assignmentNotificationId) {
    import('@/services/supabaseService')
      .then(({ markAssignmentNotificationRead }) => markAssignmentNotificationRead(assignmentNotificationId))
      .catch((err) => console.warn('[notificationDomainRead] markAssignmentNotificationRead 실패:', err));
  }

  const calendarNotificationId = asString(metadataValue(metadata, 'calendarNotificationId'));
  if (type === 'calendar' && calendarNotificationId) {
    Promise.resolve(window.electronAPI?.calendarNotificationsMarkRead?.([calendarNotificationId]))
      .catch((err) => console.warn('[notificationDomainRead] 캘린더 알림 read 실패:', err));
  }

  // v1.149.0(씬 댓글 B안 PR 6): 씬·캐릭터 댓글 알림은 서버 줄도 읽음으로 — 다른 PC 의 놓친 알림 모으기에서 읽은 채로 온다.
  const commentTarget = commentNotificationReadTarget([{ type, metadata }]);
  if (commentTarget.addCommentIds.length + commentTarget.editTargets.length > 0) {
    markServerCommentNotificationsRead(commentTarget, sendServerCommentRead());
  }
}

interface DomainReadRow {
  type: string;
  isRead?: boolean;
  metadata?: unknown;
}

/**
 * v1.148.0(씬 댓글 B안 §9): 여러 알림의 서버 쪽 읽음 처리를 종류별로 모아 한 번에.
 * 예전엔 '모두 읽음'·'전체 삭제'가 알림 한 줄마다 서버를 한 번씩 불렀다(50줄이면 50번).
 *   - 반응: everyReaction 이면 받는 사람의 안 읽은 반응을 한 번에(markAllCommentReactionsRead), 아니면 하나씩.
 *     everyReaction 은 '모두 읽음'·'전체 삭제'처럼 사용자가 '전부'를 고른 때만 — 카드 하나의 '읽음'·지우기에서 쓰면
 *     아직 이 PC 가 받지 못한 반응(놓친 알림 복원 전)까지 서버에서 읽음이 된다.
 *   - 캘린더: id 를 모아 한 번.
 *   - 액팅 피드백·씬 배정: 묶어 읽는 길이 없어 하나씩(드물다).
 * 이미 읽은 줄은 부르지 않는다 — includeRead(지우기)면 다시 부른다: 예전 읽음 처리가 실패했으면(오프라인 등) 지운 알림이
 * 다음 로그인 복원 때 안 읽음으로 되살아나기 때문(서버는 read_at 이 비었을 때만 바꿔 다시 불러도 같다).
 */
export function markNotificationsDomainReadBatch(
  rows: readonly DomainReadRow[],
  options: { recipientId: string | null; everyReaction: boolean; includeRead?: boolean },
): void {
  const unread = options.includeRead ? [...rows] : rows.filter((row) => row.isRead !== true);
  if (unread.length === 0) return;
  const meta = (row: DomainReadRow) => (row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : null);

  const reactionIds = unread
    .filter((row) => row.type === 'comment_reaction')
    .map((row) => asString(metadataValue(meta(row), 'reactionNotificationId')))
    .filter((id): id is string => !!id);
  if (reactionIds.length > 1 && options.everyReaction && options.recipientId) {
    const recipientId = options.recipientId;
    import('@/services/supabaseService')
      .then(({ markAllCommentReactionsRead }) => markAllCommentReactionsRead(recipientId))
      .catch((err) => console.warn('[notificationDomainRead] markAllCommentReactionsRead 실패:', err));
  } else {
    reactionIds.forEach((id) => markNotificationDomainRead('comment_reaction', { reactionNotificationId: id }));
  }

  const calendarIds = unread
    .filter((row) => row.type === 'calendar')
    .map((row) => asString(metadataValue(meta(row), 'calendarNotificationId')))
    .filter((id): id is string => !!id);
  if (calendarIds.length > 0) {
    Promise.resolve(window.electronAPI?.calendarNotificationsMarkRead?.(calendarIds))
      .catch((err) => console.warn('[notificationDomainRead] 캘린더 알림 read 실패:', err));
  }

  unread
    .filter((row) => row.type === 'acting_feedback' || row.type === 'scene_assignment')
    .forEach((row) => markNotificationDomainRead(row.type, meta(row)));

  // v1.149.0(씬 댓글 B안 PR 6): 씬·캐릭터 댓글 알림의 서버 줄 — 댓글 id 를 모아 한 번(500개씩).
  const commentTarget = commentNotificationReadTarget(unread);
  if (commentTarget.addCommentIds.length + commentTarget.editTargets.length > 0) {
    markServerCommentNotificationsRead(commentTarget, sendServerCommentRead());
  }
}
