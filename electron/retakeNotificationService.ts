import {
  canRemindRetake, emptyRetakeDelivery, unfinishedRetakeAssigneeIds, RETAKE_REMINDER_COOLDOWN_MS,
  type RetakeDeliveryResult, type RetakeNotificationActor, type RetakeNotificationRecord, type RetakeReminderPayload,
} from '../src/shared/retakeNotifications';
import { buildRetakeDeepLink } from '../src/shared/bflowDeepLink';

export interface RetakeNotificationDependencies {
  getActor(): Promise<RetakeNotificationActor>;
  isActorCurrent(actor: RetakeNotificationActor): boolean;
  readRevision(id: string): Promise<RetakeNotificationRecord | null>;
  readUsers(): Promise<Array<{ id: string; slackId?: string }>>;
  sendSlack(payload: Record<string, string>, isCurrent?: () => boolean): Promise<unknown>;
  broadcast(payload: RetakeReminderPayload): Promise<boolean> | boolean;
  now?(): number;
  createEventId(): string;
}

export interface RetakeReassignmentContext {
  actor: RetakeNotificationActor;
  newAssigneeIds: string[];
}

/** Uses the existing Workflow Builder trigger's eight string variables, including its link variable. */
export function buildRetakeWorkflowPayload(revision: RetakeNotificationRecord, actor: RetakeNotificationActor, targetSlackId: string, reminder: boolean, now: number): Record<string, string> {
  const [episode = '', part = '', ...scene] = revision.sceneKey.split(':');
  const deepLink = buildRetakeDeepLink(revision.id);
  const title = reminder ? '리테이크 상태 확인 요청' : '새 리테이크 배정';
  return {
    comment: `${title} · re#${revision.revisionNo}\n${revision.description}\n작업을 시작하면 진행중, 수정을 마쳤으면 담당 완료를 눌러주세요.\n<${deepLink}|리테이크 확인하기>`,
    EP: episode || '전반',
    time: new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric' }).format(new Date(now)),
    scene: scene.join(':') || '전반',
    name_my: actor.slackId || actor.name,
    name_target: targetSlackId,
    part,
    deep_link: deepLink,
  };
}

export class RetakeNotificationService {
  private readonly deps: RetakeNotificationDependencies;
  private readonly inFlight = new Map<string, Promise<RetakeDeliveryResult>>();
  private readonly lastReminderAt = new Map<string, number>();

  constructor(deps: RetakeNotificationDependencies) { this.deps = deps; }

  /** Capture ownership before persistence; never adopt a later login when sending its notification. */
  async captureActor(): Promise<RetakeNotificationActor> {
    const actor = await this.deps.getActor();
    if (!this.deps.isActorCurrent(actor)) throw new Error('로그인이 변경됐어요. 다시 시도해주세요.');
    return actor;
  }

  /** Called only after the canonical INSERT succeeds. Delivery errors never undo a saved retake. */
  async notifyAssignment(revisionId: string, capturedActor?: RetakeNotificationActor): Promise<RetakeDeliveryResult> {
    try {
      return await this.deliver(revisionId, false, capturedActor);
    } catch {
      return { ...emptyRetakeDelivery(revisionId, 'failed'), error: '리테이크는 저장됐지만 알림 전송을 준비하지 못했어요. 다시 알림을 보내주세요.' };
    }
  }

  /** Capture the previous canonical assignment before UPDATE, independently of optimistic renderer state. */
  async captureReassignment(revisionId: string, assigneeIdsJson: string): Promise<RetakeReassignmentContext> {
    const requested: unknown = JSON.parse(assigneeIdsJson);
    if (!Array.isArray(requested) || requested.some((id) => typeof id !== 'string')) throw new Error('담당자 목록을 확인해주세요.');
    const actor = await this.captureActor();
    const previous = await this.deps.readRevision(revisionId);
    if (!previous) throw new Error('리테이크를 찾을 수 없어요.');
    if (!canRemindRetake(actor, previous)) throw new Error('등록자 또는 컴포지터만 담당자를 변경할 수 있어요.');
    if (!this.deps.isActorCurrent(actor)) throw new Error('로그인이 변경됐어요. 다시 시도해주세요.');
    const existing = new Set(previous.assigneeIds ?? []);
    return { actor, newAssigneeIds: [...new Set(requested as string[])].filter((id) => !existing.has(id)) };
  }

  /** Invoke only after UPDATE succeeds; intersect the captured difference with the latest unfinished assignees. */
  async notifyReassignment(revisionId: string, context: RetakeReassignmentContext): Promise<RetakeDeliveryResult> {
    if (!context.newAssigneeIds.length) return emptyRetakeDelivery(revisionId);
    try {
      return await this.deliver(revisionId, false, context.actor, context.newAssigneeIds);
    } catch {
      return { ...emptyRetakeDelivery(revisionId, 'failed'), error: '담당자는 변경됐지만 알림을 보내지 못했어요. 다시 알림을 보내주세요.' };
    }
  }

  async remind(revisionId: string): Promise<RetakeDeliveryResult> {
    if (typeof revisionId !== 'string' || !revisionId.trim()) throw new Error('리테이크를 선택해주세요.');
    // Authenticate each caller, including callers arriving during another send.
    const actor = await this.deps.getActor();
    const key = `${actor.id}:${actor.epoch ?? ''}:${revisionId}`;
    const active = this.inFlight.get(key);
    if (active) return active;
    const pending = this.deliver(revisionId, true, actor);
    this.inFlight.set(key, pending);
    try { return await pending; }
    finally { if (this.inFlight.get(key) === pending) this.inFlight.delete(key); }
  }

  private async deliver(revisionId: string, reminder: boolean, suppliedActor?: RetakeNotificationActor, newAssigneeIds?: readonly string[]): Promise<RetakeDeliveryResult> {
    const actor = suppliedActor ?? await this.deps.getActor();
    const revision = await this.deps.readRevision(revisionId);
    if (!revision) throw new Error('리테이크를 찾을 수 없어요.');
    if (!canRemindRetake(actor, revision)) throw new Error('등록자 또는 컴포지터만 알림을 다시 보낼 수 있어요.');
    if (!this.deps.isActorCurrent(actor)) throw new Error('로그인이 변경됐어요. 다시 시도해주세요.');
    const now = (this.deps.now ?? Date.now)();
    const last = this.lastReminderAt.get(revisionId);
    if (reminder && last !== undefined && now - last < RETAKE_REMINDER_COOLDOWN_MS) {
      return { ...emptyRetakeDelivery(revisionId, 'cooldown'), cooldownSeconds: Math.max(1, Math.ceil((RETAKE_REMINDER_COOLDOWN_MS - now + last) / 1000)) };
    }
    const recipients = unfinishedRetakeAssigneeIds(revision).filter((id) => id !== actor.id
      && (!newAssigneeIds || newAssigneeIds.includes(id)));
    const result = { ...emptyRetakeDelivery(revisionId), recipients };
    if (!recipients.length) return result;
    const users = await this.deps.readUsers();
    if (!this.deps.isActorCurrent(actor)) throw new Error('로그인이 변경됐어요. 다시 시도해주세요.');
    // A different authorized requester may have finished preparing a send during the directory read.
    const latest = this.lastReminderAt.get(revisionId);
    if (reminder && latest !== undefined && now - latest < RETAKE_REMINDER_COOLDOWN_MS) {
      return { ...emptyRetakeDelivery(revisionId, 'cooldown'), cooldownSeconds: Math.max(1, Math.ceil((RETAKE_REMINDER_COOLDOWN_MS - now + latest) / 1000)) };
    }
    if (reminder) this.lastReminderAt.set(revisionId, now);
    if (this.lastReminderAt.size > 1000) {
      for (const [id, at] of this.lastReminderAt) if (now - at >= RETAKE_REMINDER_COOLDOWN_MS) this.lastReminderAt.delete(id);
    }
    const needsBroadcast = reminder || newAssigneeIds !== undefined;
    if (needsBroadcast) {
      try {
        result.inAppBroadcast = await this.deps.broadcast({
          eventId: this.deps.createEventId(), revisionId, sceneKey: revision.sceneKey,
          revisionNo: revision.revisionNo, description: revision.description, setId: revision.setId,
          senderId: actor.id, senderName: actor.name, recipients, createdAt: new Date(now).toISOString(),
          kind: reminder ? 'reminder' : 'assignment',
        });
      } catch { /* Slack can still deliver while the realtime channel is unavailable. */ }
    }
    if (!this.deps.isActorCurrent(actor)) {
      result.slackFailedUserIds = [...recipients];
      result.status = result.inAppBroadcast ? 'partial' : 'failed';
      result.error = '로그인이 변경되어 남은 알림을 보내지 않았어요.';
      return result;
    }
    const sends = recipients.map(async (userId) => {
      const slackId = users.find((user) => user.id === userId)?.slackId?.trim();
      if (!slackId) { result.slackMissingUserIds.push(userId); return; }
      try {
        await this.deps.sendSlack(buildRetakeWorkflowPayload(revision, actor, slackId, reminder, now), () => this.deps.isActorCurrent(actor));
        result.slackSentUserIds.push(userId);
      } catch { result.slackFailedUserIds.push(userId); }
    });
    await Promise.all(sends);
    const missing = result.slackFailedUserIds.length + result.slackMissingUserIds.length + (needsBroadcast && !result.inAppBroadcast ? 1 : 0);
    result.status = missing ? (result.slackSentUserIds.length || result.inAppBroadcast ? 'partial' : 'failed') : 'sent';
    return result;
  }
}
