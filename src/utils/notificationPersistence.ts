export function safeNotificationUserId(userId: string): string {
  return userId.trim().replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
}

export function notificationFileNameForUser(userId: string): string {
  const safeUserId = safeNotificationUserId(userId);
  return `notifications.${safeUserId}.json`;
}
