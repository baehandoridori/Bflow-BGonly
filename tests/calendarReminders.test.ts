import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['src/shared/calendarReminders.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { dueCalendarReminders, claimCalendarReminders } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const event = { id:'event',calendarId:'calendar',title:'회의',memo:'',color:'#fff',type:'custom',createdBy:'user',createdAt:'2026-09-20',startDate:'2026-09-20',endDate:'2026-09-20',allDay:false,startTime:'10:00',endTime:'11:00',reminderMinutes:15 };
test('timed reminders use KST, not host timezone, with exact boundary and 30 minute catchup',()=>{
 const due=Date.parse('2026-09-20T00:45:00Z');
 assert.equal(dueCalendarReminders([event],due-1).length,0);
 assert.equal(dueCalendarReminders([event],due).length,1);
 assert.equal(dueCalendarReminders([event],due+1800000).length,1);
 assert.equal(dueCalendarReminders([event],due+1800001).length,0);
});
test('all day reminders use 09:00 KST; muted and disabled reminders stay silent',()=>{
 const now=Date.parse('2026-09-20T00:00:00Z'),allDay={...event,allDay:true,reminderMinutes:0};
 assert.equal(dueCalendarReminders([allDay],now).length,1);
 assert.equal(dueCalendarReminders([allDay],now,['calendar']).length,0);
 assert.equal(dueCalendarReminders([{...allDay,reminderMinutes:null}],now).length,0);
});
test('recurrence exception cancel and moved times determine actual alarm',()=>{
 const series={...event,recurrenceRule:{frequency:'daily',interval:1,count:3},recurrenceExceptions:[{occurrenceDate:'2026-09-21',cancelled:true},{occurrenceDate:'2026-09-22',cancelled:false,patch:{startTime:'14:00'}}]};
 assert.equal(dueCalendarReminders([series],Date.parse('2026-09-21T00:45:00Z')).length,0);
 const due=dueCalendarReminders([series],Date.parse('2026-09-22T04:45:00Z'));
 assert.equal(due.length,1);assert.match(due[0].key,/event\|2026-09-22/);
});
test('an exception can enable a reminder when its master has reminders off',()=>{
 const series={...event,reminderMinutes:null,recurrenceRule:{frequency:'daily',interval:1,count:3},recurrenceExceptions:[{occurrenceDate:'2026-09-21',cancelled:false,patch:{reminderMinutes:15}}]};
 assert.equal(dueCalendarReminders([series],Date.parse('2026-09-21T00:45:00Z')).length,1);
 assert.equal(dueCalendarReminders([series],Date.parse('2026-09-22T00:45:00Z')).length,0);
});
test('claim ledger survives restart, ignores title changes, isolates changed alarm times, expires old entries',()=>{
 const now=Date.parse('2026-09-20T00:45:00Z'),ledger={'old':now-33*86400000};
 const due=dueCalendarReminders([event],now);
 assert.equal(claimCalendarReminders(due,ledger,now).length,1);assert.equal('old' in ledger,false);
 assert.equal(claimCalendarReminders(dueCalendarReminders([{...event,title:'제목 변경'}],now),JSON.parse(JSON.stringify(ledger)),now).length,0);
 assert.equal(claimCalendarReminders(due,{},now).length,1);
});
