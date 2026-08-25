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
  rows: Map<string, RawPrivateEvent>;
  status: 'known' | 'unknown';
};

let legacyPrivateEvents: LegacyPrivateEventState = {
  userId: null,
  ids: new Set<string>(),
  rows: new Map<string, RawPrivateEvent>(),
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

class PrivacyMigrationSourceMissingError extends Error {
  readonly survivingLegacy?: CalendarEvent;

  constructor(eventId: string, survivingLegacy?: CalendarEvent) {
    super(`[calendar] privacy migration source ${eventId} is missing before persistence deletion`);
    this.name = 'PrivacyMigrationSourceMissingError';
    this.survivingLegacy = survivingLegacy;
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
    rows: new Map(rows.map((row) => [row.id, row])),
    status: 'known',
  };
  return rows;
}

function forgetLegacyPrivateEvent(id: string): void {
  legacyPrivateEvents.ids.delete(id);
  legacyPrivateEvents.rows.delete(id);
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
  const timedStart = !isAllDay && gcalEvent.start?.dateTime
    ? fromRfc3339ToKstFields(gcalEvent.start.dateTime)
    : undefined;
  const timedEnd = !isAllDay && gcalEvent.end?.dateTime
    ? fromRfc3339ToKstFields(gcalEvent.end.dateTime)
    : undefined;
  const startDate = isAllDay ? gcalEvent.start.date : timedStart?.date;
  let endDate = isAllDay ? gcalEvent.end?.date : timedEnd?.date;

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
    color: '#8B8DA3',
    type: (meta.bflow_type as CalendarEventType) || 'custom',
    startDate: startDate || '',
    endDate: endDate || '',
    allDay: isAllDay,
    startTime: timedStart?.time,
    endTime: timedEnd?.time,
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

function toKstRfc3339(date: string, time: string): string {
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  return `${date}T${normalizedTime}+09:00`;
}

function fromRfc3339ToKstFields(value: string): { date: string; time: string } {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    return { date: value.slice(0, 10), time: value.slice(11, 16) };
  }
  const kst = new Date(instant.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`,
    time: `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`,
  };
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
// 다른 창/클라이언트에서 persistence가 끝났다는 exact marker를 기억한다. 로컬 ordinary
// delete가 뒤늦게 실패해도 같은 행을 rollback으로 되살리거나 stale snapshot으로 다시
// 담지 않는다. B flow는 calendar+event, legacy는 owner+event identity로 격리한다.
const committedBflowDeleteKeys = new Set<string>();
const committedLegacyPrivateDeleteKeys = new Set<string>();

function committedBflowDeleteKey(calendarId: string, eventId: string): string {
  return `${calendarId}\u0000${eventId}`;
}

function isCommittedBflowDelete(calendarId: string, eventId: string): boolean {
  return committedBflowDeleteKeys.has(committedBflowDeleteKey(calendarId, eventId));
}

function committedLegacyPrivateDeleteKey(ownerId: string, eventId: string): string {
  return `${ownerId}\u0000${eventId}`;
}

function isCommittedLegacyPrivateDelete(ownerId: string | null, eventId: string): boolean {
  return Boolean(
    ownerId
    && committedLegacyPrivateDeleteKeys.has(committedLegacyPrivateDeleteKey(ownerId, eventId)),
  );
}

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

function replaceConfirmedGoogleCalendar(calendarId: string, events: CalendarEvent[]): void {
  for (const [key, event] of confirmedGoogleEvents) {
    if (event.sourceCalendarId === calendarId) confirmedGoogleEvents.delete(key);
  }
  for (const event of events) {
    confirmedGoogleEvents.set(googleEventKey(calendarId, event.id), {
      ...event,
      sourceCalendarId: calendarId,
    });
  }
}

function applyConfirmedGoogleIncremental(
  calendarId: string,
  updated: CalendarEvent[],
  deleted: string[],
): void {
  for (const eventId of deleted) {
    confirmedGoogleEvents.delete(googleEventKey(calendarId, eventId));
  }
  for (const event of updated) {
    confirmedGoogleEvents.set(googleEventKey(calendarId, event.id), {
      ...event,
      sourceCalendarId: calendarId,
    });
  }
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
  | { actualId: string; storage: 'bflow'; calendarId: string; receipt?: string }
  | { actualId: string; storage: 'legacy-private'; ownerId: string; receipt?: string }
  | { actualId: string; storage: 'google'; calendarId: string; receipt?: string };

type EventIntentLease = {
  completion: Promise<EventIntentOutcome>;
  release: (outcome: EventIntentOutcome) => void;
  keys: string[];
};

type EventIntentOutcome = {
  ambiguousError?: PrivacyMigrationCompensationError;
};

// privacy intent는 public 호출 진입 시점에 동기 등록한다. 그래야 같은 tick에 뒤따른
// update/delete가 async resolve 전에 source로 빠지지 않는다. ordinary intent끼리는
// 서로 기다리지 않고, 뒤에 온 privacy intent만 앞선 ordinary 완료를 기다린다.
const activePrivacyMigrationByEventId = new Map<string, EventIntentLease>();
const activeOrdinaryIntentsByEventId = new Map<string, Set<EventIntentLease>>();

type EventAliasPath = {
  keys: string[];
  terminal?: string;
};

/** Alias chain을 끝까지 따라가되 cycle이면 반복 직전에 멈춘다. 정상 chain만
 * terminal로 path compression해 오래된 ID가 migration 횟수와 무관하게 정본을 찾는다. */
function eventAliasPath(eventId: string, compress = true): EventAliasPath {
  const visited = new Set<string>();
  const keys: string[] = [];
  let current = eventId;

  while (!visited.has(current)) {
    visited.add(current);
    keys.push(current);
    const next = localToGcalId.get(current);
    if (!next) {
      if (compress) {
        for (const key of keys) {
          if (key !== current) localToGcalId.set(key, current);
        }
      }
      return { keys, terminal: current };
    }
    current = next;
  }

  // Cycle에는 임의 canonical을 정하지 않는다. 호출자는 포함된 key로 cache를 찾을 수
  // 있고, loop는 visited Set으로 항상 종료된다.
  return { keys };
}

/** seed와 같은 alias graph에 속하는 forward/reverse/transitive key 전체를 모은다. */
function eventAliasClosure(seedKeys: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const seed of seedKeys) {
    for (const key of eventAliasPath(seed).keys) keys.add(key);
  }

  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const alias of localToGcalId.keys()) {
      const path = eventAliasPath(alias);
      if (!path.keys.some((key) => keys.has(key))) continue;
      for (const key of path.keys) {
        if (keys.has(key)) continue;
        keys.add(key);
        expanded = true;
      }
    }
  }
  return keys;
}

function knownEventIdentityKeys(eventId: string): string[] {
  let keys = eventAliasClosure([eventId]);
  let resolved = eventCache.find((event) => keys.has(event.id));
  if (!resolved && eventId.startsWith('cal_')) {
    const linkedTodoId = eventId.slice(4);
    resolved = eventCache.find((event) => event.linkedTodoId === linkedTodoId);
  }
  if (resolved) {
    keys.add(resolved.id);
    if (resolved.linkedTodoId) keys.add(`cal_${resolved.linkedTodoId}`);
    keys = eventAliasClosure(keys);
  }
  return [...keys];
}

function cachedEventForIdentity(eventId: string): CalendarEvent | undefined {
  const keys = new Set(knownEventIdentityKeys(eventId));
  return eventCache.find((event) => keys.has(event.id));
}

function needsPrivacyIntentReservation(
  eventId: string,
  updates: Partial<CalendarEvent>,
): boolean {
  if (updates.isPrivate === undefined) return false;
  const current = cachedEventForIdentity(eventId);
  // cold cache에서는 resolve 전 실제 저장소를 모르므로 보수적으로 선점한다.
  return !current || isPrivateStorageEvent(current) !== updates.isPrivate;
}

function createEventIntentLease(keys: string[]): EventIntentLease {
  let release!: (outcome: EventIntentOutcome) => void;
  const completion = new Promise<EventIntentOutcome>((resolve) => { release = resolve; });
  return { completion, release, keys: [...new Set(keys)] };
}

function activePrivacyMigration(keys: string[]): EventIntentLease | undefined {
  for (const key of keys) {
    const active = activePrivacyMigrationByEventId.get(key);
    if (active) return active;
  }
  return undefined;
}

function registerPrivacyMigration(keys: string[]): {
  lease: EventIntentLease;
  precedingOrdinary: Promise<EventIntentOutcome>[];
} {
  const lease = createEventIntentLease(keys);
  const precedingOrdinary = new Set<Promise<EventIntentOutcome>>();
  for (const key of lease.keys) {
    activePrivacyMigrationByEventId.set(key, lease);
    for (const ordinary of activeOrdinaryIntentsByEventId.get(key) ?? []) {
      precedingOrdinary.add(ordinary.completion);
    }
  }
  return { lease, precedingOrdinary: [...precedingOrdinary] };
}

function releasePrivacyMigration(
  lease: EventIntentLease,
  outcome: EventIntentOutcome,
): void {
  for (const key of lease.keys) {
    if (activePrivacyMigrationByEventId.get(key) === lease) {
      activePrivacyMigrationByEventId.delete(key);
    }
  }
  lease.release(outcome);
}

function extendPrivacyMigration(lease: EventIntentLease, eventId: string): boolean {
  if (lease.keys.includes(eventId)) return true;
  const active = activePrivacyMigrationByEventId.get(eventId);
  if (active && active !== lease) return false;
  lease.keys.push(eventId);
  activePrivacyMigrationByEventId.set(eventId, lease);
  return true;
}

function registerOrdinaryIntent(keys: string[]): EventIntentLease {
  const lease = createEventIntentLease(keys);
  for (const key of lease.keys) {
    const active = activeOrdinaryIntentsByEventId.get(key) ?? new Set<EventIntentLease>();
    active.add(lease);
    activeOrdinaryIntentsByEventId.set(key, active);
  }
  return lease;
}

function releaseOrdinaryIntent(lease: EventIntentLease): void {
  for (const key of lease.keys) {
    const active = activeOrdinaryIntentsByEventId.get(key);
    if (!active) continue;
    active.delete(lease);
    if (active.size === 0) activeOrdinaryIntentsByEventId.delete(key);
  }
  lease.release({});
}

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

function isSameBflowMutationToken(
  left: BflowMutationToken,
  right: BflowMutationToken,
): boolean {
  return left.userId === right.userId
    && left.sessionGeneration === right.sessionGeneration;
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

async function withOrdinaryEventIntent(
  eventId: string,
  token: BflowMutationToken,
  intent: () => Promise<void>,
  retry: () => Promise<void>,
): Promise<void> {
  if (!isBflowMutationCurrent(token)) return;
  const keys = knownEventIdentityKeys(eventId);
  const activePrivacy = activePrivacyMigration(keys);
  if (activePrivacy) {
    const outcome = await activePrivacy.completion;
    if (outcome.ambiguousError) throw outcome.ambiguousError;
    if (!isBflowMutationCurrent(token)) return;
    return retry();
  }

  const lease = registerOrdinaryIntent(keys);
  try {
    if (!isBflowMutationCurrent(token)) return;
    await intent();
  } finally {
    releaseOrdinaryIntent(lease);
  }
}

async function withPrivacyEventIntent(
  eventId: string,
  token: BflowMutationToken,
  intent: (lease: EventIntentLease) => Promise<void>,
  retry: () => Promise<void>,
): Promise<void> {
  if (!isBflowMutationCurrent(token)) return;
  const keys = knownEventIdentityKeys(eventId);
  const activePrivacy = activePrivacyMigration(keys);
  if (activePrivacy) {
    const outcome = await activePrivacy.completion;
    if (outcome.ambiguousError) throw outcome.ambiguousError;
    if (!isBflowMutationCurrent(token)) return;
    return retry();
  }

  const { lease, precedingOrdinary } = registerPrivacyMigration(keys);
  let ambiguousError: PrivacyMigrationCompensationError | undefined;
  try {
    await Promise.all(precedingOrdinary);
    if (!isBflowMutationCurrent(token)) return;
    await intent(lease);
  } catch (error) {
    if (error instanceof PrivacyMigrationCompensationError) ambiguousError = error;
    throw error;
  } finally {
    // 실패도 follower intent 자체를 취소하지 않는다. source가 복원되면 follower가
    // 같은 entry token으로 다시 resolve할 수 있도록 completion은 항상 정상 해제한다.
    releasePrivacyMigration(lease, { ambiguousError });
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
  const calendarState = useCalendarStore.getState();
  if (!calendarState.loaded) return [...eventCache];
  const knownCalendarIds = new Set(calendarState.calendars.map((calendar) => calendar.id));
  return eventCache.filter((event) => (
    event.source !== 'bflow'
    || !event.calendarId
    || knownCalendarIds.has(event.calendarId)
  ));
}

type LoadBflowEventsOptions = {
  broadcast?: boolean;
  requireTagsFresh?: boolean;
};

async function loadBflowEventsInternal(options: LoadBflowEventsOptions = {}): Promise<boolean> {
  resetBflowSession(useAuthStore.getState().currentUser?.id ?? null);
  const requestSessionGeneration = bflowSessionGeneration;
  const requestUserId = bflowSessionUserId;
  const requestGeneration = ++bflowLoadGeneration;
  bflowLoadsInFlight += 1;
  if (bflowMutationInFlight > 0) bflowReloadRequested = true;
  try {
    const metadataFreshness = await useCalendarStore.getState().loadAll();
    if (
      requestGeneration !== bflowLoadGeneration
      || requestSessionGeneration !== bflowSessionGeneration
      || requestUserId !== bflowSessionUserId
      || requestUserId !== (useAuthStore.getState().currentUser?.id ?? null)
    ) return false;
    if (!metadataFreshness.calendarsFresh) return false;
    if (options.requireTagsFresh && !metadataFreshness.tagsFresh) return false;
    const calendarState = useCalendarStore.getState();
    // 일정 행은 캘린더 색·개인 여부·편집 권한을 메타데이터에서 파생한다. 깨끗한
    // 세션에서 목록 조회가 실패했다면 fallback 값으로 오해석하지 말고 다음 호출이
    // 메타데이터와 일정 행을 함께 재시도하도록 기존 캐시를 그대로 둔다.
    if (!calendarState.loaded) return false;
    const calendars = calendarState.calendars;
    const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
    const rows = await window.electronAPI.calendarEventsList();
    const next = rows
      .filter((row) => !isCommittedBflowDelete(row.calendar_id, row.id))
      .map((row) => toCalendarEventFromBflowRow(row, calendarsById));

    // 마이그레이션 전 폴백: 구 private_calendar_events 병행 읽기 — 중복 id 는 calendar_events 우선.
    const newIds = new Set(next.map((event) => event.id));
    const userId = requestUserId;
    let nextLegacyPrivateEvents: LegacyPrivateEventState;
    try {
      if (userId) {
        const legacyRows = (await fetchLegacyPrivateEventsForUser(userId))
          .filter((row) => !isCommittedLegacyPrivateDelete(userId, row.id));
        nextLegacyPrivateEvents = {
          userId,
          ids: new Set(legacyRows.map((row) => row.id)),
          rows: new Map(legacyRows.map((row) => [row.id, row])),
          status: 'known',
        };
        for (const row of legacyRows) {
          if (!newIds.has(row.id)) next.push(toCalendarEventFromPrivate(row));
        }
      } else {
        nextLegacyPrivateEvents = {
          userId: null,
          ids: new Set<string>(),
          rows: new Map<string, RawPrivateEvent>(),
          status: 'known',
        };
      }
    } catch (err) {
      nextLegacyPrivateEvents = {
        userId: userId ?? null,
        ids: new Set<string>(),
        rows: new Map<string, RawPrivateEvent>(),
        status: 'unknown',
      };
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

function requestBflowReloadAfterExternalInvalidation(): void {
  if (bflowLoadsInFlight <= 0) return;
  const sessionGeneration = bflowSessionGeneration;
  bflowReloadRequested = true;
  // exact marker는 현재 renderer 밖에서 커밋된 persistence 결과다. 최초 load를
  // 무효화했다면 후속 정본 조회를 예약해, 삭제 행뿐 아니라 무관한 행도 빈 cache에
  // 갇히지 않게 한다. 여러 marker는 reloadBflowAfterDiscardedLoad가 합친다.
  void reloadBflowAfterDiscardedLoad(sessionGeneration);
}

/** B flow 일정 로드 — 구글 인증 가드 밖에서 항상 호출된다 (설계서 §6.2 핵심). */
export async function loadBflowEvents(options: LoadBflowEventsOptions = {}): Promise<boolean> {
  return loadBflowEventsInternal(options);
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
  const successfulEventsByCalendar = new Map<string, CalendarEvent[]>();

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
      const calendarEvents: CalendarEvent[] = [];
      for (const e of gcalEvents) {
        if (!e.id || isCompensatedGoogleEvent(calId, e.id)) continue;
        const converted = toCalendarEvent(e, calId);
        calendarEvents.push(converted);
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        successfulEvents.push(converted);
      }
      successfulEventsByCalendar.set(calId, calendarEvents);
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
    for (const calId of successfulCalendarIds) {
      replaceConfirmedGoogleCalendar(calId, successfulEventsByCalendar.get(calId) ?? []);
    }
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
    const confirmedUpdates = updated
      .filter((event) => event.id && !isCompensatedGoogleEvent(calId, event.id))
      .map((event) => toCalendarEvent(event, calId));

    if (isFullSync) {
      // fullSync 폴백: 해당 캘린더의 캐시를 완전히 교체 (삭제된 이벤트 제거)
      const next = googleEvents.filter((event) => (
        event.sourceCalendarId !== calId
        && !isCompensatedGoogleEvent(event.sourceCalendarId, event.id)
      ));
      // ID 기반 중복 제거 (팀/개인 캘린더에 같은 이벤트가 있을 수 있음)
      const seenIds = new Set(next.map((event) => event.id));
      for (const converted of confirmedUpdates) {
        if (seenIds.has(converted.id)) continue;
        seenIds.add(converted.id);
        next.push(converted);
      }
      googleEvents = next;
      replaceConfirmedGoogleCalendar(calId, confirmedUpdates);
    } else {
      // 일반 incremental: 삭제 + 머지
      let next = googleEvents.filter((event) => (
        !deleted.includes(event.id)
        && !isCompensatedGoogleEvent(event.sourceCalendarId, event.id)
      ));
      for (const converted of confirmedUpdates) {
        const exists = next.some((event) => event.id === converted.id);
        next = exists
          ? next.map((event) => (event.id === converted.id ? converted : event))
          : [...next, converted];
      }
      googleEvents = next;
      applyConfirmedGoogleIncremental(calId, confirmedUpdates, deleted);
    }
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
    rows: new Map<string, RawPrivateEvent>(),
    status: 'unknown',
  };
  activePrivacyMigrationByEventId.clear();
  activeOrdinaryIntentsByEventId.clear();
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

const GOOGLE_TEMPORAL_UPDATE_KEYS: ReadonlyArray<keyof CalendarEvent> = [
  'allDay',
  'startDate',
  'endDate',
  'startTime',
  'endTime',
];

type GoogleTemporalFields = Pick<
  CalendarEvent,
  'allDay' | 'startDate' | 'endDate' | 'startTime' | 'endTime'
>;

type GoogleEventUpdatePlan = {
  patch: GoogleEventUpdatePayload;
  temporal?: GoogleTemporalFields;
};

function hasGoogleTemporalUpdate(updates: Partial<CalendarEvent>): boolean {
  return GOOGLE_TEMPORAL_UPDATE_KEYS.some((key) => hasOwnEventUpdate(updates, key));
}

function resolveGoogleTemporalFields(
  confirmed: CalendarEvent,
  updates: Partial<CalendarEvent>,
): GoogleTemporalFields {
  const merged = { ...confirmed, ...updates };
  const allDay = merged.allDay ?? true;
  const startDate = merged.startDate;
  const endDate = merged.endDate;
  const validDate = (value: unknown): value is string => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  };

  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) {
    throw new Error('종료 날짜는 시작 날짜보다 빠를 수 없습니다');
  }
  if (allDay) {
    return {
      allDay: true,
      startDate,
      endDate,
      startTime: undefined,
      endTime: undefined,
    };
  }

  const validTime = (value: unknown): value is string => (
    typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
  );
  const startTime = merged.startTime;
  const endTime = merged.endTime;
  if (!validTime(startTime) || !validTime(endTime)) {
    throw new Error('시간 일정에는 올바른 시작·종료 시각이 모두 필요합니다');
  }
  if (`${endDate}T${endTime}` <= `${startDate}T${startTime}`) {
    throw new Error('종료 시각은 시작 시각보다 뒤여야 합니다');
  }
  return { allDay: false, startDate, endDate, startTime, endTime };
}

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

function buildGoogleEventUpdatePlan(
  confirmed: CalendarEvent,
  updates: Partial<CalendarEvent>,
): GoogleEventUpdatePlan {
  const patch: GoogleEventUpdatePayload = {};
  const temporal = hasGoogleTemporalUpdate(updates)
    ? resolveGoogleTemporalFields(confirmed, updates)
    : undefined;
  if (hasOwnEventUpdate(updates, 'title')) patch.summary = updates.title;
  if (hasOwnEventUpdate(updates, 'memo')) patch.description = updates.memo;
  if (temporal) {
    patch.startDate = temporal.allDay
      ? temporal.startDate
      : toKstRfc3339(temporal.startDate, temporal.startTime ?? '');
    patch.endDate = temporal.allDay
      ? addOneDay(temporal.endDate)
      : toKstRfc3339(temporal.endDate, temporal.endTime ?? '');
  }
  if (GOOGLE_METADATA_UPDATE_KEYS.some((key) => hasOwnEventUpdate(updates, key))) {
    patch.extendedProperties = toBflowMeta({ ...confirmed, ...updates });
  }
  return { patch, temporal };
}

function confirmGoogleEventUpdate(
  calendarId: string,
  eventId: string,
  fallback: CalendarEvent,
  updates: Partial<CalendarEvent>,
  patch: GoogleEventUpdatePayload,
  temporal: GoogleTemporalFields | undefined,
): void {
  const key = googleEventKey(calendarId, eventId);
  let confirmed = { ...(confirmedGoogleEvents.get(key) ?? fallback) };

  // Google PATCH의 일반 필드는 부분 갱신이므로 실제 요청에 포함된 값만 확정한다.
  if (patch.summary !== undefined) confirmed.title = patch.summary;
  if (patch.description !== undefined) confirmed.memo = patch.description;
  if (temporal) {
    confirmed.allDay = temporal.allDay;
    confirmed.startDate = temporal.startDate;
    confirmed.endDate = temporal.endDate;
    confirmed.startTime = temporal.startTime;
    confirmed.endTime = temporal.endTime;
  }

  // Google PATCH는 전송한 extended property 키만 덮어쓰고 빠진 키는 서버에 유지한다.
  // confirmed 상태도 실제 전송 키만 합쳐 다음 요청의 기준이 서버 상태와 같게 한다.
  if (patch.extendedProperties !== undefined) {
    const meta = patch.extendedProperties;
    if (Object.prototype.hasOwnProperty.call(meta, 'bflow_type')) {
      confirmed.type = (meta.bflow_type as CalendarEventType | undefined) ?? 'custom';
    }
    if (Object.prototype.hasOwnProperty.call(meta, 'bflow_linked_episode')) {
      confirmed.linkedEpisode = meta.bflow_linked_episode !== undefined
        ? Number(meta.bflow_linked_episode)
        : undefined;
    }
    if (Object.prototype.hasOwnProperty.call(meta, 'bflow_linked_part')) confirmed.linkedPart = meta.bflow_linked_part;
    if (Object.prototype.hasOwnProperty.call(meta, 'bflow_linked_scene_id')) confirmed.linkedSceneId = meta.bflow_linked_scene_id;
    if (Object.prototype.hasOwnProperty.call(meta, 'bflow_department')) {
      confirmed.linkedDepartment = meta.bflow_department as 'bg' | 'acting' | undefined;
    }
    if (Object.prototype.hasOwnProperty.call(meta, 'bflow_linked_todo_id')) confirmed.linkedTodoId = meta.bflow_linked_todo_id;
    if (Object.prototype.hasOwnProperty.call(meta, 'bflow_vacation_type')) confirmed.vacationType = meta.bflow_vacation_type;
    if (Object.prototype.hasOwnProperty.call(meta, 'bflow_vacation_user')) confirmed.vacationUserName = meta.bflow_vacation_user;
  }

  confirmedGoogleEvents.set(key, {
    ...confirmed,
    id: eventId,
    sourceCalendarId: calendarId,
  });
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
  const deletedKeys = eventAliasClosure([requestId, actualId]);
  for (const key of deletedKeys) {
    localToGcalId.delete(key);
  }
}

function redirectEventAliases(aliasKeys: Iterable<string>, canonicalId: string): void {
  const aliases = eventAliasClosure([...aliasKeys, canonicalId]);
  // replacement ID가 과거 alias와 재사용된 경우에도 self-loop/cycle을 남기지 않는다.
  localToGcalId.delete(canonicalId);
  for (const alias of aliases) {
    if (alias !== canonicalId) localToGcalId.set(alias, canonicalId);
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
  // migration 횟수와 무관하게 forward/reverse alias graph를 cycle-safe하게 재조회한다.
  const identityKeys = new Set(knownEventIdentityKeys(eventId));
  const aliased = eventCache.find((event) => identityKeys.has(event.id));
  if (aliased) return aliased;
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
  isPrivacyMigrationReplacement = false,
  onPersistedId?: (eventId: string) => void,
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
      const createInput = {
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
      };
      const replacement = isPrivacyMigrationReplacement
        ? await window.electronAPI.calendarPrivacyReplacementCreate({
            storage: 'bflow',
            event: createInput,
          })
        : null;
      const actualId = replacement
        ? replacement.actual_id
        : (await window.electronAPI.calendarEventCreate(createInput)).id;
      const created: CreatedEventRef = {
        actualId,
        storage: 'bflow',
        calendarId: replacement?.calendar_id ?? calendarId,
        receipt: replacement?.receipt,
      };
      onPersistedId?.(actualId);
      // 메인은 이미 이전 세션 actor로 insert를 커밋했을 수 있다. 실ID를 버리면
      // privacy migration caller가 정확한 replacement를 보상 삭제할 수 없다.
      if (!isBflowMutationCurrent(token)) return created;
      if (localId !== actualId) {
        localToGcalId.set(localId, actualId);
      }
      mutateSourceEvents('bflow', (events) => events.map((item) => (
        item.id === localId ? { ...item, id: actualId } : item
      )));
      broadcastCalendarChange({ eventId: actualId, action: 'update' });
      return created;
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
  isPrivacyMigrationReplacement = false,
  onPersistedId?: (eventId: string) => void,
): Promise<CreatedEventRef | null> {
  if (event.calendarId) {
    return addBflowEvent(
      event,
      event.calendarId,
      inheritedToken,
      isPrivacyMigrationReplacement,
      onPersistedId,
    );
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
      const refreshedCalendarState = useCalendarStore.getState();
      if (!refreshedCalendarState.loaded) {
        throw new Error('캘린더 목록을 불러오지 못해 나만 보기 일정을 저장하지 않았습니다');
      }
      const personal = getPersonalCalendar(refreshedCalendarState, userId);
      if (personal) {
        return addBflowEvent(
          { ...event, calendarId: personal.id },
          personal.id,
          token,
          isPrivacyMigrationReplacement,
          onPersistedId,
        );
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
        const createInput = {
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
        };
        const replacement = isPrivacyMigrationReplacement
          ? await window.electronAPI.calendarPrivacyReplacementCreate({
              storage: 'legacy-private',
              event: createInput,
            })
          : null;
        const actualId = replacement
          ? replacement.actual_id
          : (await window.electronAPI.supabaseAddPrivateEvent({
              ...createInput,
              user_id: userId,
            })).id;
        const created: CreatedEventRef = {
          actualId,
          storage: 'legacy-private',
          ownerId: userId,
          receipt: replacement?.receipt,
        };
        onPersistedId?.(actualId);
        if (!isBflowMutationCurrent(token)) return created;
        // 로컬 ID → Supabase UUID 교체
        if (localId !== actualId) {
          localToGcalId.set(localId, actualId);
        }
        mutateSourceEvents('bflow', (events) => events.map((item) => (
          item.id === localId ? { ...item, id: actualId } : item
        )));
        broadcastCalendarChange({ eventId: actualId, action: 'update' });
        return created;
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
  googleEvents.push({ ...event, color: '#8B8DA3', sourceCalendarId: calId, source: 'google' });
  if (inheritedToken) sessionOptimisticGoogleEventIds.add(localId);
  rebuildEventCache();
  broadcastCalendarChange({ eventId: localId, action: 'add' });

  try {
    // GCal 종일 이벤트 종료일 보정 (B flow inclusive → GCal exclusive)
    const isAllDay = event.allDay ?? true;
    const gcalEndDate = isAllDay && event.endDate ? addOneDay(event.endDate) : event.endDate;
    const createInput = {
      summary: event.title,
      description: event.memo,
      startDate: isAllDay
        ? event.startDate
        : toKstRfc3339(event.startDate, event.startTime ?? ''),
      endDate: isAllDay
        ? gcalEndDate
        : toKstRfc3339(event.endDate, event.endTime ?? ''),
      extendedProperties: toBflowMeta(event),
      // 비공개 일정이면 Google Calendar 에 'private' 로 저장 — 도메인 내 다른 사용자에게 숨김
      visibility: event.isPrivate ? 'private' as const : undefined,
    };
    const replacement = isPrivacyMigrationReplacement
      ? await window.electronAPI.calendarPrivacyReplacementCreate({
          storage: 'google',
          calendar_id: calId,
          event: createInput,
        })
      : null;
    const gcalId = replacement?.actual_id ?? await gcalService.insertEvent(calId, createInput);
    const created: CreatedEventRef = {
      actualId: gcalId,
      storage: 'google',
      calendarId: replacement?.calendar_id ?? calId,
      receipt: replacement?.receipt,
    };
    onPersistedId?.(gcalId);
    if (inheritedToken && !isBflowMutationCurrent(inheritedToken)) return created;
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
    return created;
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

async function deletePersistedCreatedEvent(created: CreatedEventRef): Promise<void> {
  if (created.receipt) {
    await window.electronAPI.calendarPrivacyReplacementSettle(created.receipt, 'delete');
    return;
  }
  if (created.storage === 'google') {
    await gcalService.deleteEvent(created.calendarId, created.actualId);
  } else if (created.storage === 'bflow') {
    await window.electronAPI.calendarEventDelete(created.actualId);
  } else {
    await window.electronAPI.supabaseDeletePrivateEvent(created.actualId);
  }
}

async function keepPersistedCreatedEvent(created: CreatedEventRef): Promise<void> {
  if (!created.receipt) return;
  await window.electronAPI.calendarPrivacyReplacementSettle(created.receipt, 'keep');
}

function tombstoneGoogleEvent(calendarId: string, eventId: string): boolean {
  compensatedGoogleEventKeys.add(compensatedGoogleEventKey(calendarId, eventId));
  confirmedGoogleEvents.delete(googleEventKey(calendarId, eventId));
  const removedFromCurrentCache = googleEvents.some((event) => (
    event.id === eventId && event.sourceCalendarId === calendarId
  ));
  googleEvents = googleEvents.filter((event) => !(
    event.id === eventId && event.sourceCalendarId === calendarId
  ));
  if (removedFromCurrentCache) rebuildEventCache();
  return removedFromCurrentCache;
}

type CalendarChangeDetail = {
  eventId?: string;
  action?: 'add' | 'update' | 'delete';
  calendarId?: string;
  committedGoogleDelete?: true;
  storage?: 'bflow' | 'legacy-private';
  ownerId?: string;
  committedPrivacyReplacementDelete?: true;
};

function committedGoogleDeleteDetail(calendarId: string, eventId: string): CalendarChangeDetail {
  return {
    eventId,
    action: 'delete',
    calendarId,
    committedGoogleDelete: true,
  };
}

/** 다른 BrowserWindow가 보낸 Google 영속 삭제 완료를 이 renderer의 독립 cache에 적용한다.
 *  재방송하지 않고 정확한 calendar+event 한 행만 tombstone 처리해 IPC ping-pong과
 *  삭제 전에 시작한 fullSync snapshot의 ghost 복원을 함께 막는다. */
export function applyCommittedGoogleDelete(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const detail = payload as Record<string, unknown>;
  if (
    detail.committedGoogleDelete !== true
    || detail.action !== 'delete'
    || typeof detail.calendarId !== 'string'
    || detail.calendarId.length === 0
    || typeof detail.eventId !== 'string'
    || detail.eventId.length === 0
  ) return false;
  tombstoneGoogleEvent(detail.calendarId, detail.eventId);
  return true;
}

function committedPrivacyReplacementDeleteDetail(
  created: Extract<CreatedEventRef, { storage: 'bflow' | 'legacy-private' }>,
): CalendarChangeDetail {
  return {
    eventId: created.actualId,
    action: 'delete',
    storage: created.storage,
    ...(created.storage === 'bflow' ? { calendarId: created.calendarId } : {}),
    ...(created.storage === 'legacy-private' ? { ownerId: created.ownerId } : {}),
    committedPrivacyReplacementDelete: true,
  };
}

/** 다른 BrowserWindow의 B flow/legacy replacement 보상 삭제를 이 renderer의 독립
 * cache에 source-aware하게 적용한다. 일반 delete 신호는 받지 않고 확정 marker 한 행만
 * 제거하며 재방송하지 않는다. */
export function applyCommittedPrivacyReplacementDelete(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const detail = payload as Record<string, unknown>;
  if (
    detail.committedPrivacyReplacementDelete !== true
    || detail.action !== 'delete'
    || typeof detail.eventId !== 'string'
    || detail.eventId.length === 0
    || (detail.storage !== 'bflow' && detail.storage !== 'legacy-private')
  ) return false;

  const eventId = detail.eventId;
  if (detail.storage === 'bflow') {
    if (typeof detail.calendarId !== 'string' || detail.calendarId.length === 0) return false;
    const sourceCalendarId = `${BFLOW_CAL_PREFIX}${detail.calendarId}`;
    committedBflowDeleteKeys.add(committedBflowDeleteKey(detail.calendarId, eventId));
    mutateSourceEvents('bflow', (events) => events.filter((event) => !(
      event.id === eventId && event.sourceCalendarId === sourceCalendarId
    )));
    requestBflowReloadAfterExternalInvalidation();
    return true;
  }

  if (
    detail.calendarId !== undefined
    || typeof detail.ownerId !== 'string'
    || detail.ownerId.trim().length === 0
  ) return false;
  const ownerId = detail.ownerId;
  committedLegacyPrivateDeleteKeys.add(committedLegacyPrivateDeleteKey(ownerId, eventId));
  if (ownerId !== (useAuthStore.getState().currentUser?.id ?? null)) {
    // 다른 사용자의 marker도 owner-key로 기억해 두되 현재 session cache에는 적용하지
    // 않는다. 이후 해당 owner로 로그인해 stale snapshot을 읽을 때만 필터된다.
    return true;
  }
  mutateSourceEvents('bflow', (events) => events.filter((event) => !(
    event.id === eventId && event.sourceCalendarId === PRIVATE_CAL_ID
  )));
  forgetLegacyPrivateEvent(eventId);
  requestBflowReloadAfterExternalInvalidation();
  return true;
}

function tombstoneCompensatedReplacement(created: CreatedEventRef): void {
  if (created.storage === 'google') {
    tombstoneGoogleEvent(created.calendarId, created.actualId);
    return;
  }
  applyCommittedPrivacyReplacementDelete(committedPrivacyReplacementDeleteDetail(created));
}

async function compensateStalePrivacyMigrationReplacement(
  originalEventId: string,
  created: CreatedEventRef,
  primaryError: unknown,
): Promise<void> {
  try {
    // 세션 전환 뒤에는 old source ID를 resolve/delete하지 않는다. 이전 create 응답의
    // 실ID만 직접 지우며 새 세션 alias나 무관한 cache 행에는 손대지 않는다.
    await deletePersistedCreatedEvent(created);
    // Google replacement는 삭제 이전에 시작한 fullSync snapshot에도 들어갈 수 있다.
    // 정확한 캘린더+이벤트 tombstone으로 그 한 행만 차단한다. 다른 창/클라이언트의
    // committed marker는 receipt를 처리한 main persistence boundary가 직접 보낸다.
    tombstoneCompensatedReplacement(created);
  } catch (compensationDeleteError) {
    throw new PrivacyMigrationCompensationError(
      originalEventId,
      created.actualId,
      primaryError,
      compensationDeleteError,
    );
  }
}

async function compensateCreatedEvent(
  requestId: string,
  created: CreatedEventRef,
  token: BflowMutationToken,
): Promise<boolean> {
  if (!isBflowMutationCurrent(token)) return false;
  await deletePersistedCreatedEvent(created);
  // persistence 보상은 끝났으므로 세션 전환 여부와 무관하게 Google의 정확한 행을
  // tombstone 처리한다. 그래야 보상 전에 시작한 snapshot도 삭제 행을 복원하지 못한다.
  tombstoneCompensatedReplacement(created);
  if (!isBflowMutationCurrent(token)) {
    return false;
  }
  if (created.storage === 'legacy-private') {
    forgetLegacyPrivateEvent(created.actualId);
  }

  const cacheSource: CalendarCacheSource = created.storage === 'google' ? 'google' : 'bflow';
  mutateSourceEvents(cacheSource, (events) => events.filter((item) => (
    item.id !== created.actualId && item.id !== requestId
  )));
  cleanupDeletedEventAliases(requestId, created.actualId);
  return true;
}

export async function updateEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<void> {
  const requestToken = captureBflowMutationToken();
  return runUpdateEventIntent(eventId, updates, requestToken);
}

function runUpdateEventIntent(
  eventId: string,
  updates: Partial<CalendarEvent>,
  requestToken: BflowMutationToken,
): Promise<void> {
  if (!isBflowMutationCurrent(requestToken)) return Promise.resolve();
  const retry = () => runUpdateEventIntent(eventId, updates, requestToken);
  if (needsPrivacyIntentReservation(eventId, updates)) {
    return withPrivacyEventIntent(
      eventId,
      requestToken,
      (lease) => updateEventForToken(eventId, updates, requestToken, lease),
      retry,
    );
  }
  return withOrdinaryEventIntent(
    eventId,
    requestToken,
    () => updateEventForToken(eventId, updates, requestToken),
    retry,
  );
}

async function updateEventForToken(
  eventId: string,
  updates: Partial<CalendarEvent>,
  requestToken: BflowMutationToken,
  privacyLease?: EventIntentLease,
): Promise<void> {
  if (!isBflowMutationCurrent(requestToken)) return;
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
    if (!privacyLease) {
      throw new Error('[calendar] privacy migration requires an active intent reservation');
    }
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
    // deleteEvent가 source persistence 성공 후 alias를 정리하므로, 그 전에 오래된 A와
    // refreshed B를 포함한 reverse/transitive identity를 보존해 최종 replacement로 잇는다.
    const inheritedSourceAliases = knownEventIdentityKeys(eventId);
    if (!inheritedSourceAliases.includes(actualId)) inheritedSourceAliases.push(actualId);

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
    if (!extendPrivacyMigration(privacyLease, freshLocalId)) {
      throw new Error('[calendar] privacy migration local replacement is already reserved');
    }
    await withBflowMutation(async (token) => {
      if (!isSameBflowMutationToken(token, requestToken)) return;
      // 1) 새 저장소에 생성 — 실패하면 원본이 그대로 남아있어 데이터 손실 없음.
      let replacementReservationConflict = false;
      let replacement: CreatedEventRef | null;
      try {
        replacement = await addEventInternal(fresh, token, true, (replacementId) => {
          if (!isBflowMutationCurrent(token)) return;
          if (!extendPrivacyMigration(privacyLease, replacementId)) {
            replacementReservationConflict = true;
          }
        });
      } catch (createError) {
        // optimistic fresh ID를 보고 대기한 follower는 create 실패 후 복원된 source로 이어진다.
        if (isBflowMutationCurrent(token) && freshLocalId !== actualId) {
          localToGcalId.set(freshLocalId, actualId);
        }
        throw createError;
      }
      if (!replacement) return;
      if (replacementReservationConflict) {
        const reservationError = new Error(
          '[calendar] privacy migration persisted replacement is already reserved',
        );
        if (!isBflowMutationCurrent(token)) {
          await compensateStalePrivacyMigrationReplacement(actualId, replacement, reservationError);
          return;
        }
        try {
          await compensateCreatedEvent(freshLocalId, replacement, token);
        } catch (compensationDeleteError) {
          throw new PrivacyMigrationCompensationError(
            actualId,
            replacement.actualId,
            reservationError,
            compensationDeleteError,
          );
        }
        throw reservationError;
      }
      if (!isBflowMutationCurrent(token)) {
        await compensateStalePrivacyMigrationReplacement(
          actualId,
          replacement,
          new Error('[calendar] privacy migration session changed before source deletion'),
        );
        return;
      }
      // 2) 새 이벤트가 안전하게 자리잡은 뒤 기존 저장소에서 제거.
      try {
        await deleteEvent(eventId, token);
      } catch (originalDeleteError) {
        if (!isBflowMutationCurrent(token)) {
          await compensateStalePrivacyMigrationReplacement(
            actualId,
            replacement,
            originalDeleteError,
          );
          return;
        }
        // 원본 삭제가 실패하면 create-first 단계의 replacement도 되돌려야 reload 후
        // 영구 중복이 남지 않는다. deleteEvent 는 실패 시 원본 cache 를 복원한다.
        try {
          const compensated = await compensateCreatedEvent(freshLocalId, replacement, token);
          if (!compensated || !isBflowMutationCurrent(token)) return;
          if (originalDeleteError instanceof PrivacyMigrationSourceMissingError) {
            if (originalDeleteError.survivingLegacy) {
              // canonical B flow만 외부 삭제되고 legacy shadow가 남았다면 그 정확한
              // PRIVATE_CAL_ID source로 stale/follower ID 전체를 되돌린다.
              redirectEventAliases(
                [...inheritedSourceAliases, freshLocalId, replacement.actualId],
                actualId,
              );
            } else {
              // shadow도 없는 strict false는 source가 완전히 사라진 확정 결과다.
              cleanupDeletedEventAliases(eventId, actualId);
            }
          } else {
            // replacement ID를 보고 들어온 follower도 rollback 뒤 복원된 source에 intent를
            // 이어갈 수 있게 모든 transitive alias를 source로 되돌려 연결한다.
            redirectEventAliases(
              [...inheritedSourceAliases, freshLocalId, replacement.actualId],
              actualId,
            );
          }
        } catch (compensationDeleteError) {
          throw new PrivacyMigrationCompensationError(
            actualId,
            replacement.actualId,
            originalDeleteError,
            compensationDeleteError,
          );
        }
        throw originalDeleteError;
      }
      // 원본 persistence 삭제가 끝난 순간 replacement가 유일한 정본이다. receipt keep이
      // 늦거나 실패해도 waiting old-ID follower가 no-op 되지 않도록 canonical alias를 먼저
      // 확정한다. 새 session으로 바뀐 경우에는 그 session alias/cache를 건드리지 않는다.
      if (isBflowMutationCurrent(token)) {
        redirectEventAliases(
          [...inheritedSourceAliases, freshLocalId, replacement.actualId],
          replacement.actualId,
        );
      }
      // persistence 전환은 이미 끝났으므로 keep 실패를 caller에 알리더라도 위 alias는 유지한다.
      await keepPersistedCreatedEvent(replacement);
      if (!isBflowMutationCurrent(token)) return;
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
      // temporal payload 검증을 먼저 끝낸 뒤 캐시를 낙관적으로 갱신한다.
      const previous = { ...existing };
      const confirmed = confirmedGoogleEvents.get(googleEventKey(calId, actualId)) ?? previous;
      const googleUpdate = buildGoogleEventUpdatePlan(confirmed, updates);
      mutateSourceEvents(existingSource, (events) => events.map((item) => (
        item.id === actualId ? { ...item, ...updates } : item
      )));
      broadcastCalendarChange({ eventId: actualId, action: 'update' });

      try {
        await gcalService.updateEvent(calId, actualId, googleUpdate.patch);
        confirmGoogleEventUpdate(
          calId,
          actualId,
          confirmed,
          updates,
          googleUpdate.patch,
          googleUpdate.temporal,
        );
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
  if (inheritedToken) {
    return deleteEventForToken(eventId, inheritedToken, requestToken);
  }
  return runDeleteEventIntent(eventId, requestToken);
}

function runDeleteEventIntent(
  eventId: string,
  requestToken: BflowMutationToken,
): Promise<void> {
  if (!isBflowMutationCurrent(requestToken)) return Promise.resolve();
  return withOrdinaryEventIntent(
    eventId,
    requestToken,
    () => deleteEventForToken(eventId, undefined, requestToken),
    () => runDeleteEventIntent(eventId, requestToken),
  );
}

async function deleteEventForToken(
  eventId: string,
  inheritedToken: BflowMutationToken | undefined,
  requestToken: BflowMutationToken,
): Promise<void> {
  const continueBeforeSourceDelete = (token: BflowMutationToken): boolean => {
    if (isBflowMutationCurrent(token)) return true;
    if (inheritedToken) {
      throw new Error('[calendar] privacy migration session changed before source deletion');
    }
    return false;
  };
  if (!continueBeforeSourceDelete(requestToken)) return;
  const existing = await resolveEvent(eventId);
  if (!continueBeforeSourceDelete(requestToken)) return;
  if (!existing) {
    if (inheritedToken) {
      throw new Error('[calendar] privacy migration source is missing before persistence deletion');
    }
    return;
  }
  const actualId = existing.id; // GCal ID

  // ── B flow 공유 캘린더 이벤트 분기 — calendar:* IPC 경유 ──
  if (existing.sourceCalendarId?.startsWith(BFLOW_CAL_PREFIX)) {
    const bflowCalendarId = existing.sourceCalendarId.slice(BFLOW_CAL_PREFIX.length);
    const mutate = async (token: BflowMutationToken): Promise<void> => {
      if (!continueBeforeSourceDelete(token)) return;
      const currentUserId = token.userId ?? undefined;
      const isCurrentUsersPersonal = currentUserId !== undefined
        && isCurrentUsersPersonalBflowEvent(existing, currentUserId);
      let hasLegacyCopy = false;
      let legacyCopy: RawPrivateEvent | undefined;
      let canonicalBflowDeleted = false;

      if (isCurrentUsersPersonal && currentUserId) {
        const stateIsCurrentAndKnown = legacyPrivateEvents.userId === currentUserId
          && legacyPrivateEvents.status === 'known';
        if (!stateIsCurrentAndKnown) {
          await readLegacyPrivateEventsForUser(currentUserId);
          if (!continueBeforeSourceDelete(token)) return;
        }
        hasLegacyCopy = legacyPrivateEvents.ids.has(actualId);
        legacyCopy = legacyPrivateEvents.rows.get(actualId);
      }

      mutateSourceEvents('bflow', (events) => events.filter((item) => item.id !== actualId));
      broadcastCalendarChange({ eventId: actualId, action: 'delete' });
      try {
        if (inheritedToken) {
          // privacy migration은 canonical B flow 행의 존재를 엄격히 확인한 뒤에만
          // legacy shadow를 정리한다. canonical 행이 이미 사라졌다면 legacy가 마지막
          // source copy일 수 있으므로 replacement만 보상하고 shadow는 보존해야 한다.
          const deleteResult = await window.electronAPI.calendarPrivacyMigrationSourceDelete({
            storage: 'bflow',
            event_id: actualId,
          });
          if (deleteResult === 'missing') {
            const survivingLegacy = legacyCopy
              ? toCalendarEventFromPrivate(legacyCopy)
              : undefined;
            if (survivingLegacy && isBflowMutationCurrent(token)) {
              mutateSourceEvents('bflow', (events) => (
                events.some((item) => item.id === actualId)
                  ? events
                  : [...events, survivingLegacy]
              ));
            }
            throw new PrivacyMigrationSourceMissingError(actualId, survivingLegacy);
          }
          if (deleteResult === 'ambiguous') {
            // RPC 응답 유실 시 DB delete가 commit됐을 수 있다. replacement를 지우거나
            // legacy shadow까지 건드리면 0-row 유실이 가능하므로 안전 사본을 유지한다.
            console.warn(
              `[Calendar] canonical ${actualId} 삭제 결과가 불확실해 replacement를 유지합니다`,
            );
            return;
          }
          canonicalBflowDeleted = true;
          if (!continueBeforeSourceDelete(token)) return;
          if (hasLegacyCopy) {
            await window.electronAPI.supabaseDeletePrivateEvent(actualId);
            // await 중 세션이 바뀌었더라도 exact legacy 삭제가 성공했다면 두 source가
            // 모두 제거된 상태다. 이때 replacement를 보상 삭제하면 전부 유실되므로
            // 성공으로 마치되 새 세션의 legacy tracking만 건드리지 않는다.
            if (isBflowMutationCurrent(token)) forgetLegacyPrivateEvent(actualId);
          }
        } else {
          if (hasLegacyCopy) {
            await window.electronAPI.supabaseDeletePrivateEvent(actualId);
            if (!continueBeforeSourceDelete(token)) return;
            forgetLegacyPrivateEvent(actualId);
          }
          await window.electronAPI.calendarEventDelete(actualId);
        }
        if (!isBflowMutationCurrent(token)) return;
        cleanupDeletedEventAliases(eventId, actualId);
      } catch (err) {
        // strict migration delete의 false는 DB 원본이 이미 사라졌다는 확정 결과다.
        // 로컬 optimistic source를 되살리면 ghost가 되므로 replacement만 보상하도록 전달한다.
        if (err instanceof PrivacyMigrationSourceMissingError) throw err;
        if (canonicalBflowDeleted) {
          // canonical 삭제가 commit된 뒤 legacy shadow 정리의 응답이 실패/유실된 경우,
          // replacement까지 보상하면 둘 다 사라질 수 있다. 중복 가능성보다 0-row 유실을
          // 막는 것이 우선이므로 migration은 유지하고 후속 cleanup 대상으로 경고한다.
          console.warn(
            `[Calendar] canonical ${actualId} 삭제 후 legacy shadow 정리를 확정하지 못해 replacement를 유지합니다:`,
            err,
          );
          return;
        }
        if (!isBflowMutationCurrent(token)) {
          if (inheritedToken) throw err;
          return;
        }
        if (
          !inheritedToken
          && isCommittedBflowDelete(bflowCalendarId, actualId)
        ) {
          cleanupDeletedEventAliases(eventId, actualId);
          return;
        }
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
      if (!continueBeforeSourceDelete(token)) return;
      const previous = existing;
      mutateSourceEvents('bflow', (events) => events.filter((item) => item.id !== actualId));
      broadcastCalendarChange({ eventId: actualId, action: 'delete' });
      try {
        if (inheritedToken) {
          const deleteResult = await window.electronAPI.calendarPrivacyMigrationSourceDelete({
            storage: 'legacy-private',
            event_id: actualId,
          });
          if (deleteResult === 'missing') {
            if (isBflowMutationCurrent(token)) forgetLegacyPrivateEvent(actualId);
            throw new PrivacyMigrationSourceMissingError(actualId);
          }
          if (deleteResult === 'ambiguous') {
            console.warn(
              `[Calendar] legacy ${actualId} 삭제 결과가 불확실해 replacement를 유지합니다`,
            );
            return;
          }
        } else {
          await window.electronAPI.supabaseDeletePrivateEvent(actualId);
        }
        if (!isBflowMutationCurrent(token)) return;
        forgetLegacyPrivateEvent(actualId);
        cleanupDeletedEventAliases(eventId, actualId);
      } catch (err) {
        if (err instanceof PrivacyMigrationSourceMissingError) throw err;
        if (!isBflowMutationCurrent(token)) {
          if (inheritedToken) throw err;
          return;
        }
        if (!inheritedToken && isCommittedLegacyPrivateDelete(token.userId, actualId)) {
          forgetLegacyPrivateEvent(actualId);
          cleanupDeletedEventAliases(eventId, actualId);
          return;
        }
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
    if (!continueBeforeSourceDelete(requestToken)) return;
    const existingSource = inferExistingEventSource(existing);
    mutateSourceEvents(existingSource, (events) => events.filter((item) => item.id !== actualId));
    cleanupDeletedEventAliases(eventId, actualId);
    broadcastCalendarChange({ eventId: actualId, action: 'delete' });
    return;
  }

  // 원본 캘린더 ID 우선 사용
  const calId = existing.sourceCalendarId || await getTargetCalendar(existing.type);
  if (!continueBeforeSourceDelete(requestToken)) return;
  if (!calId) return;
  const existingSource = inferExistingEventSource(existing);

  // 낙관적 업데이트: 캐시 먼저 업데이트
  mutateSourceEvents(existingSource, (events) => events.filter((item) => item.id !== actualId));
  broadcastCalendarChange({ eventId: actualId, action: 'delete' });

  try {
    if (inheritedToken) {
      const deleteResult = await window.electronAPI.calendarPrivacyMigrationSourceDelete({
        storage: 'google',
        calendar_id: calId,
        event_id: actualId,
      });
      if (deleteResult === 'missing') {
        throw new PrivacyMigrationSourceMissingError(actualId);
      }
      if (deleteResult === 'ambiguous') {
        console.warn(
          `[Calendar] Google ${calId}/${actualId} 삭제 결과가 불확실해 replacement를 유지합니다`,
        );
        return;
      }
    } else {
      await gcalService.deleteEvent(calId, actualId);
    }
    // 삭제 전에 시작한 Google snapshot이 완료되더라도 이 정확한 원본 행을 되살리지 않는다.
    tombstoneGoogleEvent(calId, actualId);
    // exact committed marker는 renderer가 위조할 수 없는 main persistence 경계에서
    // 모든 창과 다른 앱 인스턴스로 발행한다. 여기서는 sender cache만 tombstone한다.
    if (inheritedToken && !isBflowMutationCurrent(inheritedToken)) return;
    cleanupDeletedEventAliases(eventId, actualId);
  } catch (err) {
    if (err instanceof PrivacyMigrationSourceMissingError) throw err;
    if (inheritedToken && !isBflowMutationCurrent(inheritedToken)) throw err;
    if (!inheritedToken && isCompensatedGoogleEvent(calId, actualId)) {
      cleanupDeletedEventAliases(eventId, actualId);
      return;
    }
    // 실패: 롤백
    mutateSourceEvents(existingSource, (events) => (
      events.some((item) => item.id === actualId) ? events : [...events, existing]
    ));
    broadcastCalendarChange({ eventId: actualId, action: 'add' });
    throw err;
  }
}

function broadcastCalendarChange(detail?: CalendarChangeDetail) {
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
