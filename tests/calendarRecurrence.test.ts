import assert from 'node:assert/strict';
import test from 'node:test';
import { expandRecurringEvents, getRecurrenceMaster, parseRecurrenceEventId, previewRecurrenceDates, validateCalendarRecurrenceRule } from '../src/shared/calendarRecurrence.ts';

const master = (extra: Record<string, unknown> = {}) => ({id:'11111111-1111-4111-8111-111111111111',title:'회의',startDate:'2026-12-31',endDate:'2027-01-01',allDay:false,startTime:'23:30',endTime:'01:00',recurrenceRule:{frequency:'daily' as const,interval:1,count:3},...extra});
test('daily count counts from series start even when requested window begins later and preserves midnight duration',()=>{
 const event=master(), result=expandRecurringEvents([event],'2027-01-02','2027-01-03');
 assert.deepEqual(result.map(e=>[e.recurrenceDate,e.startDate,e.endDate,e.startTime,e.endTime]),[['2027-01-01','2027-01-01','2027-01-02','23:30','01:00'],['2027-01-02','2027-01-02','2027-01-03','23:30','01:00']]);
 assert.equal(event.id,'11111111-1111-4111-8111-111111111111');assert.equal(result[0].recurrenceSeriesId,event.id);assert.equal(getRecurrenceMaster(result[0],[event]),event);
 assert.deepEqual(parseRecurrenceEventId(result[0].id),{seriesId:event.id,occurrenceDate:'2027-01-01'});assert.equal(parseRecurrenceEventId('gantt:project:task'),null);
});
test('weekly intervals use Monday weeks, dedupe weekdays and begin on first matching day',()=>{
 assert.deepEqual(previewRecurrenceDates('2026-09-22',{frequency:'weekly',interval:2,weekdays:[5,1,1],count:5},8),['2026-09-25','2026-10-05','2026-10-09','2026-10-19','2026-10-23']);
});
test('monthly dates skip nonexistent days without consuming count, yearly leap day skips invalid years',()=>{
 assert.deepEqual(previewRecurrenceDates('2026-01-31',{frequency:'monthly',interval:1,count:4},8),['2026-01-31','2026-03-31','2026-05-31','2026-07-31']);
 assert.deepEqual(previewRecurrenceDates('2024-02-29',{frequency:'yearly',interval:1,count:3},8),['2024-02-29','2028-02-29','2032-02-29']);
});
test('monthly last day and fifth/last weekday rules skip missing occurrences',()=>{
 assert.deepEqual(previewRecurrenceDates('2024-01-20',{frequency:'monthly',interval:1,monthlyMode:'lastDay',count:3}),['2024-01-31','2024-02-29','2024-03-31']);
 assert.deepEqual(previewRecurrenceDates('2026-01-01',{frequency:'monthly',interval:1,monthlyMode:'weekday',ordinal:5,weekday:1,count:3}),['2026-03-30','2026-06-29','2026-08-31']);
 assert.deepEqual(previewRecurrenceDates('2026-01-01',{frequency:'monthly',interval:1,monthlyMode:'weekday',ordinal:-1,weekday:5,count:2}),['2026-01-30','2026-02-27']);
});
test('until is inclusive and rule validation rejects malformed dates, mixed ends and invalid ranges',()=>{
 assert.deepEqual(previewRecurrenceDates('2026-12-30',{frequency:'daily',interval:1,until:'2027-01-01'},10),['2026-12-30','2026-12-31','2027-01-01']);
 for(const rule of [{frequency:'hourly',interval:1},{frequency:'daily',interval:0},{frequency:'daily',interval:100},{frequency:'weekly',interval:1,weekdays:[]},{frequency:'daily',interval:1,until:'2026-02-30'},{frequency:'daily',interval:1,count:0},{frequency:'daily',interval:1,count:1001},{frequency:'daily',interval:1,count:2,until:'2026-12-31'},{frequency:'monthly',interval:1,monthlyMode:'weekday',weekday:7,ordinal:1}]) assert.throws(()=>validateCalendarRecurrenceRule(rule));
});
test('cancelled and moved exceptions retain original keys and cannot override identity or access',()=>{
 const event=master({recurrenceExceptions:[{occurrenceDate:'2027-01-01',cancelled:true},{occurrenceDate:'2027-01-02',cancelled:false,patch:{startDate:'2027-03-01',endDate:'2027-03-02',title:'옮김',id:'bad',canEdit:true}}]});
 const result=expandRecurringEvents([event],'2027-03-01','2027-03-02');assert.equal(result.length,1);assert.equal(result[0].title,'옮김');assert.equal(result[0].recurrenceDate,'2027-01-02');assert.equal(result[0].id,`recurrence:${event.id}:2027-01-02`);assert.equal((result[0] as any).canEdit,undefined);
 assert.equal(expandRecurringEvents([event],'2027-01-02','2027-01-03').length,0);
});
test('future originals moved into the window are included, invalid exception dates do not fabricate instances',()=>{
 const event=master({endDate:'2026-12-31',allDay:true,recurrenceRule:{frequency:'daily',interval:1,count:3},recurrenceExceptions:[{occurrenceDate:'2027-01-02',cancelled:false,patch:{startDate:'2026-01-01',endDate:'2026-01-01'}},{occurrenceDate:'2027-02-01',cancelled:false,patch:{startDate:'2026-01-01',endDate:'2026-01-01'}}]});
 assert.equal(expandRecurringEvents([event],'2026-01-01','2026-01-01').length,1);
});
