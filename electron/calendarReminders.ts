import { app, ipcMain, Notification } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './calendarStore';
import { canViewCalendar } from '../src/shared/calendarPermissions';
import { calendarPatchFromRow, recurrenceFieldsFromRow } from '../src/shared/calendarRecurrenceContract';
import { claimCalendarReminders, dueCalendarReminders, REMINDER_CATCHUP_MS, type CalendarReminder } from '../src/shared/calendarReminders';
import type { CalendarEvent } from '../src/types/calendar';

type ReminderOrigin = { userId: string; epoch: number };
type ReminderTimers = Pick<typeof globalThis, 'setInterval' | 'clearInterval'>;
const sameOrigin = (a: ReminderOrigin, b: ReminderOrigin): boolean => a.userId === b.userId && a.epoch === b.epoch;

// 알림 시각 확인은 30초마다 하지만, 일정 목록은 바뀌었다는 신호가 올 때나 5분이 지났을 때만 다시 읽는다.
// 예전에는 30초마다 일정 전체와 캘린더 목록을 다시 받아 켜진 PC 마다 하루 약 8,600건이 나갔다 (2026-10-20 서버 신호 줄이기).
export const REMINDER_EVENTS_MAX_AGE_MS = 5 * 60_000;

export interface CalendarReminderHandle {
  /** 일정·캘린더·간트 연결이 바뀌었을 수 있다 — 다음 확인 때 일정 목록을 다시 읽는다. */
  invalidate(): void;
}

export function registerCalendarReminders(getOrigin: () => ReminderOrigin, onClick: () => void,
  timers: ReminderTimers = { setInterval, clearInterval }): CalendarReminderHandle {
  let busy = false;
  let stopped = false;
  let preferences: { origin: ReminderOrigin; muted: string[] } | null = null;
  let lastPoll: { origin: ReminderOrigin; at: number } | null = null;
  let queued: CalendarReminder[] = [];
  // 읽는 중에 바뀜 신호가 오면 그 결과는 이미 낡았을 수 있다 — 세대 번호가 다르면 다음에 다시 읽는다.
  let eventsGeneration = 0;
  let eventsCache: { origin: ReminderOrigin; at: number; generation: number; events: CalendarEvent[] } | null = null;
  const isCurrent = (origin: ReminderOrigin): boolean => {
    try { return !stopped && !!preferences && sameOrigin(preferences.origin, origin) && sameOrigin(getOrigin(), origin); }
    catch { return false; }
  };
  const readVisibleEvents = async (origin: ReminderOrigin): Promise<CalendarEvent[] | null> => {
    const cached = eventsCache;
    if (cached && sameOrigin(cached.origin, origin) && cached.generation === eventsGeneration
      && Date.now() - cached.at < REMINDER_EVENTS_MAX_AGE_MS) return cached.events;
    const generation = eventsGeneration;
    const [rows, authority] = await Promise.all([store.listRecurrenceEvents(origin.userId), store.listCalendarsWithMembers(origin.userId)]);
    if (!isCurrent(origin)) return null;
    // An administrator's overview access does not opt them into private calendars' reminders.
    const visible = new Set(authority.calendars.filter(calendar => canViewCalendar(calendar,
      authority.members.filter(member => member.calendar_id === calendar.id).map(member => member.user_id), origin.userId)).map(calendar => calendar.id));
    const events = rows.filter(row => visible.has(row.calendar_id)).map(row => ({
      ...calendarPatchFromRow(row), ...recurrenceFieldsFromRow(row), id: row.id, color: '#6C5CE7', type: 'custom',
      createdBy: row.created_by ?? '', createdAt: row.created_at, source: 'bflow',
    } as CalendarEvent));
    eventsCache = { origin, at: Date.now(), generation, events };
    return events;
  };
  const poll = async (origin: ReminderOrigin): Promise<void> => {
    if (!isCurrent(origin) || busy || (lastPoll && sameOrigin(lastPoll.origin, origin) && Date.now() - lastPoll.at < 20000)) return;
    if (!Notification.isSupported()) return;
    busy = true;
    try {
      const events = await readVisibleEvents(origin);
      if (!events || !isCurrent(origin)) return;
      const now = Date.now();
      const file = path.join(app.getPath('userData'), 'calendar-reminders.json');
      let ledgers: Record<string, Record<string, number>> = {};
      try { const parsed = JSON.parse(fs.readFileSync(file, 'utf8')); if (parsed && typeof parsed === 'object') ledgers = parsed; } catch { /* First use. */ }
      const ledger = ledgers[origin.userId] ?? (ledgers[origin.userId] = {});
      // An IPC request can update mute preferences while this read is in flight.
      const reminders = claimCalendarReminders(dueCalendarReminders(events, now, preferences!.muted), ledger, now);
      if (reminders.length) {
        const temp = `${file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(ledgers), 'utf8'); fs.renameSync(temp, file);
        for (const reminder of reminders) {
          const notification = new Notification({ title: `일정 알림 · ${reminder.title}`, body: reminder.body });
          notification.on('click', onClick); notification.show();
        }
        queued = queued.filter(reminder => now - reminder.dueAt <= REMINDER_CATCHUP_MS).concat(reminders);
      }
      lastPoll = { origin, at: now };
    } finally { busy = false; }
  };
  ipcMain.handle('calendar:reminders:poll', async (_event, rawMuted: unknown) => {
    const origin = getOrigin();
    const muted = Array.isArray(rawMuted) ? rawMuted.filter((id): id is string => typeof id === 'string').slice(0, 10000) : [];
    if (!preferences || !sameOrigin(preferences.origin, origin)) queued = [];
    preferences = { origin, muted };
    await poll(origin);
    if (!isCurrent(origin)) return [];
    const reminders = queued.filter(reminder => !preferences!.muted.includes(reminder.calendarId)
      && Date.now() - reminder.dueAt <= REMINDER_CATCHUP_MS);
    queued = [];
    return reminders;
  });
  // Renderer timers may be suspended in the tray. Main owns the delivery clock,
  // but only after this exact login session has supplied its local preferences.
  const timer = timers.setInterval(async () => {
    let origin: ReminderOrigin;
    try { origin = getOrigin(); }
    catch { preferences = null; queued = []; return; }
    if (!preferences || !sameOrigin(preferences.origin, origin)) { preferences = null; queued = []; return; }
    try { await poll(origin); } catch { /* Background failures retry on the next tick. */ }
  }, 30000);
  timer.unref();
  app.once('before-quit', () => {
    stopped = true;
    timers.clearInterval(timer);
    preferences = null;
    queued = [];
    eventsCache = null;
  });
  return {
    invalidate() {
      eventsGeneration += 1;
      eventsCache = null;
    },
  };
}
