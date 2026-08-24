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

type CalendarEventCreateInput = Parameters<typeof store.createEvent>[0];

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

export function registerCalendarIpc(deps: CalendarIpcDeps): void {
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

    const safeUpdates: Parameters<typeof store.updateCalendar>[1] = {};
    if (updates.name !== undefined) safeUpdates.name = updates.name;
    if (updates.color !== undefined) safeUpdates.color = updates.color;
    if (!calendar.is_personal && requestedVisibility !== undefined) {
      if (requestedVisibility === 'team' && !canCreateCalendar(user, 'team')) {
        throw new Error('팀 전체 캘린더는 관리자만 만들 수 있습니다');
      }
      safeUpdates.visibility = requestedVisibility;
    }

    await store.updateCalendar(id, safeUpdates, user.id);
    broadcastDataChange('calendars', 'UPDATE');
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

    const created = await store.createEvent({
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
    }, user.id);
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
    await emitCalendarEventNotifications({
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

  ipcMain.handle('calendar:events:delete', wrap(async (id: string) => {
    const user = await sessionUser();
    const previous = await store.getEventByIdForWrite(id);
    if (!previous) return;
    const { calendar, members } = await loadCalendarForUserOrThrow(previous.calendar_id, user.id);
    if (!canEditCalendarEvents(calendar, members, user.id)) {
      throw new Error('이 일정을 삭제할 권한이 없습니다');
    }

    await store.deleteEvent(id, previous.calendar_id, user.id);
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
    const saved = await store.saveTags(safeTags, user.id);
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
