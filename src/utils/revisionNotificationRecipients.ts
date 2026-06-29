interface RevisionNotificationRecipientInput {
  notifyUserIds?: readonly (string | null | undefined)[] | null;
  requesterId?: string | null;
  mentionedUserIds?: readonly (string | null | undefined)[] | null;
}

interface RevisionAssigneeCompletionRecipientInput extends RevisionNotificationRecipientInput {
  selectedUserIds?: readonly (string | null | undefined)[] | null;
  completerId?: string | null;
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

export function buildRevisionAssigneeCompletionNotifyUserIds({
  notifyUserIds,
  requesterId,
  mentionedUserIds,
  selectedUserIds,
  completerId,
}: RevisionAssigneeCompletionRecipientInput): string[] {
  const sourceIds = Array.isArray(selectedUserIds)
    ? selectedUserIds
    : buildRevisionNotificationUserIds({ notifyUserIds, requesterId, mentionedUserIds });
  const excluded = typeof completerId === 'string' ? completerId.trim() : '';
  const targets = new Set<string>();

  sourceIds.forEach((id) => {
    const normalized = typeof id === 'string' ? id.trim() : '';
    if (normalized && normalized !== excluded) targets.add(normalized);
  });

  return Array.from(targets);
}
