import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeCalendarIcs, foldIcsLine, type CalendarFeed } from '../supabase/functions/_shared/calendarIcs.ts';
const sample=():CalendarFeed=>({calendar:{id:'c',name:'팀 캘린더',color:'#6C5CE7'},events:[{id:'e',title:'회의, 검토; 확정',memo:'첫 줄\r\n둘째 줄\\끝',all_day:true,start_date:'2026-09-20',end_date:'2026-09-21',start_time:null,end_time:null,created_at:'2026-09-19T01:02:03Z',updated_at:'2026-09-20T01:02:03Z',categories:['기획,회의','업로드']}]});
test('passive subscriptions do not advertise a scheduling METHOD',()=>assert.doesNotMatch(serializeCalendarIcs(sample()),/^METHOD:/m));
test('ICS produces stable UID, escaped text, exclusive all-day end and CRLF',()=>{const feed=sample();const body=serializeCalendarIcs(feed);assert.match(body,/BEGIN:VCALENDAR\r\nVERSION:2.0/);assert.match(body,/DTSTART;VALUE=DATE:20260920\r\nDTEND;VALUE=DATE:20260922/);assert.match(body,/SUMMARY:회의\\, 검토\\; 확정/);assert.match(body,/DESCRIPTION:첫 줄\\n둘째 줄\\\\끝/);assert.match(body,/CATEGORIES:기획\\,회의,업로드/);assert.match(body,/DTSTAMP:20260920T010203Z/);assert.match(body,/LAST-MODIFIED:20260920T010203Z/);assert.equal(body.replace(/\r\n/g,'' ).includes('\n'),false);const uid=body.match(/UID:([^\r]+)/)![1];feed.events[0].title='변경';assert.equal(serializeCalendarIcs(feed).match(/UID:([^\r]+)/)![1],uid);});
test('Seoul timed dates convert to UTC across midnight and year boundaries',()=>{const feed=sample();Object.assign(feed.events[0],{all_day:false,start_date:'2027-01-01',end_date:'2027-01-01',start_time:'00:30',end_time:'10:00'});assert.match(serializeCalendarIcs(feed),/DTSTART:20261231T153000Z\r\nDTEND:20270101T010000Z/);});
test('UTF8 folds at75 octets including continuation without breaking Korean or emoji',()=>{const source='SUMMARY:'+('한글😀'.repeat(60));const folded=foldIcsLine(source);for(const line of folded.split('\r\n'))assert.ok(new TextEncoder().encode(line).length<=75);assert.equal(folded.replace(/\r\n /g,''),source);assert.equal(folded.includes('\ufffd'),false);});
test('property injection remains escaped text and deleted events disappear entirely',()=>{const feed=sample();feed.events[0].title='정상\r\nEND:VEVENT\r\nBEGIN:VEVENT';const body=serializeCalendarIcs(feed);assert.equal(body.match(/\r\nBEGIN:VEVENT\r\n/g)?.length,1);feed.events=[];assert.equal(serializeCalendarIcs(feed).includes('BEGIN:VEVENT'),false);});
test('invalid dates and incomplete timed data fail closed instead of emitting corrupt calendars',()=>{for(const patch of [{start_date:'2026-02-30'},{all_day:false,start_time:null},{all_day:false,start_time:'25:00',end_time:'26:00'},{end_date:'2026-09-19'}]){const feed=sample();Object.assign(feed.events[0],patch);assert.throws(()=>serializeCalendarIcs(feed));}});

test('timed recurrence uses Seoul wall time and correct weekday instead of UTC weekday drift',()=>{
 const feed=sample();Object.assign(feed.events[0],{all_day:false,start_date:'2026-09-21',end_date:'2026-09-21',start_time:'00:30',end_time:'01:00',recurrence_rule:{frequency:'weekly',interval:2,weekdays:[1],count:3},recurrence_revision:4});
 const body=serializeCalendarIcs(feed);assert.match(body,/BEGIN:VTIMEZONE\r\nTZID:Asia\/Seoul/);assert.match(body,/DTSTART;TZID=Asia\/Seoul:20260921T003000/);assert.match(body,/RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=MO;COUNT=3/);assert.match(body,/SEQUENCE:4/);
});
test('nonmatching anchor shifts ICS DTSTART to first actual occurrence preserving the recurrence interval',()=>{
 const feed=sample();Object.assign(feed.events[0],{start_date:'2026-09-22',end_date:'2026-09-23',recurrence_rule:{frequency:'weekly',interval:2,weekdays:[1],count:2}});
 const body=serializeCalendarIcs(feed);assert.match(body,/DTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261007/);assert.match(body,/BYDAY=MO;COUNT=2/);
});
test('snake-case exceptions serialize cancellation and moved override with original recurrence identity',()=>{
 const feed=sample();Object.assign(feed.events[0],{recurrence_rule:{frequency:'daily',interval:1,count:4},recurrence_exceptions:[{occurrence_date:'2026-09-21',cancelled:true,patch:{}},{occurrence_date:'2026-09-22',cancelled:false,patch:{title:'변경',start_date:'2026-10-01',end_date:'2026-10-02',location:'회의실, A',meeting_url:'https://example.com/meet',reminder_minutes:30}}]});
 const body=serializeCalendarIcs(feed);assert.match(body,/EXDATE;VALUE=DATE:20260921/);assert.match(body,/RECURRENCE-ID;VALUE=DATE:20260922/);assert.match(body,/DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261003/);assert.match(body,/LOCATION:회의실\\, A/);assert.match(body,/URL:https:\/\/example.com\/meet/);const uids=body.match(/^UID:.+$/gm);assert.equal(uids?.length,2);assert.equal(uids?.[0],uids?.[1]);
});
test('monthly rule modes and timed UNTIL use the original local calendar date',()=>{
 for(const [fields,expected] of [[{monthlyMode:'lastDay'},'BYMONTHDAY=-1'],[{monthlyMode:'weekday',ordinal:-1,weekday:5},'BYDAY=-1FR'],[{monthlyMode:'date',monthDay:31},'BYMONTHDAY=31']] as const){const feed=sample();Object.assign(feed.events[0],{recurrence_rule:{frequency:'monthly',interval:1,...fields}});assert.ok(serializeCalendarIcs(feed).includes(expected));}
 const feed=sample();Object.assign(feed.events[0],{all_day:false,start_time:'00:30',end_time:'01:00',recurrence_rule:{frequency:'daily',interval:1,until:'2026-09-23'}});assert.match(serializeCalendarIcs(feed),/UNTIL=20260922T153000Z/);
});
test('reminders serialize timed relative alarms and nonrecurring all-day 09:00 Seoul absolute alarms',()=>{
 const feed=sample();feed.events[0].reminder_minutes=30;assert.match(serializeCalendarIcs(feed),/TRIGGER;VALUE=DATE-TIME:20260919T233000Z/);
 Object.assign(feed.events[0],{all_day:false,start_time:'10:00',end_time:'11:00'});assert.match(serializeCalendarIcs(feed),/TRIGGER:-PT30M/);
 Object.assign(feed.events[0],{all_day:true,recurrence_rule:{frequency:'daily',interval:1,count:2}});assert.match(serializeCalendarIcs(feed),/TRIGGER:PT510M/);
 feed.events[0].reminder_minutes=null;assert.doesNotMatch(serializeCalendarIcs(feed),/BEGIN:VALARM/);
});
