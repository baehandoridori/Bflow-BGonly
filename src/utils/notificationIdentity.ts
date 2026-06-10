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

  const commentId = asNonEmptyString(metadataField(metadata, 'commentId'));
  if ((type === 'comment' || type === 'mention') && commentId) {
    return `scene_comment:${commentId}`;
  }

  const revisionId = asNonEmptyString(metadataField(metadata, 'revisionId'));
  const revisionAction = asNonEmptyString(metadataField(metadata, 'revisionAction'));
  if (type === 'revision' && revisionAction === 'comment' && commentId) {
    return `revision_comment:${revisionId ?? 'unknown'}:${commentId}`;
  }
  if (type === 'revision' && revisionId) {
    return `revision:${revisionId}:${revisionAction ?? 'update'}`;
  }

  return null;
}

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

function mergeNotification<T extends NotificationIdentityInput>(existing: T, incoming: T): T {
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
  const identity = getNotificationIdentity(incoming);
  if (!identity) return [incoming, ...list].slice(0, limit);

  const existingIndex = list.findIndex((item) => getNotificationIdentity(item) === identity);
  if (existingIndex < 0) return [incoming, ...list].slice(0, limit);

  const next = list.slice();
  next[existingIndex] = mergeNotification(next[existingIndex], incoming);
  return next.slice(0, limit);
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
      if (next.length < limit) next.push(item);
      continue;
    }

    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      if (next.length >= limit) continue;
      indexByIdentity.set(identity, next.length);
      next.push(item);
      continue;
    }

    next[existingIndex] = mergeNotification(next[existingIndex], item);
  }

  return next.slice(0, limit);
}
