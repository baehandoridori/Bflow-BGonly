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
import { getPersonalCalendar, useCalendarStore } from '@/stores/useCalendarStore';
import { createUuid } from '@/utils/createUuid';

// 비공개 이벤트는 Google Calendar 가 아닌 Supabase 에만 저장된다.
// sourceCalendarId 에 이 특수 식별자를 써서 update/delete 시 올바른 저장소로 라우팅.
const PRIVATE_CAL_ID = 'supabase-private';
const BFLOW_CAL_PREFIX = 'bflow:';

type RawPrivateEvent = Awaited<ReturnType<NonNullable<Window['electronAPI']>['supabaseReadPrivateEvents']>>[number];
type RawBflowEvent = Awaited<ReturnType<NonNullable<Window['electronAPI']>['calendarEventsList']>>[number];

// 마이그레이션이 ID를 유지한 구 비공개 행. 사용자 전환이나 읽기 실패 때 다른 사용자의
// ID를 재사용하지 않도록, 조회 신뢰도까지 함께 보관한다.
type LegacyPrivateEventState = {
  userId: string | null;
  ids: Set<string>;
  status: 'known' | 'unknown';
};

let legacyPrivateEvents: LegacyPrivateEventState = {
  userId: null,
  ids: new Set<string>(),
  status: 'unknown',
};
let bflowSessionUserId = useAuthStore.getState().currentUser?.id ?? null;
let bflowSessionGeneration = 0;

class PrivacyMigrationCompensationError extends Error {
  readonly errors: readonly [unknown, unknown];

  constructor(
    originalEventId: string,
    replacementEventId: string,
    originalDeleteError: unknown,
    compensationDeleteError: unknown,
  ) {
    super(`[calendar] privacy migration failed: original ${originalEventId} delete and replacement ${replacementEventId} compensation delete both failed`);
    this.name = 'PrivacyMigrationCompensationError';
    this.errors = [originalDeleteError, compensationDeleteError];
  }
}

async function fetchLegacyPrivateEventsForUser(userId: string): Promise<RawPrivateEvent[]> {
  return window.electronAPI.supabaseReadPrivateEvents(userId);
}

async function readLegacyPrivateEventsForUser(userId: string): Promise<RawPrivateEvent[]> {
  const requestSessionGeneration = bflowSessionGeneration;
  const rows = await fetchLegacyPrivateEventsForUser(userId);
  if (
    requestSessionGeneration !== bflowSessionGeneration
    || userId !== bflowSessionUserId
    || userId !== useAuthStore.getState().currentUser?.id
  ) return rows;
  legacyPrivateEvents = {
    userId,
    ids: new Set(rows.map((row) => row.id)),
    status: 'known',
  };
  return rows;
}

function forgetLegacyPrivateEvent(id: string): void {
  legacyPrivateEvents.ids.delete(id);
}

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
  const creator = row.created_by
    ? useAuthStore.getState().users.find((user) => user.id === row.created_by)
    : undefined;
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
    createdBy: creator?.name ?? row.created_by ?? '',
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
    isPrivate: calendar?.isPersonal === true,
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
// Google 낙관적 화면 상태와 서버 확인 상태를 분리한다. 겹친 수정의 payload는
// 아직 성공하지 않은 다른 요청의 필드를 복사하지 않도록 확인 상태만 기준으로 만든다.
const confirmedGoogleEvents = new Map<string, CalendarEvent>();
const sessionOptimisticGoogleEventIds = new Set<string>();
// Google 캐시는 빈 목록도 정상적인 동기화 결과이므로 이벤트 개수와 별도로 준비 상태를 보관한다.
let googleCacheReady = false;
let syncAllGeneration = 0;
let bflowLoadGeneration = 0;
let bflowMutationInFlight = 0;
let bflowLoadsInFlight = 0;
let bflowReloadRequested = false;
let bflowReloadTask: { sessionGeneration: number; promise: Promise<void> } | null = null;
// 이 renderer 세션에서 보상 삭제된 캘린더+이벤트 ID를 기억해, 삭제 전에 만들어진
// 동기화 snapshot이 해당 이벤트만 되살리지 못하게 한다.
const compensatedGoogleEventKeys = new Set<string>();

function compensatedGoogleEventKey(calendarId: string, eventId: string): string {
  return `${calendarId}\u0000${eventId}`;
}

function isCompensatedGoogleEvent(
  calendarId: string | undefined,
  eventId: string | undefined,
): boolean {
  return Boolean(
    calendarId
    && eventId
    && compensatedGoogleEventKeys.has(compensatedGoogleEventKey(calendarId, eventId)),
  );
}

export function isGoogleCacheReady(): boolean {
  return googleCacheReady;
}

function rebuildEventCache(): void {
  const seen = new Set<string>();
  eventCache = [...bflowEvents, ...googleEvents].filter(
    (event) => !seen.has(event.id) && (seen.add(event.id), true),
  );
}

function googleEventKey(calendarId: string, eventId: string): string {
  return `${calendarId}\u0000${eventId}`;
}

function replaceConfirmedGoogleEvents(events: CalendarEvent[]): void {
  confirmedGoogleEvents.clear();
  for (const event of events) {
    if (event.sourceCalendarId) {
      confirmedGoogleEvents.set(googleEventKey(event.sourceCalendarId, event.id), { ...event });
    }
  }
}

function confirmGoogleEventUpdate(
  calendarId: string,
  eventId: string,
  fallback: CalendarEvent,
  updates: Partial<CalendarEvent>,
): void {
  const key = googleEventKey(calendarId, eventId);
  const confirmed = confirmedGoogleEvents.get(key) ?? fallback;
  confirmedGoogleEvents.set(key, { ...confirmed, ...updates, id: eventId, sourceCalendarId: calendarId });
}

type CalendarCacheSource = 'bflow' | 'google';

type ConcurrentEventUpdateFlight = {
  source: CalendarCacheSource;
  sessionGeneration: number | null;
  inFlight: number;
  concurrent: boolean;
  reconcileRequested: boolean;
  reconcileTask: Promise<void> | null;
};

const concurrentEventUpdateFlights = new Map<string, ConcurrentEventUpdateFlight>();

async function reconcileConcurrentEventUpdates(flight: ConcurrentEventUpdateFlight): Promise<void> {
  try {
    if (flight.source === 'bflow') {
      if (flight.sessionGeneration !== bflowSessionGeneration) return;
      await loadBflowEventsInternal();
      return;
    }
    await syncAll({ skipBflowLoad: true });
  } catch (err) {
    // 쓰기 성공/실패 결과를 정본 재조회 오류로 바꾸지는 않는다. 기존 캐시는 유지하고
    // 다음 화면 동기화에서 다시 수렴할 수 있도록 진단만 남긴다.
    console.warn('[Calendar] 겹친 일정 수정 후 정본 재조회 실패:', err);
  }
}

async function drainConcurrentEventUpdateReconciliation(
  key: string,
  flight: ConcurrentEventUpdateFlight,
): Promise<void> {
  if (flight.reconcileTask) {
    await flight.reconcileTask;
    return;
  }

  const task = (async () => {
    // 정본 재조회 중 새 수정이 끝나면 한 번 더 조회한다. 진행 중인 쓰기보다 먼저 받은
    // snapshot이 마지막 낙관적 값을 덮는 것을 막으면서, 평상시 단일 수정은 추가 조회하지 않는다.
    while (flight.inFlight === 0 && flight.reconcileRequested) {
      flight.reconcileRequested = false;
      await reconcileConcurrentEventUpdates(flight);
    }
  })();
  flight.reconcileTask = task;
  try {
    await task;
  } finally {
    if (flight.reconcileTask === task) flight.reconcileTask = null;
    if (
      flight.inFlight === 0
      && !flight.reconcileRequested
      && concurrentEventUpdateFlights.get(key) === flight
    ) {
      concurrentEventUpdateFlights.delete(key);
    }
  }
}

async function withConcurrentEventUpdateReconciliation<T>(
  source: CalendarCacheSource,
  key: string,
  mutation: () => Promise<T>,
): Promise<T> {
  let flight = concurrentEventUpdateFlights.get(key);
  if (flight) {
    flight.concurrent = true;
  } else {
    flight = {
      source,
      sessionGeneration: source === 'bflow' ? bflowSessionGeneration : null,
      inFlight: 0,
      concurrent: false,
      reconcileRequested: false,
      reconcileTask: null,
    };
    concurrentEventUpdateFlights.set(key, flight);
  }
  flight.inFlight += 1;

  try {
    return await mutation();
  } finally {
    flight.inFlight = Math.max(0, flight.inFlight - 1);
    if (flight.concurrent) flight.reconcileRequested = true;
    if (flight.inFlight === 0) {
      if (flight.reconcileRequested) {
        await drainConcurrentEventUpdateReconciliation(key, flight);
      } else if (concurrentEventUpdateFlights.get(key) === flight) {
        concurrentEventUpdateFlights.delete(key);
      }
    }
  }
}

type CreatedEventRef =
  | { actualId: string; storage: 'bflow'; calendarId: string }
  | { actualId: string; storage: 'legacy-private' }
  | { actualId: string; storage: 'google'; calendarId: string };

function invalidateBflowLoads(): void {
  bflowLoadGeneration += 1;
}

type BflowMutationToken = { userId: string | null; sessionGeneration: number };

function isBflowMutationCurrent(token: BflowMutationToken): boolean {
  const currentUserId = useAuthStore.getState().currentUser?.id ?? null;
  return token.sessionGeneration === bflowSessionGeneration
    && token.userId === bflowSessionUserId
    && token.userId === currentUserId;
}

function captureBflowMutationToken(): BflowMutationToken {
  resetBflowSession(useAuthStore.getState().currentUser?.id ?? null);
  return { userId: bflowSessionUserId, sessionGeneration: bflowSessionGeneration };
}

function beginBflowMutation(): BflowMutationToken {
  const token = captureBflowMutationToken();
  bflowMutationInFlight += 1;
  if (bflowLoadsInFlight > 0) bflowReloadRequested = true;
  invalidateBflowLoads();
  return token;
}

async function finishBflowMutation(token: BflowMutationToken): Promise<void> {
  if (!isBflowMutationCurrent(token)) return;
  bflowMutationInFlight = Math.max(0, bflowMutationInFlight - 1);
  invalidateBflowLoads();
  if (bflowMutationInFlight === 0 && bflowReloadRequested) {
    await reloadBflowAfterDiscardedLoad(token.sessionGeneration);
  }
}

async function withBflowMutation<T>(mutation: (token: BflowMutationToken) => Promise<T>): Promise<T> {
  const token = beginBflowMutation();
  try {
    return await mutation(token);
  } finally {
    await finishBflowMutation(token);
  }
}

/** 낙관적 CRUD 공용 헬퍼 — 확인된 단일 source만 변경한 뒤 병합 캐시를 재조립한다. */
function mutateSourceEvents(
  source: CalendarCacheSource,
  fn: (events: CalendarEvent[]) => CalendarEvent[],
): void {
  if (source === 'bflow') {
    // CRUD가 시작된 뒤 도착한 이전 load 결과가 낙관적 변경을 되돌리지 못하게 한다.
    invalidateBflowLoads();
    bflowEvents = fn(bflowEvents);
  } else {
    googleEvents = fn(googleEvents);
  }
  rebuildEventCache();
}

export async function getEvents(): Promise<CalendarEvent[]> {
  return [...eventCache];
}

type LoadBflowEventsOptions = {
  broadcast?: boolean;
};

async function loadBflowEventsInternal(options: LoadBflowEventsOptions = {}): Promise<boolean> {
  resetBflowSession(useAuthStore.getState().currentUser?.id ?? null);
  const requestSessionGeneration = bflowSessionGeneration;
  const requestUserId = bflowSessionUserId;
  const requestGeneration = ++bflowLoadGeneration;
  bflowLoadsInFlight += 1;
  if (bflowMutationInFlight > 0) bflowReloadRequested = true;
  try {
    await useCalendarStore.getState().loadAll();
    const calendars = useCalendarStore.getState().calendars;
    const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
    const rows = await window.electronAPI.calendarEventsList();
    const next = rows.map((row) => toCalendarEventFromBflowRow(row, calendarsById));

    // 마이그레이션 전 폴백: 구 private_calendar_events 병행 읽기 — 중복 id 는 calendar_events 우선.
    const newIds = new Set(next.map((event) => event.id));
    const userId = requestUserId;
    let nextLegacyPrivateEvents: LegacyPrivateEventState;
    try {
      if (userId) {
        const legacyRows = await fetchLegacyPrivateEventsForUser(userId);
        nextLegacyPrivateEvents = {
          userId,
          ids: new Set(legacyRows.map((row) => row.id)),
          status: 'known',
        };
        for (const row of legacyRows) {
          if (!newIds.has(row.id)) next.push(toCalendarEventFromPrivate(row));
        }
      } else {
        nextLegacyPrivateEvents = { userId: null, ids: new Set<string>(), status: 'known' };
      }
    } catch (err) {
      nextLegacyPrivateEvents = { userId: userId ?? null, ids: new Set<string>(), status: 'unknown' };
      console.warn('[Calendar] 구 비공개 일정 폴백 로드 실패:', err);
    }

    // 단독 로드와 syncAll을 포함해 가장 늦게 시작한 요청만 B flow/legacy 상태를 함께 반영한다.
    if (
      requestSessionGeneration !== bflowSessionGeneration
      || requestUserId !== bflowSessionUserId
      || requestUserId !== (useAuthStore.getState().currentUser?.id ?? null)
    ) return false;
    if (requestGeneration !== bflowLoadGeneration || bflowMutationInFlight > 0) {
      if (bflowMutationInFlight > 0) bflowReloadRequested = true;
      return false;
    }
    legacyPrivateEvents = nextLegacyPrivateEvents;
    bflowEvents = next;
    rebuildEventCache();
    if (options.broadcast !== false) broadcastCalendarChange();
    return true;
  } catch (err) {
    if (requestSessionGeneration === bflowSessionGeneration) {
      console.warn('[Calendar] B flow 일정 로드 실패:', err);
    }
    return false;
  } finally {
    if (requestSessionGeneration === bflowSessionGeneration) {
      bflowLoadsInFlight = Math.max(0, bflowLoadsInFlight - 1);
    }
  }
}

async function reloadBflowAfterDiscardedLoad(sessionGeneration: number): Promise<void> {
  while (
    sessionGeneration === bflowSessionGeneration
    && bflowMutationInFlight === 0
    && bflowReloadRequested
  ) {
    const existing = bflowReloadTask;
    if (existing?.sessionGeneration === sessionGeneration) {
      await existing.promise;
      continue;
    }

    bflowReloadRequested = false;
    const promise = loadBflowEventsInternal().then(() => undefined);
    const task = { sessionGeneration, promise };
    bflowReloadTask = task;
    try {
      await promise;
    } finally {
      if (bflowReloadTask === task) bflowReloadTask = null;
    }
  }
}

/** B flow 일정 로드 — 구글 인증 가드 밖에서 항상 호출된다 (설계서 §6.2 핵심). */
export async function loadBflowEvents(): Promise<void> {
  await loadBflowEventsInternal();
}

/** 전체 동기화 (앱 시작 시 호출) */
export async function syncAll(options: { broadcast?: boolean; skipBflowLoad?: boolean } = {}): Promise<CalendarEvent[]> {
  const requestGeneration = ++syncAllGeneration;
  if (!options.skipBflowLoad) {
    await loadBflowEventsInternal({
      broadcast: options.broadcast !== false,
    });
    if (requestGeneration !== syncAllGeneration) return [...googleEvents];
  }
  const seen = new Set<string>();
  const successfulEvents: CalendarEvent[] = [];

  // 팀/개인 캘린더 목록 — 설정 조회 실패 시에도 비공개 이벤트는 이미 위에서 로드됨
  const calIds = new Set<string>();
  let settingsLoaded = false;
  try {
    const settings = await getGCalSettings();
    if (settings.teamCalendarId) calIds.add(settings.teamCalendarId);
    calIds.add(settings.personalCalendarId || 'primary');
    settingsLoaded = true;
  } catch (err) {
    console.warn('[Calendar] GCal 설정 조회 실패 — 공개 일정 동기화 건너뜀:', err);
  }

  // Google Calendar fullSync — 각 calId 를 개별 try/catch 로 감싸 한 캘린더 실패가
  // 다른 캘린더 로드를 막지 않게 한다.
  const successfulCalendarIds = new Set<string>();
  const failedCalendarIds = new Set<string>();
  for (const calId of calIds) {
    try {
      const gcalEvents = await gcalService.fullSync(calId);
      successfulCalendarIds.add(calId);
      for (const e of gcalEvents) {
        if (e.id && !isCompensatedGoogleEvent(calId, e.id) && !seen.has(e.id)) {
          seen.add(e.id);
          successfulEvents.push(toCalendarEvent(e, calId));
        }
      }
    } catch (err) {
      failedCalendarIds.add(calId);
      console.warn(`[Calendar] Google fullSync 실패 (${calId}):`, err);
    }
  }

  // 더 늦게 시작한 전체 동기화가 이미 최신 결과를 맡았다면, 오래된 요청은
  // 캐시·준비 상태·변경 알림·watch 등록을 건드리지 않는다.
  if (requestGeneration !== syncAllGeneration) return [...googleEvents];

  if (settingsLoaded) {
    // 성공한 캘린더는 빈 결과까지 완전히 교체하되, 실패한 캘린더의 마지막 성공
    // 데이터는 유지한다. 새 성공 행과 ID가 겹치면 새 행이 우선한다.
    const retainedFailedEvents = googleEvents.filter(
      (event) => event.sourceCalendarId && failedCalendarIds.has(event.sourceCalendarId),
    );
    googleEvents = [
      ...successfulEvents.filter((event) => (
        !isCompensatedGoogleEvent(event.sourceCalendarId, event.id)
      )),
      ...retainedFailedEvents.filter((event) => (
        !isCompensatedGoogleEvent(event.sourceCalendarId, event.id) && !seen.has(event.id)
      )),
    ];
    replaceConfirmedGoogleEvents(googleEvents);
  }
  // 설정 조회 실패나 전체 fullSync 실패는 마지막 성공 캐시를 보존하고 재시도 대상으로 둔다.
  googleCacheReady = settingsLoaded
    && successfulCalendarIds.size === calIds.size
    && failedCalendarIds.size === 0;
  rebuildEventCache();
  if (options.broadcast !== false) broadcastCalendarChange();

  // Watch 채널 등록 (실시간 동기화용)
  // 비동기로 실행 — sync 완료를 블로킹하지 않음
  for (const calId of calIds) {
    gcalService.ensureWatch(calId, 'bflow').catch((err) =>
      console.warn('[Calendar] Watch 등록 실패 (수동 동기화는 가능):', err),
    );
  }

  return [...googleEvents];
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
      const next = googleEvents.filter((event) => (
        event.sourceCalendarId !== calId
        && !isCompensatedGoogleEvent(event.sourceCalendarId, event.id)
      ));
      // ID 기반 중복 제거 (팀/개인 캘린더에 같은 이벤트가 있을 수 있음)
      const seenIds = new Set(next.map((event) => event.id));
      for (const gcalEvent of updated) {
        if (
          gcalEvent.id
          && !isCompensatedGoogleEvent(calId, gcalEvent.id)
          && !seenIds.has(gcalEvent.id)
        ) {
          seenIds.add(gcalEvent.id);
          next.push(toCalendarEvent(gcalEvent, calId));
        }
      }
      googleEvents = next;
    } else {
      // 일반 incremental: 삭제 + 머지
      let next = googleEvents.filter((event) => (
        !deleted.includes(event.id)
        && !isCompensatedGoogleEvent(event.sourceCalendarId, event.id)
      ));
      for (const gcalEvent of updated) {
        if (isCompensatedGoogleEvent(calId, gcalEvent.id)) continue;
        const converted = toCalendarEvent(gcalEvent, calId);
        const exists = next.some((event) => event.id === converted.id);
        next = exists
          ? next.map((event) => (event.id === converted.id ? converted : event))
          : [...next, converted];
      }
      googleEvents = next;
    }
    replaceConfirmedGoogleEvents(googleEvents);
    rebuildEventCache();
  }

  broadcastCalendarChange();
}

// ─── 로컬 ID ↔ GCal ID 매핑 (할일 등 cal_* ID 호환용) ──────────────────

const localToGcalId = new Map<string, string>();

function resetBflowSession(userId: string | null): void {
  if (userId === bflowSessionUserId) return;
  bflowSessionUserId = userId;
  bflowSessionGeneration += 1;
  bflowLoadGeneration += 1;
  bflowMutationInFlight = 0;
  bflowLoadsInFlight = 0;
  bflowReloadRequested = false;
  bflowReloadTask = null;
  bflowEvents = [];
  if (sessionOptimisticGoogleEventIds.size > 0) {
    googleEvents = googleEvents.filter((event) => !sessionOptimisticGoogleEventIds.has(event.id));
    sessionOptimisticGoogleEventIds.clear();
  }
  legacyPrivateEvents = {
    userId,
    ids: new Set<string>(),
    status: 'unknown',
  };
  localToGcalId.clear();
  rebuildEventCache();
}

// 인증 store 구독은 상태 변경과 같은 call stack에서 실행된다. Google cache는 기존 인증
// lifecycle에 맡기고, 사용자 소유인 B flow/private cache와 alias만 즉시 격리한다.
useAuthStore.subscribe((state) => {
  resetBflowSession(state.currentUser?.id ?? null);
});

function hasOwnEventUpdate<K extends keyof CalendarEvent>(
  updates: Partial<CalendarEvent>,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(updates, key);
}

type GoogleEventUpdatePayload = Parameters<typeof gcalService.updateEvent>[2];

const GOOGLE_METADATA_UPDATE_KEYS: ReadonlyArray<keyof CalendarEvent> = [
  'type',
  'linkedEpisode',
  'linkedPart',
  'linkedSceneId',
  'linkedDepartment',
  'linkedTodoId',
  'vacationType',
  'vacationUserName',
];

function buildGoogleEventUpdatePayload(
  confirmed: CalendarEvent,
  updates: Partial<CalendarEvent>,
): GoogleEventUpdatePayload {
  const patch: GoogleEventUpdatePayload = {};
  if (hasOwnEventUpdate(updates, 'title')) patch.summary = updates.title;
  if (hasOwnEventUpdate(updates, 'memo')) patch.description = updates.memo;
  if (hasOwnEventUpdate(updates, 'startDate') && updates.startDate !== undefined) {
    patch.startDate = updates.startDate;
  }
  if (hasOwnEventUpdate(updates, 'endDate') && updates.endDate !== undefined) {
    const effectiveStart = updates.startDate ?? confirmed.startDate;
    patch.endDate = effectiveStart.length === 10 ? addOneDay(updates.endDate) : updates.endDate;
  }
  if (GOOGLE_METADATA_UPDATE_KEYS.some((key) => hasOwnEventUpdate(updates, key))) {
    patch.extendedProperties = toBflowMeta({ ...confirmed, ...updates });
  }
  return patch;
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
    isPrivate: calendar?.isPersonal === true,
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

function isBflowPersonalEvent(event: CalendarEvent): boolean {
  if (!event.sourceCalendarId?.startsWith(BFLOW_CAL_PREFIX)) return false;
  const calendarId = event.calendarId ?? event.sourceCalendarId?.slice(BFLOW_CAL_PREFIX.length);
  return calendarId !== undefined
    && useCalendarStore.getState().calendars.some((calendar) => (
      calendar.id === calendarId && calendar.isPersonal
    ));
}

function isCurrentUsersPersonalBflowEvent(event: CalendarEvent, userId: string): boolean {
  if (!event.sourceCalendarId?.startsWith(BFLOW_CAL_PREFIX)) return false;
  const calendarId = event.calendarId ?? event.sourceCalendarId.slice(BFLOW_CAL_PREFIX.length);
  return getPersonalCalendar(useCalendarStore.getState(), userId)?.id === calendarId;
}

function isPrivateStorageEvent(event: CalendarEvent): boolean {
  return event.sourceCalendarId === PRIVATE_CAL_ID || isBflowPersonalEvent(event);
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

async function addBflowEvent(
  event: CalendarEvent,
  calendarId: string,
  inheritedToken?: BflowMutationToken,
): Promise<CreatedEventRef | null> {
  const mutate = async (token: BflowMutationToken): Promise<CreatedEventRef | null> => {
    if (!isBflowMutationCurrent(token)) return null;
    const localId = event.id;
    const optimistic = withBflowCalendarPresentation({
      ...event,
      type: bflowEventType(event),
      allDay: event.allDay ?? true,
    }, calendarId);
    mutateSourceEvents('bflow', (events) => [...events, optimistic]);
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
      if (!isBflowMutationCurrent(token)) return null;
      if (localId !== inserted.id) {
        localToGcalId.set(localId, inserted.id);
      }
      mutateSourceEvents('bflow', (events) => events.map((item) => (
        item.id === localId ? { ...item, id: inserted.id } : item
      )));
      broadcastCalendarChange({ eventId: inserted.id, action: 'update' });
      return { actualId: inserted.id, storage: 'bflow', calendarId };
    } catch (err) {
      if (!isBflowMutationCurrent(token)) return null;
      mutateSourceEvents('bflow', (events) => events.filter((item) => item.id !== localId));
      broadcastCalendarChange();
      throw err;
    }
  };
  return inheritedToken ? mutate(inheritedToken) : withBflowMutation(mutate);
}

async function addEventInternal(
  event: CalendarEvent,
  inheritedToken?: BflowMutationToken,
): Promise<CreatedEventRef | null> {
  if (event.calendarId) {
    return addBflowEvent(event, event.calendarId, inheritedToken);
  }

  // ── 비공개 이벤트 분기 — Supabase 에만 저장, Google Calendar 비연동 ──
  if (event.isPrivate) {
    const mutate = async (token: BflowMutationToken): Promise<CreatedEventRef | null> => {
      const userId = token.userId;
      if (!userId) throw new Error('로그인 정보가 필요합니다 (비공개 일정)');

      const calendarState = useCalendarStore.getState();
      if (!calendarState.loaded) {
        await calendarState.loadAll();
        if (!isBflowMutationCurrent(token)) return null;
      }
      const personal = getPersonalCalendar(useCalendarStore.getState(), userId);
      if (personal) {
        return addBflowEvent({ ...event, calendarId: personal.id }, personal.id, token);
      }

      const localId = event.id;
      // 낙관적 업데이트
      mutateSourceEvents('bflow', (events) => [...events, {
        ...event,
        sourceCalendarId: PRIVATE_CAL_ID,
        isPrivate: true,
        source: 'bflow',
      }]);
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
        if (!isBflowMutationCurrent(token)) return null;
        // 로컬 ID → Supabase UUID 교체
        if (localId !== inserted.id) {
          localToGcalId.set(localId, inserted.id);
        }
        mutateSourceEvents('bflow', (events) => events.map((item) => (
          item.id === localId ? { ...item, id: inserted.id } : item
        )));
        broadcastCalendarChange({ eventId: inserted.id, action: 'update' });
        return { actualId: inserted.id, storage: 'legacy-private' };
      } catch (err) {
        if (!isBflowMutationCurrent(token)) return null;
        mutateSourceEvents('bflow', (events) => events.filter((item) => item.id !== localId));
        broadcastCalendarChange();
        throw err;
      }
    };
    return inheritedToken ? mutate(inheritedToken) : withBflowMutation(mutate);
  }

  if (inheritedToken && !isBflowMutationCurrent(inheritedToken)) return null;

  const calId = await getTargetCalendar(event.type);
  if (inheritedToken && !isBflowMutationCurrent(inheritedToken)) return null;
  if (!calId) throw new Error('캘린더가 설정되지 않았습니다');

  // caller가 제공한 로컬 ID 보존 (cal_xxx 등)
  const localId = event.id;

  // 낙관적 업데이트: 로컬 ID로 캐시에 먼저 추가 + 원본 캘린더 ID 기록
  googleEvents.push({ ...event, sourceCalendarId: calId, source: 'google' });
  if (inheritedToken) sessionOptimisticGoogleEventIds.add(localId);
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
    if (inheritedToken && !isBflowMutationCurrent(inheritedToken)) return null;
    sessionOptimisticGoogleEventIds.delete(localId);
    // 성공: 로컬 ID → GCal ID 매핑 등록 + 캐시 ID 교체
    if (localId !== gcalId) {
      localToGcalId.set(localId, gcalId);
    }
    mutateSourceEvents('google', (events) => events.map((item) => (
      item.id === localId ? { ...item, id: gcalId } : item
    )));
    const confirmed = googleEvents.find((item) => item.id === gcalId);
    if (confirmed) {
      confirmedGoogleEvents.set(googleEventKey(calId, gcalId), { ...confirmed });
    }
    broadcastCalendarChange({ eventId: gcalId, action: 'update' });
    return { actualId: gcalId, storage: 'google', calendarId: calId };
  } catch (err) {
    if (inheritedToken && !isBflowMutationCurrent(inheritedToken)) return null;
    sessionOptimisticGoogleEventIds.delete(localId);
    // 실패: 롤백
    mutateSourceEvents('google', (events) => events.filter((item) => item.id !== localId));
    broadcastCalendarChange();
    throw err;
  }
}

export async function addEvent(event: CalendarEvent): Promise<void> {
  await addEventInternal(event);
}

async function compensateCreatedEvent(
  requestId: string,
  created: CreatedEventRef,
  token: BflowMutationToken,
): Promise<boolean> {
  if (!isBflowMutationCurrent(token)) return false;
  if (created.storage === 'google') {
    await gcalService.deleteEvent(created.calendarId, created.actualId);
    if (!isBflowMutationCurrent(token)) return false;
    compensatedGoogleEventKeys.add(compensatedGoogleEventKey(created.calendarId, created.actualId));
    confirmedGoogleEvents.delete(googleEventKey(created.calendarId, created.actualId));
  } else if (created.storage === 'bflow') {
    await window.electronAPI.calendarEventDelete(created.actualId);
    if (!isBflowMutationCurrent(token)) return false;
  } else {
    await window.electronAPI.supabaseDeletePrivateEvent(created.actualId);
    if (!isBflowMutationCurrent(token)) return false;
    forgetLegacyPrivateEvent(created.actualId);
  }

  const cacheSource: CalendarCacheSource = created.storage === 'google' ? 'google' : 'bflow';
  mutateSourceEvents(cacheSource, (events) => events.filter((item) => (
    item.id !== created.actualId && item.id !== requestId
  )));
  cleanupDeletedEventAliases(requestId, created.actualId);
  broadcastCalendarChange({ eventId: created.actualId, action: 'delete' });
  return true;
}

export async function updateEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<void> {
  const requestToken = captureBflowMutationToken();
  const existing = await resolveEvent(eventId);
  if (!isBflowMutationCurrent(requestToken)) return;
  if (!existing) return;
  const actualId = existing.id; // GCal ID (캐시에 저장된 실제 ID)

  // ── 저장소 이전(migration) 감지 ─────────────────────
  // 개인 B flow 캘린더와 구 private_calendar_events 는 모두 "나만 보기"의 실제 저장소다.
  // 플래그가 바뀌면 단순 필드 패치가 아니라 새 저장소에 먼저 생성한 뒤 원본을 지운다.
  const currentlyPrivate = isPrivateStorageEvent(existing);
  const nextPrivate = updates.isPrivate !== undefined ? updates.isPrivate : currentlyPrivate;
  if (updates.isPrivate !== undefined && currentlyPrivate !== nextPrivate) {
    const merged: CalendarEvent = { ...existing, ...updates, isPrivate: nextPrivate };
    const requestedCalendarId = updates.calendarId;
    const requestedCalendarIsPersonal = requestedCalendarId !== undefined
      && useCalendarStore.getState().calendars.some((calendar) => (
        calendar.id === requestedCalendarId && calendar.isPersonal
      ));
    // isPrivate=true 은 항상 현재 사용자의 개인 캘린더(없으면 legacy 폴백)로 보낸다.
    // 반대로 false 는 명시된 일반 B flow 대상만 유지하고, 기존 개인 calendarId 는 제거해
    // 기존 Google 공개 경로로 향하게 한다.
    const targetCalendarId = nextPrivate || requestedCalendarIsPersonal
      ? undefined
      : requestedCalendarId;

    // create-first: 새 저장소에 먼저 생성해 성공을 확정한 뒤 기존 저장소에서 제거한다.
    // delete-first 방식이면 create 가 네트워크/인증 오류로 실패했을 때 원본이 이미
    // 사라져 데이터 손실이 발생하므로, 사용자 관점에서 atomic 하게 느껴지도록 순서를 뒤집음.
    const freshLocalId = `cal_${createUuid()}`;
    const fresh: CalendarEvent = {
      ...merged,
      id: freshLocalId,
      calendarId: targetCalendarId,
      sourceCalendarId: undefined, // addEvent 내부에서 새 저장소 경로 결정
      source: undefined,
      canEdit: undefined,
      isReadOnly: undefined,
      createdAt: merged.createdAt || new Date().toISOString(),
    };
    await withBflowMutation(async (token) => {
      // 1) 새 저장소에 생성 — 실패하면 원본이 그대로 남아있어 데이터 손실 없음.
      const replacement = await addEventInternal(fresh, token);
      if (!replacement || !isBflowMutationCurrent(token)) return;
      // 2) 새 이벤트가 안전하게 자리잡은 뒤 기존 저장소에서 제거.
      try {
        await deleteEvent(eventId, token);
        if (!isBflowMutationCurrent(token)) return;
      } catch (originalDeleteError) {
        if (!isBflowMutationCurrent(token)) return;
        // 원본 삭제가 실패하면 create-first 단계의 replacement도 되돌려야 reload 후
        // 영구 중복이 남지 않는다. deleteEvent 는 실패 시 원본 cache 를 복원한다.
        try {
          const compensated = await compensateCreatedEvent(freshLocalId, replacement, token);
          if (!compensated || !isBflowMutationCurrent(token)) return;
        } catch (compensationDeleteError) {
          if (!isBflowMutationCurrent(token)) return;
          throw new PrivacyMigrationCompensationError(
            actualId,
            replacement.actualId,
            originalDeleteError,
            compensationDeleteError,
          );
        }
        throw originalDeleteError;
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
    });
    return;
  }

  // ── B flow 공유 캘린더 이벤트 분기 — calendar:* IPC 경유 ──
  if (existing.sourceCalendarId?.startsWith(BFLOW_CAL_PREFIX)) {
    const patch = toBflowEventUpdatePatch(updates);
    if (Object.keys(patch).length === 0) return;
    await withConcurrentEventUpdateReconciliation(
      'bflow',
      `bflow:${bflowSessionGeneration}:${actualId}`,
      () => withBflowMutation(async (token) => {
        const previous = { ...existing };
        const optimistic = applyBflowEventUpdates(existing, updates);
        mutateSourceEvents('bflow', (events) => events.map((item) => (
          item.id === actualId ? optimistic : item
        )));
        broadcastCalendarChange({ eventId: actualId, action: 'update' });

        try {
          await window.electronAPI.calendarEventUpdate(actualId, patch);
          if (!isBflowMutationCurrent(token)) return;
        } catch (err) {
          if (!isBflowMutationCurrent(token)) return;
          mutateSourceEvents('bflow', (events) => events.map((item) => (
            item.id === actualId ? previous : item
          )));
          broadcastCalendarChange({ eventId: actualId, action: 'update' });
          throw err;
        }
      }),
    );
    return;
  }

  // ── 비공개 이벤트 분기 — Supabase update ──
  if (existing.sourceCalendarId === PRIVATE_CAL_ID) {
    await withConcurrentEventUpdateReconciliation(
      'bflow',
      `bflow:${bflowSessionGeneration}:${actualId}`,
      () => withBflowMutation(async (token) => {
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
          if (!isBflowMutationCurrent(token)) return;
        } catch (err) {
          if (!isBflowMutationCurrent(token)) return;
          mutateSourceEvents('bflow', (events) => events.map((item) => (
            item.id === actualId ? previous : item
          )));
          broadcastCalendarChange({ eventId: actualId, action: 'update' });
          throw err;
        }
      }),
    );
    return;
  }

  // 원본 캘린더 ID 우선 사용 (캘린더 설정 변경 후에도 올바른 캘린더에서 수정)
  const calId = existing.sourceCalendarId || await getTargetCalendar(existing.type);
  if (!calId) return;
  const existingSource = inferExistingEventSource(existing);

  await withConcurrentEventUpdateReconciliation(
    'google',
    `google:${calId}:${actualId}`,
    async () => {
      // 낙관적 업데이트: 캐시 먼저 업데이트
      const previous = { ...existing };
      const confirmed = confirmedGoogleEvents.get(googleEventKey(calId, actualId)) ?? previous;
      const googlePatch = buildGoogleEventUpdatePayload(confirmed, updates);
      mutateSourceEvents(existingSource, (events) => events.map((item) => (
        item.id === actualId ? { ...item, ...updates } : item
      )));
      broadcastCalendarChange({ eventId: actualId, action: 'update' });

      try {
        await gcalService.updateEvent(calId, actualId, googlePatch);
        confirmGoogleEventUpdate(calId, actualId, confirmed, updates);
      } catch (err) {
        // 실패: 롤백
        mutateSourceEvents(existingSource, (events) => events.map((item) => (
          item.id === actualId ? previous : item
        )));
        broadcastCalendarChange({ eventId: actualId, action: 'update' });
        throw err;
      }
    },
  );
}

export async function deleteEvent(
  eventId: string,
  inheritedToken?: BflowMutationToken,
): Promise<void> {
  const requestToken = inheritedToken ?? captureBflowMutationToken();
  const existing = await resolveEvent(eventId);
  if (!isBflowMutationCurrent(requestToken)) return;
  if (!existing) return;
  const actualId = existing.id; // GCal ID

  // ── B flow 공유 캘린더 이벤트 분기 — calendar:* IPC 경유 ──
  if (existing.sourceCalendarId?.startsWith(BFLOW_CAL_PREFIX)) {
    const mutate = async (token: BflowMutationToken): Promise<void> => {
      if (!isBflowMutationCurrent(token)) return;
      const currentUserId = token.userId ?? undefined;
      const isCurrentUsersPersonal = currentUserId !== undefined
        && isCurrentUsersPersonalBflowEvent(existing, currentUserId);
      let hasLegacyCopy = false;

      if (isCurrentUsersPersonal && currentUserId) {
        const stateIsCurrentAndKnown = legacyPrivateEvents.userId === currentUserId
          && legacyPrivateEvents.status === 'known';
        if (!stateIsCurrentAndKnown) {
          await readLegacyPrivateEventsForUser(currentUserId);
          if (!isBflowMutationCurrent(token)) return;
        }
        hasLegacyCopy = legacyPrivateEvents.ids.has(actualId);
      }

      mutateSourceEvents('bflow', (events) => events.filter((item) => item.id !== actualId));
      broadcastCalendarChange({ eventId: actualId, action: 'delete' });
      try {
        if (hasLegacyCopy) {
          await window.electronAPI.supabaseDeletePrivateEvent(actualId);
          if (!isBflowMutationCurrent(token)) return;
          forgetLegacyPrivateEvent(actualId);
        }
        await window.electronAPI.calendarEventDelete(actualId);
        if (!isBflowMutationCurrent(token)) return;
        cleanupDeletedEventAliases(eventId, actualId);
      } catch (err) {
        if (!isBflowMutationCurrent(token)) return;
        mutateSourceEvents('bflow', (events) => (
          events.some((item) => item.id === actualId) ? events : [...events, existing]
        ));
        broadcastCalendarChange({ eventId: actualId, action: 'add' });
        throw err;
      }
    };
    if (inheritedToken) await mutate(inheritedToken);
    else await withBflowMutation(mutate);
    return;
  }

  // ── 비공개 이벤트 분기 — Supabase delete ──
  if (existing.sourceCalendarId === PRIVATE_CAL_ID) {
    const mutate = async (token: BflowMutationToken): Promise<void> => {
      if (!isBflowMutationCurrent(token)) return;
      const previous = existing;
      mutateSourceEvents('bflow', (events) => events.filter((item) => item.id !== actualId));
      broadcastCalendarChange({ eventId: actualId, action: 'delete' });
      try {
        await window.electronAPI.supabaseDeletePrivateEvent(actualId);
        if (!isBflowMutationCurrent(token)) return;
        forgetLegacyPrivateEvent(actualId);
        cleanupDeletedEventAliases(eventId, actualId);
      } catch (err) {
        if (!isBflowMutationCurrent(token)) return;
        mutateSourceEvents('bflow', (events) => (
          events.some((item) => item.id === actualId) ? events : [...events, previous]
        ));
        broadcastCalendarChange({ eventId: actualId, action: 'add' });
        throw err;
      }
    };
    if (inheritedToken) await mutate(inheritedToken);
    else await withBflowMutation(mutate);
    return;
  }

  // 로컬 전용 이벤트(GCal에 저장되지 않은 legacy 이벤트)는 캐시에서만 제거
  const isLocalOnly = !existing.sourceCalendarId;
  if (isLocalOnly) {
    if (inheritedToken && !isBflowMutationCurrent(inheritedToken)) return;
    const existingSource = inferExistingEventSource(existing);
    mutateSourceEvents(existingSource, (events) => events.filter((item) => item.id !== actualId));
    cleanupDeletedEventAliases(eventId, actualId);
    broadcastCalendarChange({ eventId: actualId, action: 'delete' });
    return;
  }

  // 원본 캘린더 ID 우선 사용
  const calId = existing.sourceCalendarId || await getTargetCalendar(existing.type);
  if (inheritedToken && !isBflowMutationCurrent(inheritedToken)) return;
  if (!calId) return;
  const existingSource = inferExistingEventSource(existing);

  // 낙관적 업데이트: 캐시 먼저 업데이트
  mutateSourceEvents(existingSource, (events) => events.filter((item) => item.id !== actualId));
  broadcastCalendarChange({ eventId: actualId, action: 'delete' });

  try {
    await gcalService.deleteEvent(calId, actualId);
    if (inheritedToken && !isBflowMutationCurrent(inheritedToken)) return;
    confirmedGoogleEvents.delete(googleEventKey(calId, actualId));
    cleanupDeletedEventAliases(eventId, actualId);
  } catch (err) {
    if (inheritedToken && !isBflowMutationCurrent(inheritedToken)) return;
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
