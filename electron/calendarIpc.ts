/** electron/calendarIpc.ts — calendar:* IPC 등록.
 *  세션 검증(getSessionUserIdOrThrow 주입) + 권한 강제(calendarPermissions) + broadcast.
 *  main.ts 비대화 방지를 위해 분리. 렌더러 → 여기 → calendarStore → Supabase 단일 경로. */
import { ipcMain } from 'electron';
import {
  canViewCalendar,
  canEditCalendarEvents,
  canManageCalendar,
  canCreateCalendar,
} from '../src/shared/calendarPermissions';
import * as store from './calendarStore';
import type { CalendarRow, CalendarEventRow, CalendarMemberRow } from './calendarStore';
import { broadcastCalendarChanged, broadcastDataChange } from './broadcast';

interface CalendarIpcDeps {
  getSessionUserIdOrThrow: () => string;
}

type CalendarEventCreateInput = Omit<Parameters<typeof store.createEvent>[0], 'created_by'> & {
  created_by?: string | null;
};

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

/** 일정 쓰기 성공 후 알림 파이프라인 진입점 (설계서 §8).
 *  PR4 에서 수신자 계산 + calendar_notifications insert 를 구현한다.
 *  PR2 에서는 호출 지점만 확정하고 의도적으로 아무것도 하지 않는다. */
async function emitCalendarEventNotifications(_ctx: {
  actorId: string;
  action: 'create' | 'update' | 'delete';
  calendar: CalendarRow;
  members: CalendarMemberRow[];
  event: CalendarEventRow | null;
  previous: CalendarEventRow | null;
}): Promise<void> {
  return;
}

const membersOf = (all: CalendarMemberRow[], calendarId: string) =>
  all.filter((member) => member.calendar_id === calendarId);

export function registerCalendarIpc(deps: CalendarIpcDeps): void {
  const sessionUser = async () => {
    const id = deps.getSessionUserIdOrThrow();
    return { id, role: await store.getUserRole(id) };
  };

  /** 캘린더 + 멤버 로드, 요청자가 볼 수 없으면 throw. */
  const loadCalendarForUserOrThrow = async (calendarId: string, userId: string) => {
    const { calendar, members } = await store.getCalendarWithMembers(calendarId);
    if (!calendar) throw new Error('캘린더를 찾을 수 없습니다');
    if (!canViewCalendar(calendar, members.map((member) => member.user_id), userId)) {
      throw new Error('이 캘린더에 대한 권한이 없습니다');
    }
    return { calendar, members };
  };

  ipcMain.handle('calendar:list', wrap(async () => {
    const user = await sessionUser();
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
    members?: Array<{ user_id: string; can_edit: boolean }>;
  }) => {
    const user = await sessionUser();
    if (!canCreateCalendar(user, input.visibility)) {
      throw new Error('팀 전체 캘린더는 관리자만 만들 수 있습니다');
    }
    const created = await store.createCalendar({
      name: input.name,
      color: input.color,
      visibility: input.visibility,
      owner_id: user.id,
      is_personal: false,
    });
    if (input.members?.length && input.visibility !== 'private') {
      const safeMembers = input.members
        .filter((member) => member.user_id !== user.id)
        .map(({ user_id, can_edit }) => ({ user_id, can_edit }));
      await store.replaceMembers(created.id, safeMembers);
    }
    broadcastDataChange('calendars', 'INSERT');
    broadcastCalendarChanged('INSERT');
    return created;
  }));

  ipcMain.handle('calendar:update', wrap(async (
    id: string,
    updates: Parameters<typeof store.updateCalendar>[1],
  ) => {
    const user = await sessionUser();
    const { calendar } = await loadCalendarForUserOrThrow(id, user.id);
    if (!canManageCalendar(calendar, user)) {
      throw new Error('이 캘린더를 수정할 권한이 없습니다');
    }

    const safeUpdates: Parameters<typeof store.updateCalendar>[1] = {};
    if (updates.name !== undefined) safeUpdates.name = updates.name;
    if (updates.color !== undefined) safeUpdates.color = updates.color;
    if (!calendar.is_personal && updates.visibility !== undefined) {
      if (updates.visibility === 'team' && !canCreateCalendar(user, 'team')) {
        throw new Error('팀 전체 캘린더는 관리자만 만들 수 있습니다');
      }
      safeUpdates.visibility = updates.visibility;
    }

    await store.updateCalendar(id, safeUpdates);
    broadcastDataChange('calendars', 'UPDATE');
    broadcastCalendarChanged('UPDATE');
  }));

  ipcMain.handle('calendar:delete', wrap(async (id: string) => {
    const user = await sessionUser();
    const { calendar } = await loadCalendarForUserOrThrow(id, user.id);
    if (calendar.is_personal) throw new Error('개인 캘린더는 삭제할 수 없습니다');
    if (!canManageCalendar(calendar, user)) {
      throw new Error('이 캘린더를 삭제할 권한이 없습니다');
    }

    await store.deleteCalendar(id);
    broadcastDataChange('calendars', 'DELETE');
    broadcastCalendarChanged('DELETE');
  }));

  ipcMain.handle('calendar:set-members', wrap(async (
    calendarId: string,
    members: Array<{ user_id: string; can_edit: boolean }>,
  ) => {
    const user = await sessionUser();
    const { calendar } = await loadCalendarForUserOrThrow(calendarId, user.id);
    if (calendar.is_personal) throw new Error('개인 캘린더에는 멤버를 추가할 수 없습니다');
    if (!canManageCalendar(calendar, user)) {
      throw new Error('이 캘린더의 멤버를 수정할 권한이 없습니다');
    }

    const safeMembers = members
      .filter((member) => member.user_id !== calendar.owner_id)
      .map(({ user_id, can_edit }) => ({ user_id, can_edit }));
    await store.replaceMembers(calendarId, safeMembers);
    broadcastDataChange('calendar_members', 'UPDATE');
    broadcastCalendarChanged('UPDATE');
  }));

  ipcMain.handle('calendar:events:list', wrap(async (params?: { from?: string; to?: string }) => {
    const user = await sessionUser();
    const { calendars, members } = await store.listCalendarsWithMembers();
    const visibleIds = calendars
      .filter((calendar) => canViewCalendar(
        calendar,
        membersOf(members, calendar.id).map((member) => member.user_id),
        user.id,
      ))
      .map((calendar) => calendar.id);
    return store.listEventsInRange({
      calendarIds: visibleIds,
      from: params?.from,
      to: params?.to,
    });
  }));

  ipcMain.handle('calendar:events:create', wrap(async (input: CalendarEventCreateInput) => {
    const user = await sessionUser();
    const { calendar, members } = await loadCalendarForUserOrThrow(input.calendar_id, user.id);
    if (!canEditCalendarEvents(calendar, members, user.id)) {
      throw new Error('이 캘린더에 일정을 만들 권한이 없습니다');
    }

    const created = await store.createEvent({ ...input, created_by: user.id });
    await emitCalendarEventNotifications({
      actorId: user.id,
      action: 'create',
      calendar,
      members,
      event: created,
      previous: null,
    });
    broadcastDataChange('calendar_events', 'INSERT');
    broadcastCalendarChanged('INSERT');
    return created;
  }));

  ipcMain.handle('calendar:events:update', wrap(async (
    id: string,
    updates: Parameters<typeof store.updateEvent>[1],
  ) => {
    const user = await sessionUser();
    const previous = await store.getEventById(id);
    if (!previous) throw new Error('일정을 찾을 수 없습니다');
    const { calendar, members } = await loadCalendarForUserOrThrow(previous.calendar_id, user.id);
    if (!canEditCalendarEvents(calendar, members, user.id)) {
      throw new Error('이 일정을 수정할 권한이 없습니다');
    }

    if (updates.calendar_id && updates.calendar_id !== previous.calendar_id) {
      const target = await loadCalendarForUserOrThrow(updates.calendar_id, user.id);
      if (!canEditCalendarEvents(target.calendar, target.members, user.id)) {
        throw new Error('옮기려는 캘린더에 일정을 만들 권한이 없습니다');
      }
    }

    const { created_by: _ignoredCreatedBy, ...safeUpdates } = updates;
    const updated = await store.updateEvent(id, safeUpdates);
    await emitCalendarEventNotifications({
      actorId: user.id,
      action: 'update',
      calendar,
      members,
      event: updated,
      previous,
    });
    broadcastDataChange('calendar_events', 'UPDATE');
    broadcastCalendarChanged('UPDATE');
    return updated;
  }));

  ipcMain.handle('calendar:events:delete', wrap(async (id: string) => {
    const user = await sessionUser();
    const previous = await store.getEventById(id);
    if (!previous) return;
    const { calendar, members } = await loadCalendarForUserOrThrow(previous.calendar_id, user.id);
    if (!canEditCalendarEvents(calendar, members, user.id)) {
      throw new Error('이 일정을 삭제할 권한이 없습니다');
    }

    await store.deleteEvent(id);
    await emitCalendarEventNotifications({
      actorId: user.id,
      action: 'delete',
      calendar,
      members,
      event: null,
      previous,
    });
    broadcastDataChange('calendar_events', 'DELETE');
    broadcastCalendarChanged('DELETE');
  }));

  ipcMain.handle('calendar:tags:list', wrap(async () => {
    deps.getSessionUserIdOrThrow();
    return store.listTags();
  }));

  ipcMain.handle('calendar:tags:save', wrap(async (
    tags: Array<{ id?: string; name: string; color: string; sort_order: number }>,
  ) => {
    const user = await sessionUser();
    if (user.role !== 'admin') throw new Error('태그는 관리자만 수정할 수 있습니다');
    const safeTags = tags.map(({ id, name, color, sort_order }) => ({ id, name, color, sort_order }));
    const saved = await store.saveTags(safeTags);
    broadcastDataChange('calendar_tags', 'UPDATE');
    broadcastCalendarChanged('UPDATE');
    return saved;
  }));

  ipcMain.handle('calendar:notifications:catchup', wrap(async () => {
    const userId = deps.getSessionUserIdOrThrow();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return store.listUnreadNotifications(userId, since);
  }));

  ipcMain.handle('calendar:notifications:mark-read', wrap(async (ids: string[]) => {
    const userId = deps.getSessionUserIdOrThrow();
    await store.markNotificationsRead(userId, ids);
  }));
}
