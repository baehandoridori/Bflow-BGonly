import {dateStamp,daysBetween} from './domain.ts';
import type {GanttTask} from './types.ts';

type DurationTask=Pick<GanttTask,'kind'|'startDate'|'endDate'|'allDay'|'startTime'|'endTime'>;
export const DISPLAY_OPTIONS_KEY='bflow-gantt-display-options';
export interface GanttDisplayOptions {todayLine:boolean;remainingDays:boolean}

export function compactDuration(task:DurationTask):string {
  if(task.kind==='milestone')return '0d';
  if(task.allDay)return `${daysBetween(task.startDate,task.endDate)+1}d`;
  const minutes=Math.max(0,Math.round((dateStamp(task.endDate,task.endTime)-dateStamp(task.startDate,task.startTime))/60000));
  const days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),rest=minutes%60;
  return [days?`${days}d`:'',hours?`${hours}h`:'',rest?`${rest}min`:''].filter(Boolean).join(' ')||'0min';
}
export function remainingDaysLabel(endDate:string,today:string):string {
  const days=daysBetween(today,endDate);
  return days>0?`${days}일 남음`:days<0?`${-days}일 지남`:'오늘 마감';
}
export function localDate():string {
  const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function millisecondsUntilMidnight(now=new Date()):number {
  const next=new Date(now.getTime());next.setHours(24,0,0,0);return Math.max(1,next.getTime()-now.getTime());
}
export function readDisplayOptions(raw:string|null):GanttDisplayOptions {
  let saved:Partial<GanttDisplayOptions>|null=null;
  try{saved=raw?JSON.parse(raw):null;}catch{/* A malformed view preference never hides the chart. */}
  return {todayLine:typeof saved?.todayLine==='boolean'?saved.todayLine:true,remainingDays:typeof saved?.remainingDays==='boolean'?saved.remainingDays:false};
}
