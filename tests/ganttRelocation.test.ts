import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createTask,projectProgress} from '../src/features/gantt/domain.ts';
import {relocateTask, CrossingPredecessorError} from '../src/features/gantt/relocation.ts';
const project=()=>createProject('일정',crypto.randomUUID(),'owner');
test('reordering a group keeps its subtree intact and puts a later sibling before that subtree',()=>{
 const p=project(),g={...createTask('그룹2'),kind:'group' as const},a={...createTask('작업1'),parentId:g.id},nested={...createTask('그룹2a'),kind:'group' as const,parentId:g.id,sortOrder:1},child={...createTask('하위작업'),parentId:nested.id},b={...createTask('작업2'),parentId:g.id,sortOrder:2};p.tasks=[g,a,nested,child,b];
 const result=relocateTask(p,b.id,p,nested.id,'before');
 const siblings=result.targetProject.tasks.filter(t=>t.parentId===g.id).sort((a,b)=>a.sortOrder-b.sortOrder);
 assert.deepEqual(siblings.map(t=>t.id),[a.id,b.id,nested.id]);assert.equal(result.targetProject.tasks.find(t=>t.id===child.id)?.parentId,nested.id);assert.strictEqual(result.sourceProject,result.targetProject);
 assert.throws(()=>relocateTask(p,g.id,p,nested.id,'inside'),/하위|자신/);assert.equal(p.tasks.at(-1)?.sortOrder,2);
});
test('cross-project move preserves IDs, internal dependencies and calendar links, with explicit external dependency clearing',()=>{
 const s=project(),t=project(),g={...createTask('그룹'),kind:'group' as const},a={...createTask('A'),parentId:g.id,calendarId:crypto.randomUUID()},b={...createTask('B'),parentId:g.id,predecessorId:a.id},c={...createTask('외부'),predecessorId:b.id};s.tasks=[g,a,b,c];
 assert.throws(()=>relocateTask(s,g.id,t,null,'inside'),CrossingPredecessorError);
 const result=relocateTask(s,g.id,t,null,'inside',{clearCrossingPredecessors:true});assert.equal(result.crossingPredecessorCount,1);assert.equal(result.sourceProject.tasks[0].predecessorId,null);assert.deepEqual(result.targetProject.tasks.map(t=>t.id),[g.id,a.id,b.id]);assert.equal(result.targetProject.tasks[2].predecessorId,a.id);assert.equal(result.targetProject.tasks[1].calendarId,a.calendarId);
});
test('invalid targets, ID collision and completed projects cannot accept a move',()=>{
 const s=project(),t=project(),a=createTask('A');s.tasks=[a];t.tasks=[structuredClone(a)];
 assert.throws(()=>relocateTask(s,a.id,t,null,'inside'),/중복/);t.tasks=[];t.completed=true;assert.throws(()=>relocateTask(s,a.id,t,null,'inside'),/완료/);t.completed=false;assert.throws(()=>relocateTask(s,a.id,t,'missing','before'),/대상/);
});
test('project progress counts nested leaves and empty groups exactly once',()=>{
 const p=project(),g={...createTask('G'),kind:'group' as const},a={...createTask('A'),parentId:g.id,progress:100},b={...createTask('B'),progress:50},empty={...createTask('empty'),kind:'group' as const,parentId:g.id};p.tasks=[g,a,b,empty];assert.equal(projectProgress(p),50);assert.equal(projectProgress(project()),0);assert.equal(projectProgress({...project(),completed:true}),100);
});
test('inside placement preserves completed work and reschedules automatic leaves against the new group constraint',()=>{
 const p=project(),earlier={...createTask('선행','2026-09-05'),endDate:'2026-09-09'},g={...createTask('제약 그룹'),kind:'group' as const,mode:'auto' as const,predecessorId:earlier.id},done={...createTask('완료','2026-09-05'),progress:100,completed:true,mode:'auto' as const};p.tasks=[earlier,g,done];
 const result=relocateTask(p,done.id,p,g.id,'inside').targetProject,t=result.tasks.find(t=>t.id===done.id)!;assert.equal(t.parentId,g.id);assert.equal(t.startDate,'2026-09-10');assert.equal(t.completed,true);assert.equal(result.tasks.find(t=>t.id===g.id)?.progress,100);
});
