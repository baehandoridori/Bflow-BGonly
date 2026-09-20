/** Civil dates are evaluated in UTC so host timezone/DST never changes KST recurrences. */
export interface CalendarRecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  weekdays?: number[];
  monthlyMode?: 'date' | 'weekday' | 'lastDay';
  monthDay?: number;
  ordinal?: 1 | 2 | 3 | 4 | 5 | -1;
  weekday?: number;
  until?: string;
  count?: number;
}
export interface CalendarRecurrencePatch {
  title?: string; memo?: string; color?: string;
  startDate?: string; endDate?: string; allDay?: boolean; startTime?: string; endTime?: string;
  tagId?: string; tagIds?: string[]; location?: string; meetingUrl?: string; reminderMinutes?: number | null;
}
export interface CalendarRecurrenceException { occurrenceDate: string; cancelled: boolean; patch?: CalendarRecurrencePatch }
export interface RecurringCalendarEvent {
  id: string; startDate: string; endDate: string;
  recurrenceRule?: CalendarRecurrenceRule | null;
  recurrenceRevision?: number;
  recurrenceSeriesId?: string;
  recurrenceDate?: string;
  recurrenceExceptions?: CalendarRecurrenceException[];
}
export type ExpandedRecurringEvent<T extends RecurringCalendarEvent> = T & Pick<RecurringCalendarEvent, 'recurrenceSeriesId' | 'recurrenceDate'>;
const DAY = 86400000;
function civil(value: string): Date {
  const date = new Date(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error('올바른 날짜를 입력해 주세요');
  return date;
}
function iso(date: Date): string { return date.toISOString().slice(0,10); }
export function shiftRecurrenceDate(value: string, days: number): string { return iso(new Date(civil(value).getTime() + days * DAY)); }
function integer(value: unknown, min: number, max: number): value is number { return Number.isInteger(value) && Number(value) >= min && Number(value) <= max; }
export function validateCalendarRecurrenceRule(value: unknown, startDate?: string): CalendarRecurrenceRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('반복 규칙이 올바르지 않아요');
  const input = value as Record<string, unknown>;
  if (!['daily','weekly','monthly','yearly'].includes(String(input.frequency)) || !integer(input.interval,1,99)) throw new Error('반복 주기는 1~99 사이로 입력해 주세요');
  const rule: CalendarRecurrenceRule = {frequency:input.frequency as CalendarRecurrenceRule['frequency'],interval:input.interval};
  if (input.weekdays !== undefined) {
    if (!Array.isArray(input.weekdays) || !input.weekdays.length || !input.weekdays.every(day=>integer(day,0,6))) throw new Error('반복 요일을 선택해 주세요');
    rule.weekdays = [...new Set(input.weekdays as number[])].sort((a,b)=>a-b);
  }
  if (input.monthlyMode !== undefined) {
    if (!['date','weekday','lastDay'].includes(String(input.monthlyMode))) throw new Error('매월 반복 방식이 올바르지 않아요');
    rule.monthlyMode=input.monthlyMode as CalendarRecurrenceRule['monthlyMode'];
  }
  if (input.monthDay !== undefined) { if (!integer(input.monthDay,1,31)) throw new Error('반복 날짜는 1~31일이어야 해요'); rule.monthDay=input.monthDay; }
  if (input.weekday !== undefined) { if (!integer(input.weekday,0,6)) throw new Error('반복 요일이 올바르지 않아요'); rule.weekday=input.weekday; }
  if (input.ordinal !== undefined) { if (!(input.ordinal===-1 || integer(input.ordinal,1,5))) throw new Error('반복 순서가 올바르지 않아요'); rule.ordinal=input.ordinal as CalendarRecurrenceRule['ordinal']; }
  if (rule.monthlyMode==='weekday' && (rule.ordinal===undefined || rule.weekday===undefined)) throw new Error('몇 번째 요일인지 선택해 주세요');
  if (input.until !== undefined) { if (typeof input.until!=='string') throw new Error('반복 종료일이 올바르지 않아요'); civil(input.until); rule.until=input.until; }
  if (input.count !== undefined) { if (!integer(input.count,1,1000)) throw new Error('반복 횟수는 1~1000 사이여야 해요'); rule.count=input.count; }
  if (rule.until && rule.count!==undefined) throw new Error('반복 종료일 또는 횟수 중 하나만 선택해 주세요');
  if (startDate) { civil(startDate); if (rule.until && rule.until<startDate) throw new Error('반복 종료일은 시작일 이후여야 해요'); }
  return rule;
}
function inMonth(year: number, month: number, anchorDay: number, rule: CalendarRecurrenceRule): string | null {
  if(year<0 || year>9999)return null;
  const first=new Date(0);first.setUTCFullYear(year,month,1);first.setUTCHours(0,0,0,0);
  const last=new Date(first);last.setUTCMonth(month+1,0);const lastDay=last.getUTCDate();
  let day=rule.monthDay??anchorDay;
  if(rule.monthlyMode==='lastDay')day=lastDay;
  else if(rule.monthlyMode==='weekday') {
    const weekday=rule.weekday!,ordinal=rule.ordinal!;
    day=ordinal===-1 ? lastDay-((last.getUTCDay()-weekday+7)%7) : 1+((weekday-first.getUTCDay()+7)%7)+(ordinal-1)*7;
  }
  if(day>lastDay)return null;first.setUTCDate(day);return iso(first);
}
/** Generated days are unique; invalid month dates neither clamp nor consume COUNT. */
function* occurrenceDates(startDate: string, rule: CalendarRecurrenceRule, stop: string): Generator<string> {
  const start=civil(startDate), last=rule.until && rule.until<stop ? rule.until : stop;
  if(last<startDate)return;
  let count=0;
  const accept=(candidate:string)=>candidate>=startDate && candidate<=last;
  if(rule.frequency==='daily') {
    for(let at=start.getTime(); at<=civil(last).getTime(); at+=rule.interval*DAY) {
      yield iso(new Date(at));if(++count===(rule.count??Infinity))return;
    }
    return;
  }
  if(rule.frequency==='weekly') {
    const weekdays=rule.weekdays??[start.getUTCDay()];
    const offsets=[...new Set(weekdays.map(day=>(day+6)%7))].sort((a,b)=>a-b);
    const monday=start.getTime()-((start.getUTCDay()+6)%7)*DAY, end=civil(last).getTime();
    for(let week=monday;week<=end;week+=rule.interval*7*DAY)for(const offset of offsets) {
      const at=week+offset*DAY;if(at>end)return;const candidate=iso(new Date(at));if(!accept(candidate))continue;
      yield candidate;if(++count===(rule.count??Infinity))return;
    }
    return;
  }
  const startMonth=start.getUTCFullYear()*12+start.getUTCMonth(), end=civil(last), endMonth=end.getUTCFullYear()*12+end.getUTCMonth();
  const step=rule.interval*(rule.frequency==='yearly'?12:1);
  for(let month=startMonth;month<=endMonth;month+=step) {
    const candidate=inMonth(Math.floor(month/12),month%12,start.getUTCDate(),rule);
    if(candidate && accept(candidate)){yield candidate;if(++count===(rule.count??Infinity))return;}
  }
}
export function getOccurrenceDates(startDate: string, value: CalendarRecurrenceRule, from: string, to: string): string[] {
  civil(from);civil(to);const rule=validateCalendarRecurrenceRule(value,startDate);if(to<from)return [];
  return Array.from(occurrenceDates(startDate,rule,to)).filter(date=>date>=from);
}
export function previewRecurrenceDates(startDate: string, value: CalendarRecurrenceRule, limit=5): string[] {
  const rule=validateCalendarRecurrenceRule(value,startDate), result:string[]=[];
  if(!Number.isInteger(limit)||limit<1)return result;
  for(const date of occurrenceDates(startDate,rule,'9999-12-31')){result.push(date);if(result.length>=Math.min(limit,1000))break;}
  return result;
}
export function parseRecurrenceEventId(id: string): {seriesId:string;occurrenceDate:string}|null {
  const match=/^recurrence:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(id);if(!match)return null;
  try{civil(match[2]);return {seriesId:match[1],occurrenceDate:match[2]};}catch{return null;}
}
export function getRecurrenceMaster<T extends RecurringCalendarEvent>(event:T,events:readonly T[]):T|undefined {
  const id=event.recurrenceSeriesId??parseRecurrenceEventId(event.id)?.seriesId??event.id;return events.find(candidate=>candidate.id===id);
}
const PATCH_KEYS:readonly (keyof CalendarRecurrencePatch)[]=['title','memo','color','startDate','endDate','allDay','startTime','endTime','tagId','tagIds','location','meetingUrl','reminderMinutes'];
export function materializeRecurrenceOccurrence<T extends RecurringCalendarEvent>(event:T,date:string,patch?:CalendarRecurrencePatch):ExpandedRecurringEvent<T> {
  const duration=Math.max(0,(civil(event.endDate).getTime()-civil(event.startDate).getTime())/DAY);
  const safe:CalendarRecurrencePatch={};if(patch)for(const key of PATCH_KEYS)if(Object.prototype.hasOwnProperty.call(patch,key))Object.assign(safe,{[key]:patch[key]});
  return {...event,startDate:date,endDate:shiftRecurrenceDate(date,duration),...safe,id:`recurrence:${event.id}:${date}`,recurrenceSeriesId:event.id,recurrenceDate:date};
}
/** Window bounds are inclusive civil dates. Exceptions can move into/out of the window. */
export function expandRecurringEvents<T extends RecurringCalendarEvent>(events:readonly T[],from:string,to:string):ExpandedRecurringEvent<T>[] {
  civil(from);civil(to);if(to<from)return [];const output:ExpandedRecurringEvent<T>[]=[];
  for(const event of events){
    if(!event.recurrenceRule || event.recurrenceSeriesId){if(event.startDate<=to && event.endDate>=from)output.push(event);continue;}
    const rule=validateCalendarRecurrenceRule(event.recurrenceRule,event.startDate);
    const exceptions=new Map((event.recurrenceExceptions??[]).map(exception=>[exception.occurrenceDate,exception]));
    let stop=to;for(const date of exceptions.keys()){try{civil(date);if(date>stop)stop=date;}catch{/* Invalid stored keys never become occurrences. */}}
    for(const date of occurrenceDates(event.startDate,rule,stop)){
      const exception=exceptions.get(date);if(exception?.cancelled)continue;
      const occurrence=materializeRecurrenceOccurrence(event,date,exception?.patch);
      if(occurrence.startDate<=to && occurrence.endDate>=from)output.push(occurrence);
    }
  }
  return output.sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.id.localeCompare(b.id));
}
