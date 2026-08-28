import type { CalendarEvent } from '../types/calendar';
import { calendarEventIdentityKey } from './calendarEventIdentity.ts';

export type CalendarEventSnapshot = Map<string, string>;

export interface CalendarEventDiff {
  added: string[];
  changed: string[];
}

function eventChangeKey(event: CalendarEvent): string {
  return JSON.stringify({
    title: event.title,
    memo: event.memo,
    color: event.color,
    type: event.type,
    startDate: event.startDate,
    endDate: event.endDate,
    startTime: event.startTime,
    endTime: event.endTime,
    allDay: event.allDay,
    createdBy: event.createdBy,
    createdAt: event.createdAt,
    calendarId: event.calendarId,
    tagId: event.tagId,
    linkedEpisode: event.linkedEpisode,
    linkedPart: event.linkedPart,
    linkedSheetName: event.linkedSheetName,
    linkedSceneId: event.linkedSceneId,
    linkedDepartment: event.linkedDepartment,
    linkedTodoId: event.linkedTodoId,
    vacationType: event.vacationType,
    vacationUserName: event.vacationUserName,
    isReadOnly: event.isReadOnly,
    isPrivate: event.isPrivate,
    canEdit: event.canEdit,
    source: event.source,
    sourceCalendarId: event.sourceCalendarId,
  });
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
