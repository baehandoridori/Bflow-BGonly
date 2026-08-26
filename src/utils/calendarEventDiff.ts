import type { CalendarEvent } from '../types/calendar';
import { calendarEventIdentityKey } from './calendarEventIdentity.ts';

export type CalendarEventSnapshot = Map<string, string>;

export interface CalendarEventDiff {
  added: string[];
  changed: string[];
}

function eventChangeKey(event: CalendarEvent): string {
  return [
    event.startDate,
    event.endDate,
    event.startTime ?? '',
    event.endTime ?? '',
    String(event.allDay ?? ''),
    event.title,
    event.calendarId ?? '',
    event.tagId ?? '',
  ].join('|');
}

export function buildEventSnapshot(events: CalendarEvent[]): CalendarEventSnapshot {
  return new Map(events.map((event) => [calendarEventIdentityKey(event), eventChangeKey(event)]));
}

export function diffEventSnapshots(
  before: CalendarEventSnapshot,
  after: CalendarEventSnapshot,
): CalendarEventDiff {
  const added: string[] = [];
  const changed: string[] = [];

  for (const [identityKey, changeKey] of after) {
    const previousChangeKey = before.get(identityKey);
    if (previousChangeKey === undefined) {
      added.push(identityKey);
    } else if (previousChangeKey !== changeKey) {
      changed.push(identityKey);
    }
  }

  return { added, changed };
}
