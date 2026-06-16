import type { AppNotification } from '@/stores/useNotificationStore';

export type NotificationDisplayItem =
  | { kind: 'item'; notification: AppNotification }
  | {
      kind: 'group';
      key: string;
      title: string;
      notifications: AppNotification[];
      unreadCount: number;
      latestCreatedAt: string;
    };

function metadataValue(notification: AppNotification, key: keyof NonNullable<AppNotification['metadata']>): string | undefined {
  const value = notification.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getNotificationGroupKey(notification: AppNotification): string | null {
  const revisionId = metadataValue(notification, 'revisionId');
  if (notification.type === 'revision' && revisionId) {
    return `revision:${revisionId}`;
  }

  if (notification.type === 'scene_change' || notification.type === 'scene_assignment' || notification.type === 'acting_feedback') {
    const sheetName = metadataValue(notification, 'sheetName');
    const sceneName = metadataValue(notification, 'sceneName') ?? metadataValue(notification, 'commentSceneId');
    if (sheetName && sceneName) return `scene:${sheetName}:${sceneName}`;
    const sceneId = metadataValue(notification, 'sceneId');
    if (sceneId) return `scene:${sceneId}`;
  }

  return null;
}

function titleForGroup(key: string, count: number): string {
  if (key.startsWith('revision:')) return `리테이크 알림 ${count}건`;
  return `씬 알림 ${count}건`;
}

export function buildNotificationDisplayGroups(notifications: AppNotification[]): NotificationDisplayItem[] {
  const grouped = new Map<string, AppNotification[]>();
  const singles: NotificationDisplayItem[] = [];

  notifications.forEach((notification) => {
    const key = getNotificationGroupKey(notification);
    if (!key) {
      singles.push({ kind: 'item', notification });
      return;
    }
    const bucket = grouped.get(key) ?? [];
    bucket.push(notification);
    grouped.set(key, bucket);
  });

  const groups: NotificationDisplayItem[] = [];
  Array.from(grouped.entries()).forEach(([key, groupNotifications]) => {
    const firstNotification = groupNotifications[0];
    if (!firstNotification) return;
    if (groupNotifications.length < 2) {
      groups.push({ kind: 'item', notification: firstNotification });
      return;
    }
    const latestCreatedAt = groupNotifications.reduce((latest, item) =>
      new Date(item.createdAt).getTime() >= new Date(latest).getTime() ? item.createdAt : latest,
    firstNotification.createdAt);
    groups.push({
      kind: 'group',
      key,
      title: titleForGroup(key, groupNotifications.length),
      notifications: groupNotifications,
      unreadCount: groupNotifications.filter((item) => !item.isRead).length,
      latestCreatedAt,
    });
  });

  return [...groups, ...singles].sort((a, b) => {
    const aTime = a.kind === 'group' ? a.latestCreatedAt : a.notification.createdAt;
    const bTime = b.kind === 'group' ? b.latestCreatedAt : b.notification.createdAt;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });
}
