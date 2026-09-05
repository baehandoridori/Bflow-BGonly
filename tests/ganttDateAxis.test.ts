import assert from 'node:assert/strict';
import test from 'node:test';
import { isoWeek, monthStart, navigationRange, weekBands } from '../src/features/gantt/dateAxis.ts';

test('ISO weeks use the week year across December and January, including 53-week years',()=>{
  for(const [date,year,week] of [
    ['2020-12-28',2020,53],['2021-01-01',2020,53],['2021-01-03',2020,53],
    ['2021-01-04',2021,1],['2024-12-29',2024,52],['2024-12-30',2025,1],['2025-01-05',2025,1],
  ] as const)assert.deepEqual(isoWeek(date),{year,week},date);
});

test('previous and next month always land on its first day through leap days and year boundaries',()=>{
  assert.equal(monthStart('2024-03-31',-1),'2024-02-01');
  assert.equal(monthStart('2024-02-29',1),'2024-03-01');
  assert.equal(monthStart('2026-12-31',1),'2027-01-01');
  assert.equal(monthStart('2027-01-01',-1),'2026-12-01');
});

test('week bands align exactly to day cells and retain truncated weeks at both ends',()=>{
  const bands=weekBands('2024-12-27',12);
  assert.deepEqual(bands.map(({offset,days,year,week})=>({offset,days,year,week})),[
    {offset:0,days:3,year:2024,week:52},{offset:3,days:7,year:2025,week:1},{offset:10,days:2,year:2025,week:2},
  ]);
  assert.equal(bands.reduce((sum,band)=>sum+band.days,0),12);
  assert.equal(bands[1].start,'2024-12-30');
  assert.equal(bands[1].end,'2025-01-05');
});

test('navigation grows both ends without shrinking existing work or losing the requested day',()=>{
  const previous=navigationRange('2026-08-30','2026-10-31','2025-12-01',48,540,'start');
  assert.ok(previous.base<'2025-12-01');assert.equal(previous.end,'2026-10-31');
  assert.equal(Date.parse(previous.base)+previous.scrollLeft/48*86400000,Date.parse('2025-12-01'));
  const next=navigationRange(previous.base,previous.end,'2027-03-15',12,820,'center');
  assert.equal(next.base,previous.base);assert.ok(next.end>'2027-04-15');
  assert.equal(Date.parse(next.base)+(next.scrollLeft+410)/12*86400000,Date.parse('2027-03-15')+43200000);
});
