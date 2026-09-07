interface RevisionNotificationRecipientInput {
  notifyUserIds?: readonly (string | null | undefined)[] | null;
  requesterId?: string | null;
  mentionedUserIds?: readonly (string | null | undefined)[] | null;
}

interface RevisionAssigneeCompletionRecipientInput extends RevisionNotificationRecipientInput {
  selectedUserIds?: readonly (string | null | undefined)[] | null;
  completerId?: string | null;
}

interface RetakeAssigneeCompletionBodyInput {
  senderName: string;
  revisionLabel?: string;
  note?: string | null;
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

/** 완료 메모의 경로가 알림 패널에서 온전한 버튼이 되도록 원문을 자르지 않는다. */
export function buildRetakeAssigneeCompletionBody({
  senderName,
  revisionLabel,
  note,
}: RetakeAssigneeCompletionBodyInput): string {
  const normalizedNote = note?.trim();
  const target = revisionLabel?.trim() ? `${revisionLabel.trim()} ` : '';
  const base = `${senderName}님이 ${target}담당을 완료했습니다.`;
  return normalizedNote ? `${base} ${normalizedNote}` : base;
}
