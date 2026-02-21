/**
 * 캘린더 이벤트 CRUD 서비스
 * %APPDATA%/Bflow-BGonly/calendar-events.json 에 저장
 */

import type { CalendarEvent, CalendarStore } from '@/types/calendar';

const FILE_NAME = 'calendar-events.json';

let cache: CalendarStore | null = null;

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
  all.push(event);
  cache = all;
  await window.electronAPI.writeSettings(FILE_NAME, all);
}

export async function updateEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<void> {
  const all = await loadAllEvents();
  const idx = all.findIndex((e) => e.id === eventId);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...updates };
  }
  cache = all;
  await window.electronAPI.writeSettings(FILE_NAME, all);
}

export async function deleteEvent(eventId: string): Promise<void> {
  const all = await loadAllEvents();
  cache = all.filter((e) => e.id !== eventId);
  await window.electronAPI.writeSettings(FILE_NAME, cache);
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
