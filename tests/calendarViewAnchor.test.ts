import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarViewAnchor } from '../src/utils/calendarViewAnchor.ts';
import { addDays, fmtDate, parseDate } from '../src/utils/calendarDate.ts';

const base={year:2026,month:9,activeDayIndex:248,now:parseDate('2026-09-06')};
test('browsing another month then changing mode keeps that month instead of the current week',()=>{
  assert.equal(fmtDate(calendarViewAnchor({...base,mode:'month'})),'2026-10-01');
  assert.equal(fmtDate(calendarViewAnchor({...base,mode:'month',focusedDate:'2026-10-24'})),'2026-10-24');
  assert.equal(fmtDate(calendarViewAnchor({...base,mode:'month',focusedDate:'2026-09-24',previousAnchor:'2026-09-24'})),'2026-10-01');
});
test('day and weekly mode retain their selected date through month and year boundaries',()=>{
  assert.equal(fmtDate(calendarViewAnchor({...base,mode:'today',year:2024,activeDayIndex:59})),'2024-02-29');
  const weekDays=Array.from({length:7},(_,i)=>addDays(parseDate('2026-12-27'),i));
  assert.equal(fmtDate(calendarViewAnchor({...base,mode:'week',weekDays})),'2026-12-31');
  assert.equal(fmtDate(calendarViewAnchor({...base,mode:'2week',weekDays,previousAnchor:'2027-01-01'})),'2027-01-01');
  assert.equal(fmtDate(calendarViewAnchor({...base,mode:'week',weekDays,previousAnchor:'2026-09-06'})),'2026-12-31');
});
test('the current month starts at today unless an explicit date is already selected',()=>{
  assert.equal(fmtDate(calendarViewAnchor({...base,mode:'month',month:8})),'2026-09-06');
  assert.equal(fmtDate(calendarViewAnchor({...base,mode:'month',month:8,previousAnchor:'2026-09-22'})),'2026-09-22');
});
