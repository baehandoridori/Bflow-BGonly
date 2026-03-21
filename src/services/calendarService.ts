/**
 * 캘린더 이벤트 CRUD 서비스
 * %APPDATA%/B flow/calendar-events.json 에 저장
 */

import type { CalendarEvent, CalendarStore } from '@/types/calendar';

const FILE_NAME = 'calendar-events.json';

let cache: CalendarStore | null = null;

/** 캘린더 변경 브로드캐스트 (할일 위젯 등 구독자에게 알림) */
function broadcastCalendarChange(detail?: { eventId?: string; action?: 'add' | 'update' | 'delete' }) {
  window.dispatchEvent(new CustomEvent('bflow:calendar-changed', { detail }));
}

export async function loadAllEvents(): Promise<CalendarStore> {
  if (cache) return cache;
  try {
    const data = await window.electronAPI.readSettings(FILE_NAME);
    if (Array.isArray(data)) {
      cache = data as CalendarStore;
      return cache;
    }
  } catch {
    // 파일 없으면 빈 배열
  }
  cache = [];
  return cache;
}

export async function getEvents(): Promise<CalendarEvent[]> {
  return loadAllEvents();
}

export async function addEvent(event: CalendarEvent): Promise<void> {
  const all = await loadAllEvents();
  const next = [...all, event];
  try {
    await window.electronAPI.writeSettings(FILE_NAME, next);
    cache = next;
    broadcastCalendarChange({ eventId: event.id, action: 'add' });
  } catch (err) {
    console.error('[calendarService] addEvent 저장 실패:', err);
    throw err;
  }
}

export async function updateEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<void> {
  const all = await loadAllEvents();
  const next = all.map((e) => (e.id === eventId ? { ...e, ...updates } : e));
  try {
    await window.electronAPI.writeSettings(FILE_NAME, next);
    cache = next;
    broadcastCalendarChange({ eventId: eventId, action: 'update' });
  } catch (err) {
    console.error('[calendarService] updateEvent 저장 실패:', err);
    throw err;
  }
}

export async function deleteEvent(eventId: string): Promise<void> {
  const all = await loadAllEvents();
  const next = all.filter((e) => e.id !== eventId);
  try {
    await window.electronAPI.writeSettings(FILE_NAME, next);
    cache = next;
    broadcastCalendarChange({ eventId: eventId, action: 'delete' });
  } catch (err) {
    console.error('[calendarService] deleteEvent 저장 실패:', err);
    throw err;
  }
}

/** linkedTodoId로 캘린더 이벤트 찾기 */
export async function findEventByTodoId(todoId: string): Promise<CalendarEvent | undefined> {
  const all = await loadAllEvents();
  return all.find((e) => e.linkedTodoId === todoId || e.id === `cal_${todoId}`);
}

/** 날짜 범위 내 이벤트 필터 */
export function filterEventsByRange(
  events: CalendarEvent[],
  rangeStart: string,
  rangeEnd: string,
): CalendarEvent[] {
  return events.filter(
    (e) => e.endDate >= rangeStart && e.startDate <= rangeEnd,
  );
}

/** 특정 날짜에 해당하는 이벤트 */
export function getEventsForDate(events: CalendarEvent[], date: string): CalendarEvent[] {
  return events.filter((e) => e.startDate <= date && e.endDate >= date);
}
