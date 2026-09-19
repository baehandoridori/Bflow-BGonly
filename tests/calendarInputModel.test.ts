import assert from 'node:assert/strict';
import test from 'node:test';
import { addCalendarDuration, calendarGridKey, calendarMonthDays, calendarPopoverPosition, normalizeCalendarDate, normalizeCalendarTime, selectCalendarRange, shiftCalendarMonth } from '../src/components/calendar/inputs/calendarInputModel.ts';

test('typed calendar dates validate leap years and normalize compact input', () => {
 assert.equal(normalizeCalendarDate('20240229'),'2024-02-29');assert.equal(normalizeCalendarDate('2026.9.2'),'2026-09-02');
 for(const value of ['2023-02-29','1900-02-29','2026-04-31','2026-13-01','2026-02-',''])assert.equal(normalizeCalendarDate(value),null,value);
 assert.equal(normalizeCalendarDate('2000-02-29'),'2000-02-29');
});
test('calendar keyboard navigation crosses months and years without DST drift', () => {
 assert.equal(calendarGridKey('2026-12-31','ArrowRight'),'2027-01-01');assert.equal(calendarGridKey('2024-02-29','PageDown',true),'2025-02-28');
 assert.equal(shiftCalendarMonth('2026-01-31',1),'2026-02-28');assert.equal(calendarGridKey('2026-09-16','Home'),'2026-09-13');assert.equal(calendarGridKey('2026-09-16','End'),'2026-09-19');
 const days=calendarMonthDays('2026-02-01');assert.equal(days.length,42);assert.equal(days[0],'2026-02-01');assert.equal(days.at(-1),'2026-03-14');
});
test('range selection is inclusive and milestone mode always keeps the same day', () => {
 assert.deepEqual(selectCalendarRange({startDate:'2026-09-20',endDate:'2026-09-22'},'2026-09-18','end'),{startDate:'2026-09-18',endDate:'2026-09-20'});
 assert.deepEqual(selectCalendarRange({startDate:'2026-09-20',endDate:'2026-09-22'},'2026-09-25','start'),{startDate:'2026-09-25',endDate:'2026-09-25'});
 assert.deepEqual(selectCalendarRange({startDate:'2026-09-20',endDate:'2026-09-22'},'2026-09-18','start',true),{startDate:'2026-09-18',endDate:'2026-09-18'});
});
test('time drafts accept 24 hour shorthand and arbitrary minutes without accepting incomplete edits', () => {
 for(const [value,expected] of [['930','09:30'],['1430','14:30'],['9:07','09:07'],['2359','23:59'],['000','00:00']])assert.equal(normalizeCalendarTime(value),expected);
 for(const value of ['9','23','24:00','9:3','2360','-100','12:'])assert.equal(normalizeCalendarTime(value),null,value);
 assert.equal(normalizeCalendarTime('9',true),'09:00');
});
test('duration shortcuts cross midnight, leap day and year boundaries exactly', () => {
 assert.deepEqual(addCalendarDuration('2026-12-31','23:45',30),{endDate:'2027-01-01',endTime:'00:15'});
 assert.deepEqual(addCalendarDuration('2024-02-28','23:30',120),{endDate:'2024-02-29',endTime:'01:30'});
 assert.deepEqual(addCalendarDuration('2026-09-20','09:07',60),{endDate:'2026-09-20',endTime:'10:07'});assert.equal(addCalendarDuration('2026-09-20','9:',30),null);
});
test('calendar popover stays within viewport and opens upward near the bottom', () => {
 const position=calendarPopoverPosition({left:750,top:540,bottom:580,width:180},{width:800,height:600},324,410);
 assert.ok(position.left>=8&&position.left+position.width<=792);assert.ok(position.top>=8&&position.top+position.maxHeight<=592);assert.ok(position.top<540);
 const small=calendarPopoverPosition({left:20,top:50,bottom:90,width:100},{width:280,height:220},324,410);assert.ok(small.width<=264);assert.ok(small.top+small.maxHeight<=212);
});

test('centered date popover uses available viewport height without hiding shortcuts', () => {
 const position=calendarPopoverPosition({left:1186,top:400,bottom:421,width:180},{width:1418,height:802},324,520);
 assert.equal(position.maxHeight,520);assert.equal(position.top,274);
 assert.ok(position.left+position.width<=1410);assert.equal(position.top+position.maxHeight,794);
 const short=calendarPopoverPosition({left:20,top:100,bottom:140,width:180},{width:400,height:300},324,520);
 assert.equal(short.maxHeight,284);assert.equal(short.top,8);
 const timeBelow=calendarPopoverPosition({left:20,top:100,bottom:140,width:180},{width:800,height:802},180,280);
 assert.equal(timeBelow.top,146);assert.equal(timeBelow.maxHeight,280);
 const timeAbove=calendarPopoverPosition({left:20,top:650,bottom:690,width:180},{width:800,height:802},180,280);
 assert.equal(timeAbove.top,364);assert.equal(timeAbove.maxHeight,280);
});
