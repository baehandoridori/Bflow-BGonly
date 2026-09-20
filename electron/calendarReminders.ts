import { app, ipcMain, Notification } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './calendarStore';
import { canViewCalendar } from '../src/shared/calendarPermissions';
import { calendarPatchFromRow, recurrenceFieldsFromRow } from '../src/shared/calendarRecurrenceContract';
import { claimCalendarReminders, dueCalendarReminders } from '../src/shared/calendarReminders';
import type { CalendarEvent } from '../src/types/calendar';

export function registerCalendarReminders(getOrigin: () => { userId: string; epoch: number }, onClick: () => void): void {
  let busy = false;
  const lastPoll = new Map<string, number>();
  ipcMain.handle('calendar:reminders:poll', async (_event, rawMuted: unknown) => {
    const origin = getOrigin();
    if (busy || Date.now() - (lastPoll.get(origin.userId) ?? 0) < 20000) return [];
    if (!Notification.isSupported()) return [];
    const muted = Array.isArray(rawMuted) ? rawMuted.filter((id): id is string => typeof id === 'string').slice(0, 10000) : [];
    busy = true;
    try {
      const [rows, authority] = await Promise.all([store.listRecurrenceEvents(origin.userId), store.listCalendarsWithMembers(origin.userId)]);
      const current = getOrigin();
      if (current.userId !== origin.userId || current.epoch !== origin.epoch) return [];
      // An administrator's overview access does not opt them into private calendars' reminders.
      const visible = new Set(authority.calendars.filter(calendar => canViewCalendar(calendar,
        authority.members.filter(member => member.calendar_id === calendar.id).map(member => member.user_id), origin.userId)).map(calendar => calendar.id));
      const events = rows.filter(row => visible.has(row.calendar_id)).map(row => ({
        ...calendarPatchFromRow(row), ...recurrenceFieldsFromRow(row), id: row.id, color: '#6C5CE7', type: 'custom',
        createdBy: row.created_by ?? '', createdAt: row.created_at, source: 'bflow',
      } as CalendarEvent));
      const now = Date.now();
      const file = path.join(app.getPath('userData'), 'calendar-reminders.json');
      let ledgers: Record<string, Record<string, number>> = {};
      try { const parsed = JSON.parse(fs.readFileSync(file, 'utf8')); if (parsed && typeof parsed === 'object') ledgers = parsed; } catch { /* First use. */ }
      const ledger = ledgers[origin.userId] ?? (ledgers[origin.userId] = {});
      const reminders = claimCalendarReminders(dueCalendarReminders(events, now, muted), ledger, now);
      if (reminders.length) {
        const temp = `${file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(ledgers), 'utf8'); fs.renameSync(temp, file);
        for (const reminder of reminders) {
          const notification = new Notification({ title: `일정 알림 · ${reminder.title}`, body: reminder.body });
          notification.on('click', onClick); notification.show();
        }
      }
      lastPoll.set(origin.userId, now);
      return reminders;
    } finally { busy = false; }
  });
}
