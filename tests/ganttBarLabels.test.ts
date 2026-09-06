import assert from 'node:assert/strict';
import test from 'node:test';
import {createTask} from '../src/features/gantt/domain.ts';
import {compactDuration,remainingDaysLabel,millisecondsUntilMidnight,readDisplayOptions} from '../src/features/gantt/barLabels.ts';

test('compact durations retain inclusive days, leap dates, minute precision and zero milestones',()=>{
  const task=createTask('기간','2024-02-28');task.endDate='2024-03-01';assert.equal(compactDuration(task),'3d');task.endDate='2024-03-31';assert.equal(compactDuration(task),'33d');
  task.allDay=false;task.startTime='23:30';task.endDate='2024-03-01';task.endTime='01:05';assert.equal(compactDuration(task),'1d 1h 35min');task.kind='milestone';assert.equal(compactDuration(task),'0d');
});
test('remaining dates use local calendar days rather than inclusive duration',()=>{
  assert.equal(remainingDaysLabel('2026-09-12','2026-09-07'),'5일 남음');assert.equal(remainingDaysLabel('2026-09-07','2026-09-07'),'오늘 마감');assert.equal(remainingDaysLabel('2026-09-04','2026-09-07'),'3일 지남');
});
test('next local midnight recalculates from the calendar and corrupted preferences use defaults',()=>{
  assert.equal(millisecondsUntilMidnight(new Date(2026,8,6,23,59,59)),1000);assert.equal(millisecondsUntilMidnight(new Date(2026,8,7,0,0,0)),86400000);
  assert.deepEqual(readDisplayOptions(null),{todayLine:true,remainingDays:false});assert.deepEqual(readDisplayOptions('{'),{todayLine:true,remainingDays:false});assert.deepEqual(readDisplayOptions('{"todayLine":false,"remainingDays":true,"tasks":[]}'),{todayLine:false,remainingDays:true});
  assert.deepEqual(readDisplayOptions('{"todayLine":"false","remainingDays":1}'),{todayLine:true,remainingDays:false});
});
