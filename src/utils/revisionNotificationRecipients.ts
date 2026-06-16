interface RevisionNotificationRecipientInput {
  notifyUserIds?: readonly (string | null | undefined)[] | null;
  requesterId?: string | null;
  mentionedUserIds?: readonly (string | null | undefined)[] | null;
}

function appendUserId(targets: Set<string>, userId?: string | null): void {
  const normalized = typeof userId === 'string' ? userId.trim() : '';
  if (normalized) targets.add(normalized);
}

export function buildRevisionNotificationUserIds({
  notifyUserIds,
  requesterId,
  mentionedUserIds,
}: RevisionNotificationRecipientInput): string[] {
  const targets = new Set<string>();

  notifyUserIds?.forEach((id) => appendUserId(targets, id));
  appendUserId(targets, requesterId);
  mentionedUserIds?.forEach((id) => appendUserId(targets, id));

  return Array.from(targets);
}
