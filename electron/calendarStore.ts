/** electron/calendarStore.ts — B flow 공유 캘린더 Supabase CRUD (메인 전용).
 * 권한 검증·broadcast 는 calendarIpc.ts 담당 — 여기는 순수 데이터 접근만.
 * 마이그레이션 전(테이블 부재) 안전: 읽기는 빈 결과 + console.warn, 쓰기는 throw. */
import { supabase } from './supabase';

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
  return /does not exist|schema cache/i.test(error.message ?? '');
}

function warnMissingTable(table: string, emptyResult: string): void {
  console.warn(`[calendar] ${table} 테이블 없음 — 마이그레이션 전, ${emptyResult} 반환`);
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

  const { data: memberData, error: memberError } = await supabase
    .from('calendar_members')
    .select('calendar_id, user_id, can_edit');
  if (memberError) {
    if (isMissingTable(memberError)) {
      warnMissingTable('calendar_members', '빈 목록');
      return { calendars: [], members: [] };
    }
    throwIfError(memberError);
  }

  return {
    calendars: (data ?? []) as CalendarRow[],
    members: (memberData ?? []) as CalendarMemberRow[],
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
  owner_id: string;
  is_personal?: boolean;
}): Promise<CalendarRow> {
  const { data, error } = await supabase
    .from('calendars')
    .insert(input)
    .select('*')
    .single();
  throwIfError(error);
  return data as CalendarRow;
}

export async function updateCalendar(
  id: string,
  updates: Partial<Pick<CalendarRow, 'name' | 'color' | 'visibility'>>,
): Promise<void> {
  const { error } = await supabase
    .from('calendars')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  throwIfError(error);
}

export async function deleteCalendar(id: string): Promise<void> {
  const { error } = await supabase.from('calendars').delete().eq('id', id);
  throwIfError(error);
}

/** 멤버 전체 교체 — 소유자 행은 호출자가 제외한 상태로 전달한다. */
export async function replaceMembers(
  calendarId: string,
  members: Array<{ user_id: string; can_edit: boolean }>,
): Promise<void> {
  const { error } = await supabase.rpc('replace_calendar_members', {
    p_calendar_id: calendarId,
    p_members: members,
  });
  throwIfError(error);
}

// ── 일정 ────────────────────────────────────────

/** 기간 조회 + .range() 페이지네이션 (PostgREST 1000행 제한). */
export async function listEventsInRange(params: {
  calendarIds: string[];
  from?: string;
  to?: string;
}): Promise<CalendarEventRow[]> {
  if (params.calendarIds.length === 0) return [];

  const pageSize = 1000;
  const all: CalendarEventRow[] = [];
  let offset = 0;
  for (;;) {
    let query = supabase
      .from('calendar_events')
      .select('*')
      .in('calendar_id', params.calendarIds)
      .order('start_date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (params.from) query = query.gte('end_date', params.from);
    if (params.to) query = query.lte('start_date', params.to);

    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) {
        warnMissingTable('calendar_events', '빈 목록');
        return [];
      }
      throwIfError(error);
    }

    const rows = (data ?? []) as CalendarEventRow[];
    all.push(...rows);
    if (rows.length < pageSize) return all;
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
export async function getEventById(id: string): Promise<CalendarEventRow | null> {
  return readEventById(id, true);
}

/** 쓰기 전 권한/원본 확인은 테이블 부재를 성공으로 오인하면 안 되므로 오류를 그대로 올린다. */
export async function getEventByIdForWrite(id: string): Promise<CalendarEventRow | null> {
  return readEventById(id, false);
}

export async function createEvent(
  input: Omit<CalendarEventRow, 'id' | 'created_at' | 'updated_at'> & { id?: string },
): Promise<CalendarEventRow> {
  const { data, error } = await supabase
    .from('calendar_events')
    .insert(input)
    .select('*')
    .single();
  throwIfError(error);
  return data as CalendarEventRow;
}

export async function updateEvent(
  id: string,
  updates: Partial<Omit<CalendarEventRow, 'id' | 'created_at'>>,
  expectedCalendarId: string,
): Promise<CalendarEventRow> {
  const { data, error } = await supabase
    .from('calendar_events')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('calendar_id', expectedCalendarId)
    .select('*')
    .maybeSingle();
  throwIfError(error);
  if (!data) {
    throw new Error('일정이 다른 캘린더로 변경되었습니다. 새로고침 후 다시 시도해 주세요');
  }
  return data as CalendarEventRow;
}

export async function deleteEvent(id: string, expectedCalendarId: string): Promise<void> {
  const { data, error } = await supabase
    .from('calendar_events')
    .delete()
    .eq('id', id)
    .eq('calendar_id', expectedCalendarId)
    .select('id')
    .maybeSingle();
  throwIfError(error);
  if (!data) {
    throw new Error('일정이 다른 캘린더로 변경되었습니다. 새로고침 후 다시 시도해 주세요');
  }
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
): Promise<CalendarTagRow[]> {
  const { data, error } = await supabase.rpc('replace_calendar_tags', { p_tags: tags });
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
): Promise<CalendarNotificationRow[]> {
  const { data, error } = await supabase
    .from('calendar_notifications')
    .select('*')
    .eq('recipient_id', recipientId)
    .is('read_at', null)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) {
      warnMissingTable('calendar_notifications', '빈 목록');
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
  return (data as { role?: string } | null)?.role === 'admin' ? 'admin' : 'user';
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
    if (!isMissingTable(error)) console.warn('[calendar] 개인 캘린더 조회 실패:', error.message);
    return;
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
  if (insertError && insertError.code !== '23505') {
    console.warn('[calendar] 개인 캘린더 생성 실패:', insertError.message);
    return;
  }
  ensuredPersonalFor.add(userId);
}
