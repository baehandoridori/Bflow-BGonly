/**
 * Google Calendar IPC 래퍼 (렌더러 → 메인)
 * calendarService.ts를 대체
 */

export async function isAuthenticated(): Promise<boolean> {
  return window.electronAPI.gcalIsAuthenticated();
}

export async function startAuth(): Promise<void> {
  return window.electronAPI.gcalStartAuth();
}

export async function signOut(): Promise<void> {
  return window.electronAPI.gcalSignOut();
}

export async function listCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
  return window.electronAPI.gcalListCalendars();
}

export async function fullSync(calendarId: string) {
  return window.electronAPI.gcalFullSync(calendarId);
}

export async function incrementalSync(calendarId: string) {
  return window.electronAPI.gcalIncrementalSync(calendarId);
}

export async function insertEvent(calendarId: string, input: {
  summary: string;
  description?: string;
  startDate: string;
  endDate: string;
  colorId?: string;
  extendedProperties?: Record<string, string>;
}): Promise<string> {
  return window.electronAPI.gcalInsertEvent(calendarId, input);
}

export async function updateEvent(
  calendarId: string,
  eventId: string,
  input: Partial<{
    summary: string;
    description?: string;
    startDate: string;
    endDate: string;
    extendedProperties?: Record<string, string>;
  }>,
): Promise<void> {
  return window.electronAPI.gcalUpdateEvent(calendarId, eventId, input);
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  return window.electronAPI.gcalDeleteEvent(calendarId, eventId);
}

export async function ensureWatch(calendarId: string, userId: string): Promise<void> {
  return window.electronAPI.gcalEnsureWatch(calendarId, userId);
}
