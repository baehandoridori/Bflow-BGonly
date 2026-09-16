import type { CalendarEvent } from '../../types/calendar.ts';
import type { GanttCalendarImportSource, GanttProject, GanttTask } from './types.ts';
import { createTask, scheduleProject, validateProject, calendarImportSourceKey, validateCalendarImportSource } from './domain.ts';

function sourceReference(event: CalendarEvent): GanttCalendarImportSource | null {
  // A projection is already a Gantt task. Reject incomplete/older projection rows too.
  if (event.id.startsWith('gantt:') || event.linkedGanttProjectId || event.linkedGanttTaskId) return null;
  if (!event.source || !['bflow', 'google', 'ics', 'vacation'].includes(event.source)) return null;
  const calendarId = event.sourceCalendarId || (event.source === 'bflow' && event.calendarId ? `bflow:${event.calendarId}` : '');
  if (!calendarId) return null;
  const reference = { source: event.source, calendarId, eventId: event.id };
  validateCalendarImportSource(reference);
  return reference;
}

export function getCalendarImportSourceKey(event: CalendarEvent): string | null {
  const source = sourceReference(event);
  return source ? calendarImportSourceKey(source) : null;
}

export function isCalendarEventImported(project: GanttProject, event: CalendarEvent): boolean {
  const key = getCalendarImportSourceKey(event);
  return key !== null && project.tasks.some((task) => task.importedCalendarEvent
    && calendarImportSourceKey(task.importedCalendarEvent) === key);
}

/**
 * Copies already-authorized, UI-normalized events. Callers must freshly read source
 * calendars and use saveProject with the destination's current revision/permissions.
 * CalendarEvent.endDate is already inclusive; never apply provider date conversion here.
 */
export function importCalendarEvents(
  project: GanttProject,
  events: readonly CalendarEvent[],
  options: { idFactory?: () => string } = {},
): { project: GanttProject; importedCount: number; skippedCount: number } {
  validateProject(project);
  const seen = new Set(project.tasks.flatMap((task) => task.importedCalendarEvent
    ? [calendarImportSourceKey(task.importedCalendarEvent)] : []));
  const additions: GanttTask[] = [];
  let skippedCount = 0;
  let sortOrder = project.tasks.reduce((last, task) => Math.max(last, task.sortOrder), -1);
  for (const event of events) {
    const source = sourceReference(event);
    if (!source || seen.has(calendarImportSourceKey(source))) { skippedCount++; continue; }
    const task: GanttTask = {
      ...createTask(event.title, event.startDate),
      ...(options.idFactory ? { id: options.idFactory() } : {}),
      title: event.title,
      memo: event.memo,
      color: event.color,
      startDate: event.startDate,
      endDate: event.endDate,
      allDay: event.allDay !== false,
      startTime: event.allDay === false ? event.startTime ?? '' : '',
      endTime: event.allDay === false ? event.endTime ?? '' : '',
      sortOrder: ++sortOrder,
      importedCalendarEvent: source,
    };
    additions.push(task);
    seen.add(calendarImportSourceKey(source));
  }
  // Validate as one batch, so invalid dates or overlong memo/title never silently
  // truncate an event or partially mutate the caller's project.
  const next = additions.length ? scheduleProject({ ...project, tasks: [...project.tasks, ...additions] }) : project;
  return { project: next, importedCount: additions.length, skippedCount };
}
