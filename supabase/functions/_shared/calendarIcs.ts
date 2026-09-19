/** RFC 5545 subscription serialization shared by the Edge endpoint and offline tests. */
export interface CalendarFeedEvent {
  id:string; title:string; memo:string|null; all_day:boolean;
  start_date:string; end_date:string; start_time:string|null; end_time:string|null;
  created_at:string|null; updated_at:string|null; categories:string[];
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
export function serializeCalendarIcs(feed:CalendarFeed):string {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Studio JBBJ//B flow Calendar//KO','CALSCALE:GREGORIAN',
    'X-WR-CALNAME:'+escapeIcsText(feed.calendar.name),'X-WR-TIMEZONE:Asia/Seoul','REFRESH-INTERVAL;VALUE=DURATION:PT1H','X-PUBLISHED-TTL:PT1H'];
  const seen=new Set<string>();
  for(const event of feed.events){
    if(seen.has(event.id))continue;seen.add(event.id);
    const start=day(event.start_date),end=day(event.end_date);if(end<start)throw new Error('Invalid calendar range');
    const stamp=timestamp(event);
    lines.push('BEGIN:VEVENT','UID:'+encodeURIComponent(feed.calendar.id)+'/'+encodeURIComponent(event.id)+'@calendar.bflow.app','DTSTAMP:'+stamp,'LAST-MODIFIED:'+stamp);
    if(event.all_day){end.setUTCDate(end.getUTCDate()+1);lines.push('DTSTART;VALUE=DATE:'+event.start_date.replace(/-/g,''),'DTEND;VALUE=DATE:'+end.toISOString().slice(0,10).replace(/-/g,''));}
    else {const startAt=seoul(event.start_date,event.start_time),endAt=seoul(event.end_date,event.end_time);if(endAt<startAt)throw new Error('Invalid calendar range');lines.push('DTSTART:'+utc(startAt));if(endAt>startAt)lines.push('DTEND:'+utc(endAt));}
    lines.push('SUMMARY:'+escapeIcsText(event.title));if(event.memo)lines.push('DESCRIPTION:'+escapeIcsText(event.memo));
    if(event.categories.length)lines.push('CATEGORIES:'+event.categories.map(escapeIcsText).join(','));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');return lines.map(foldIcsLine).join('\r\n')+'\r\n';
}
