import type { CalendarEvent } from '../types/calendar';
import { expandRecurringEvents, shiftRecurrenceDate } from './calendarRecurrence';

export interface CalendarReminder { key: string; eventId: string; calendarId: string; title: string; body: string; dueAt: number; date: string }
export const REMINDER_CATCHUP_MS = 30 * 60 * 1000;
export function dueCalendarReminders(events: CalendarEvent[], now: number, muted: readonly string[] = []): CalendarReminder[] {
  const date = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const occurrences = expandRecurringEvents(events.filter(event => event.calendarId && !muted.includes(event.calendarId)),
    shiftRecurrenceDate(date, -1), shiftRecurrenceDate(date, 8));
  return occurrences.flatMap(event => {
    const minutes = event.reminderMinutes;
    if (minutes == null || !Number.isInteger(minutes) || minutes < 0 || minutes > 10080 || !event.calendarId) return [];
    const time = event.allDay === false ? event.startTime : '09:00';
    if (!time) return [];
    const dueAt = Date.parse(`${event.startDate}T${time.length === 5 ? time + ':00' : time}+09:00`) - minutes * 60000;
    if (!Number.isFinite(dueAt) || dueAt > now || dueAt < now - REMINDER_CATCHUP_MS) return [];
    const key = `${event.recurrenceSeriesId ?? event.id}|${event.recurrenceDate ?? event.startDate}|${dueAt}`;
    return [{ key, eventId: event.id, calendarId: event.calendarId, title: event.title,
      body: `${event.startDate} ${event.allDay === false ? time.slice(0, 5) : '종일'}${event.location ? ` · ${event.location}` : ''}`,
      dueAt, date: event.startDate }];
  }).sort((a, b) => a.dueAt - b.dueAt);
}

/** Claim before showing so multiple windows and immediate retries cannot deliver twice. */
export function claimCalendarReminders(due: CalendarReminder[], ledger: Record<string, number>, now: number): CalendarReminder[] {
  for (const [key, timestamp] of Object.entries(ledger)) if (timestamp < now - 32 * 86400000) delete ledger[key];
  const claimed = due.filter(reminder => ledger[reminder.key] === undefined);
  for (const reminder of claimed) ledger[reminder.key] = now;
  return claimed;
}
