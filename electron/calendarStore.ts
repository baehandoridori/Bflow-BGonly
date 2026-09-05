/** electron/calendarStore.ts — B flow 공유 캘린더 Supabase CRUD (메인 전용).
 * 권한 검증·broadcast 는 calendarIpc.ts 담당 — 여기는 순수 데이터 접근만.
 * 마이그레이션 전(테이블 부재) 안전: 읽기는 빈 결과 + console.warn, 쓰기는 throw. */
import { supabase } from './supabase';
import { isGanttCalendarEventId, listGanttCalendarEvents, updateGanttCalendarEvent, unlinkGanttCalendarEvent } from './ganttStore';
import type { CalendarUpdateInput } from '../src/shared/calendarApiContract';
import { normalizeCalendarNotificationCatchupInput } from '../src/shared/calendarNotificationCatchup';
import type { CalendarNotificationCatchupInput } from '../src/shared/calendarNotificationCatchup';

export interface CalendarRow {
  id: string;
  name: string;
  color: string;
  visibility: 'private' | 'members' | 'team';
  owner_id: string;
  is_personal: boolean;
  created_at: string;
  updated_at: string;
}

export interface CalendarMemberRow {
  calendar_id: string;
  user_id: string;
  can_edit: boolean;
}

export interface CalendarTagRow {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface CalendarEventRow {
  id: string;
  calendar_id: string;
  title: string;
  memo: string | null;
  tag_id: string | null;
  all_day: boolean;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  linked_episode: number | null;
  linked_part: string | null;
  linked_sheet_name: string | null;
  linked_scene_id: string | null;
  linked_department: string | null;
  linked_todo_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  linked_gantt_project_id?: string;
  linked_gantt_task_id?: string;
  gantt_can_edit?: boolean;
}

export interface CalendarNotificationRow {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  actor_name: string | null;
  calendar_id: string | null;
  calendar_name: string | null;
  event_id: string | null;
  event_title: string | null;
  event_date: string | null;
  action: 'create' | 'update' | 'delete';
  detail: string | null;
  created_at: string;
  read_at: string | null;
}

type SbError = { code?: string | null; message?: string | null } | null;

function throwIfError(error: SbError): void {
  if (error) throw new Error(error.message ?? 'Supabase error');
}

/** 마이그레이션 전 테이블 부재 — 42P01(Postgres) / PGRST205(PostgREST schema cache). */
function isMissingTable(error: SbError): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  if (error.code) return false;
  const message = error.message ?? '';
  return /\brelation\s+(?:"[^"]+"|'[^']+'|[\w.]+)\s+does not exist\b/i.test(message)
    || /could not find the table\s+['"][^'"]+['"]\s+in the schema cache/i.test(message);
}

function isMissingFunction(error: SbError, functionName: string): boolean {
  if (!error || (error.code !== 'PGRST202' && error.code !== '42883')) return false;
  const message = error.message ?? '';
  if (!message.toLowerCase().includes(functionName.toLowerCase())) return false;
  return error.code === 'PGRST202'
    ? /function[\s\S]*schema cache/i.test(message)
    : /function[\s\S]*does not exist/i.test(message);
}

function warnMissingTable(table: string, emptyResult: string): void {
  console.warn(`[calendar] ${table} 테이블 없음 — 마이그레이션 전, ${emptyResult} 반환`);
}

function requireEventRpcRow(data: unknown, operation: string): CalendarEventRow {
  if (!Array.isArray(data) || data.length !== 1 || !data[0]) {
    throw new Error(`${operation} RPC가 결과 행을 반환하지 않았습니다`);
  }
  return data[0] as CalendarEventRow;
}

function requireCalendarRpcRow(data: unknown, operation: string): CalendarRow {
  if (!Array.isArray(data) || data.length !== 1 || !data[0]) {
    throw new Error(`${operation} RPC가 결과 행을 반환하지 않았습니다`);
  }
  return data[0] as CalendarRow;
}

// ── 캘린더 ──────────────────────────────────────

export async function listCalendarsWithMembers(): Promise<{ calendars: CalendarRow[]; members: CalendarMemberRow[] }> {
  const { data, error } = await supabase
    .from('calendars')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingTable(error)) {
      warnMissingTable('calendars', '빈 목록');
      return { calendars: [], members: [] };
    }
    throwIfError(error);
  }

  const pageSize = 1000;
  const members: CalendarMemberRow[] = [];
  let offset = 0;
  for (;;) {
    const { data: memberData, error: memberError } = await supabase
      .from('calendar_members')
      .select('calendar_id, user_id, can_edit')
      .order('calendar_id', { ascending: true })
      .order('user_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (memberError) {
      if (isMissingTable(memberError)) {
        warnMissingTable('calendar_members', '빈 목록');
        return { calendars: [], members: [] };
      }
      throwIfError(memberError);
    }

    const rows = (memberData ?? []) as CalendarMemberRow[];
    members.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return {
    calendars: (data ?? []) as CalendarRow[],
    members,
  };
}

export async function getCalendarWithMembers(calendarId: string): Promise<{ calendar: CalendarRow | null; members: CalendarMemberRow[] }> {
  const { data, error } = await supabase
    .from('calendars')
    .select('*')
    .eq('id', calendarId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      warnMissingTable('calendars', '빈 결과');
      return { calendar: null, members: [] };
    }
    throwIfError(error);
  }

  if (!data) return { calendar: null, members: [] };

  const { data: memberData, error: memberError } = await supabase
    .from('calendar_members')
    .select('calendar_id, user_id, can_edit')
    .eq('calendar_id', calendarId);
  if (memberError) {
    if (isMissingTable(memberError)) {
      warnMissingTable('calendar_members', '빈 결과');
      return { calendar: null, members: [] };
    }
    throwIfError(memberError);
  }

  return {
    calendar: data as CalendarRow,
    members: (memberData ?? []) as CalendarMemberRow[],
  };
}

export async function createCalendar(input: {
  name: string;
  color: string;
  visibility: 'private' | 'members' | 'team';
}, members: Array<{ user_id: string; can_edit: boolean }>, actorId: string): Promise<CalendarRow> {
  const { data, error } = await supabase.rpc('create_calendar_with_members_authorized', {
    p_actor_id: actorId,
    p_calendar: input,
    p_members: members,
  });
  throwIfError(error);
  return requireCalendarRpcRow(data, '캘린더 생성');
}

export async function updateCalendar(
  id: string,
  updates: CalendarUpdateInput,
  actorId: string,
): Promise<void> {
  const { error } = await supabase.rpc('update_calendar_authorized', {
    p_actor_id: actorId,
    p_calendar_id: id,
    p_updates: updates,
  });
  throwIfError(error);
}

export async function deleteCalendar(id: string, actorId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_calendar_authorized', {
    p_actor_id: actorId,
    p_calendar_id: id,
  });
  throwIfError(error);
}

/** 멤버 전체 교체 — 소유자 행은 호출자가 제외한 상태로 전달한다. */
export async function replaceMembers(
  calendarId: string,
  members: Array<{ user_id: string; can_edit: boolean }>,
  actorId: string,
): Promise<void> {
  const { error } = await supabase.rpc('replace_calendar_members_authorized', {
    p_actor_id: actorId,
    p_calendar_id: calendarId,
    p_members: members,
  });
  throwIfError(error);
}

// ── 일정 ────────────────────────────────────────

/** 기간 조회 + .range() 페이지네이션 (PostgREST 1000행 제한). */
export async function listEventsInRange(params: {
  actorId: string;
  from?: string;
  to?: string;
}): Promise<CalendarEventRow[]> {
  const pageSize = 1000;
  const all: CalendarEventRow[] = [];
  let offset = 0;
  for (;;) {
    const query = supabase
      .rpc('list_calendar_events_authorized', {
        p_actor_id: params.actorId,
        p_from: params.from ?? null,
        p_to: params.to ?? null,
      })
      .order('start_date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error) || isMissingFunction(error, 'list_calendar_events_authorized')) {
        warnMissingTable('calendar_events', '빈 목록');
        return [];
      }
      throwIfError(error);
    }

    const rows = (data ?? []) as CalendarEventRow[];
    all.push(...rows);
    if (rows.length < pageSize) {
      const linked = await listGanttCalendarEvents(params.actorId, { from: params.from, to: params.to });
      return [...all, ...linked];
    }
    offset += pageSize;
  }
}

async function readEventById(id: string, missingTableIsEmpty: boolean): Promise<CalendarEventRow | null> {
  const { data, error } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (missingTableIsEmpty && isMissingTable(error)) {
      warnMissingTable('calendar_events', '빈 결과');
      return null;
    }
    throwIfError(error);
  }
  return (data as CalendarEventRow | null) ?? null;
}

/** 일반 조회는 마이그레이션 전 테이블 부재를 빈 결과로 취급한다. */
export async function getEventById(id: string, actorId?: string): Promise<CalendarEventRow | null> {
  if (isGanttCalendarEventId(id)) {
    if (!actorId) throw new Error('간트 일정 조회에 로그인 세션이 필요합니다.');
    return (await listGanttCalendarEvents(actorId, { eventId: id }))[0] ?? null;
  }
  return readEventById(id, true);
}

/** 쓰기 전 권한/원본 확인은 테이블 부재를 성공으로 오인하면 안 되므로 오류를 그대로 올린다. */
export async function getEventByIdForWrite(id: string, actorId?: string): Promise<CalendarEventRow | null> {
  if (isGanttCalendarEventId(id)) return getEventById(id, actorId);
  return readEventById(id, false);
}

export type CalendarEventWriteFields = Pick<
  CalendarEventRow,
  | 'calendar_id'
  | 'title'
  | 'memo'
  | 'tag_id'
  | 'all_day'
  | 'start_date'
  | 'end_date'
  | 'start_time'
  | 'end_time'
  | 'linked_episode'
  | 'linked_part'
  | 'linked_sheet_name'
  | 'linked_scene_id'
  | 'linked_department'
  | 'linked_todo_id'
>;

export async function createEvent(
  input: CalendarEventWriteFields,
  actorId: string,
): Promise<CalendarEventRow> {
  const { data, error } = await supabase.rpc('create_calendar_event_authorized', {
    p_actor_id: actorId,
    p_event: input,
  });
  throwIfError(error);
  return requireEventRpcRow(data, '일정 생성');
}

export async function updateEvent(
  id: string,
  updates: Partial<CalendarEventWriteFields>,
  expectedCalendarId: string,
  actorId: string,
): Promise<CalendarEventRow> {
  if (isGanttCalendarEventId(id)) return updateGanttCalendarEvent(actorId, id, updates, expectedCalendarId);
  const { data, error } = await supabase.rpc('update_calendar_event_authorized', {
    p_actor_id: actorId,
    p_event_id: id,
    p_expected_calendar_id: expectedCalendarId,
    p_updates: updates,
  });
  throwIfError(error);
  return requireEventRpcRow(data, '일정 수정');
}

export async function deleteEvent(
  id: string,
  expectedCalendarId: string,
  actorId: string,
): Promise<void> {
  if (isGanttCalendarEventId(id)) return unlinkGanttCalendarEvent(actorId, id, expectedCalendarId);
  const { data, error } = await supabase.rpc('delete_calendar_event_authorized', {
    p_actor_id: actorId,
    p_event_id: id,
    p_expected_calendar_id: expectedCalendarId,
  });
  throwIfError(error);
  requireEventRpcRow(data, '일정 삭제');
}

/** 비공개 전환 중 생성한 B flow 대체 일정만 정확한 생성 시점 식별자로 보상 삭제한다. */
export async function deletePrivacyReplacementEvent(
  id: string,
  calendarId: string,
  createdAt: string,
): Promise<void> {
  const { data, error } = await supabase.rpc('delete_calendar_privacy_replacement', {
    p_event_id: id,
    p_calendar_id: calendarId,
    p_created_at: createdAt,
  });
  throwIfError(error);
  requireEventRpcRow(data, '비공개 전환 대체 일정 삭제');
}

// ── 태그 ────────────────────────────────────────

async function readTags(allowMissingTable: boolean): Promise<CalendarTagRow[]> {
  const { data, error } = await supabase
    .from('calendar_tags')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) {
    if (allowMissingTable && isMissingTable(error)) {
      warnMissingTable('calendar_tags', '빈 목록');
      return [];
    }
    throwIfError(error);
  }
  return (data ?? []) as CalendarTagRow[];
}

export async function listTags(): Promise<CalendarTagRow[]> {
  return readTags(true);
}

/** 태그 일괄 저장 — 전달 목록이 최종 상태이며 삭제된 태그의 일정 연결은 DB가 NULL 처리한다. */
export async function saveTags(
  tags: Array<{ id?: string; name: string; color: string; sort_order: number }>,
  actorId: string,
): Promise<CalendarTagRow[]> {
  const { data, error } = await supabase.rpc('replace_calendar_tags_authorized', {
    p_actor_id: actorId,
    p_tags: tags,
  });
  throwIfError(error);
  return (data ?? []) as CalendarTagRow[];
}

// ── 알림 (PR2 는 저장소 함수만 — insert 호출은 PR4) ──

export async function insertNotifications(
  rows: Array<Omit<CalendarNotificationRow, 'id' | 'created_at' | 'read_at'>>,
): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await supabase.from('calendar_notifications').insert(rows);
  if (error) console.warn('[calendar] 알림 저장 실패:', error.message);
}

export async function listUnreadNotifications(
  recipientId: string,
  sinceIso: string,
  input?: CalendarNotificationCatchupInput,
): Promise<CalendarNotificationRow[]> {
  const { excludedCalendarIds } = normalizeCalendarNotificationCatchupInput(input);
  const { data, error } = await supabase.rpc('list_calendar_notifications_authorized', {
    p_actor_id: recipientId,
    p_since: sinceIso,
    p_excluded_calendar_ids: excludedCalendarIds,
  });
  if (error) {
    if (isMissingFunction(error, 'list_calendar_notifications_authorized')) {
      console.warn('[calendar] 알림 catch-up RPC 없음 — 마이그레이션 전, 빈 목록 반환');
      return [];
    }
    throwIfError(error);
  }
  return (data ?? []) as CalendarNotificationRow[];
}

export async function markNotificationsRead(recipientId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabase
    .from('calendar_notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .eq('recipient_id', recipientId);
  throwIfError(error);
}

// ── 사용자 role 재조회 (calendarIpc 의 admin 검증용) ──

export async function getUserRole(userId: string): Promise<'admin' | 'user'> {
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  throwIfError(error);
  const user = data as { role?: string } | null;
  if (!user) {
    throw new Error('캘린더 사용자 세션이 더 이상 유효하지 않습니다');
  }
  return user.role === 'admin' ? 'admin' : 'user';
}

// ── 개인 캘린더 보장 (로그인 훅 — Task 2.5 에서 연결) ──

const ensuredPersonalFor = new Set<string>();

export async function ensurePersonalCalendar(userId: string): Promise<void> {
  if (ensuredPersonalFor.has(userId)) return;

  const { data, error } = await supabase
    .from('calendars')
    .select('id')
    .eq('owner_id', userId)
    .eq('is_personal', true)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      warnMissingTable('calendars', '개인 캘린더 보장 생략');
      return;
    }
    throwIfError(error);
  }
  if (data) {
    ensuredPersonalFor.add(userId);
    return;
  }

  const { error: insertError } = await supabase.from('calendars').insert({
    name: '개인',
    color: '#6C5CE7',
    visibility: 'private',
    owner_id: userId,
    is_personal: true,
  });
  if (insertError) {
    if (insertError.code === '23505') {
      ensuredPersonalFor.add(userId);
      return;
    }
    if (isMissingTable(insertError)) {
      warnMissingTable('calendars', '개인 캘린더 보장 생략');
      return;
    }
    throwIfError(insertError);
  }
  ensuredPersonalFor.add(userId);
}
