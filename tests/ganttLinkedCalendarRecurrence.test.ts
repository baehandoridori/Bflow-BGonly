import assert from 'node:assert/strict';
import test from 'node:test';
import { expandLinkedCalendarProjects, linkedCalendarVisibleRange } from '../src/features/gantt/linkedCalendarRecurrence.ts';
import { createProject, createTask } from '../src/features/gantt/domain.ts';
test('linked calendar tasks expand only for the current viewport, including distant future navigation',()=>{
 const project=createProject('팀 일정','space','owner');project.calendarLink={calendarId:'calendar',linkId:'link',actorId:'me',visibility:'team',canEdit:true,canUnlink:true,isAdminOverview:false};
 project.tasks=[{...createTask('매주 회의','2026-09-21'),sourceCalendarEventId:'source',recurrenceRule:{frequency:'weekly',interval:1,weekdays:[1]}}];
 const original=JSON.stringify(project),range=linkedCalendarVisibleRange('2035-01-01',480,48),result=expandLinkedCalendarProjects([project],range);
 assert.ok(result[0].tasks.length>0);assert.ok(result[0].tasks.every(task=>task.startDate>=range.from&&task.startDate<=range.to));assert.ok(result[0].tasks.every(task=>task.sourceCalendarEventId===`recurrence:source:${task.startDate}`));
 assert.equal(JSON.stringify(project),original,'canonical snapshot must remain unexpanded');
 const again=expandLinkedCalendarProjects([project],range);assert.deepEqual(again[0].tasks.map(t=>t.id),result[0].tasks.map(t=>t.id));
});
test('ordinary projects remain canonical and moved linked exceptions appear at their new dates',()=>{
 const normal=createProject('일반','space','owner');normal.tasks=[createTask('일반 작업','2020-01-01')];
 const linked={...normal,id:'linked',calendarLink:{calendarId:'calendar',linkId:'link',actorId:'me',visibility:'team' as const,canEdit:false,canUnlink:false,isAdminOverview:false},tasks:[{...createTask('반복','2026-01-01'),sourceCalendarEventId:'source',recurrenceRule:{frequency:'daily' as const,interval:1,count:2},recurrenceExceptions:[{occurrenceDate:'2026-01-02',cancelled:false,patch:{startDate:'2030-01-03',endDate:'2030-01-03',title:'이동'}}]}]};
 const output=expandLinkedCalendarProjects([normal,linked],{from:'2030-01-01',to:'2030-01-07'});assert.equal(output[0],normal);assert.equal(output[1].tasks.length,1);assert.equal(output[1].tasks[0].title,'이동');assert.equal(output[1].tasks[0].sourceCalendarEventId,'recurrence:source:2026-01-02');
});
test('visible range follows scroll date and zoom rather than a fixed calendar horizon',()=>{
 const narrow=linkedCalendarVisibleRange('2026-09-21',480,48),wide=linkedCalendarVisibleRange('2026-09-21',480,12),future=linkedCalendarVisibleRange('2040-09-21',480,48);
 assert.equal(narrow.from,'2026-08-21');assert.ok(wide.to>narrow.to);assert.equal(future.from,'2040-08-21');assert.ok(future.to>'2040-09-21');
});
