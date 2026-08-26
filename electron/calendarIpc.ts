/** electron/calendarIpc.ts — calendar:* IPC 등록.
 *  세션 검증(getSessionUserIdOrThrow 주입) + 권한 강제(calendarPermissions) + broadcast.
 *  main.ts 비대화 방지를 위해 분리. 렌더러 → 여기 → calendarStore → Supabase 단일 경로. */
import { randomBytes } from 'node:crypto';
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
}

type CalendarEventCreateInput = Parameters<typeof store.createEvent>[0];
type InvokeEvent = { sender?: { id?: number } };

type PrivacyReplacementTarget =
  | {
      storage: 'bflow';
      actualId: string;
      calendarId: string;
      actorId: string;
      createdAt: string;
    }
  | { storage: 'legacy-private'; actualId: string; actorId: string }
  | { storage: 'google'; actualId: string; calendarId: string; actorId: string };

type PrivacyReplacementReceipt = {
  senderId: number;
  target: PrivacyReplacementTarget;
  expiresAt: number;
  inFlight: boolean;
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
  if (request.storage === 'google' && (
    typeof request.calendar_id !== 'string'
    || request.calendar_id.trim().length === 0
  )) {
    throw new Error('구글 캘린더 ID가 올바르지 않습니다');
  }
  return request as unknown as CalendarPrivacyReplacementCreateInput;
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
  return request as unknown as CalendarPrivacyMigrationSourceDeleteInput;
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
async function emitCalendarEventNotifications(ctx: {
  actorId: string;
  action: 'create' | 'update' | 'delete';
  calendar: CalendarRow;
  members: CalendarMemberRow[];
  event: CalendarEventRow | null;
  previous: CalendarEventRow | null;
}): Promise<void> {
  try {
    const event = ctx.event ?? ctx.previous;
    if (!event) return;

    const users = await readUsers();
    const recipients = computeCalendarNotificationRecipients(
      ctx.calendar,
      ctx.members.map((member) => member.user_id),
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

export function registerCalendarIpc(deps: CalendarIpcDeps): void {
  const privacyReplacementReceipts = new Map<string, PrivacyReplacementReceipt>();

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

  const purgeExpiredReceipts = (now: number) => {
    for (const [receipt, entry] of privacyReplacementReceipts) {
      // 이미 persistence 요청이 시작된 receipt는 완료 판정 전까지 유지한다.
      if (!entry.inFlight && entry.expiresAt <= now) privacyReplacementReceipts.delete(receipt);
    }
  };

  const issuePrivacyReplacementReceipt = (
    senderId: number,
    target: PrivacyReplacementTarget,
  ): string => {
    const now = Date.now();
    purgeExpiredReceipts(now);
    let receipt: string;
    do {
      receipt = randomBytes(32).toString('base64url');
    } while (privacyReplacementReceipts.has(receipt));
    privacyReplacementReceipts.set(receipt, {
      senderId,
      target,
      expiresAt: now + PRIVACY_REPLACEMENT_RECEIPT_TTL_MS,
      inFlight: false,
    });
    return receipt;
  };

  const acquirePrivacyReplacementReceipt = (
    receipt: unknown,
    senderId: number,
  ): { receipt: string; target: PrivacyReplacementTarget } => {
    if (typeof receipt !== 'string' || receipt.length === 0) {
      throw new Error('보상 receipt가 올바르지 않습니다');
    }
    const entry = privacyReplacementReceipts.get(receipt);
    if (!entry) throw new Error('보상 receipt가 없거나 이미 사용되었습니다');
    if (entry.expiresAt <= Date.now()) {
      privacyReplacementReceipts.delete(receipt);
      throw new Error('보상 receipt가 만료되었습니다');
    }
    if (entry.senderId !== senderId) {
      throw new Error('보상 receipt를 발급받은 창이 아닙니다');
    }
    if (entry.inFlight) {
      throw new Error('보상 receipt가 이미 처리 중입니다');
    }
    entry.inFlight = true;
    return { receipt, target: entry.target };
  };

  const settlePrivacyReplacementReceipt = (receipt: string, consume: boolean): void => {
    const entry = privacyReplacementReceipts.get(receipt);
    if (!entry) return;
    if (consume) {
      privacyReplacementReceipts.delete(receipt);
      return;
    }
    // 삭제가 커밋되지 않았거나 확인할 수 없으면 같은 창이 정확한 target으로 재시도한다.
    entry.inFlight = false;
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
  ) => {
    const { calendar, members } = await loadCalendarForUserOrThrow(input.calendar_id, actorId);
    if (!canEditCalendarEvents(calendar, members, actorId)) {
      throw new Error('이 캘린더에 일정을 만들 권한이 없습니다');
    }
    const created = await store.createEvent(safeCalendarEventCreateInput(input), actorId);
    void emitCalendarEventNotifications({
      actorId,
      action: 'create',
      calendar,
      members,
      event: created,
      previous: null,
    });
    return created;
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

  ipcMain.handle('calendar:events:create', wrap(async (input: CalendarEventCreateInput) => {
    const user = await sessionUser();
    const created = await createBflowEventForActor(input, user.id);
    broadcastDataChange('calendar_events', 'INSERT');
    broadcastCalendarChanged('INSERT');
    return created;
  }));

  ipcMain.handle('calendar:privacy-migration:create-replacement', wrapWithEvent(async (
    event,
    rawRequest: unknown,
  ) => {
    const senderId = requireSenderId(event);
    const user = await sessionUser();
    const actorId = user.id;
    const request = requirePrivacyReplacementRequest(rawRequest);
    let target: PrivacyReplacementTarget;

    if (request.storage === 'bflow') {
      const created = await createBflowEventForActor(request.event, actorId);
      target = {
        storage: 'bflow',
        actualId: created.id,
        calendarId: created.calendar_id,
        actorId,
        createdAt: created.created_at,
      };
      broadcastDataChange('calendar_events', 'INSERT');
      broadcastCalendarChanged('INSERT');
    } else if (request.storage === 'legacy-private') {
      const created = await deps.createLegacyPrivateEvent(
        safeLegacyPrivateCreateInput(request.event),
        actorId,
      );
      target = { storage: 'legacy-private', actualId: created.id, actorId };
    } else {
      const actualId = await deps.createGoogleEvent(
        request.calendar_id,
        safeGoogleCreateInput(request.event),
        actorId,
      );
      target = {
        storage: 'google',
        actualId,
        calendarId: request.calendar_id,
        actorId,
      };
    }

    return {
      storage: target.storage,
      actual_id: target.actualId,
      calendar_id: 'calendarId' in target ? target.calendarId : undefined,
      receipt: issuePrivacyReplacementReceipt(senderId, target),
    };
  }));

  ipcMain.handle('calendar:privacy-migration:settle-replacement', wrapWithEvent(async (
    event,
    receipt: unknown,
    disposition: CalendarPrivacyReplacementDisposition,
  ) => {
    if (disposition !== 'keep' && disposition !== 'delete') {
      throw new Error('보상 receipt 처리 방식이 올바르지 않습니다');
    }
    const acquired = acquirePrivacyReplacementReceipt(receipt, requireSenderId(event));
    if (disposition === 'keep') {
      settlePrivacyReplacementReceipt(acquired.receipt, true);
      return;
    }

    try {
      await deletePrivacyReplacement(acquired.target);
    } catch (error) {
      settlePrivacyReplacementReceipt(acquired.receipt, false);
      throw error;
    }

    settlePrivacyReplacementReceipt(acquired.receipt, true);
    const marker = committedReplacementDeleteMarker(acquired.target);
    // persistence boundary가 직접 확정 marker를 만든다. invoke 응답이 유실되거나 sender가
    // 종료돼도 다른 BrowserWindow와 다른 앱 인스턴스는 exact row를 tombstone할 수 있다.
    emitCommittedDelete(marker);
  }));

  ipcMain.handle('calendar:events:update', wrap(async (
    id: string,
    updates: Parameters<typeof store.updateEvent>[1],
  ) => {
    const user = await sessionUser();
    const previous = await store.getEventByIdForWrite(id);
    if (!previous) throw new Error('일정을 찾을 수 없습니다');
    const { calendar, members } = await loadCalendarForUserOrThrow(previous.calendar_id, user.id);
    if (!canEditCalendarEvents(calendar, members, user.id)) {
      throw new Error('이 일정을 수정할 권한이 없습니다');
    }

    let notificationCalendar = calendar;
    let notificationMembers = members;
    if (updates.calendar_id && updates.calendar_id !== previous.calendar_id) {
      const target = await loadCalendarForUserOrThrow(updates.calendar_id, user.id);
      if (!canEditCalendarEvents(target.calendar, target.members, user.id)) {
        throw new Error('옮기려는 캘린더에 일정을 만들 권한이 없습니다');
      }
      notificationCalendar = target.calendar;
      notificationMembers = target.members;
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
    void emitCalendarEventNotifications({
      actorId: user.id,
      action: 'update',
      calendar: notificationCalendar,
      members: notificationMembers,
      event: updated,
      previous,
    });
    broadcastDataChange('calendar_events', 'UPDATE');
    broadcastCalendarChanged('UPDATE');
    return updated;
  }));

  const deleteCalendarEventIfPresent = async (
    id: string,
    classifyStrictMigrationOutcome = false,
  ): Promise<CalendarPrivacyMigrationSourceDeleteResult> => {
    const user = await sessionUser();
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
        void emitCalendarEventNotifications({
          actorId: user.id,
          action: 'delete',
          calendar,
          members,
          event: null,
          previous,
        });
      });
      await runStrictPostCommitSideEffect('data broadcast', () => {
        broadcastDataChange('calendar_events', 'DELETE');
      });
      await runStrictPostCommitSideEffect('calendar broadcast', () => {
        broadcastCalendarChanged('DELETE');
      });
      return 'deleted';
    }
    void emitCalendarEventNotifications({
      actorId: user.id,
      action: 'delete',
      calendar,
      members,
      event: null,
      previous,
    });
    broadcastDataChange('calendar_events', 'DELETE');
    broadcastCalendarChanged('DELETE');
    return 'deleted';
  };

  const deleteLegacyPrivateMigrationSource = async (
    eventId: string,
  ): Promise<CalendarPrivacyMigrationSourceDeleteResult> => {
    const user = await sessionUser();
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
  ): Promise<CalendarPrivacyMigrationSourceDeleteResult> => {
    const user = await sessionUser();
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

  ipcMain.handle('calendar:events:delete', wrap(async (id: string) => {
    await deleteCalendarEventIfPresent(id);
  }));

  ipcMain.handle('calendar:privacy-migration:delete-source', wrap(async (rawRequest: unknown) => {
    const request = requirePrivacyMigrationSourceDeleteRequest(rawRequest);
    if (request.storage === 'bflow') {
      return deleteCalendarEventIfPresent(request.event_id, true);
    }
    if (request.storage === 'legacy-private') {
      return deleteLegacyPrivateMigrationSource(request.event_id);
    }
    return deleteGoogleMigrationSource(request.calendar_id, request.event_id);
  }));

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

  ipcMain.handle('calendar:notifications:catchup', wrap(async () => {
    const user = await sessionUser();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return store.listUnreadNotifications(user.id, since);
  }));

  ipcMain.handle('calendar:notifications:mark-read', wrap(async (ids: string[]) => {
    const user = await sessionUser();
    await store.markNotificationsRead(user.id, ids);
  }));
}
