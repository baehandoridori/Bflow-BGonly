/**
 * 캘린더 서비스 (어댑터)
 * Google Calendar API를 기존 CalendarEvent 인터페이스로 래핑
 */
import type { CalendarEvent, CalendarEventType, BflowEventMeta, GCalSettings } from '@/types/calendar';
import * as gcalService from './googleCalendarService';

const GCAL_SETTINGS_KEY = 'bflow_gcal_settings';

export function getGCalSettings(): GCalSettings {
  try {
    const raw = localStorage.getItem(GCAL_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { teamCalendarId: null, personalCalendarId: null, lastSyncAt: null };
}

export function saveGCalSettings(settings: GCalSettings): void {
  localStorage.setItem(GCAL_SETTINGS_KEY, JSON.stringify(settings));
}

/** GCal 이벤트 → B flow CalendarEvent 변환 */
function toCalendarEvent(gcalEvent: any, _calendarId: string): CalendarEvent {
  const meta = (gcalEvent.extendedProperties?.private || {}) as Partial<BflowEventMeta>;
  const isAllDay = !!gcalEvent.start?.date;
  const startDate = isAllDay ? gcalEvent.start.date : gcalEvent.start?.dateTime?.slice(0, 10);
  let endDate = isAllDay ? gcalEvent.end?.date : gcalEvent.end?.dateTime?.slice(0, 10);

  // GCal 종일 이벤트는 종료일이 exclusive (3/25~3/26 = 3/25 하루)
  // B flow는 inclusive 종료일을 사용하므로 하루 빼기
  if (isAllDay && endDate) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - 1);
    endDate = d.toISOString().slice(0, 10);
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
  };
}

/** 종일 이벤트 종료일 보정: inclusive 날짜에 하루 추가 (GCal exclusive → B flow inclusive) */
function addOneDay(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
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
function getTargetCalendar(type: CalendarEventType): string | null {
  const settings = getGCalSettings();
  if (type === 'custom') return settings.personalCalendarId || 'primary';
  return settings.teamCalendarId || settings.personalCalendarId || 'primary';
}

// ─── 공개 API (기존 인터페이스 유지) ──────────────────────────

let eventCache: CalendarEvent[] = [];

export async function loadAllEvents(): Promise<CalendarEvent[]> {
  return eventCache;
}

export async function getEvents(): Promise<CalendarEvent[]> {
  return eventCache;
}

/** 전체 동기화 (앱 시작 시 호출) */
export async function syncAll(): Promise<CalendarEvent[]> {
  const settings = getGCalSettings();
  const events: CalendarEvent[] = [];

  for (const calId of [settings.teamCalendarId, settings.personalCalendarId]) {
    if (!calId) continue;
    const gcalEvents = await gcalService.fullSync(calId);
    events.push(...gcalEvents.map((e: any) => toCalendarEvent(e, calId)));
  }

  eventCache = events;
  broadcastCalendarChange();
  return events;
}

/** Incremental 동기화 (webhook 알림 시 호출) */
export async function syncIncremental(): Promise<void> {
  const settings = getGCalSettings();

  for (const calId of [settings.teamCalendarId, settings.personalCalendarId]) {
    if (!calId) continue;
    const { updated, deleted } = await gcalService.incrementalSync(calId);

    // 삭제
    eventCache = eventCache.filter((e) => !deleted.includes(e.id));
    // 업데이트/추가
    for (const gcalEvent of updated) {
      const converted = toCalendarEvent(gcalEvent, calId);
      const idx = eventCache.findIndex((e) => e.id === converted.id);
      if (idx >= 0) eventCache[idx] = converted;
      else eventCache.push(converted);
    }
  }

  broadcastCalendarChange();
}

export async function addEvent(event: CalendarEvent): Promise<void> {
  const calId = getTargetCalendar(event.type);
  if (!calId) throw new Error('캘린더가 설정되지 않았습니다');

  // 낙관적 업데이트: 캐시 먼저 업데이트
  const tempId = `temp_${Date.now()}`;
  const tempEvent = { ...event, id: tempId };
  eventCache.push(tempEvent);
  broadcastCalendarChange({ eventId: tempId, action: 'add' });

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
    // 성공: temp ID를 실제 ID로 교체
    const idx = eventCache.findIndex((e) => e.id === tempId);
    if (idx >= 0) eventCache[idx] = { ...tempEvent, id: gcalId };
    broadcastCalendarChange({ eventId: gcalId, action: 'update' });
  } catch (err) {
    // 실패: 롤백
    eventCache = eventCache.filter((e) => e.id !== tempId);
    broadcastCalendarChange();
    throw err;
  }
}

export async function updateEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<void> {
  const existing = eventCache.find((e) => e.id === eventId);
  if (!existing) return;

  const calId = getTargetCalendar(existing.type);
  if (!calId) return;

  // 낙관적 업데이트: 캐시 먼저 업데이트
  const previous = { ...existing };
  eventCache = eventCache.map((e) => (e.id === eventId ? { ...e, ...updates } : e));
  broadcastCalendarChange({ eventId, action: 'update' });

  try {
    // GCal 종일 이벤트 종료일 보정 (B flow inclusive → GCal exclusive)
    const effectiveStart = updates.startDate ?? existing.startDate;
    const effectiveEnd = updates.endDate ?? existing.endDate;
    const isAllDay = effectiveStart.length === 10;
    const gcalEndDate = isAllDay && effectiveEnd ? addOneDay(effectiveEnd) : effectiveEnd;
    await gcalService.updateEvent(calId, eventId, {
      summary: updates.title,
      description: updates.memo,
      startDate: updates.startDate,
      endDate: gcalEndDate,
      extendedProperties: toBflowMeta({ ...existing, ...updates }),
    });
  } catch (err) {
    // 실패: 롤백
    eventCache = eventCache.map((e) => (e.id === eventId ? previous : e));
    broadcastCalendarChange({ eventId, action: 'update' });
    throw err;
  }
}

export async function deleteEvent(eventId: string): Promise<void> {
  const existing = eventCache.find((e) => e.id === eventId);
  if (!existing) return;

  const calId = getTargetCalendar(existing.type);
  if (!calId) return;

  // 낙관적 업데이트: 캐시 먼저 업데이트
  eventCache = eventCache.filter((e) => e.id !== eventId);
  broadcastCalendarChange({ eventId, action: 'delete' });

  try {
    await gcalService.deleteEvent(calId, eventId);
  } catch (err) {
    // 실패: 롤백
    eventCache = [...eventCache, existing];
    broadcastCalendarChange({ eventId, action: 'add' });
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
  return eventCache.find((e) => e.linkedTodoId === todoId);
}
