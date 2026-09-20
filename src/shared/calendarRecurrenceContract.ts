import type { CalendarRecurrenceRule } from './calendarRecurrence';
import type { CalendarEventCreateInput, CalendarEventUpdateInput } from './calendarApiContract';
import type { CalendarEvent } from '../types/calendar';
export type CalendarRecurrenceScope = 'this' | 'following' | 'all';
export interface CalendarRecurrenceFields {
  recurrence_rule?: CalendarRecurrenceRule | null;
  recurrence_revision?: number;
  recurrence_exceptions?: Array<{ occurrence_date: string; cancelled: boolean; patch?: CalendarEventUpdateInput }>;
  location?: string;
  meeting_url?: string;
  reminder_minutes?: number | null;
}
export interface CalendarRecurrenceRow extends CalendarEventCreateInput, CalendarRecurrenceFields {
  id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface CalendarRecurrenceRequest {
  action: 'create' | 'update' | 'delete';
  eventId?: string;
  occurrenceDate?: string;
  scope: CalendarRecurrenceScope;
  expectedRevision: number;
  patch: CalendarEventUpdateInput & { expected_calendar_id?: string };
}
export interface CalendarRecurrenceResult {
  event: CalendarRecurrenceRow | null;
  split_event: CalendarRecurrenceRow | null;
  deleted: boolean;
}
export function recurrenceFieldsFromRow(row: CalendarRecurrenceFields): Partial<CalendarEvent> {
  return {
    recurrenceRule: row.recurrence_rule ?? undefined,
    recurrenceRevision: row.recurrence_revision ?? 0,
    recurrenceExceptions: row.recurrence_exceptions?.map(ex => ({
      occurrenceDate: ex.occurrence_date, cancelled: ex.cancelled,
      patch: calendarPatchFromRow(ex.patch ?? {}),
    })),
    location: row.location ?? '', meetingUrl: row.meeting_url ?? '', reminderMinutes: row.reminder_minutes ?? null,
  };
}
const keys = {
  calendarId: 'calendar_id', title: 'title', memo: 'memo', tagId: 'tag_id', tagIds: 'tag_ids',
  allDay: 'all_day', startDate: 'start_date', endDate: 'end_date', startTime: 'start_time', endTime: 'end_time',
  linkedEpisode: 'linked_episode', linkedPart: 'linked_part', linkedSheetName: 'linked_sheet_name',
  linkedSceneId: 'linked_scene_id', linkedDepartment: 'linked_department', linkedTodoId: 'linked_todo_id',
  recurrenceRule: 'recurrence_rule', location: 'location', meetingUrl: 'meeting_url', reminderMinutes: 'reminder_minutes',
} as const;
export function calendarPatchToRow(event: Partial<CalendarEvent>): CalendarEventUpdateInput {
  const result: Record<string, unknown> = {};
  for (const [camel, snake] of Object.entries(keys)) {
    if (Object.prototype.hasOwnProperty.call(event, camel)) result[snake] = event[camel as keyof CalendarEvent] ?? null;
  }
  return result as CalendarEventUpdateInput;
}
export function calendarPatchFromRow(row: CalendarEventUpdateInput): Partial<CalendarEvent> {
  const result: Record<string, unknown> = {};
  for (const [camel, snake] of Object.entries(keys)) {
    if (Object.prototype.hasOwnProperty.call(row, snake)) result[camel] = row[snake as keyof CalendarEventUpdateInput] ?? undefined;
  }
  if ('reminder_minutes' in row) result.reminderMinutes = row.reminder_minutes ?? null;
  if ('recurrence_rule' in row) result.recurrenceRule = row.recurrence_rule ?? null;
  return result as Partial<CalendarEvent>;
}
