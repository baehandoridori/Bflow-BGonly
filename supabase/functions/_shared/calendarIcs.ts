/** RFC 5545 subscription serialization shared by the Edge endpoint and offline tests. */
import { getOccurrenceDates, previewRecurrenceDates, shiftRecurrenceDate, validateCalendarRecurrenceRule, type CalendarRecurrenceRule } from '../../../src/shared/calendarRecurrence.ts';
export interface CalendarFeedEvent {
  id:string; title:string; memo:string|null; all_day:boolean;
  start_date:string; end_date:string; start_time:string|null; end_time:string|null;
  created_at:string|null; updated_at:string|null; categories:string[];
  recurrence_rule?:CalendarRecurrenceRule|null;
  recurrence_revision?:number;
  recurrence_exceptions?:{occurrence_date:string;cancelled:boolean;patch?:Partial<CalendarFeedEvent>}[];
  location?:string|null; meeting_url?:string|null; reminder_minutes?:number|null;
}
export interface CalendarFeed {calendar:{id:string;name:string;color:string};events:CalendarFeedEvent[]}
const encoder=new TextEncoder();
export function escapeIcsText(value:string):string {
  return value.replace(/\r\n|\r|\n/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')
    .replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
}
/** Fold on Unicode code-point boundaries; continuation space counts toward 75 octets. */
export function foldIcsLine(line:string):string {
  let current='',bytes=0;const lines:string[]=[];
  for(const character of line){const length=encoder.encode(character).length;if(bytes+length>75){lines.push(current);current=' ';bytes=1;}current+=character;bytes+=length;}
  lines.push(current);return lines.join('\r\n');
}
function day(value:string):Date {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Invalid calendar date');
  const result=new Date(value+'T00:00:00Z');if(!Number.isFinite(result.getTime())||result.toISOString().slice(0,10)!==value)throw new Error('Invalid calendar date');return result;
}
function utc(value:Date):string{return value.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}
function seoul(date:string,time:string|null):Date {
  day(date);if(!time||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Invalid calendar time');
  return new Date(date+'T'+time+':00+09:00');
}
function timestamp(event:CalendarFeedEvent):string {
  const value=event.updated_at??event.created_at??'1970-01-01T00:00:00Z';const result=new Date(value);
  if(!Number.isFinite(result.getTime()))throw new Error('Invalid calendar timestamp');return utc(result);
}
const WEEKDAYS=['SU','MO','TU','WE','TH','FR','SA'];
function local(date:string,time:string|null):string { seoul(date,time);return date.replace(/-/g,'')+'T'+time!.replace(':','')+'00'; }
function dateProperty(name:string,event:CalendarFeedEvent,date:string):string {
  return event.all_day ? name+';VALUE=DATE:'+date.replace(/-/g,'') : name+';TZID=Asia/Seoul:'+local(date,event.start_time);
}
function recurrenceLine(event:CalendarFeedEvent,rule:CalendarRecurrenceRule):string {
  const start=day(event.start_date),parts=['FREQ='+rule.frequency.toUpperCase(),'INTERVAL='+rule.interval];
  if(rule.frequency==='weekly')parts.push('WKST=MO','BYDAY='+(rule.weekdays??[start.getUTCDay()]).map(d=>WEEKDAYS[d]).join(','));
  if(rule.frequency==='monthly'||rule.frequency==='yearly') {
    if(rule.frequency==='yearly')parts.push('BYMONTH='+(start.getUTCMonth()+1));
    if(rule.monthlyMode==='lastDay')parts.push('BYMONTHDAY=-1');
    else if(rule.monthlyMode==='weekday')parts.push('BYDAY='+rule.ordinal+WEEKDAYS[rule.weekday!]);
    else parts.push('BYMONTHDAY='+(rule.monthDay??start.getUTCDate()));
  }
  if(rule.count!==undefined)parts.push('COUNT='+rule.count);
  if(rule.until)parts.push('UNTIL='+(event.all_day?rule.until.replace(/-/g,''):utc(seoul(rule.until,event.start_time))));
  return 'RRULE:'+parts.join(';');
}
function eventAt(event:CalendarFeedEvent,date:string,patch?:Partial<CalendarFeedEvent>):CalendarFeedEvent {
  const duration=(day(event.end_date).getTime()-day(event.start_date).getTime())/86400000;
  const result={...event,start_date:date,end_date:shiftRecurrenceDate(date,duration)};
  // Exception data can change content, never the series identity or recurrence itself.
  const fields:readonly (keyof CalendarFeedEvent)[]=['title','memo','all_day','start_date','end_date','start_time','end_time','categories','location','meeting_url','reminder_minutes'];
  if(patch)for(const key of fields)if(Object.prototype.hasOwnProperty.call(patch,key))Object.assign(result,{[key]:patch[key]});
  return result;
}
function eventLines(event:CalendarFeedEvent,uid:string,wallTime:boolean,recurrenceId?:string,recurrence?:string,exdates:string[]=[]):string[] {
  const start=day(event.start_date),end=day(event.end_date);if(end<start)throw new Error('Invalid calendar range');
  const stamp=timestamp(event),lines=['BEGIN:VEVENT','UID:'+uid,'DTSTAMP:'+stamp,'LAST-MODIFIED:'+stamp];
  if(event.recurrence_revision!==undefined){if(!Number.isSafeInteger(event.recurrence_revision)||event.recurrence_revision<0)throw new Error('Invalid recurrence revision');lines.push('SEQUENCE:'+event.recurrence_revision);}
  if(recurrenceId)lines.push(recurrenceId);
  if(event.all_day){end.setUTCDate(end.getUTCDate()+1);lines.push('DTSTART;VALUE=DATE:'+event.start_date.replace(/-/g,''),'DTEND;VALUE=DATE:'+end.toISOString().slice(0,10).replace(/-/g,''));}
  else {
    const startAt=seoul(event.start_date,event.start_time),endAt=seoul(event.end_date,event.end_time);if(endAt<startAt)throw new Error('Invalid calendar range');
    lines.push(wallTime?'DTSTART;TZID=Asia/Seoul:'+local(event.start_date,event.start_time):'DTSTART:'+utc(startAt));
    if(endAt>startAt)lines.push(wallTime?'DTEND;TZID=Asia/Seoul:'+local(event.end_date,event.end_time):'DTEND:'+utc(endAt));
  }
  if(recurrence)lines.push(recurrence);lines.push(...exdates);
  lines.push('SUMMARY:'+escapeIcsText(event.title));if(event.memo)lines.push('DESCRIPTION:'+escapeIcsText(event.memo));
  if(event.categories.length)lines.push('CATEGORIES:'+event.categories.map(escapeIcsText).join(','));
  if(event.location)lines.push('LOCATION:'+escapeIcsText(event.location));
  if(event.meeting_url){
    if(/[\u0000-\u0020\u007f]/.test(event.meeting_url))throw new Error('Invalid meeting URL');
    const url=new URL(event.meeting_url);if(url.protocol!=='https:'&&url.protocol!=='http:')throw new Error('Invalid meeting URL');lines.push('URL:'+url.href);
  }
  if(event.reminder_minutes!==undefined&&event.reminder_minutes!==null){
    const minutes=event.reminder_minutes;if(!Number.isSafeInteger(minutes)||minutes<0||minutes>40320)throw new Error('Invalid reminder');
    let trigger:string;
    if(event.all_day&&!recurrence){trigger='TRIGGER;VALUE=DATE-TIME:'+utc(new Date(seoul(event.start_date,'09:00').getTime()-minutes*60000));}
    else {const offset=(event.all_day?540:0)-minutes;trigger='TRIGGER:'+(offset<0?'-':'')+'PT'+Math.abs(offset)+'M';}
    lines.push('BEGIN:VALARM','ACTION:DISPLAY',trigger,'DESCRIPTION:'+escapeIcsText(event.title),'END:VALARM');
  }
  lines.push('END:VEVENT');return lines;
}
export function serializeCalendarIcs(feed:CalendarFeed):string {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Studio JBBJ//B flow Calendar//KO','CALSCALE:GREGORIAN',
    'X-WR-CALNAME:'+escapeIcsText(feed.calendar.name),'X-WR-TIMEZONE:Asia/Seoul','REFRESH-INTERVAL;VALUE=DURATION:PT1H','X-PUBLISHED-TTL:PT1H'];
  if(feed.events.some(event=>event.recurrence_rule))lines.push('BEGIN:VTIMEZONE','TZID:Asia/Seoul','X-LIC-LOCATION:Asia/Seoul','BEGIN:STANDARD','DTSTART:19700101T000000','TZOFFSETFROM:+0900','TZOFFSETTO:+0900','TZNAME:KST','END:STANDARD','END:VTIMEZONE');
  const seen=new Set<string>();
  for(const event of feed.events){
    if(seen.has(event.id))continue;seen.add(event.id);
    const uid=encodeURIComponent(feed.calendar.id)+'/'+encodeURIComponent(event.id)+'@calendar.bflow.app';
    if(!event.recurrence_rule){lines.push(...eventLines(event,uid,false));continue;}
    const rule=validateCalendarRecurrenceRule(event.recurrence_rule,event.start_date),first=previewRecurrenceDates(event.start_date,rule,1)[0];if(!first)continue;
    const exceptions=[...new Map((event.recurrence_exceptions??[]).map(exception=>[exception.occurrence_date,exception])).values()].filter(exception=>getOccurrenceDates(event.start_date,rule,exception.occurrence_date,exception.occurrence_date).length>0);
    const exdates=exceptions.filter(exception=>exception.cancelled).map(exception=>dateProperty('EXDATE',event,exception.occurrence_date));
    lines.push(...eventLines(eventAt(event,first),uid,true,undefined,recurrenceLine(event,rule),exdates));
    for(const exception of exceptions){if(exception.cancelled)continue;lines.push(...eventLines(eventAt(event,exception.occurrence_date,exception.patch),uid,true,dateProperty('RECURRENCE-ID',event,exception.occurrence_date)));}
  }
  lines.push('END:VCALENDAR');return lines.map(foldIcsLine).join('\r\n')+'\r\n';
}
