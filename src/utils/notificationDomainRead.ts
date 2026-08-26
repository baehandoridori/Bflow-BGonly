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
