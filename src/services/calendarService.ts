/**
 * 캘린더 서비스 (어댑터)
 * Google Calendar API를 기존 CalendarEvent 인터페이스로 래핑
 */
import type {
  BflowCalendar,
  CalendarEvent,
  CalendarEventType,
  BflowEventMeta,
  GCalSettings,
} from '@/types/calendar';
import * as gcalService from './googleCalendarService';
import { readMetadata, writeMetadata } from './supabaseService';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { createUuid } from '@/utils/createUuid';

// 비공개 이벤트는 Google Calendar 가 아닌 Supabase 에만 저장된다.
// sourceCalendarId 에 이 특수 식별자를 써서 update/delete 시 올바른 저장소로 라우팅.
const PRIVATE_CAL_ID = 'supabase-private';
const BFLOW_CAL_PREFIX = 'bflow:';

type RawPrivateEvent = Awaited<ReturnType<NonNullable<Window['electronAPI']>['supabaseReadPrivateEvents']>>[number];
type RawBflowEvent = Awaited<ReturnType<NonNullable<Window['electronAPI']>['calendarEventsList']>>[number];

function toCalendarEventFromPrivate(row: RawPrivateEvent): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    memo: row.memo ?? '',
    color: row.color ?? '#6C5CE7',
    type: (row.type as CalendarEventType) || 'custom',
    startDate: row.start_date,
    endDate: row.end_date,
    createdBy: row.created_by ?? '',
    createdAt: row.created_at,
    linkedEpisode: row.linked_episode ?? undefined,
    linkedPart: row.linked_part ?? undefined,
    linkedSheetName: row.linked_sheet_name ?? undefined,
    linkedSceneId: row.linked_scene_id ?? undefined,
    linkedDepartment: (row.linked_department as 'bg' | 'acting' | undefined) ?? undefined,
    linkedTodoId: row.linked_todo_id ?? undefined,
    sourceCalendarId: PRIVATE_CAL_ID,
    isPrivate: true,
    source: 'bflow',
  };
}

function toCalendarEventFromBflowRow(
  row: RawBflowEvent,
  calendarsById: Map<string, BflowCalendar>,
): CalendarEvent {
  const calendar = calendarsById.get(row.calendar_id);
  const canEdit = calendar?.canEdit ?? false;
  const type: CalendarEventType = row.linked_scene_id
    ? 'scene'
    : row.linked_part
      ? 'part'
      : row.linked_episode !== null
        ? 'episode'
        : 'custom';

  return {
    id: row.id,
    title: row.title,
    memo: row.memo ?? '',
    color: calendar?.color ?? '#6C5CE7',
    type,
    startDate: row.start_date,
    endDate: row.end_date,
    createdBy: row.created_by ?? '',
    createdAt: row.created_at,
    linkedEpisode: row.linked_episode ?? undefined,
    linkedPart: row.linked_part ?? undefined,
    linkedSheetName: row.linked_sheet_name ?? undefined,
    linkedSceneId: row.linked_scene_id ?? undefined,
    linkedDepartment: (row.linked_department as 'bg' | 'acting' | undefined) ?? undefined,
    linkedTodoId: row.linked_todo_id ?? undefined,
    sourceCalendarId: `${BFLOW_CAL_PREFIX}${row.calendar_id}`,
    calendarId: row.calendar_id,
    tagId: row.tag_id ?? undefined,
    allDay: row.all_day,
    startTime: row.start_time ?? undefined,
    endTime: row.end_time ?? undefined,
    canEdit,
    isReadOnly: !canEdit,
    source: 'bflow',
  };
}

// teamCalendarId는 Supabase metadata에 저장 (팀 전체 공유)
// personalCalendarId, lastSyncAt은 로컬에만 저장 (사용자별)
const OLD_SETTINGS_KEY = 'bflow_gcal_settings';
const GCAL_LOCAL_SETTINGS_KEY = 'bflow_gcal_local_settings';

interface GCalLocalSettings {
  personalCalendarId: string | null;
  lastSyncAt: string | null;
}

function getLocalSettings(): GCalLocalSettings {
  try {
    const raw = localStorage.getItem(GCAL_LOCAL_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { personalCalendarId: null, lastSyncAt: null };
}

function saveLocalSettings(settings: GCalLocalSettings): void {
  localStorage.setItem(GCAL_LOCAL_SETTINGS_KEY, JSON.stringify(settings));
  void window.electronAPI?.gcalSaveLocalSettings?.(settings).catch((error) => {
    console.warn('[Calendar] 메인 프로세스 개인 캘린더 설정 저장 실패:', error);
  });
}

/** 로컬 설정 일부 업데이트 (personalCalendarId, lastSyncAt) */
export function saveLocalGCalSettings(settings: Partial<GCalLocalSettings>): void {
  const current = getLocalSettings();
  saveLocalSettings({ ...current, ...settings });
}

let cachedTeamCalendarId: string | null | undefined = undefined; // undefined = 아직 로드 안 됨

/** 구 localStorage 전용 설정 → 새 구조로 마이그레이션 */
async function migrateOldSettings(): Promise<void> {
  const old = localStorage.getItem(OLD_SETTINGS_KEY);
  if (!old) return;
  try {
    const parsed = JSON.parse(old);
    if (parsed.teamCalendarId) {
      await writeMetadata('gcal', 'teamCalendarId', parsed.teamCalendarId);
      cachedTeamCalendarId = parsed.teamCalendarId;
    }
    saveLocalSettings({
      personalCalendarId: parsed.personalCalendarId || null,
      lastSyncAt: parsed.lastSyncAt || null,
    });
    localStorage.removeItem(OLD_SETTINGS_KEY);
  } catch { /* ignore */ }
}

export async function getGCalSettings(): Promise<GCalSettings> {
  // 구 설정 마이그레이션 (있으면)
  await migrateOldSettings();

  // teamCalendarId: Supabase metadata에서 로드 (캐시 활용)
  if (cachedTeamCalendarId === undefined) {
    try {
      const meta = await readMetadata('gcal', 'teamCalendarId');
      cachedTeamCalendarId = meta?.value || null;
    } catch {
      cachedTeamCalendarId = null;
    }
  }

  const local = getLocalSettings();
  // Main-side personal-todo calendar sync reads the same setting from the
  // app-data file; mirror existing renderer settings before it resolves a
  // target calendar (important after upgrading from the localStorage-only path).
  saveLocalSettings(local);
  return {
    teamCalendarId: cachedTeamCalendarId ?? null,
    personalCalendarId: local.personalCalendarId,
    lastSyncAt: local.lastSyncAt,
  };
}

/** 팀 캘린더 ID를 Supabase에 저장 (팀 전체 공유) */
export async function saveTeamCalendarId(calId: string | null): Promise<void> {
  cachedTeamCalendarId = calId;
  await writeMetadata('gcal', 'teamCalendarId', calId || '');
}

/** 하위 호환: 기존 saveGCalSettings 시그니처 유지 (로컬 부분 즉시 저장, 팀 ID는 비동기) */
export function saveGCalSettings(settings: GCalSettings): void {
  saveLocalSettings({
    personalCalendarId: settings.personalCalendarId,
    lastSyncAt: settings.lastSyncAt,
  });
  if (settings.teamCalendarId !== cachedTeamCalendarId) {
    cachedTeamCalendarId = settings.teamCalendarId;
    writeMetadata('gcal', 'teamCalendarId', settings.teamCalendarId || '').catch(console.error);
  }
}

/** GCal 이벤트 → B flow CalendarEvent 변환 */
function toCalendarEvent(gcalEvent: any, calendarId: string): CalendarEvent {
  const meta = (gcalEvent.extendedProperties?.private || {}) as Partial<BflowEventMeta>;
  const isAllDay = !!gcalEvent.start?.date;
  const startDate = isAllDay ? gcalEvent.start.date : gcalEvent.start?.dateTime?.slice(0, 10);
  let endDate = isAllDay ? gcalEvent.end?.date : gcalEvent.end?.dateTime?.slice(0, 10);

  // GCal 종일 이벤트는 종료일이 exclusive (3/25~3/26 = 3/25 하루)
  // B flow는 inclusive 종료일을 사용하므로 하루 빼기
  // UTC 기반 문자열 연산으로 DST 영향 없음
  if (isAllDay && endDate) {
    endDate = subtractOneDay(endDate);
  }

  return {
    id: gcalEvent.id,
    title: gcalEvent.summary || '',
    memo: gcalEvent.description || '',
    color: '#6C5CE7', // TODO: GCal colorId → 색상 매핑
    type: (meta.bflow_type as CalendarEventType) || 'custom',
    startDate: startDate || '',
    endDate: endDate || '',
    createdBy: gcalEvent.creator?.email || '',
    createdAt: gcalEvent.created || new Date().toISOString(),
    linkedEpisode: meta.bflow_linked_episode ? Number(meta.bflow_linked_episode) : undefined,
    linkedPart: meta.bflow_linked_part,
    linkedSceneId: meta.bflow_linked_scene_id,
    linkedDepartment: meta.bflow_department,
    linkedTodoId: meta.bflow_linked_todo_id,
    vacationType: meta.bflow_vacation_type,
    vacationUserName: meta.bflow_vacation_user,
    isReadOnly: !meta.bflow_type, // B flow에서 만들지 않은 이벤트는 읽기 전용
    sourceCalendarId: calendarId,
    // Google Calendar 의 visibility='private' 를 읽어 isPrivate 에 반영
    isPrivate: gcalEvent.visibility === 'private',
    source: 'google',
  };
}

/** 날짜 문자열에서 하루 빼기 (UTC 기반, DST 안전) */
function subtractOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d - 1);
  const r = new Date(utc);
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, '0')}-${String(r.getUTCDate()).padStart(2, '0')}`;
}

/** 날짜 문자열에서 하루 더하기 (UTC 기반, DST 안전) */
function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + 1);
  const r = new Date(utc);
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, '0')}-${String(r.getUTCDate()).padStart(2, '0')}`;
}

/** B flow CalendarEvent → GCal extendedProperties */
function toBflowMeta(event: Partial<CalendarEvent>): Record<string, string> {
  const meta: Record<string, string> = {};
  if (event.type) meta.bflow_type = event.type;
  if (event.linkedEpisode !== undefined) meta.bflow_linked_episode = String(event.linkedEpisode);
  if (event.linkedPart) meta.bflow_linked_part = event.linkedPart;
  if (event.linkedSceneId) meta.bflow_linked_scene_id = event.linkedSceneId;
  if (event.linkedDepartment) meta.bflow_department = event.linkedDepartment;
  if (event.linkedTodoId) meta.bflow_linked_todo_id = event.linkedTodoId;
  if (event.vacationType) meta.bflow_vacation_type = event.vacationType;
  if (event.vacationUserName) meta.bflow_vacation_user = event.vacationUserName;
  return meta;
}

/** 공개 일정은 항상 로그인 계정의 primary 캘린더에 저장한다.
 *  (팀 캘린더 / 개인 캘린더 구분은 제거 — 비공개는 Supabase 로 분리)
 *  type 파라미터는 시그니처 호환을 위해 유지하되 사용하지 않는다. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getTargetCalendar(_type: CalendarEventType): Promise<string | null> {
  return 'primary';
}

// ─── 공개 API (기존 인터페이스 유지) ──────────────────────────

let bflowEvents: CalendarEvent[] = [];
let googleEvents: CalendarEvent[] = [];
let eventCache: CalendarEvent[] = [];

function rebuildEventCache(): void {
  const seen = new Set<string>();
  eventCache = [...bflowEvents, ...googleEvents].filter(
    (event) => !seen.has(event.id) && (seen.add(event.id), true),
  );
}

type CalendarCacheSource = 'bflow' | 'google';

/** 낙관적 CRUD 공용 헬퍼 — 확인된 단일 source만 변경한 뒤 병합 캐시를 재조립한다. */
function mutateSourceEvents(
  source: CalendarCacheSource,
  fn: (events: CalendarEvent[]) => CalendarEvent[],
): void {
  if (source === 'bflow') bflowEvents = fn(bflowEvents);
  else googleEvents = fn(googleEvents);
  rebuildEventCache();
}

export async function getEvents(): Promise<CalendarEvent[]> {
  return [...eventCache];
}

/** B flow 일정 로드 — 구글 인증 가드 밖에서 항상 호출된다 (설계서 §6.2 핵심). */
export async function loadBflowEvents(): Promise<void> {
  try {
    await useCalendarStore.getState().loadAll();
    const calendars = useCalendarStore.getState().calendars;
    const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
    const rows = await window.electronAPI.calendarEventsList();
    const next = rows.map((row) => toCalendarEventFromBflowRow(row, calendarsById));

    // 마이그레이션 전 폴백: 구 private_calendar_events 병행 읽기 — 중복 id 는 calendar_events 우선.
    const newIds = new Set(next.map((event) => event.id));
    try {
      const userId = useAuthStore.getState().currentUser?.id;
      if (userId) {
        const legacyRows = await window.electronAPI.supabaseReadPrivateEvents(userId);
        for (const row of legacyRows) {
          if (!newIds.has(row.id)) next.push(toCalendarEventFromPrivate(row));
        }
      }
    } catch (err) {
      console.warn('[Calendar] 구 비공개 일정 폴백 로드 실패:', err);
    }

    bflowEvents = next;
    rebuildEventCache();
    broadcastCalendarChange();
  } catch (err) {
    console.warn('[Calendar] B flow 일정 로드 실패:', err);
  }
}

/** 전체 동기화 (앱 시작 시 호출) */
export async function syncAll(options: { broadcast?: boolean } = {}): Promise<CalendarEvent[]> {
  await loadBflowEvents();
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];

  // 팀/개인 캘린더 목록 — 설정 조회 실패 시에도 비공개 이벤트는 이미 위에서 로드됨
  const calIds = new Set<string>();
  try {
    const settings = await getGCalSettings();
    if (settings.teamCalendarId) calIds.add(settings.teamCalendarId);
    calIds.add(settings.personalCalendarId || 'primary');
  } catch (err) {
    console.warn('[Calendar] GCal 설정 조회 실패 — 공개 일정 동기화 건너뜀:', err);
  }

  // Google Calendar fullSync — 각 calId 를 개별 try/catch 로 감싸 한 캘린더 실패가
  // 다른 캘린더 로드를 막지 않게 한다.
  for (const calId of calIds) {
    try {
      const gcalEvents = await gcalService.fullSync(calId);
      for (const e of gcalEvents) {
        if (e.id && !seen.has(e.id)) {
          seen.add(e.id);
          events.push(toCalendarEvent(e, calId));
        }
      }
    } catch (err) {
      console.warn(`[Calendar] Google fullSync 실패 (${calId}):`, err);
    }
  }

  // GCal에 없는 이벤트는 캐시에서도 제거 (legacy 로컬 이벤트 미지원)
  googleEvents = events;
  rebuildEventCache();
  if (options.broadcast !== false) broadcastCalendarChange();

  // Watch 채널 등록 (실시간 동기화용)
  // 비동기로 실행 — sync 완료를 블로킹하지 않음
  for (const calId of calIds) {
    gcalService.ensureWatch(calId, 'bflow').catch((err) =>
      console.warn('[Calendar] Watch 등록 실패 (수동 동기화는 가능):', err),
    );
  }

  return events;
}

/** Incremental 동기화 (webhook 알림 시 호출) */
export async function syncIncremental(): Promise<void> {
  const settings = await getGCalSettings();

  // 팀/개인 캘린더 목록 (중복 제거, getTargetCalendar과 일치)
  const calIds = new Set<string>();
  if (settings.teamCalendarId) calIds.add(settings.teamCalendarId);
  calIds.add(settings.personalCalendarId || 'primary');

  for (const calId of calIds) {
    const { updated, deleted, isFullSync } = await gcalService.incrementalSync(calId);

    if (isFullSync) {
      // fullSync 폴백: 해당 캘린더의 캐시를 완전히 교체 (삭제된 이벤트 제거)
      const next = googleEvents.filter((event) => event.sourceCalendarId !== calId);
      // ID 기반 중복 제거 (팀/개인 캘린더에 같은 이벤트가 있을 수 있음)
      const seenIds = new Set(next.map((event) => event.id));
      for (const gcalEvent of updated) {
        if (gcalEvent.id && !seenIds.has(gcalEvent.id)) {
          seenIds.add(gcalEvent.id);
          next.push(toCalendarEvent(gcalEvent, calId));
        }
      }
      googleEvents = next;
    } else {
      // 일반 incremental: 삭제 + 머지
      let next = googleEvents.filter((event) => !deleted.includes(event.id));
      for (const gcalEvent of updated) {
        const converted = toCalendarEvent(gcalEvent, calId);
        const exists = next.some((event) => event.id === converted.id);
        next = exists
          ? next.map((event) => (event.id === converted.id ? converted : event))
          : [...next, converted];
      }
      googleEvents = next;
    }
    rebuildEventCache();
  }

  broadcastCalendarChange();
}

// ─── 로컬 ID ↔ GCal ID 매핑 (할일 등 cal_* ID 호환용) ──────────────────

const localToGcalId = new Map<string, string>();

function hasOwnEventUpdate<K extends keyof CalendarEvent>(
  updates: Partial<CalendarEvent>,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(updates, key);
}

function inferExistingEventSource(event: CalendarEvent): CalendarCacheSource {
  if (
    event.source === 'bflow'
    || event.sourceCalendarId === PRIVATE_CAL_ID
    || event.sourceCalendarId?.startsWith(BFLOW_CAL_PREFIX)
  ) {
    return 'bflow';
  }
  if (event.source === 'google') return 'google';

  // rebuildEventCache는 원본 객체 참조를 유지하므로 legacy source 표식이 없어도
  // 현재 정본 배열의 실제 소속으로 안전하게 판정할 수 있다.
  if (bflowEvents.includes(event)) return 'bflow';
  if (googleEvents.includes(event)) return 'google';

  // 기존 Google 이벤트는 sourceCalendarId에 실제 Google 캘린더 ID를 보존한다.
  if (event.sourceCalendarId) return 'google';
  throw new Error('[Calendar] 이벤트 캐시 출처를 확인할 수 없습니다');
}

function cleanupDeletedEventAliases(requestId: string, actualId: string): void {
  localToGcalId.delete(requestId);
  for (const [localId, serverId] of localToGcalId) {
    if (serverId === actualId) localToGcalId.delete(localId);
  }
}

function bflowEventType(event: CalendarEvent): CalendarEventType {
  if (event.linkedSceneId) return 'scene';
  if (event.linkedPart) return 'part';
  if (event.linkedEpisode !== undefined) return 'episode';
  return 'custom';
}

function withBflowCalendarPresentation(event: CalendarEvent, calendarId: string): CalendarEvent {
  const calendar = useCalendarStore.getState().calendars.find((item) => item.id === calendarId);
  const canEdit = calendar?.canEdit ?? false;
  return {
    ...event,
    color: calendar?.color ?? '#6C5CE7',
    sourceCalendarId: `${BFLOW_CAL_PREFIX}${calendarId}`,
    calendarId,
    canEdit,
    isReadOnly: !canEdit,
    source: 'bflow',
  };
}

function applyBflowEventUpdates(
  existing: CalendarEvent,
  updates: Partial<CalendarEvent>,
): CalendarEvent {
  let next = { ...existing };
  if (updates.title !== undefined) next.title = updates.title;
  if (updates.memo !== undefined) next.memo = updates.memo;
  if (hasOwnEventUpdate(updates, 'tagId')) next.tagId = updates.tagId ?? undefined;
  if (updates.allDay !== undefined) next.allDay = updates.allDay;
  if (updates.startDate !== undefined) next.startDate = updates.startDate;
  if (updates.endDate !== undefined) next.endDate = updates.endDate;
  if (hasOwnEventUpdate(updates, 'startTime')) next.startTime = updates.startTime ?? undefined;
  if (hasOwnEventUpdate(updates, 'endTime')) next.endTime = updates.endTime ?? undefined;
  if (hasOwnEventUpdate(updates, 'linkedEpisode')) next.linkedEpisode = updates.linkedEpisode ?? undefined;
  if (hasOwnEventUpdate(updates, 'linkedPart')) next.linkedPart = updates.linkedPart ?? undefined;
  if (hasOwnEventUpdate(updates, 'linkedSheetName')) next.linkedSheetName = updates.linkedSheetName ?? undefined;
  if (hasOwnEventUpdate(updates, 'linkedSceneId')) next.linkedSceneId = updates.linkedSceneId ?? undefined;
  if (hasOwnEventUpdate(updates, 'linkedDepartment')) next.linkedDepartment = updates.linkedDepartment ?? undefined;
  if (hasOwnEventUpdate(updates, 'linkedTodoId')) next.linkedTodoId = updates.linkedTodoId ?? undefined;
  if (updates.calendarId !== undefined) {
    next = withBflowCalendarPresentation(next, updates.calendarId);
  }
  next.type = bflowEventType(next);
  return next;
}

type BflowEventUpdatePatch = Parameters<
  NonNullable<Window['electronAPI']>['calendarEventUpdate']
>[1];

function toBflowEventUpdatePatch(updates: Partial<CalendarEvent>): BflowEventUpdatePatch {
  const patch: BflowEventUpdatePatch = {};
  if (updates.calendarId !== undefined) patch.calendar_id = updates.calendarId;
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.memo !== undefined) patch.memo = updates.memo;
  if (hasOwnEventUpdate(updates, 'tagId')) patch.tag_id = updates.tagId ?? null;
  if (updates.allDay !== undefined) patch.all_day = updates.allDay;
  if (updates.startDate !== undefined) patch.start_date = updates.startDate;
  if (updates.endDate !== undefined) patch.end_date = updates.endDate;
  if (hasOwnEventUpdate(updates, 'startTime')) patch.start_time = updates.startTime ?? null;
  if (hasOwnEventUpdate(updates, 'endTime')) patch.end_time = updates.endTime ?? null;
  if (hasOwnEventUpdate(updates, 'linkedEpisode')) patch.linked_episode = updates.linkedEpisode ?? null;
  if (hasOwnEventUpdate(updates, 'linkedPart')) patch.linked_part = updates.linkedPart ?? null;
  if (hasOwnEventUpdate(updates, 'linkedSheetName')) patch.linked_sheet_name = updates.linkedSheetName ?? null;
  if (hasOwnEventUpdate(updates, 'linkedSceneId')) patch.linked_scene_id = updates.linkedSceneId ?? null;
  if (hasOwnEventUpdate(updates, 'linkedDepartment')) patch.linked_department = updates.linkedDepartment ?? null;
  if (hasOwnEventUpdate(updates, 'linkedTodoId')) patch.linked_todo_id = updates.linkedTodoId ?? null;
  return patch;
}

/** 로컬 ID(cal_xxx) 또는 GCal ID로 캐시에서 이벤트 찾기 (cold cache 시 sync 시도) */
async function resolveEvent(eventId: string): Promise<CalendarEvent | undefined> {
  // cold cache 방어: 캐시가 비어있으면 sync 시도
  if (eventCache.length === 0) {
    try {
      const authed = await gcalService.isAuthenticated();
      if (authed) await syncAll();
    } catch { /* 무시 */ }
  }

  // 직접 매칭
  const direct = eventCache.find((e) => e.id === eventId);
  if (direct) return direct;
  // 매핑 체인을 타고 재조회 (migration: oldId → freshCalId → newRealId 같은 2단계 이상)
  let mapped = localToGcalId.get(eventId);
  let hops = 0;
  while (mapped && hops < 4) {
    const found = eventCache.find((e) => e.id === mapped);
    if (found) return found;
    mapped = localToGcalId.get(mapped);
    hops++;
  }
  // linkedTodoId로 폴백 (cal_xxx → todoId 추출)
  if (eventId.startsWith('cal_')) {
    const todoId = eventId.slice(4);
    return eventCache.find((e) => e.linkedTodoId === todoId);
  }
  return undefined;
}

async function addBflowEvent(event: CalendarEvent, calendarId: string): Promise<void> {
  const localId = event.id;
  const optimistic = withBflowCalendarPresentation({
    ...event,
    type: bflowEventType(event),
    allDay: event.allDay ?? true,
  }, calendarId);
  bflowEvents.push(optimistic);
  rebuildEventCache();
  broadcastCalendarChange({ eventId: localId, action: 'add' });

  try {
    const inserted = await window.electronAPI.calendarEventCreate({
      calendar_id: calendarId,
      title: event.title,
      memo: event.memo,
      tag_id: event.tagId ?? null,
      all_day: event.allDay ?? true,
      start_date: event.startDate,
      end_date: event.endDate,
      start_time: event.startTime ?? null,
      end_time: event.endTime ?? null,
      linked_episode: event.linkedEpisode ?? null,
      linked_part: event.linkedPart ?? null,
      linked_sheet_name: event.linkedSheetName ?? null,
      linked_scene_id: event.linkedSceneId ?? null,
      linked_department: event.linkedDepartment ?? null,
      linked_todo_id: event.linkedTodoId ?? null,
    });
    if (localId !== inserted.id) {
      localToGcalId.set(localId, inserted.id);
    }
    mutateSourceEvents('bflow', (events) => events.map((item) => (
      item.id === localId ? { ...item, id: inserted.id } : item
    )));
    broadcastCalendarChange({ eventId: inserted.id, action: 'update' });
  } catch (err) {
    mutateSourceEvents('bflow', (events) => events.filter((item) => item.id !== localId));
    broadcastCalendarChange();
    throw err;
  }
}

export async function addEvent(event: CalendarEvent): Promise<void> {
  if (event.calendarId) {
    await addBflowEvent(event, event.calendarId);
    return;
  }

  // ── 비공개 이벤트 분기 — Supabase 에만 저장, Google Calendar 비연동 ──
  if (event.isPrivate) {
    const userId = useAuthStore.getState().currentUser?.id;
    if (!userId) throw new Error('로그인 정보가 필요합니다 (비공개 일정)');

    const localId = event.id;
    // 낙관적 업데이트
    bflowEvents.push({
      ...event,
      sourceCalendarId: PRIVATE_CAL_ID,
      isPrivate: true,
      source: 'bflow',
    });
    rebuildEventCache();
    broadcastCalendarChange({ eventId: localId, action: 'add' });

    try {
      const inserted = await window.electronAPI.supabaseAddPrivateEvent({
        user_id: userId,
        title: event.title,
        memo: event.memo,
        color: event.color,
        type: event.type,
        start_date: event.startDate,
        end_date: event.endDate,
        linked_episode: event.linkedEpisode ?? null,
        linked_part: event.linkedPart ?? null,
        linked_sheet_name: event.linkedSheetName ?? null,
        linked_scene_id: event.linkedSceneId ?? null,
        linked_department: event.linkedDepartment ?? null,
        linked_todo_id: event.linkedTodoId ?? null,
        created_by: event.createdBy,
      });
      // 로컬 ID → Supabase UUID 교체
      if (localId !== inserted.id) {
        localToGcalId.set(localId, inserted.id);
      }
      mutateSourceEvents('bflow', (events) => events.map((item) => (
        item.id === localId ? { ...item, id: inserted.id } : item
      )));
      broadcastCalendarChange({ eventId: inserted.id, action: 'update' });
    } catch (err) {
      mutateSourceEvents('bflow', (events) => events.filter((item) => item.id !== localId));
      broadcastCalendarChange();
      throw err;
    }
    return;
  }

  const calId = await getTargetCalendar(event.type);
  if (!calId) throw new Error('캘린더가 설정되지 않았습니다');

  // caller가 제공한 로컬 ID 보존 (cal_xxx 등)
  const localId = event.id;

  // 낙관적 업데이트: 로컬 ID로 캐시에 먼저 추가 + 원본 캘린더 ID 기록
  googleEvents.push({ ...event, sourceCalendarId: calId, source: 'google' });
  rebuildEventCache();
  broadcastCalendarChange({ eventId: localId, action: 'add' });

  try {
    // GCal 종일 이벤트 종료일 보정 (B flow inclusive → GCal exclusive)
    const isAllDay = event.startDate.length === 10;
    const gcalEndDate = isAllDay && event.endDate ? addOneDay(event.endDate) : event.endDate;
    const gcalId = await gcalService.insertEvent(calId, {
      summary: event.title,
      description: event.memo,
      startDate: event.startDate,
      endDate: gcalEndDate,
      extendedProperties: toBflowMeta(event),
      // 비공개 일정이면 Google Calendar 에 'private' 로 저장 — 도메인 내 다른 사용자에게 숨김
      visibility: event.isPrivate ? 'private' : undefined,
    });
    // 성공: 로컬 ID → GCal ID 매핑 등록 + 캐시 ID 교체
    if (localId !== gcalId) {
      localToGcalId.set(localId, gcalId);
    }
    mutateSourceEvents('google', (events) => events.map((item) => (
      item.id === localId ? { ...item, id: gcalId } : item
    )));
    broadcastCalendarChange({ eventId: gcalId, action: 'update' });
  } catch (err) {
    // 실패: 롤백
    mutateSourceEvents('google', (events) => events.filter((item) => item.id !== localId));
    broadcastCalendarChange();
    throw err;
  }
}

export async function updateEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<void> {
  const existing = await resolveEvent(eventId);
  if (!existing) return;
  const actualId = existing.id; // GCal ID (캐시에 저장된 실제 ID)

  // ── B flow 공유 캘린더 이벤트 분기 — calendar:* IPC 경유 ──
  if (existing.sourceCalendarId?.startsWith(BFLOW_CAL_PREFIX)) {
    const patch = toBflowEventUpdatePatch(updates);
    if (Object.keys(patch).length === 0) return;
    const previous = { ...existing };
    const optimistic = applyBflowEventUpdates(existing, updates);
    mutateSourceEvents('bflow', (events) => events.map((item) => (
      item.id === actualId ? optimistic : item
    )));
    broadcastCalendarChange({ eventId: actualId, action: 'update' });

    try {
      await window.electronAPI.calendarEventUpdate(actualId, patch);
    } catch (err) {
      mutateSourceEvents('bflow', (events) => events.map((item) => (
        item.id === actualId ? previous : item
      )));
      broadcastCalendarChange({ eventId: actualId, action: 'update' });
      throw err;
    }
    return;
  }

  // ── 저장소 이전(migration) 감지 —
  //    공개(GCal) ↔ 비공개(Supabase) 플래그가 바뀌면 단순 필드 패치로는 안 된다.
  //    "앱에만 저장" 약속을 지키려면 실제로 기존 저장소에서 삭제하고 새 저장소에 생성해야 한다.
  const currentlyPrivate = existing.sourceCalendarId === PRIVATE_CAL_ID;
  const nextPrivate = updates.isPrivate !== undefined ? updates.isPrivate : currentlyPrivate;
  if (updates.isPrivate !== undefined && currentlyPrivate !== nextPrivate) {
    const merged: CalendarEvent = { ...existing, ...updates, isPrivate: nextPrivate };
    // create-first: 새 저장소에 먼저 생성해 성공을 확정한 뒤 기존 저장소에서 제거한다.
    // delete-first 방식이면 create 가 네트워크/인증 오류로 실패했을 때 원본이 이미
    // 사라져 데이터 손실이 발생하므로, 사용자 관점에서 atomic 하게 느껴지도록 순서를 뒤집음.
    const freshLocalId = `cal_${createUuid()}`;
    const fresh: CalendarEvent = {
      ...merged,
      id: freshLocalId,
      sourceCalendarId: undefined, // addEvent 내부에서 경로 결정
      createdAt: merged.createdAt || new Date().toISOString(),
    };
    // 1) 새 저장소에 생성 — 실패하면 원본이 그대로 남아있어 데이터 손실 없음.
    await addEvent(fresh);
    // 2) 새 이벤트가 안전하게 자리잡은 뒤 기존 저장소에서 제거.
    //    여기서 실패하더라도 사용자에게는 '이전 성공' — 중복이 잠깐 남을 뿐 데이터 손실 아님.
    try {
      await deleteEvent(eventId);
    } catch (err) {
      console.error('[calendar] privacy migration: 새 저장소 생성은 성공했으나 기존 저장소 삭제 실패. 중복 이벤트가 남을 수 있음:', err);
    }
    // 3) 원본 eventId 를 들고 있는 caller 가 stale id 로 이어지는 update/delete 를 호출해도
    //    resolveEvent 가 매핑 체인을 타고 찾을 수 있도록 oldId → freshLocalId 매핑 등록.
    //    addEvent 는 freshLocalId → 최종 저장소 real id 를 추가로 매핑하므로 2단계 체인으로 해결.
    if (actualId !== freshLocalId) {
      localToGcalId.set(actualId, freshLocalId);
    }
    if (eventId !== actualId && eventId !== freshLocalId) {
      localToGcalId.set(eventId, freshLocalId);
    }
    return;
  }

  // ── 비공개 이벤트 분기 — Supabase update ──
  if (existing.sourceCalendarId === PRIVATE_CAL_ID) {
    const previous = { ...existing };
    mutateSourceEvents('bflow', (events) => events.map((item) => (
      item.id === actualId ? { ...item, ...updates } : item
    )));
    broadcastCalendarChange({ eventId: actualId, action: 'update' });

    try {
      const patch: Record<string, unknown> = {};
      if (updates.title !== undefined) patch.title = updates.title;
      if (updates.memo !== undefined) patch.memo = updates.memo;
      if (updates.color !== undefined) patch.color = updates.color;
      if (updates.type !== undefined) patch.type = updates.type;
      if (updates.startDate !== undefined) patch.start_date = updates.startDate;
      if (updates.endDate !== undefined) patch.end_date = updates.endDate;
      if (hasOwnEventUpdate(updates, 'linkedEpisode')) patch.linked_episode = updates.linkedEpisode ?? null;
      if (hasOwnEventUpdate(updates, 'linkedPart')) patch.linked_part = updates.linkedPart ?? null;
      if (hasOwnEventUpdate(updates, 'linkedSheetName')) patch.linked_sheet_name = updates.linkedSheetName ?? null;
      if (hasOwnEventUpdate(updates, 'linkedSceneId')) patch.linked_scene_id = updates.linkedSceneId ?? null;
      if (hasOwnEventUpdate(updates, 'linkedDepartment')) patch.linked_department = updates.linkedDepartment ?? null;
      if (hasOwnEventUpdate(updates, 'linkedTodoId')) patch.linked_todo_id = updates.linkedTodoId ?? null;
      await window.electronAPI.supabaseUpdatePrivateEvent(actualId, patch);
    } catch (err) {
      mutateSourceEvents('bflow', (events) => events.map((item) => (
        item.id === actualId ? previous : item
      )));
      broadcastCalendarChange({ eventId: actualId, action: 'update' });
      throw err;
    }
    return;
  }

  // 원본 캘린더 ID 우선 사용 (캘린더 설정 변경 후에도 올바른 캘린더에서 수정)
  const calId = existing.sourceCalendarId || await getTargetCalendar(existing.type);
  if (!calId) return;
  const existingSource = inferExistingEventSource(existing);

  // 낙관적 업데이트: 캐시 먼저 업데이트
  const previous = { ...existing };
  mutateSourceEvents(existingSource, (events) => events.map((item) => (
    item.id === actualId ? { ...item, ...updates } : item
  )));
  broadcastCalendarChange({ eventId: actualId, action: 'update' });

  try {
    const effectiveStart = updates.startDate ?? existing.startDate;
    const effectiveEnd = updates.endDate ?? existing.endDate;
    const isAllDay = effectiveStart.length === 10;
    const gcalEndDate = isAllDay && effectiveEnd ? addOneDay(effectiveEnd) : effectiveEnd;
    await gcalService.updateEvent(calId, actualId, {
      summary: updates.title,
      description: updates.memo,
      startDate: updates.startDate,
      endDate: gcalEndDate,
      extendedProperties: toBflowMeta({ ...existing, ...updates }),
      // isPrivate 토글은 이미 위의 저장소 이전 경로에서 처리됨 — 여기는 저장소 변경 없이
      // 단순 필드 수정만 오므로 visibility 는 건드리지 않는다.
    });
  } catch (err) {
    // 실패: 롤백
    mutateSourceEvents(existingSource, (events) => events.map((item) => (
      item.id === actualId ? previous : item
    )));
    broadcastCalendarChange({ eventId: actualId, action: 'update' });
    throw err;
  }
}

export async function deleteEvent(eventId: string): Promise<void> {
  const existing = await resolveEvent(eventId);
  if (!existing) return;
  const actualId = existing.id; // GCal ID

  // ── B flow 공유 캘린더 이벤트 분기 — calendar:* IPC 경유 ──
  if (existing.sourceCalendarId?.startsWith(BFLOW_CAL_PREFIX)) {
    mutateSourceEvents('bflow', (events) => events.filter((item) => item.id !== actualId));
    broadcastCalendarChange({ eventId: actualId, action: 'delete' });
    try {
      await window.electronAPI.calendarEventDelete(actualId);
      cleanupDeletedEventAliases(eventId, actualId);
    } catch (err) {
      mutateSourceEvents('bflow', (events) => (
        events.some((item) => item.id === actualId) ? events : [...events, existing]
      ));
      broadcastCalendarChange({ eventId: actualId, action: 'add' });
      throw err;
    }
    return;
  }

  // ── 비공개 이벤트 분기 — Supabase delete ──
  if (existing.sourceCalendarId === PRIVATE_CAL_ID) {
    const previous = existing;
    mutateSourceEvents('bflow', (events) => events.filter((item) => item.id !== actualId));
    broadcastCalendarChange({ eventId: actualId, action: 'delete' });
    try {
      await window.electronAPI.supabaseDeletePrivateEvent(actualId);
      cleanupDeletedEventAliases(eventId, actualId);
    } catch (err) {
      mutateSourceEvents('bflow', (events) => (
        events.some((item) => item.id === actualId) ? events : [...events, previous]
      ));
      broadcastCalendarChange({ eventId: actualId, action: 'add' });
      throw err;
    }
    return;
  }

  // 로컬 전용 이벤트(GCal에 저장되지 않은 legacy 이벤트)는 캐시에서만 제거
  // sourceCalendarId 부재 = GCal과 연동되지 않은 이벤트 (calendarService.ts:229 참고)
  // 주의: cal_ prefix 가드는 제거됨. in-flight insert 상태(actualId=cal_*, sourceCalendarId=실제)도
  // GCal 삭제 경로로 진입해야 함. insert가 성공하면 GCal에 고스트 이벤트가 남기 때문.
  // 404 등 실패 시 catch에서 롤백 처리.
  const isLocalOnly = !existing.sourceCalendarId;
  if (isLocalOnly) {
    const existingSource = inferExistingEventSource(existing);
    mutateSourceEvents(existingSource, (events) => events.filter((item) => item.id !== actualId));
    cleanupDeletedEventAliases(eventId, actualId);
    broadcastCalendarChange({ eventId: actualId, action: 'delete' });
    return;
  }

  // 원본 캘린더 ID 우선 사용
  const calId = existing.sourceCalendarId || await getTargetCalendar(existing.type);
  if (!calId) return;
  const existingSource = inferExistingEventSource(existing);

  // 낙관적 업데이트: 캐시 먼저 업데이트
  mutateSourceEvents(existingSource, (events) => events.filter((item) => item.id !== actualId));
  broadcastCalendarChange({ eventId: actualId, action: 'delete' });

  try {
    await gcalService.deleteEvent(calId, actualId);
    cleanupDeletedEventAliases(eventId, actualId);
  } catch (err) {
    // 실패: 롤백
    mutateSourceEvents(existingSource, (events) => (
      events.some((item) => item.id === actualId) ? events : [...events, existing]
    ));
    broadcastCalendarChange({ eventId: actualId, action: 'add' });
    throw err;
  }
}

function broadcastCalendarChange(detail?: { eventId?: string; action?: 'add' | 'update' | 'delete' }) {
  // 1) 자기 프로세스 구독자에게 즉시 전파 (즉각적 UX 반응)
  window.dispatchEvent(new CustomEvent('bflow:calendar-changed', { detail }));
  // 2) 다른 BrowserWindow(플로팅 위젯 등)에도 IPC로 전파
  //    무한 루프 방지: 메인 프로세스가 송신자(event.sender.id)를 제외하므로
  //    자기 창은 IPC로 되돌아온 이벤트를 수신하지 않음.
  try {
    window.electronAPI?.calendarBroadcastChange?.(detail);
  } catch {
    // 브라우저/개발 환경에서 electronAPI 미제공 시 무시
  }
}

export function filterEventsByRange(events: CalendarEvent[], rangeStart: string, rangeEnd: string): CalendarEvent[] {
  return events.filter((e) => e.endDate >= rangeStart && e.startDate <= rangeEnd);
}

export function getEventsForDate(events: CalendarEvent[], date: string): CalendarEvent[] {
  return events.filter((e) => e.startDate <= date && e.endDate >= date);
}
