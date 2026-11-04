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
 *     ('모두 읽음'처럼 이 PC 의 안 읽은 반응이 하나도 남지 않을 때만 전부 — 남는 반응까지 읽음이 되면 안 된다.)
 *   - 캘린더: id 를 모아 한 번.
 *   - 액팅 피드백·씬 배정: 묶어 읽는 길이 없어 하나씩(드물다).
 * 이미 읽은 줄은 부르지 않는다.
 */
export function markNotificationsDomainReadBatch(
  rows: readonly DomainReadRow[],
  options: { recipientId: string | null; everyReaction: boolean },
): void {
  const unread = rows.filter((row) => row.isRead !== true);
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
}
