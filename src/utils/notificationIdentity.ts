import { capNotifications } from './notificationCap.ts';

type NotificationIdentityInput = {
  id?: string;
  type: string;
  metadata?: unknown;
  createdAt?: string;
  isRead?: boolean;
};

function metadataField(metadata: unknown, key: string): unknown {
  if (!metadata || typeof metadata !== 'object') return undefined;
  return (metadata as Record<string, unknown>)[key];
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getNotificationIdentity(notification: NotificationIdentityInput): string | null {
  const { type, metadata } = notification;

  const feedbackNotificationId = asNonEmptyString(metadataField(metadata, 'feedbackNotificationId'));
  if (feedbackNotificationId) return `acting_feedback:${feedbackNotificationId}`;

  const assignmentNotificationId = asNonEmptyString(metadataField(metadata, 'assignmentNotificationId'));
  if (assignmentNotificationId) return `scene_assignment:${assignmentNotificationId}`;

  const reactionNotificationId = asNonEmptyString(metadataField(metadata, 'reactionNotificationId'));
  if (reactionNotificationId) return `comment_reaction:${reactionNotificationId}`;

  const calendarNotificationId = asNonEmptyString(metadataField(metadata, 'calendarNotificationId'));
  if (calendarNotificationId) return `calendar:${calendarNotificationId}`;

  const commentId = asNonEmptyString(metadataField(metadata, 'commentId'));
  // v1.146.0: 댓글을 고치면서 새로 넣은 @ 는 그 댓글의 예전 알림(예: 조용한 자동 알림)과 따로 센다 — 합쳐져 토스트가 사라지지 않게.
  const mentionEditAt = asNonEmptyString(metadataField(metadata, 'mentionEditAt'));
  if (type === 'mention' && commentId && mentionEditAt) {
    return `scene_comment:${commentId}:edit:${mentionEditAt}`;
  }
  if ((type === 'comment' || type === 'mention') && commentId) {
    return `scene_comment:${commentId}`;
  }

  const revisionId = asNonEmptyString(metadataField(metadata, 'revisionId'));
  const revisionAction = asNonEmptyString(metadataField(metadata, 'revisionAction'));
  const revisionEventId = asNonEmptyString(metadataField(metadata, 'revisionEventId'));
  if (type === 'revision' && revisionAction === 'comment' && commentId) {
    return `revision_comment:${revisionId ?? 'unknown'}:${commentId}`;
  }
  if (type === 'revision' && revisionId && revisionEventId) {
    return `revision:${revisionId}:${revisionAction ?? 'update'}:${revisionEventId}`;
  }
  if (type === 'revision' && revisionId) {
    return `revision:${revisionId}:${revisionAction ?? 'update'}`;
  }

  // v1.148.0(§9): 같은 사람이 5분 안에 바꾼 단계 변경은 한 줄로(체크 열 개를 연달아 누르면 알림 열 개가 쌓였다).
  // 누가 바꿨는지 모르는 줄(예전 알림)은 합치지 않는다.
  if (type === 'scene_change') {
    const changedBy = asNonEmptyString(metadataField(metadata, 'changedBy'));
    const time = notification.createdAt ? Date.parse(notification.createdAt) : NaN;
    if (changedBy && Number.isFinite(time)) return `scene_change:${changedBy}:${Math.floor(time / SCENE_CHANGE_BUCKET_MS)}`;
  }

  return null;
}

/** 단계 변경 합치기 창(5분). */
export const SCENE_CHANGE_BUCKET_MS = 5 * 60 * 1000;

function mergeMetadata(existing: unknown, incoming: unknown): unknown {
  const existingObject = existing && typeof existing === 'object'
    ? existing as Record<string, unknown>
    : null;
  const incomingObject = incoming && typeof incoming === 'object'
    ? incoming as Record<string, unknown>
    : null;

  if (!existingObject && !incomingObject) return incoming ?? existing;
  return {
    ...(existingObject ?? {}),
    ...(incomingObject ?? {}),
  };
}

function changeCountOf(item: NotificationIdentityInput): number {
  const value = metadataField(item.metadata, 'changeCount');
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

/**
 * 단계 변경 묶음 합치기 — 제목·본문·씬은 더 최근 것, 수는 더하고, 하나라도 안 읽었으면 안 읽음,
 * 시각은 더 최근 것(목록 정렬·'누른 순간 보이던 줄만 지우기' 표시가 새 변경을 알아본다).
 */
function mergeSceneChange<T extends NotificationIdentityInput>(existing: T, incoming: T): T {
  const existingAt = existing.createdAt ? Date.parse(existing.createdAt) : NaN;
  const incomingAt = incoming.createdAt ? Date.parse(incoming.createdAt) : NaN;
  const incomingIsNewer = !Number.isFinite(existingAt) || (Number.isFinite(incomingAt) && incomingAt >= existingAt);
  const [older, newer] = incomingIsNewer ? [existing, incoming] : [incoming, existing];
  return {
    ...older,
    ...newer,
    metadata: {
      ...((mergeMetadata(older.metadata, newer.metadata) as Record<string, unknown> | undefined) ?? {}),
      changeCount: changeCountOf(existing) + changeCountOf(incoming),
    },
    id: existing.id ?? incoming.id,
    createdAt: newer.createdAt ?? older.createdAt,
    isRead: existing.isRead === true && incoming.isRead === true,
  } as T;
}

function mergeNotification<T extends NotificationIdentityInput>(existing: T, incoming: T): T {
  if (existing.type === 'scene_change' && incoming.type === 'scene_change') return mergeSceneChange(existing, incoming);
  const merged = {
    ...existing,
    ...incoming,
    metadata: mergeMetadata(existing.metadata, incoming.metadata),
    id: existing.id ?? incoming.id,
    createdAt: existing.createdAt ?? incoming.createdAt,
  } as T;

  if (typeof existing.isRead === 'boolean' || typeof incoming.isRead === 'boolean') {
    (merged as NotificationIdentityInput).isRead = existing.isRead === true || incoming.isRead === true;
  }

  return merged;
}

export function prependNotificationDeduped<T extends NotificationIdentityInput>(
  list: T[],
  incoming: T,
  limit: number,
): T[] {
  // v1.148.0(§9): 상한은 위치로 자르지 않고 버리는 순서대로(안 읽은 멘션·배정·피드백은 지킨다 — notificationCap).
  const identity = getNotificationIdentity(incoming);
  if (!identity) return capNotifications([incoming, ...list], limit);

  const existingIndex = list.findIndex((item) => getNotificationIdentity(item) === identity);
  if (existingIndex < 0) return capNotifications([incoming, ...list], limit);

  const next = list.slice();
  next[existingIndex] = mergeNotification(next[existingIndex], incoming);
  return capNotifications(next, limit);
}

export function dedupeNotificationsByIdentity<T extends NotificationIdentityInput>(
  list: T[],
  limit: number,
): T[] {
  const next: T[] = [];
  const indexByIdentity = new Map<string, number>();

  for (const item of list) {
    const identity = getNotificationIdentity(item);
    if (!identity) {
      next.push(item);
      continue;
    }

    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, next.length);
      next.push(item);
      continue;
    }

    next[existingIndex] = mergeNotification(next[existingIndex], item);
  }

  // 모두 합친 뒤 상한 — 예전엔 50개가 차면 뒤(오래된) 줄을 합치지도 않고 버려, 오래된 안 읽은 멘션이 사라졌다.
  return capNotifications(next, limit);
}
