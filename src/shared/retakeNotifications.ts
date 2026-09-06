/** Shared retake delivery contract. Slack delivery is separate from saving the retake. */
export interface RetakeDeliveryResult {
  revisionId: string;
  status: 'sent' | 'partial' | 'failed' | 'nothing-to-send' | 'cooldown';
  recipients: string[];
  slackSentUserIds: string[];
  slackFailedUserIds: string[];
  slackMissingUserIds: string[];
  inAppBroadcast: boolean;
  cooldownSeconds?: number;
  simulated?: boolean;
  error?: string;
}

export interface RetakeReminderPayload {
  /** Missing kind is an older manual reminder. Initial creation uses its existing INSERT notification. */
  kind?: 'assignment' | 'reminder';
  eventId: string;
  revisionId: string;
  sceneKey: string;
  revisionNo: number;
  description: string;
  senderId: string;
  senderName: string;
  recipients: string[];
  setId?: string | null;
  createdAt: string;
}

export interface RetakeNotificationActor {
  id: string;
  name: string;
  role?: string;
  isCompositor?: boolean;
  slackId?: string;
  epoch?: number;
}

export interface RetakeNotificationRecord {
  id: string;
  requesterId: string;
  sceneKey: string;
  revisionNo: number;
  description: string;
  setId?: string | null;
  assigneeIds?: readonly string[] | null;
  assigneeStates?: Readonly<Record<string, { state: string }>> | null;
  finalResolvedAt?: string | null;
  status?: string;
}

export const RETAKE_REMINDER_COOLDOWN_MS = 30_000;

export function canRemindRetake(actor: RetakeNotificationActor | null | undefined, revision: Pick<RetakeNotificationRecord, 'requesterId'>): boolean {
  return Boolean(actor && (actor.id === revision.requesterId || actor.role === 'admin' || actor.isCompositor || actor.name === '배한솔'));
}

export function unfinishedRetakeAssigneeIds(revision: Pick<RetakeNotificationRecord, 'assigneeIds' | 'assigneeStates' | 'finalResolvedAt' | 'status'>): string[] {
  if (revision.finalResolvedAt || revision.status === 'resolved') return [];
  return [...new Set((revision.assigneeIds ?? []).filter((id) => typeof id === 'string' && id.trim()))]
    .filter((id) => revision.assigneeStates?.[id]?.state !== 'done');
}

export function emptyRetakeDelivery(revisionId: string, status: RetakeDeliveryResult['status'] = 'nothing-to-send'): RetakeDeliveryResult {
  return { revisionId, status, recipients: [], slackSentUserIds: [], slackFailedUserIds: [], slackMissingUserIds: [], inAppBroadcast: false };
}
