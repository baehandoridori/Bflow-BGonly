import { expandRecurringEvents, shiftRecurrenceDate } from '../../shared/calendarRecurrence.ts';
import type { GanttProject } from './types.ts';

export interface LinkedCalendarRange { from: string; to: string }
/** A small buffer keeps rows stable while panning, without imposing a year horizon. */
export function linkedCalendarVisibleRange(firstDate:string,viewportWidth:number,dayWidth:number):LinkedCalendarRange {
  const visibleDays=Math.max(1,Math.ceil(Math.max(1,viewportWidth)/Math.max(1,dayWidth)));
  return {from:shiftRecurrenceDate(firstDate,-31),to:shiftRecurrenceDate(firstDate,visibleDays+31)};
}
export function expandLinkedCalendarProjects(projects:readonly GanttProject[],range:LinkedCalendarRange):GanttProject[] {
  return projects.map(project=>{
    if(!project.calendarLink)return project;
    return {...project,tasks:project.tasks.flatMap(task=>{
      if(!task.recurrenceRule || !task.sourceCalendarEventId)return [task];
      const master={...task,id:task.sourceCalendarEventId};
      return expandRecurringEvents([master],range.from,range.to).map(occurrence=>({...occurrence,
        id:`${task.id}:${occurrence.recurrenceDate}`,sourceCalendarEventId:occurrence.id,
      }));
    })};
  });
}
