import type { CalendarEvent } from '@/types/calendar';

export function isGanttProjection(event: CalendarEvent): boolean {
  return event.sourceCalendarId?.startsWith('bflow:') === true
    && Boolean(event.linkedGanttProjectId && event.linkedGanttTaskId)
    && event.id === `gantt:${event.linkedGanttProjectId}:${event.linkedGanttTaskId}`;
}

/** Only canonical Gantt milestones may use a zero-duration calendar interval. */
export function isGanttMilestone(event: CalendarEvent): boolean {
  return isGanttProjection(event) && event.linkedGanttTaskKind === 'milestone';
}
