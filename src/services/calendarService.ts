/**
 * 캘린더 서비스 (어댑터)
 * Google Calendar API를 기존 CalendarEvent 인터페이스로 래핑
 */
import type { CalendarEvent, CalendarEventType, BflowEventMeta, GCalSettings } from '@/types/calendar';
import * as gcalService from './googleCalendarService';
import { readMetadata, writeMetadata } from './supabaseService';

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

/** 이벤트 타입에 따라 대상 캘린더 결정 */
async function getTargetCalendar(type: CalendarEventType): Promise<string | null> {
  const settings = await getGCalSettings();
  if (type === 'custom') return settings.personalCalendarId || 'primary';
  return settings.teamCalendarId || settings.personalCalendarId || 'primary';
}

// ─── 공개 API (기존 인터페이스 유지) ──────────────────────────

let eventCache: CalendarEvent[] = [];
let legacyLoaded = false;

/** 기존 calendar-events.json에서 로컬 이벤트 로드 (GCal 전환 전 데이터 보존) */
async function loadLegacyEvents(): Promise<void> {
  if (legacyLoaded) return;
  legacyLoaded = true;
  try {
    const data = await window.electronAPI.readSettings('calendar-events.json');
    if (Array.isArray(data) && data.length > 0) {
      // GCal sync로 채워진 이벤트와 중복되지 않도록 ID 기반 머지
      const existingIds = new Set(eventCache.map((e) => e.id));
      const legacy = (data as CalendarEvent[]).filter((e) => !existingIds.has(e.id));
      if (legacy.length > 0) {
        eventCache = [...eventCache, ...legacy];
        console.log(`[Calendar] 기존 로컬 이벤트 ${legacy.length}개 로드`);
      }
    }
  } catch { /* 파일 없거나 읽기 실패 — 무시 */ }
}

export async function loadAllEvents(): Promise<CalendarEvent[]> {
  if (eventCache.length === 0) await loadLegacyEvents();
  return [...eventCache];
}

export async function getEvents(): Promise<CalendarEvent[]> {
  if (eventCache.length === 0) await loadLegacyEvents();
  return [...eventCache];
}

/** 전체 동기화 (앱 시작 시 호출) */
export async function syncAll(): Promise<CalendarEvent[]> {
  // legacy 로컬 이벤트를 먼저 로드 (syncAll이 getEvents보다 먼저 호출될 수 있으므로)
  await loadLegacyEvents();

  const settings = await getGCalSettings();
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];

  // 팀/개인 캘린더 목록 (중복 제거)
  // personalCalendarId가 미설정이면 'primary' 폴백 (getTargetCalendar과 일치)
  const calIds = new Set<string>();
  if (settings.teamCalendarId) calIds.add(settings.teamCalendarId);
  calIds.add(settings.personalCalendarId || 'primary');

  for (const calId of calIds) {
    const gcalEvents = await gcalService.fullSync(calId);
    for (const e of gcalEvents) {
      if (e.id && !seen.has(e.id)) {
        seen.add(e.id);
        events.push(toCalendarEvent(e, calId));
      }
    }
  }

  // legacy 로컬 이벤트 보존: GCal에 없는 로컬 전용 이벤트는 유지
  // (sourceCalendarId가 없는 이벤트 = 기존 calendar-events.json에서 온 것)
  const legacyEvents = eventCache.filter((e) => !e.sourceCalendarId && !seen.has(e.id));
  eventCache = [...events, ...legacyEvents];
  broadcastCalendarChange();

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
      eventCache = eventCache.filter((e) => e.sourceCalendarId !== calId);
      // ID 기반 중복 제거 (팀/개인 캘린더에 같은 이벤트가 있을 수 있음)
      const seenIds = new Set(eventCache.map((e) => e.id));
      for (const gcalEvent of updated) {
        if (gcalEvent.id && !seenIds.has(gcalEvent.id)) {
          seenIds.add(gcalEvent.id);
          eventCache.push(toCalendarEvent(gcalEvent, calId));
        }
      }
    } else {
      // 일반 incremental: 삭제 + 머지
      eventCache = eventCache.filter((e) => !deleted.includes(e.id));
      for (const gcalEvent of updated) {
        const converted = toCalendarEvent(gcalEvent, calId);
        const idx = eventCache.findIndex((e) => e.id === converted.id);
        if (idx >= 0) eventCache[idx] = converted;
        else eventCache.push(converted);
      }
    }
  }

  broadcastCalendarChange();
}

// ─── 로컬 ID ↔ GCal ID 매핑 (할일 등 cal_* ID 호환용) ──────────────────

const localToGcalId = new Map<string, string>();

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
  // 로컬 ID → GCal ID 매핑으로 재시도
  const gcalId = localToGcalId.get(eventId);
  if (gcalId) return eventCache.find((e) => e.id === gcalId);
  // linkedTodoId로 폴백 (cal_xxx → todoId 추출)
  if (eventId.startsWith('cal_')) {
    const todoId = eventId.slice(4);
    return eventCache.find((e) => e.linkedTodoId === todoId);
  }
  return undefined;
}

export async function addEvent(event: CalendarEvent): Promise<void> {
  const calId = await getTargetCalendar(event.type);
  if (!calId) throw new Error('캘린더가 설정되지 않았습니다');

  // caller가 제공한 로컬 ID 보존 (cal_xxx 등)
  const localId = event.id;

  // 낙관적 업데이트: 로컬 ID로 캐시에 먼저 추가 + 원본 캘린더 ID 기록
  eventCache.push({ ...event, sourceCalendarId: calId });
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
    });
    // 성공: 로컬 ID → GCal ID 매핑 등록 + 캐시 ID 교체
    if (localId !== gcalId) {
      localToGcalId.set(localId, gcalId);
    }
    const idx = eventCache.findIndex((e) => e.id === localId);
    if (idx >= 0) eventCache[idx] = { ...eventCache[idx], id: gcalId };
    broadcastCalendarChange({ eventId: gcalId, action: 'update' });
  } catch (err) {
    // 실패: 롤백
    eventCache = eventCache.filter((e) => e.id !== localId);
    broadcastCalendarChange();
    throw err;
  }
}

export async function updateEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<void> {
  const existing = await resolveEvent(eventId);
  if (!existing) return;
  const actualId = existing.id; // GCal ID (캐시에 저장된 실제 ID)

  // 원본 캘린더 ID 우선 사용 (캘린더 설정 변경 후에도 올바른 캘린더에서 수정)
  const calId = existing.sourceCalendarId || await getTargetCalendar(existing.type);
  if (!calId) return;

  // 낙관적 업데이트: 캐시 먼저 업데이트
  const previous = { ...existing };
  eventCache = eventCache.map((e) => (e.id === actualId ? { ...e, ...updates } : e));
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
    });
  } catch (err) {
    // 실패: 롤백
    eventCache = eventCache.map((e) => (e.id === actualId ? previous : e));
    broadcastCalendarChange({ eventId: actualId, action: 'update' });
    throw err;
  }
}

export async function deleteEvent(eventId: string): Promise<void> {
  const existing = await resolveEvent(eventId);
  if (!existing) return;
  const actualId = existing.id; // GCal ID

  // 로컬 전용 이벤트(GCal에 저장되지 않은 legacy 이벤트)는 캐시에서만 제거
  // sourceCalendarId 부재 = GCal과 연동되지 않은 이벤트 (calendarService.ts:229 참고)
  // cal_ prefix ID도 GCal 저장 전이거나 GCal 동기화가 실패한 로컬 전용 상태
  const isLocalOnly = !existing.sourceCalendarId || actualId.startsWith('cal_');
  if (isLocalOnly) {
    eventCache = eventCache.filter((e) => e.id !== actualId);
    localToGcalId.delete(eventId);
    broadcastCalendarChange({ eventId: actualId, action: 'delete' });
    return;
  }

  // 원본 캘린더 ID 우선 사용
  const calId = existing.sourceCalendarId || await getTargetCalendar(existing.type);
  if (!calId) return;

  // 낙관적 업데이트: 캐시 먼저 업데이트
  eventCache = eventCache.filter((e) => e.id !== actualId);
  // 매핑도 정리
  localToGcalId.delete(eventId);
  broadcastCalendarChange({ eventId: actualId, action: 'delete' });

  try {
    await gcalService.deleteEvent(calId, actualId);
  } catch (err) {
    // 실패: 롤백
    eventCache = [...eventCache, existing];
    broadcastCalendarChange({ eventId: actualId, action: 'add' });
    throw err;
  }
}

function broadcastCalendarChange(detail?: { eventId?: string; action?: 'add' | 'update' | 'delete' }) {
  window.dispatchEvent(new CustomEvent('bflow:calendar-changed', { detail }));
}

export function filterEventsByRange(events: CalendarEvent[], rangeStart: string, rangeEnd: string): CalendarEvent[] {
  return events.filter((e) => e.endDate >= rangeStart && e.startDate <= rangeEnd);
}

export function getEventsForDate(events: CalendarEvent[], date: string): CalendarEvent[] {
  return events.filter((e) => e.startDate <= date && e.endDate >= date);
}

export async function findEventByTodoId(todoId: string): Promise<CalendarEvent | undefined> {
  // cold cache 방어: 캐시가 비어있으면 sync 시도
  if (eventCache.length === 0) {
    try {
      const authed = await gcalService.isAuthenticated();
      if (authed) await syncAll();
    } catch { /* 무시 */ }
  }
  return eventCache.find((e) => e.linkedTodoId === todoId);
}
