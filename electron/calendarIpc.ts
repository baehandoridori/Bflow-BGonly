/** electron/calendarIpc.ts — calendar:* IPC 등록.
 *  세션 검증(getSessionUserIdOrThrow 주입) + 권한 강제(calendarPermissions) + broadcast.
 *  main.ts 비대화 방지를 위해 분리. 렌더러 → 여기 → calendarStore → Supabase 단일 경로. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ipcMain } from 'electron';
import {
  canViewCalendar,
  canEditCalendarEvents,
  canManageCalendar,
  canCreateCalendar,
} from '../src/shared/calendarPermissions';
import {
  buildCalendarChangeDetail,
  computeCalendarNotificationRecipients,
} from '../src/shared/calendarNotifications';
import { normalizeCalendarNotificationCatchupInput } from '../src/shared/calendarNotificationCatchup';
import * as store from './calendarStore';
import type { CalendarRow, CalendarEventRow, CalendarMemberRow } from './calendarStore';
import { readUsers } from './supabase';
import {
  broadcastCalendarChanged,
  broadcastCalendarCommittedDelete,
  broadcastDataChange,
} from './broadcast';
import type {
  CalendarCommittedReplacementDeleteMarker,
  CalendarPrivacyMigrationSourceDeleteInput,
  CalendarPrivacyReplacementCreateInput,
  CalendarPrivacyReplacementDisposition,
  CalendarPrivacyMigrationSourceDeleteResult,
  GoogleReplacementCreateInput,
  LegacyPrivateReplacementCreateInput,
} from '../src/shared/calendarApiContract';

interface CalendarIpcDeps {
  getSessionUserIdOrThrow: () => string;
  /** 세션 전환 전 origin을 동기적으로 고정한다. 이후 await가 현재 사용자를 바꿔도 receipt는 이 값을 따른다. */
  getSessionOriginOrThrow: () => CalendarSessionOrigin;
  createLegacyPrivateEvent: (
    input: LegacyPrivateReplacementCreateInput,
    actorId: string,
  ) => Promise<{ id: string }>;
  deleteLegacyPrivateEvent: (eventId: string, actorId: string) => Promise<void>;
  deleteLegacyPrivateSourceEvent: (
    eventId: string,
    actorId: string,
  ) => Promise<'deleted' | 'missing'>;
  getLegacyPrivateEventOwner: (eventId: string) => Promise<string | null>;
  createGoogleEvent: (
    calendarId: string,
    input: GoogleReplacementCreateInput,
    actorId: string,
  ) => Promise<string>;
  deleteGoogleEvent: (calendarId: string, eventId: string, actorId: string) => Promise<void>;
  getGoogleEvent: (
    calendarId: string,
    eventId: string,
    actorId: string,
  ) => Promise<{ id: string } | null>;
  onCommittedReplacementDelete: (payload: CalendarCommittedReplacementDeleteMarker) => void;
  /** 테스트에서만 짧은 만료를 검증할 수 있는 replacement receipt TTL override. */
  privacyReplacementReceiptTtlMs?: number;
}

/** 종료 직전에 best-effort 캘린더 알림 작업을 유한 시간만 기다리기 위한 메인 프로세스 경계. */
export interface CalendarNotificationDrain {
  /** 종료 시작 뒤 새 알림 생성 mutation의 persistence 진입을 막는다. */
  beginQuitting(): void;
  /** 새 세션을 publish하기 전에 기존 actor의 replacement capability를 더 이상 진행하지 못하게 한다. */
  beginPrivacyReplacementTransition(origin: CalendarPrivacyReplacementOrigin): void;
  /** 기존 actor의 creating/sourceDeleting receipt를 정리해 terminal 상태가 될 때까지 기다린다. */
  drainPrivacyReplacementTransition(origin: CalendarPrivacyReplacementOrigin): Promise<void>;
  /** 다음 canonical session을 publish한 뒤 더 이상 쓰일 수 없는 origin lock을 해제한다. */
  completePrivacyReplacementTransition(origin: CalendarPrivacyReplacementOrigin): void;
  /** publish 전에 후속 단계가 실패하면 현재 actor가 다시 작업할 수 있게 origin lock을 되돌린다. */
  abortPrivacyReplacementTransition(origin: CalendarPrivacyReplacementOrigin): void;
  getPendingNotificationCount(): number;
  waitForNotificationIdle(timeoutMs: number): Promise<boolean>;
}

type CalendarEventCreateInput = Parameters<typeof store.createEvent>[0];
type InvokeEvent = { sender?: { id?: number } };

type CalendarSessionOrigin = {
  userId: string;
  epoch: number;
  role: 'admin' | 'user';
};

type CalendarActor = Pick<CalendarSessionOrigin, 'role'> & { id: string };

type CalendarPrivacyReplacementOrigin = Pick<CalendarSessionOrigin, 'userId' | 'epoch'>;

/** receipt에 남기는 알림 정보는 수신자 계산과 표시 문구에 필요한 필드로 제한한다. */
type CalendarNotificationEvent = Pick<
  CalendarEventRow,
  'id' | 'title' | 'start_date' | 'end_date'
>;

type CalendarNotificationContext = {
  actorId: string;
  action: 'create' | 'update' | 'delete';
  calendar: Pick<CalendarRow, 'id' | 'name' | 'owner_id' | 'visibility'>;
  memberIds: string[];
  event: CalendarNotificationEvent | null;
  previous: CalendarNotificationEvent | null;
};

type PrivacyReplacementTarget =
  | {
      storage: 'bflow';
      actualId: string;
      calendarId: string;
      actorId: string;
      createdAt: string;
      notification: CalendarNotificationContext;
    }
  | { storage: 'legacy-private'; actualId: string; actorId: string }
  | { storage: 'google'; actualId: string; calendarId: string; actorId: string };

type PrivacyReplacementState =
  | 'creating'
  | 'created'
  | 'sourceDeleting'
  | 'needsKeep'
  | 'needsDelete'
  | 'settling'
  | 'kept'
  | 'deleted';

type PrivacyReplacementReceipt = {
  receipt: string;
  senderId: number;
  secret: string;
  origin: CalendarSessionOrigin;
  source: CalendarPrivacyMigrationSourceDeleteInput;
  target: PrivacyReplacementTarget | null;
  expiresAt: number;
  state: PrivacyReplacementState;
  terminalDisposition: CalendarPrivacyReplacementDisposition | null;
  retiring: boolean;
  operation: Promise<void> | null;
  resolveOperation: (() => void) | null;
  /** session/TTL cleanup은 하나의 tracked resolution만 공유한다. */
  transitionResolution: Promise<void> | null;
  /** renderer가 사라져도 만료 정리를 시작하는 main-owned timer. */
  expiryTimer: ReturnType<typeof setTimeout> | null;
};

type PrivacyReplacementTransitionReservation = {
  releaseWork: () => void;
  drain: Promise<void> | null;
};

const PRIVACY_REPLACEMENT_RECEIPT_TTL_MS = 5 * 60 * 1000;

function wrap<T extends unknown[], R>(fn: (...args: T) => Promise<R>) {
  return async (_e: unknown, ...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Calendar IPC]', msg);
      throw new Error(msg);
    }
  };
}

function wrapWithEvent<T extends unknown[], R>(
  fn: (event: InvokeEvent, ...args: T) => Promise<R>,
) {
  return async (event: InvokeEvent, ...args: T): Promise<R> => {
    try {
      return await fn(event, ...args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Calendar IPC]', msg);
      throw new Error(msg);
    }
  };
}

function requireSenderId(event: InvokeEvent): number {
  const senderId = event?.sender?.id;
  if (!Number.isSafeInteger(senderId) || (senderId ?? 0) <= 0) {
    throw new Error('보상 receipt 발급 창을 확인할 수 없습니다');
  }
  return senderId as number;
}

function requirePrivacyReplacementRequest(value: unknown): CalendarPrivacyReplacementCreateInput {
  if (!value || typeof value !== 'object') {
    throw new Error('보상 가능한 일정 생성 요청이 올바르지 않습니다');
  }
  const request = value as Record<string, unknown>;
  if (
    request.storage !== 'bflow'
    && request.storage !== 'legacy-private'
    && request.storage !== 'google'
  ) {
    throw new Error('보상 가능한 일정 저장소가 올바르지 않습니다');
  }
  if (!request.event || typeof request.event !== 'object') {
    throw new Error('보상 가능한 일정 입력이 올바르지 않습니다');
  }
  const source = requirePrivacyMigrationSourceDeleteRequest(request.source);
  if (request.storage === 'google' && (
    typeof request.calendar_id !== 'string'
    || request.calendar_id.trim().length === 0
  )) {
    throw new Error('구글 캘린더 ID가 올바르지 않습니다');
  }
  if (request.storage === 'bflow') {
    return { storage: 'bflow', source, event: request.event as CalendarEventCreateInput };
  }
  if (request.storage === 'legacy-private') {
    return {
      storage: 'legacy-private',
      source,
      event: request.event as LegacyPrivateReplacementCreateInput,
    };
  }
  return {
    storage: 'google',
    source,
    calendar_id: request.calendar_id as string,
    event: request.event as GoogleReplacementCreateInput,
  };
}

function requirePrivacyMigrationSourceDeleteRequest(
  value: unknown,
): CalendarPrivacyMigrationSourceDeleteInput {
  // 이전 PR2 빌드와의 짧은 공존 창에서는 B flow source id 문자열이 들어올 수 있다.
  if (typeof value === 'string' && value.trim().length > 0) {
    return { storage: 'bflow', event_id: value };
  }
  if (!value || typeof value !== 'object') {
    throw new Error('이관 원본 삭제 요청이 올바르지 않습니다');
  }
  const request = value as Record<string, unknown>;
  if (
    request.storage !== 'bflow'
    && request.storage !== 'legacy-private'
    && request.storage !== 'google'
  ) {
    throw new Error('이관 원본 저장소가 올바르지 않습니다');
  }
  if (typeof request.event_id !== 'string' || request.event_id.trim().length === 0) {
    throw new Error('이관 원본 일정 ID가 올바르지 않습니다');
  }
  if (
    request.storage === 'google'
    && (typeof request.calendar_id !== 'string' || request.calendar_id.trim().length === 0)
  ) {
    throw new Error('이관 원본 구글 캘린더 ID가 올바르지 않습니다');
  }
  if (request.storage === 'google') {
    return {
      storage: 'google',
      calendar_id: request.calendar_id as string,
      event_id: request.event_id,
    };
  }
  return request.storage === 'bflow'
    ? { storage: 'bflow', event_id: request.event_id }
    : { storage: 'legacy-private', event_id: request.event_id };
}

function isGoogleNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  return candidate.code === 404
    || candidate.code === '404'
    || candidate.status === 404
    || candidate.response?.status === 404;
}

function committedReplacementDeleteMarker(
  target: PrivacyReplacementTarget,
): CalendarCommittedReplacementDeleteMarker {
  if (target.storage === 'google') {
    return {
      eventId: target.actualId,
      action: 'delete',
      calendarId: target.calendarId,
      committedGoogleDelete: true,
    };
  }
  if (target.storage === 'bflow') {
    return {
      eventId: target.actualId,
      action: 'delete',
      storage: 'bflow',
      calendarId: target.calendarId,
      committedPrivacyReplacementDelete: true,
    };
  }
  return {
    eventId: target.actualId,
    action: 'delete',
    storage: 'legacy-private',
    ownerId: target.actorId,
    committedPrivacyReplacementDelete: true,
  };
}

/** 일정 쓰기 성공 후 알림 파이프라인 진입점 — 실패해도 일정 저장은 유지한다. */
function calendarNotificationContext(ctx: {
  actorId: string;
  action: CalendarNotificationContext['action'];
  calendar: CalendarRow;
  members: CalendarMemberRow[];
  event: CalendarEventRow | null;
  previous: CalendarEventRow | null;
}): CalendarNotificationContext {
  const toEvent = (event: CalendarEventRow | null): CalendarNotificationEvent | null => event && {
    id: event.id,
    title: event.title,
    start_date: event.start_date,
    end_date: event.end_date,
  };
  return {
    actorId: ctx.actorId,
    action: ctx.action,
    calendar: {
      id: ctx.calendar.id,
      name: ctx.calendar.name,
      owner_id: ctx.calendar.owner_id,
      visibility: ctx.calendar.visibility,
    },
    memberIds: ctx.members.map((member) => member.user_id),
    event: toEvent(ctx.event),
    previous: toEvent(ctx.previous),
  };
}

async function emitCalendarEventNotifications(ctx: CalendarNotificationContext): Promise<void> {
  try {
    const event = ctx.event ?? ctx.previous;
    if (!event) return;

    const users = await readUsers();
    const recipients = computeCalendarNotificationRecipients(
      ctx.calendar,
      ctx.memberIds,
      users.map((user) => user.id),
      ctx.actorId,
    );
    if (recipients.length === 0) return;

    const detail = ctx.action === 'update' && ctx.previous && ctx.event
      ? buildCalendarChangeDetail(
        { startDate: ctx.previous.start_date, endDate: ctx.previous.end_date },
        { startDate: ctx.event.start_date, endDate: ctx.event.end_date },
      )
      : null;
    const actor = users.find((user) => user.id === ctx.actorId);
    await store.insertNotifications(recipients.map((recipientId) => ({
      recipient_id: recipientId,
      actor_id: ctx.actorId,
      actor_name: actor?.name ?? '알 수 없음',
      calendar_id: ctx.calendar.id,
      calendar_name: ctx.calendar.name,
      event_id: event.id,
      event_title: event.title,
      event_date: event.start_date,
      action: ctx.action,
      detail,
    })));
  } catch (error) {
    console.warn('[calendarIpc] 알림 insert 실패 (best-effort — 일정 저장은 성공 유지):', error);
  }
}

const membersOf = (all: CalendarMemberRow[], calendarId: string) =>
  all.filter((member) => member.calendar_id === calendarId);

function normalizeCalendarVisibility(value: unknown): CalendarRow['visibility'] {
  if (
    typeof value !== 'string'
    || (value !== 'private' && value !== 'members' && value !== 'team')
  ) {
    throw new Error('캘린더 공개 범위가 올바르지 않습니다');
  }
  return value;
}

function normalizeCalendarMembers(members: unknown, ownerId: string): Array<{ user_id: string; can_edit: boolean }> {
  if (members === undefined) return [];
  if (!Array.isArray(members)) throw new Error('캘린더 멤버 입력이 올바르지 않습니다');
  return members.map((member) => {
    if (!member || typeof member !== 'object') {
      throw new Error('캘린더 멤버 입력이 올바르지 않습니다');
    }
    const candidate = member as Record<string, unknown>;
    if (
      typeof candidate.user_id !== 'string'
      || candidate.user_id.trim().length === 0
      || typeof candidate.can_edit !== 'boolean'
    ) {
      throw new Error('캘린더 멤버 입력이 올바르지 않습니다');
    }
    return { user_id: candidate.user_id, can_edit: candidate.can_edit };
  }).filter((member) => member.user_id !== ownerId);
}

function safeCalendarEventCreateInput(input: CalendarEventCreateInput): CalendarEventCreateInput {
  return {
    calendar_id: input.calendar_id,
    title: input.title,
    memo: input.memo,
    tag_id: input.tag_id,
    all_day: input.all_day,
    start_date: input.start_date,
    end_date: input.end_date,
    start_time: input.start_time,
    end_time: input.end_time,
    linked_episode: input.linked_episode,
    linked_part: input.linked_part,
    linked_sheet_name: input.linked_sheet_name,
    linked_scene_id: input.linked_scene_id,
    linked_department: input.linked_department,
    linked_todo_id: input.linked_todo_id,
  };
}

function safeLegacyPrivateCreateInput(
  input: LegacyPrivateReplacementCreateInput,
): LegacyPrivateReplacementCreateInput {
  return {
    title: input.title,
    memo: input.memo,
    color: input.color,
    type: input.type,
    start_date: input.start_date,
    end_date: input.end_date,
    linked_episode: input.linked_episode,
    linked_part: input.linked_part,
    linked_sheet_name: input.linked_sheet_name,
    linked_scene_id: input.linked_scene_id,
    linked_department: input.linked_department,
    linked_todo_id: input.linked_todo_id,
    created_by: input.created_by,
  };
}

function safeGoogleCreateInput(input: GoogleReplacementCreateInput): GoogleReplacementCreateInput {
  const extendedProperties = input.extendedProperties && typeof input.extendedProperties === 'object'
    ? Object.fromEntries(Object.entries(input.extendedProperties).filter((entry) => (
      typeof entry[1] === 'string'
    )))
    : undefined;
  return {
    summary: input.summary,
    description: input.description,
    startDate: input.startDate,
    endDate: input.endDate,
    colorId: input.colorId,
    extendedProperties,
    visibility: input.visibility,
  };
}

export function registerCalendarIpc(deps: CalendarIpcDeps): CalendarNotificationDrain {
  const privacyReplacementReceipts = new Map<string, PrivacyReplacementReceipt>();
  const configuredReceiptTtl = deps.privacyReplacementReceiptTtlMs;
  const privacyReplacementReceiptTtlMs = Number.isFinite(configuredReceiptTtl)
    && (configuredReceiptTtl as number) > 0
    ? Math.floor(configuredReceiptTtl as number)
    : PRIVACY_REPLACEMENT_RECEIPT_TTL_MS;
  // 알림 Promise뿐 아니라 DB await 전에 등록한 mutation fence도 같은 집합으로 관리한다.
  // 종료 직전 0개를 읽은 뒤, 이미 시작된 mutation이 알림을 enqueue하는 race를 막는다.
  const pendingNotificationWork = new Set<Promise<void>>();
  let notificationMutationIntakeOpen = true;

  const trackNotificationWork = (task: Promise<void>): void => {
    pendingNotificationWork.add(task);
    // best-effort task뿐 아니라 transition cleanup도 같은 idle 집합을 쓸 수 있다.
    // reject한 work가 집합에 영구히 남거나 unhandled rejection이 되지 않게 all-settled로 정리한다.
    void task.then(
      () => { pendingNotificationWork.delete(task); },
      () => { pendingNotificationWork.delete(task); },
    );
  };

  const beginTrackedNotificationWork = (): (() => void) => {
    let released = false;
    let resolveFence!: () => void;
    const fence = new Promise<void>((resolve) => { resolveFence = resolve; });
    pendingNotificationWork.add(fence);
    return () => {
      if (released) return;
      released = true;
      // producer가 notification task를 enqueue한 뒤 finally에서 풀린다. 그러므로
      // wait loop의 다음 snapshot에는 후속 best-effort 작업도 반드시 포함된다.
      pendingNotificationWork.delete(fence);
      resolveFence();
    };
  };

  const beginNotificationMutation = (): (() => void) => {
    if (!notificationMutationIntakeOpen) {
      throw new Error('앱 종료 중이라 새 캘린더 변경을 저장할 수 없습니다');
    }
    return beginTrackedNotificationWork();
  };

  const runNotificationMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    const release = beginNotificationMutation();
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const queueCalendarNotification = (notification: CalendarNotificationContext): void => {
    const task = emitCalendarEventNotifications(notification).catch((error) => {
      // emitCalendarEventNotifications 자체도 실패를 격리하지만, 후속 리팩터링 중
      // 예외가 새어도 종료 대기 집합에 영구 작업이 남지 않게 마지막 경계를 둔다.
      console.warn('[calendarIpc] 알림 작업 실패 (best-effort):', error);
    });
    trackNotificationWork(task);
  };

  const waitForNotificationIdle = async (timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (pendingNotificationWork.size > 0) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return false;
      const settled = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), remainingMs);
        void Promise.all([...pendingNotificationWork]).then(() => {
          clearTimeout(timeout);
          resolve(true);
        });
      });
      if (!settled) return false;
    }
    return true;
  };

  const emitCommittedDelete = (marker: CalendarCommittedReplacementDeleteMarker): void => {
    // persistence는 이미 commit됐다. 닫히는 BrowserWindow나 일시적인 broadcast 오류가
    // invoke를 실패로 바꾸거나 다른 fanout 경로까지 건너뛰게 해서는 안 된다.
    try {
      deps.onCommittedReplacementDelete(marker);
    } catch (error) {
      console.warn('[Calendar IPC] local committed-delete fanout failed:', error);
    }
    try {
      broadcastCalendarCommittedDelete(marker);
    } catch (error) {
      console.warn('[Calendar IPC] cross-client committed-delete fanout failed:', error);
    }
  };

  const runStrictPostCommitSideEffect = async (
    label: string,
    sideEffect: () => void | Promise<void>,
  ): Promise<void> => {
    try {
      await sideEffect();
    } catch (error) {
      // strict migration의 persistence 결과는 이미 확정됐다. 알림/일반 invalidation
      // 전달 실패가 renderer에 replacement 보상을 지시해 0-row를 만들면 안 된다.
      console.warn(`[Calendar IPC] strict source ${label} failed after commit:`, error);
    }
  };

  const privacyReplacementRetiringOrigins = new Set<string>();
  const privacyReplacementTransitionReservations = new Map<
    string,
    PrivacyReplacementTransitionReservation
  >();
  let resolveRetiringReceipt: (entry: PrivacyReplacementReceipt) => Promise<void> = async () => undefined;
  let resolveTrackedRetiringReceipt: (entry: PrivacyReplacementReceipt) => Promise<void> = async (entry) => (
    resolveRetiringReceipt(entry)
  );

  const originKey = (origin: CalendarPrivacyReplacementOrigin): string => (
    `${origin.userId}\u0000${origin.epoch}`
  );
  const isTerminalReceipt = (entry: PrivacyReplacementReceipt): boolean => (
    entry.state === 'kept' || entry.state === 'deleted'
  );
  const sameOrigin = (
    left: CalendarPrivacyReplacementOrigin,
    right: CalendarPrivacyReplacementOrigin,
  ): boolean => left.userId === right.userId && left.epoch === right.epoch;

  const finishReceiptOperation = (
    entry: PrivacyReplacementReceipt,
    operation: Promise<void>,
  ): void => {
    if (entry.operation !== operation) return;
    const resolve = entry.resolveOperation;
    entry.operation = null;
    entry.resolveOperation = null;
    resolve?.();
  };

  const beginReceiptOperation = (
    entry: PrivacyReplacementReceipt,
    state: Extract<PrivacyReplacementState, 'creating' | 'sourceDeleting' | 'settling'>,
  ): (() => void) => {
    if (entry.operation) throw new Error('보상 receipt가 이미 처리 중입니다');
    let resolveOperation!: () => void;
    const operation = new Promise<void>((resolve) => { resolveOperation = resolve; });
    entry.operation = operation;
    entry.resolveOperation = resolveOperation;
    entry.state = state;
    return () => finishReceiptOperation(entry, operation);
  };

  const waitForReceiptOperation = async (entry: PrivacyReplacementReceipt): Promise<void> => {
    while (entry.operation) await entry.operation;
  };

  const clearReceiptExpiryTimer = (entry: PrivacyReplacementReceipt): void => {
    if (!entry.expiryTimer) return;
    clearTimeout(entry.expiryTimer);
    entry.expiryTimer = null;
  };

  const scheduleReceiptExpiry = (entry: PrivacyReplacementReceipt): void => {
    clearReceiptExpiryTimer(entry);
    const delayMs = Math.max(0, entry.expiresAt - Date.now());
    const timer = setTimeout(() => {
      entry.expiryTimer = null;
      const current = privacyReplacementReceipts.get(entry.receipt);
      if (current !== entry) return;
      expirePrivacyReplacementReceipt(entry.receipt, entry, Date.now());
    }, delayMs);
    // receipt는 최대 5분 동안만 보조 정리 대상으로 남는다. 이 timer가 정상 앱 종료를
    // 붙들면 안 되므로 Node/Electron timer일 때만 unref 한다.
    timer.unref?.();
    entry.expiryTimer = timer;
  };

  const expirePrivacyReplacementReceipt = (
    receipt: string,
    entry: PrivacyReplacementReceipt,
    now: number,
  ): void => {
    if (privacyReplacementReceipts.get(receipt) !== entry) return;
    if (entry.expiresAt > now) {
      scheduleReceiptExpiry(entry);
      return;
    }
    if (isTerminalReceipt(entry)) {
      clearReceiptExpiryTimer(entry);
      privacyReplacementReceipts.delete(receipt);
      return;
    }
    // renderer가 reload/crash하여 후속 privacy IPC가 한 번도 오지 않아도, 원본과
    // replacement를 영구히 함께 남기지 않는다. 정리 실패는 다음 TTL에 다시 시도한다.
    entry.retiring = true;
    entry.expiresAt = now + privacyReplacementReceiptTtlMs;
    scheduleReceiptExpiry(entry);
    void resolveTrackedRetiringReceipt(entry).catch((error) => {
      console.warn('[Calendar IPC] 만료 replacement receipt 정리 실패:', error);
    });
  };

  const markReceiptTerminal = (
    entry: PrivacyReplacementReceipt,
    disposition: CalendarPrivacyReplacementDisposition,
  ): void => {
    entry.state = disposition === 'keep' ? 'kept' : 'deleted';
    entry.terminalDisposition = disposition;
    // terminal outcome은 TTL 동안 보존한다. 세션 전환이 끝난 뒤 돌아온 A의 같은
    // continuation은 idempotent하지만, 반대 outcome은 더 이상 mutation할 수 없다.
    entry.expiresAt = Date.now() + privacyReplacementReceiptTtlMs;
    scheduleReceiptExpiry(entry);
  };

  const purgeExpiredReceipts = (now: number): void => {
    for (const [receipt, entry] of privacyReplacementReceipts) {
      if (entry.expiresAt <= now) expirePrivacyReplacementReceipt(receipt, entry, now);
    }
  };

  const timingSafeSecretEquals = (expected: string, supplied: unknown): boolean => {
    if (typeof supplied !== 'string' || supplied.length === 0) return false;
    const expectedBytes = Buffer.from(expected);
    const suppliedBytes = Buffer.from(supplied);
    return expectedBytes.length === suppliedBytes.length
      && timingSafeEqual(expectedBytes, suppliedBytes);
  };

  const issuePrivacyReplacementReceipt = (
    senderId: number,
    origin: CalendarSessionOrigin,
    source: CalendarPrivacyMigrationSourceDeleteInput,
  ): { receipt: string; secret: string; entry: PrivacyReplacementReceipt } => {
    const now = Date.now();
    purgeExpiredReceipts(now);
    if (privacyReplacementRetiringOrigins.has(originKey(origin))) {
      throw new Error('이전 사용자 세션의 일정 이관은 이미 정리 중입니다');
    }
    let receipt: string;
    do {
      receipt = randomBytes(32).toString('base64url');
    } while (privacyReplacementReceipts.has(receipt));
    const entry: PrivacyReplacementReceipt = {
      senderId,
      secret: randomBytes(32).toString('base64url'),
      origin: { ...origin },
      // IPC object를 그대로 잡지 않아 원본 identity가 renderer 객체 변경에 영향을 받지 않는다.
      source: { ...source } as CalendarPrivacyMigrationSourceDeleteInput,
      target: null,
      expiresAt: now + privacyReplacementReceiptTtlMs,
      state: 'creating',
      terminalDisposition: null,
      retiring: false,
      operation: null,
      resolveOperation: null,
      transitionResolution: null,
      receipt,
      expiryTimer: null,
    };
    privacyReplacementReceipts.set(receipt, entry);
    beginReceiptOperation(entry, 'creating');
    scheduleReceiptExpiry(entry);
    return { receipt, secret: entry.secret, entry };
  };

  const acquirePrivacyReplacementReceipt = (
    receipt: unknown,
    secret: unknown,
    senderId: number,
  ): { receipt: string; entry: PrivacyReplacementReceipt } => {
    purgeExpiredReceipts(Date.now());
    if (typeof receipt !== 'string' || receipt.length === 0) {
      throw new Error('보상 receipt가 올바르지 않습니다');
    }
    const entry = privacyReplacementReceipts.get(receipt);
    if (!entry) throw new Error('보상 receipt가 없거나 만료되었습니다');
    if (entry.senderId !== senderId) {
      throw new Error('보상 receipt를 발급받은 창이 아닙니다');
    }
    if (!timingSafeSecretEquals(entry.secret, secret)) {
      throw new Error('보상 continuation을 확인할 수 없습니다');
    }
    return { receipt, entry };
  };

  const replacementStillExists = async (target: PrivacyReplacementTarget): Promise<boolean> => {
    if (target.storage === 'bflow') {
      return (await store.getEventByIdForWrite(target.actualId)) !== null;
    }
    if (target.storage === 'legacy-private') {
      return (await deps.getLegacyPrivateEventOwner(target.actualId)) !== null;
    }
    return (await deps.getGoogleEvent(
      target.calendarId,
      target.actualId,
      target.actorId,
    )) !== null;
  };

  const deletePrivacyReplacement = async (target: PrivacyReplacementTarget): Promise<void> => {
    try {
      if (target.storage === 'bflow') {
        await store.deletePrivacyReplacementEvent(
          target.actualId,
          target.calendarId,
          target.createdAt,
        );
        broadcastDataChange('calendar_events', 'DELETE');
      } else if (target.storage === 'legacy-private') {
        await deps.deleteLegacyPrivateEvent(target.actualId, target.actorId);
      } else {
        await deps.deleteGoogleEvent(target.calendarId, target.actualId, target.actorId);
      }
      return;
    } catch (deleteError) {
      try {
        if (!await replacementStillExists(target)) {
          // DELETE commit 뒤 응답만 유실된 경우다. target 부재가 authoritative하게
          // 확인됐으므로 성공과 동일하게 receipt를 소진하고 exact marker를 발행한다.
          return;
        }
      } catch (readbackError) {
        const deleteMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
        const readbackMessage = readbackError instanceof Error ? readbackError.message : String(readbackError);
        throw new Error(
          `replacement delete readback unavailable (delete: ${deleteMessage}; readback: ${readbackMessage})`,
        );
      }
      // 행이 남아 있으면 persistence 실패가 확정됐다. 원래 오류를 유지하고 receipt는
      // release하여 같은 exact target으로 안전하게 재시도할 수 있게 한다.
      throw deleteError;
    }
  };

  const settlePrivacyReplacementReceipt = async (
    entry: PrivacyReplacementReceipt,
    disposition: CalendarPrivacyReplacementDisposition,
    options: { transitionOwned?: boolean } = {},
  ): Promise<void> => {
    if (disposition !== 'keep' && disposition !== 'delete') {
      throw new Error('보상 receipt 처리 방식이 올바르지 않습니다');
    }
    if (isTerminalReceipt(entry)) {
      // session transition이 main-owned terminal outcome을 만든 경우에만, 늦게 돌아온
      // A continuation의 같은 outcome을 idempotent하게 인정한다. 일반 완료 receipt는
      // 기존처럼 단일 소비라 duplicate 알림/삭제를 조기에 드러낸다.
      if (entry.retiring && entry.terminalDisposition === disposition) return;
      throw new Error('보상 receipt는 이미 반대 방식으로 확정되었습니다');
    }
    if (entry.retiring && !options.transitionOwned) {
      // 세션 전환이 시작된 뒤에는 renderer continuation이 다음 outcome을 고를 수 없다.
      // transition drain만 source 결과에 따라 terminal outcome을 정한다. terminal 처리 뒤에
      // 돌아온 A continuation은 위의 같은-outcome idempotence만 받을 수 있다.
      throw new Error('보상 receipt는 세션 전환 정리 중입니다');
    }
    if (entry.operation) {
      throw new Error('보상 receipt가 이미 처리 중입니다');
    }
    if (entry.state === 'created' && disposition !== 'delete') {
      // replacement는 원본 삭제 결과가 confirmed/ambiguous가 되기 전까지 provisional이다.
      // keep을 허용하면 원본과 공개 replacement가 함께 남을 수 있으므로, 이 상태에서는
      // 정확한 target 보상 삭제만 가능하다.
      throw new Error('원본 일정 삭제 결과를 확인하기 전에는 replacement를 유지할 수 없습니다');
    }
    if (entry.state === 'needsKeep' && disposition !== 'keep') {
      throw new Error('원본 삭제 결과가 불확실하여 replacement를 유지해야 합니다');
    }
    if (entry.state === 'needsDelete' && disposition !== 'delete') {
      throw new Error('원본 일정이 남아 있어 replacement를 삭제해야 합니다');
    }
    if (!entry.target) throw new Error('보상 대상 일정이 아직 준비되지 않았습니다');

    const previousState = entry.state;
    const release = beginReceiptOperation(entry, 'settling');
    try {
      if (disposition === 'keep') {
        if (entry.target.storage === 'bflow') queueCalendarNotification(entry.target.notification);
        markReceiptTerminal(entry, 'keep');
        return;
      }

      await deletePrivacyReplacement(entry.target);
      markReceiptTerminal(entry, 'delete');
      // persistence boundary가 직접 확정 marker를 만든다. invoke 응답이 유실되거나 sender가
      // 종료돼도 다른 BrowserWindow와 다른 앱 인스턴스는 exact row를 tombstone할 수 있다.
      emitCommittedDelete(committedReplacementDeleteMarker(entry.target));
    } catch (error) {
      // delete failure는 exact target 재시도가 가능해야 하므로 terminal로 소비하지 않는다.
      entry.state = previousState;
      throw error;
    } finally {
      release();
    }
  };

  resolveRetiringReceipt = async (entry: PrivacyReplacementReceipt): Promise<void> => {
    entry.retiring = true;
    while (!isTerminalReceipt(entry)) {
      if (entry.operation) {
        await waitForReceiptOperation(entry);
        continue;
      }
      if (entry.state === 'created') entry.state = 'needsDelete';
      if (entry.state === 'needsKeep') {
        await settlePrivacyReplacementReceipt(entry, 'keep', { transitionOwned: true });
        continue;
      }
      if (entry.state === 'needsDelete') {
        await settlePrivacyReplacementReceipt(entry, 'delete', { transitionOwned: true });
        continue;
      }
      throw new Error('replacement receipt 정리 상태가 올바르지 않습니다');
    }
  };

  /**
   * 전환/TTL 정리는 handler producer와 별도 Promise로 이어질 수 있다. persistence await
   * 전에 fence를 등록해 quit drain이 exact replacement delete까지 기다리게 한다. 원래
   * Promise는 SessionManager에 그대로 돌려 실패 시 B publish를 막고, idle 집합만 all-settled
   * 로 해제한다.
   */
  resolveTrackedRetiringReceipt = (entry: PrivacyReplacementReceipt): Promise<void> => {
    if (entry.transitionResolution) return entry.transitionResolution;
    const releaseWork = beginTrackedNotificationWork();
    const resolution = resolveRetiringReceipt(entry);
    entry.transitionResolution = resolution;
    void resolution.then(
      () => {
        if (entry.transitionResolution === resolution) entry.transitionResolution = null;
        releaseWork();
      },
      () => {
        if (entry.transitionResolution === resolution) entry.transitionResolution = null;
        releaseWork();
      },
    );
    return resolution;
  };

  const retirePrivacyReplacementReceiptsForQuit = (): void => {
    for (const entry of privacyReplacementReceipts.values()) {
      if (isTerminalReceipt(entry)) continue;
      // create가 이미 persistence를 기다리는 중이어도 entry는 발급돼 있다. 이 플래그를
      // 먼저 세우면 handler가 돌아왔을 때 ordinary continuation을 돌려주지 않고 exact
      // target 정리로 연결한다. resolution은 tracked work로 등록돼 before-quit snapshot에
      // 포함되며, 실패는 기존 best-effort 종료 정책대로 로그만 남긴다.
      entry.retiring = true;
      void resolveTrackedRetiringReceipt(entry).catch((error) => {
        console.warn('[Calendar IPC] 종료 중 replacement receipt 정리 실패:', error);
      });
    }
  };

  const sessionUser = async () => {
    const id = deps.getSessionUserIdOrThrow();
    return { id, role: await store.getUserRole(id) };
  };

  /** 관리 권한 검사용 원본 로드 — admin 은 비공개 캘린더도 관리할 수 있다. */
  const loadCalendarOrThrow = async (calendarId: string) => {
    const { calendar, members } = await store.getCalendarWithMembers(calendarId);
    if (!calendar) throw new Error('캘린더를 찾을 수 없습니다');
    return { calendar, members };
  };

  /** 캘린더 + 멤버 로드, 요청자가 볼 수 없으면 throw. */
  const loadCalendarForUserOrThrow = async (calendarId: string, userId: string) => {
    const { calendar, members } = await loadCalendarOrThrow(calendarId);
    if (!canViewCalendar(calendar, members.map((member) => member.user_id), userId)) {
      throw new Error('이 캘린더에 대한 권한이 없습니다');
    }
    return { calendar, members };
  };

  const createBflowEventForActor = async (
    input: CalendarEventCreateInput,
    actorId: string,
    deferNotification = false,
  ) => {
    const { calendar, members } = await loadCalendarForUserOrThrow(input.calendar_id, actorId);
    if (!canEditCalendarEvents(calendar, members, actorId)) {
      throw new Error('이 캘린더에 일정을 만들 권한이 없습니다');
    }
    const created = await store.createEvent(safeCalendarEventCreateInput(input), actorId);
    const notification = calendarNotificationContext({
      actorId,
      action: 'create',
      calendar,
      members,
      event: created,
      previous: null,
    });
    if (!deferNotification) queueCalendarNotification(notification);
    return { created, notification };
  };

  ipcMain.handle('calendar:list', wrap(async () => {
    const user = await sessionUser();
    await store.ensurePersonalCalendar(user.id);
    const { calendars, members } = await store.listCalendarsWithMembers();
    return calendars
      .filter((calendar) => canViewCalendar(
        calendar,
        membersOf(members, calendar.id).map((member) => member.user_id),
        user.id,
      ))
      .map((calendar) => {
        const calendarMembers = membersOf(members, calendar.id);
        return {
          ...calendar,
          members: calendarMembers.map(({ user_id, can_edit }) => ({ user_id, can_edit })),
          can_edit: canEditCalendarEvents(calendar, calendarMembers, user.id),
          can_manage: canManageCalendar(calendar, user),
        };
      });
  }));

  ipcMain.handle('calendar:create', wrap(async (input: {
    name: string;
    color: string;
    visibility: 'private' | 'members' | 'team';
    members?: unknown;
  }) => {
    const visibility = normalizeCalendarVisibility(input.visibility);
    const user = await sessionUser();
    if (!canCreateCalendar(user, visibility)) {
      throw new Error('팀 전체 캘린더는 관리자만 만들 수 있습니다');
    }
    const normalizedMembers = normalizeCalendarMembers(input.members, user.id);
    const safeMembers = visibility === 'private' ? [] : normalizedMembers;
    const created = await store.createCalendar({
      name: input.name,
      color: input.color,
      visibility,
    }, safeMembers, user.id);
    broadcastDataChange('calendars', 'INSERT');
    broadcastCalendarChanged('INSERT');
    return created;
  }));

  ipcMain.handle('calendar:update', wrap(async (
    id: string,
    updates: Parameters<typeof store.updateCalendar>[1],
  ) => {
    const requestedVisibility = updates.visibility === undefined
      ? undefined
      : normalizeCalendarVisibility(updates.visibility);
    const user = await sessionUser();
    const { calendar } = await loadCalendarOrThrow(id);
    if (!canManageCalendar(calendar, user)) {
      throw new Error('이 캘린더를 수정할 권한이 없습니다');
    }

    const requestedMembers = updates.members === undefined
      ? undefined
      : normalizeCalendarMembers(updates.members, calendar.owner_id);
    if (calendar.is_personal && requestedMembers !== undefined) {
      throw new Error('개인 캘린더에는 멤버를 추가할 수 없습니다');
    }

    const safeUpdates: Parameters<typeof store.updateCalendar>[1] = {};
    if (updates.name !== undefined) safeUpdates.name = updates.name;
    if (updates.color !== undefined) safeUpdates.color = updates.color;
    if (!calendar.is_personal && requestedVisibility !== undefined) {
      if (requestedVisibility === 'team' && !canCreateCalendar(user, 'team')) {
        throw new Error('팀 전체 캘린더는 관리자만 만들 수 있습니다');
      }
      safeUpdates.visibility = requestedVisibility;
    }
    if (!calendar.is_personal && requestedMembers !== undefined) {
      safeUpdates.members = requestedMembers;
    }

    await store.updateCalendar(id, safeUpdates, user.id);
    broadcastDataChange('calendars', 'UPDATE');
    if (safeUpdates.members !== undefined || safeUpdates.visibility === 'private') {
      broadcastDataChange('calendar_members', 'UPDATE');
    }
    broadcastCalendarChanged('UPDATE');
  }));

  ipcMain.handle('calendar:delete', wrap(async (id: string) => {
    const user = await sessionUser();
    const { calendar } = await loadCalendarOrThrow(id);
    if (calendar.is_personal) throw new Error('개인 캘린더는 삭제할 수 없습니다');
    if (!canManageCalendar(calendar, user)) {
      throw new Error('이 캘린더를 삭제할 권한이 없습니다');
    }

    await store.deleteCalendar(id, user.id);
    broadcastDataChange('calendars', 'DELETE');
    broadcastCalendarChanged('DELETE');
  }));

  ipcMain.handle('calendar:set-members', wrap(async (
    calendarId: string,
    members: unknown,
  ) => {
    const user = await sessionUser();
    const { calendar } = await loadCalendarOrThrow(calendarId);
    if (calendar.is_personal) throw new Error('개인 캘린더에는 멤버를 추가할 수 없습니다');
    if (!canManageCalendar(calendar, user)) {
      throw new Error('이 캘린더의 멤버를 수정할 권한이 없습니다');
    }

    const safeMembers = normalizeCalendarMembers(members, calendar.owner_id);
    await store.replaceMembers(calendarId, safeMembers, user.id);
    broadcastDataChange('calendar_members', 'UPDATE');
    broadcastCalendarChanged('UPDATE');
  }));

  ipcMain.handle('calendar:events:list', wrap(async (params?: { from?: string; to?: string }) => {
    const user = await sessionUser();
    return store.listEventsInRange({
      actorId: user.id,
      from: params?.from,
      to: params?.to,
    });
  }));

  ipcMain.handle('calendar:events:create', wrap(async (input: CalendarEventCreateInput) => runNotificationMutation(async () => {
    const user = await sessionUser();
    const { created } = await createBflowEventForActor(input, user.id);
    broadcastDataChange('calendar_events', 'INSERT');
    broadcastCalendarChanged('INSERT');
    return created;
  })));

  ipcMain.handle('calendar:privacy-migration:create-replacement', wrapWithEvent(async (
    event,
    rawRequest: unknown,
  ) => runNotificationMutation(async () => {
    const senderId = requireSenderId(event);
    const request = requirePrivacyReplacementRequest(rawRequest);
    // 세션을 재조회하는 async helper보다 먼저 고정한다. 이후 로그인 전환이 일어나도
    // 이 replacement와 bound source는 처음 actor/epoch만 사용한다.
    const origin = deps.getSessionOriginOrThrow();
    const issued = issuePrivacyReplacementReceipt(senderId, origin, request.source);
    const { entry } = issued;
    const releaseCreation = () => {
      if (entry.operation) finishReceiptOperation(entry, entry.operation);
    };

    try {
      // canonical origin은 동기적으로 고정했지만, 삭제된 사용자가 stale session payload로
      // target을 만들 수는 없다. target persistence 전 live-row만 확인한다.
      await store.getUserRole(origin.userId);
      let target: PrivacyReplacementTarget;
      if (request.storage === 'bflow') {
        const { created, notification } = await createBflowEventForActor(request.event, origin.userId, true);
        target = {
          storage: 'bflow',
          actualId: created.id,
          calendarId: created.calendar_id,
          actorId: origin.userId,
          createdAt: created.created_at,
          notification,
        };
        // create persistence 뒤의 broadcast도 예외를 낼 수 있다. 그 전에 exact target을
        // receipt에 기록해야 catch가 같은 row만 보수적으로 정리할 수 있다.
        entry.target = target;
        broadcastDataChange('calendar_events', 'INSERT');
        broadcastCalendarChanged('INSERT');
      } else if (request.storage === 'legacy-private') {
        const created = await deps.createLegacyPrivateEvent(
          safeLegacyPrivateCreateInput(request.event),
          origin.userId,
        );
        target = { storage: 'legacy-private', actualId: created.id, actorId: origin.userId };
        entry.target = target;
      } else {
        const actualId = await deps.createGoogleEvent(
          request.calendar_id,
          safeGoogleCreateInput(request.event),
          origin.userId,
        );
        target = {
          storage: 'google',
          actualId,
          calendarId: request.calendar_id,
          actorId: origin.userId,
        };
        entry.target = target;
      }

      if (entry.retiring) {
        entry.state = 'needsDelete';
        releaseCreation();
        await resolveTrackedRetiringReceipt(entry);
        return { transition_resolved: 'deleted' as const };
      }

      entry.state = 'created';
      releaseCreation();
      return {
        storage: target.storage,
        actual_id: target.actualId,
        calendar_id: 'calendarId' in target ? target.calendarId : undefined,
        receipt: issued.receipt,
        continuation_secret: issued.secret,
      };
    } catch (error) {
      if (entry.target) {
        // create 응답/후속 fanout에서 예외가 나도 target만 남기지 않는다.
        entry.retiring = true;
        entry.state = 'needsDelete';
        releaseCreation();
        try {
          await resolveTrackedRetiringReceipt(entry);
        } catch (cleanupError) {
          console.warn('[Calendar IPC] replacement create 실패 뒤 정리 실패:', cleanupError);
        }
      } else {
        markReceiptTerminal(entry, 'delete');
        releaseCreation();
      }
      throw error;
    }
  })));

  ipcMain.handle('calendar:privacy-migration:settle-replacement', wrapWithEvent(async (
    event,
    receipt: unknown,
    secret: unknown,
    disposition: CalendarPrivacyReplacementDisposition,
  ) => runNotificationMutation(async () => {
    const acquired = acquirePrivacyReplacementReceipt(receipt, secret, requireSenderId(event));
    await settlePrivacyReplacementReceipt(acquired.entry, disposition);
  })));

  ipcMain.handle('calendar:events:update', wrap(async (
    id: string,
    updates: Parameters<typeof store.updateEvent>[1],
  ) => runNotificationMutation(async () => {
    const user = await sessionUser();
    const previous = await store.getEventByIdForWrite(id);
    if (!previous) throw new Error('일정을 찾을 수 없습니다');
    const { calendar, members } = await loadCalendarForUserOrThrow(previous.calendar_id, user.id);
    if (!canEditCalendarEvents(calendar, members, user.id)) {
      throw new Error('이 일정을 수정할 권한이 없습니다');
    }

    let targetNotification: { calendar: CalendarRow; members: CalendarMemberRow[] } | null = null;
    if (updates.calendar_id && updates.calendar_id !== previous.calendar_id) {
      const target = await loadCalendarForUserOrThrow(updates.calendar_id, user.id);
      if (!canEditCalendarEvents(target.calendar, target.members, user.id)) {
        throw new Error('옮기려는 캘린더에 일정을 만들 권한이 없습니다');
      }
      targetNotification = target;
    }

    const safeUpdates: Parameters<typeof store.updateEvent>[1] = {};
    if (updates.calendar_id !== undefined) safeUpdates.calendar_id = updates.calendar_id;
    if (updates.title !== undefined) safeUpdates.title = updates.title;
    if (updates.memo !== undefined) safeUpdates.memo = updates.memo;
    if (updates.tag_id !== undefined) safeUpdates.tag_id = updates.tag_id;
    if (updates.all_day !== undefined) safeUpdates.all_day = updates.all_day;
    if (updates.start_date !== undefined) safeUpdates.start_date = updates.start_date;
    if (updates.end_date !== undefined) safeUpdates.end_date = updates.end_date;
    if (updates.start_time !== undefined) safeUpdates.start_time = updates.start_time;
    if (updates.end_time !== undefined) safeUpdates.end_time = updates.end_time;
    if (updates.linked_episode !== undefined) safeUpdates.linked_episode = updates.linked_episode;
    if (updates.linked_part !== undefined) safeUpdates.linked_part = updates.linked_part;
    if (updates.linked_sheet_name !== undefined) safeUpdates.linked_sheet_name = updates.linked_sheet_name;
    if (updates.linked_scene_id !== undefined) safeUpdates.linked_scene_id = updates.linked_scene_id;
    if (updates.linked_department !== undefined) safeUpdates.linked_department = updates.linked_department;
    if (updates.linked_todo_id !== undefined) safeUpdates.linked_todo_id = updates.linked_todo_id;
    const updated = await store.updateEvent(id, safeUpdates, previous.calendar_id, user.id);
    if (targetNotification) {
      queueCalendarNotification(calendarNotificationContext({
        actorId: user.id,
        action: 'delete',
        calendar,
        members,
        event: null,
        previous,
      }));
      queueCalendarNotification(calendarNotificationContext({
        actorId: user.id,
        action: 'create',
        calendar: targetNotification.calendar,
        members: targetNotification.members,
        event: updated,
        previous: null,
      }));
    } else {
      queueCalendarNotification(calendarNotificationContext({
        actorId: user.id,
        action: 'update',
        calendar,
        members,
        event: updated,
        previous,
      }));
    }
    broadcastDataChange('calendar_events', 'UPDATE');
    broadcastCalendarChanged('UPDATE');
    return updated;
  })));

  const deleteCalendarEventIfPresent = async (
    id: string,
    classifyStrictMigrationOutcome = false,
    capturedActor?: CalendarActor,
  ): Promise<CalendarPrivacyMigrationSourceDeleteResult> => {
    const user = capturedActor ?? await sessionUser();
    const previous = await store.getEventByIdForWrite(id);
    if (!previous) return 'missing';
    const { calendar, members } = await loadCalendarForUserOrThrow(previous.calendar_id, user.id);
    if (!canEditCalendarEvents(calendar, members, user.id)) {
      throw new Error('이 일정을 삭제할 권한이 없습니다');
    }

    try {
      await store.deleteEvent(id, previous.calendar_id, user.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!classifyStrictMigrationOutcome) throw error;

      // strict migration은 RPC response-loss 뒤 replacement까지 지워 0-row가 되는 일을
      // 막아야 한다. 원본이 여전히 있으면 definitive failure, 재조회도 실패하거나
      // non-conflict error 뒤 사라졌다면 commit 여부가 불확실하므로 replacement를 유지한다.
      let latest: CalendarEventRow | null;
      try {
        latest = await store.getEventByIdForWrite(id);
      } catch {
        return 'ambiguous';
      }
      if (latest) throw error;
      // pre-read로 exact calendar/actor를 확인한 뒤 authoritative readback이 부재를
      // 확정했다. migration 결과가 missing/ambiguous 어느 쪽이든 다른 cache에는
      // source absence를 전파한다. readback 자체 실패에는 marker를 내지 않는다.
      emitCommittedDelete({
        eventId: id,
        action: 'delete',
        storage: 'bflow',
        calendarId: previous.calendar_id,
        committedPrivacyReplacementDelete: true,
      });
      return /calendar event source changed; refresh and retry/i.test(message)
        ? 'missing'
        : 'ambiguous';
    }
    if (classifyStrictMigrationOutcome) {
      emitCommittedDelete({
        eventId: id,
        action: 'delete',
        storage: 'bflow',
        calendarId: previous.calendar_id,
        committedPrivacyReplacementDelete: true,
      });
      await runStrictPostCommitSideEffect('notification', () => {
        queueCalendarNotification(calendarNotificationContext({
          actorId: user.id,
          action: 'delete',
          calendar,
          members,
          event: null,
          previous,
        }));
      });
      await runStrictPostCommitSideEffect('data broadcast', () => {
        broadcastDataChange('calendar_events', 'DELETE');
      });
      await runStrictPostCommitSideEffect('calendar broadcast', () => {
        broadcastCalendarChanged('DELETE');
      });
      return 'deleted';
    }
    queueCalendarNotification(calendarNotificationContext({
      actorId: user.id,
      action: 'delete',
      calendar,
      members,
      event: null,
      previous,
    }));
    broadcastDataChange('calendar_events', 'DELETE');
    broadcastCalendarChanged('DELETE');
    return 'deleted';
  };

  const deleteLegacyPrivateMigrationSource = async (
    eventId: string,
    capturedActor?: CalendarActor,
  ): Promise<CalendarPrivacyMigrationSourceDeleteResult> => {
    const user = capturedActor ?? await sessionUser();
    const ownerId = await deps.getLegacyPrivateEventOwner(eventId);
    if (!ownerId) return 'missing';
    if (ownerId !== user.id) {
      throw new Error('이 비공개 일정을 삭제할 권한이 없습니다');
    }

    let result: 'deleted' | 'missing';
    try {
      result = await deps.deleteLegacyPrivateSourceEvent(eventId, user.id);
    } catch (error) {
      // 네트워크 응답 유실이면 DELETE가 commit됐을 수 있다. 원본이 확실히 남아 있을
      // 때만 definitive failure로 되던지고, 캡처 owner의 부재는 replacement를 보존한다.
      let latestOwnerId: string | null;
      try {
        latestOwnerId = await deps.getLegacyPrivateEventOwner(eventId);
      } catch {
        return 'ambiguous';
      }
      if (latestOwnerId === user.id) throw error;
      emitCommittedDelete({
        eventId,
        action: 'delete',
        storage: 'legacy-private',
        ownerId: user.id,
        committedPrivacyReplacementDelete: true,
      });
      return 'ambiguous';
    }

    if (result === 'deleted') {
      emitCommittedDelete({
        eventId,
        action: 'delete',
        storage: 'legacy-private',
        ownerId: user.id,
        committedPrivacyReplacementDelete: true,
      });
      return result;
    }

    // owner-bound DELETE 0건은 행 부재뿐 아니라 같은 ID가 다른 owner의 새 행으로
    // 교체된 경합도 뜻할 수 있다. captured owner가 여전히 보이면 definitive failure다.
    let latestOwnerId: string | null;
    try {
      latestOwnerId = await deps.getLegacyPrivateEventOwner(eventId);
    } catch {
      return 'missing';
    }
    if (latestOwnerId === user.id) {
      throw new Error('구 비공개 이관 원본 삭제가 완료되지 않았습니다');
    }
    // null 또는 다른 owner면 캡처한 owner의 source는 사라졌다. owner-scoped marker라
    // 새 owner의 같은 ID 행에는 적용되지 않는다.
    emitCommittedDelete({
      eventId,
      action: 'delete',
      storage: 'legacy-private',
      ownerId: user.id,
      committedPrivacyReplacementDelete: true,
    });
    return result;
  };

  const deleteGoogleMigrationSource = async (
    calendarId: string,
    eventId: string,
    capturedActor?: CalendarActor,
  ): Promise<CalendarPrivacyMigrationSourceDeleteResult> => {
    const user = capturedActor ?? await sessionUser();
    const previous = await deps.getGoogleEvent(calendarId, eventId, user.id);
    if (!previous) return 'missing';

    try {
      await deps.deleteGoogleEvent(calendarId, eventId, user.id);
      emitCommittedDelete({
        eventId,
        action: 'delete',
        calendarId,
        committedGoogleDelete: true,
      });
      return 'deleted';
    } catch (error) {
      // pre-read hit 뒤 DELETE 404는 source 부재는 확정하지만, gaxios가 response-loss
      // DELETE를 자동 재시도해 404를 받았을 수도 있다. replacement는 보상하지 않는다.
      if (isGoogleNotFoundError(error)) {
        emitCommittedDelete({
          eventId,
          action: 'delete',
          calendarId,
          committedGoogleDelete: true,
        });
        return 'ambiguous';
      }
      try {
        const latest = await deps.getGoogleEvent(calendarId, eventId, user.id);
        if (latest) throw error;
      } catch (readbackError) {
        if (readbackError === error) throw error;
        return 'ambiguous';
      }
      emitCommittedDelete({
        eventId,
        action: 'delete',
        calendarId,
        committedGoogleDelete: true,
      });
      return 'ambiguous';
    }
  };

  ipcMain.handle('calendar:events:delete', wrap(async (id: string) => runNotificationMutation(async () => {
    await deleteCalendarEventIfPresent(id);
  })));

  ipcMain.handle('calendar:privacy-migration:delete-source', wrap(async (rawRequest: unknown) => runNotificationMutation(async () => {
    const request = requirePrivacyMigrationSourceDeleteRequest(rawRequest);
    if (request.storage === 'bflow') {
      return deleteCalendarEventIfPresent(request.event_id, true);
    }
    if (request.storage === 'legacy-private') {
      return deleteLegacyPrivateMigrationSource(request.event_id);
    }
    return deleteGoogleMigrationSource(request.calendar_id, request.event_id);
  })));

  /**
   * preload만 raw receipt/secret을 가진 private source-delete capability.
   * renderer는 source identity를 고를 수 없고, 세션 전환 뒤 B가 A의 closure를
   * 호출해도 origin/retiring fence가 persistence 전에 막는다.
   */
  ipcMain.handle('calendar:privacy-migration:delete-bound-source', wrapWithEvent(async (
    event,
    receipt: unknown,
    secret: unknown,
  ) => runNotificationMutation(async () => {
    const acquired = acquirePrivacyReplacementReceipt(receipt, secret, requireSenderId(event));
    const { entry } = acquired;
    const currentOrigin = deps.getSessionOriginOrThrow();
    if (entry.retiring || !sameOrigin(entry.origin, currentOrigin)) {
      throw new Error('세션 전환 뒤 이전 사용자의 이관 원본은 더 이상 삭제할 수 없습니다');
    }
    if (entry.state !== 'created' || entry.operation) {
      throw new Error('이관 원본을 삭제할 수 있는 replacement 상태가 아닙니다');
    }

    const release = beginReceiptOperation(entry, 'sourceDeleting');
    const actor: CalendarActor = { id: entry.origin.userId, role: entry.origin.role };
    try {
      const result = entry.source.storage === 'bflow'
        ? await deleteCalendarEventIfPresent(entry.source.event_id, true, actor)
        : entry.source.storage === 'legacy-private'
          ? await deleteLegacyPrivateMigrationSource(entry.source.event_id, actor)
          : await deleteGoogleMigrationSource(entry.source.calendar_id, entry.source.event_id, actor);
      entry.state = result === 'deleted' || result === 'ambiguous' ? 'needsKeep' : 'needsDelete';
      return result;
    } catch (error) {
      // strict source helper가 throw하면 source가 남았다고 보수적으로 취급해 target을
      // 삭제한다. 세션 전환 drain도 동일한 terminal rule을 사용한다.
      entry.state = 'needsDelete';
      throw error;
    } finally {
      release();
    }
  })));

  ipcMain.handle('calendar:tags:list', wrap(async () => {
    await sessionUser();
    return store.listTags();
  }));

  ipcMain.handle('calendar:tags:save', wrap(async (
    tags: Array<{ id?: string; name: string; color: string; sort_order: number }>,
  ) => {
    const user = await sessionUser();
    if (user.role !== 'admin') throw new Error('태그는 관리자만 수정할 수 있습니다');
    const safeTags = tags.map(({ id, name, color, sort_order }) => ({ id, name, color, sort_order }));
    const saved = await store.saveTags(safeTags, user.id);
    broadcastDataChange('calendar_tags', 'UPDATE');
    broadcastCalendarChanged('UPDATE');
    return saved;
  }));

  ipcMain.handle('calendar:notifications:catchup', wrap(async (input: unknown) => {
    const user = await sessionUser();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return store.listUnreadNotifications(
      user.id,
      since,
      normalizeCalendarNotificationCatchupInput(input),
    );
  }));

  ipcMain.handle('calendar:notifications:mark-read', wrap(async (ids: string[]) => {
    const user = await sessionUser();
    await store.markNotificationsRead(user.id, ids);
  }));

  return {
    beginQuitting: () => {
      notificationMutationIntakeOpen = false;
      retirePrivacyReplacementReceiptsForQuit();
    },
    beginPrivacyReplacementTransition: (origin) => {
      const key = originKey(origin);
      // prepareTransition은 begin 직후 첫 await 전에 drain을 시작한다. 여기서 미리
      // fence를 잡아 quit snapshot과 그 사이에 새 target cleanup이 끼어드는 race를 막는다.
      if (!privacyReplacementTransitionReservations.has(key)) {
        if (!notificationMutationIntakeOpen) {
          throw new Error('앱 종료 중이라 새 캘린더 세션 전환을 시작할 수 없습니다');
        }
        privacyReplacementTransitionReservations.set(key, {
          releaseWork: beginTrackedNotificationWork(),
          drain: null,
        });
      }
      privacyReplacementRetiringOrigins.add(key);
      for (const entry of privacyReplacementReceipts.values()) {
        if (sameOrigin(entry.origin, origin)) entry.retiring = true;
      }
    },
    drainPrivacyReplacementTransition: async (origin) => {
      const key = originKey(origin);
      const reservation = privacyReplacementTransitionReservations.get(key);
      if (!reservation) {
        if (!notificationMutationIntakeOpen) {
          throw new Error('앱 종료 뒤에는 예약되지 않은 캘린더 세션 전환을 정리할 수 없습니다');
        }
        throw new Error('캘린더 세션 전환이 먼저 예약되지 않았습니다');
      }
      if (reservation.drain) return reservation.drain;

      // begin 이후 이미 시작된 create/source-delete는 operation completion을 기다리고,
      // completion 결과에 맞춰 keep 또는 exact target delete로 terminalize한다. reject는
      // SessionManager까지 그대로 전파하지만, finally에서 reservation fence는 해제한다.
      const drain = (async () => {
        try {
          while (true) {
            const entries = [...privacyReplacementReceipts.values()]
              .filter((entry) => sameOrigin(entry.origin, origin));
            if (entries.length === 0 || entries.every(isTerminalReceipt)) return;
            await Promise.all(entries.map((entry) => resolveTrackedRetiringReceipt(entry)));
          }
        } finally {
          if (privacyReplacementTransitionReservations.get(key) === reservation) {
            privacyReplacementTransitionReservations.delete(key);
            reservation.releaseWork();
          }
        }
      })();
      reservation.drain = drain;
      return drain;
    },
    completePrivacyReplacementTransition: (origin) => {
      privacyReplacementRetiringOrigins.delete(originKey(origin));
    },
    abortPrivacyReplacementTransition: (origin) => {
      privacyReplacementRetiringOrigins.delete(originKey(origin));
    },
    getPendingNotificationCount: () => pendingNotificationWork.size,
    waitForNotificationIdle,
  };
}
