import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, createProject, createSpace, durationLabel, updateTask, completeTasks, taskBounds, resolveTaskColor, validateProject, applyCommand, visibleSnapshot, taskConflicts } from '../src/features/gantt/domain.ts';

test('duration includes weekends and both dates, timed elapsed and milestone zero',()=>{
 const t=createTask('교육','2026-09-04');t.endDate='2026-09-07';assert.equal(durationLabel(t),'4일');
 Object.assign(t,{allDay:false,startTime:'10:00',endTime:'14:30',endDate:t.startDate});assert.equal(durationLabel(t),'4시간 30분');
 t.kind='milestone';assert.equal(durationLabel(t),'0일');
});
test('auto chain follows finish while manual successor stays fixed; group colors and completion inherit',()=>{
 const p=createProject('p',crypto.randomUUID(),'u'); const group=createTask('그룹','2026-09-04');group.kind='group';group.color='#123456';
 const a=createTask('a','2026-09-04');a.parentId=group.id;const b=createTask('b','2026-09-05');b.mode='auto';b.predecessorId=a.id;
 p.tasks=[group,a,b];const next=updateTask(p,a.id,{endDate:'2026-09-07'});assert.equal(next.tasks[2].startDate,'2026-09-08');assert.equal(p.tasks[2].startDate,'2026-09-05');
 assert.equal(resolveTaskColor(p,a),'#123456');assert.equal(taskBounds(next,group.id)?.endDate,'2026-09-07');
 assert.ok(completeTasks(next,[group.id],true).tasks.slice(0,2).every(t=>t.completed));
 const manual=updateTask(next,b.id,{mode:'manual',startDate:'2026-09-05',endDate:'2026-09-05'});assert.equal(manual.tasks[2].startDate,'2026-09-05');
});
test('rejects dependency, hierarchy cycles and invalid dates/colors',()=>{
 const p=createProject('p',crypto.randomUUID(),'u');const a=createTask('a','2026-09-04'),b=createTask('b','2026-09-05');p.tasks=[a,b];a.predecessorId=b.id;b.predecessorId=a.id;
 assert.throws(()=>validateProject(p),/순환/);b.predecessorId=null;a.predecessorId=null;a.startDate='2026-02-30';assert.throws(()=>validateProject(p),/날짜/);
  a.startDate='2026-09-04';a.color='red';assert.throws(()=>validateProject(p),/색상/);
  a.color=null;a.kind='group';b.kind='group';a.parentId=b.id;b.parentId=a.id;assert.throws(()=>validateProject(p),/순환/);
});
test('timed auto successors preserve elapsed duration across midnight and manual conflicts remain visible',()=>{
 const p=createProject('시간',crypto.randomUUID(),'u'),a=createTask('a','2026-09-04'),b=createTask('b','2026-09-04');
 Object.assign(a,{allDay:false,startTime:'10:00',endTime:'12:00'});Object.assign(b,{allDay:false,startTime:'12:00',endTime:'16:00',mode:'auto',predecessorId:a.id});p.tasks=[a,b];
 const next=updateTask(p,a.id,{endTime:'22:00'});assert.equal(next.tasks[1].startTime,'22:00');assert.equal(next.tasks[1].endDate,'2026-09-05');assert.equal(next.tasks[1].endTime,'02:00');
});
test('command ACL and CAS prevent forbidden writes and cross-folder restriction broadening',()=>{
 const s=createSpace('팀','owner');s.shared=true;s.members=[{userId:'editor',canEdit:true},{userId:'viewer',canEdit:false}];
 const p=createProject('프로젝트',s.id,'owner');const snapshot={spaces:[s],projects:[p]};
 assert.throws(()=>applyCommand(snapshot,'viewer',{type:'saveProject',project:p,expectedRevision:1}),/권한/);
 assert.throws(()=>applyCommand(snapshot,'editor',{type:'saveProject',project:p,expectedRevision:2}),/변경/);
 const next=applyCommand(snapshot,'editor',{type:'saveProject',project:{...p,name:'변경'},expectedRevision:1});assert.equal(next.projects[0].revision,2);assert.equal(p.name,'프로젝트');
 assert.throws(()=>applyCommand(snapshot,'owner',{type:'saveProject',project:{...p,memberIds:['outsider']},expectedRevision:1}),/멤버/);
 assert.equal(visibleSnapshot(snapshot,'outsider').projects.length,0);
});
test('manual progress synchronizes completion and reopening also reopens project',()=>{
 const p=createProject('진행',crypto.randomUUID(),'u'),t=createTask('작업','2026-09-04');p.tasks=[t];
 const done=updateTask(p,t.id,{progress:100});assert.equal(done.tasks[0].completed,true);assert.equal(p.tasks[0].completed,false);
 done.completed=true;const reopened=updateTask(done,t.id,{progress:50});assert.equal(reopened.tasks[0].completed,false);assert.equal(reopened.completed,false);
});
test('explicit completion and reopen override scene-derived progress without losing scene links',()=>{
 const p=createProject('교육',crypto.randomUUID(),'u'),g=createTask('그룹','2026-09-04'),t=createTask('씬','2026-09-04');g.kind='group';t.parentId=g.id;t.progressMode='scenes';t.sceneLinks=[{episodeNumber:1,sheetName:'EP1',sceneId:'1',department:'bg'}];p.tasks=[g,t];p.completed=true;
 const done=completeTasks(p,[g.id],true);assert.equal(done.tasks[1].progressMode,'manual');assert.equal(done.tasks[1].progress,100);assert.deepEqual(done.tasks[1].sceneLinks,t.sceneLinks);
 const reopened=completeTasks(done,[g.id],false);assert.equal(reopened.completed,false);assert.ok(reopened.tasks.every(t=>!t.completed&&t.progress===0));
});
test('automatic group constraints move only automatic children and leave manual dates fixed',()=>{
 const p=createProject('혼합',crypto.randomUUID(),'u'),pred=createTask('선행','2026-09-01'),g=createTask('그룹','2026-09-02'),manual=createTask('고정','2026-09-02'),auto=createTask('자동','2026-09-03');
 Object.assign(g,{kind:'group',mode:'auto',predecessorId:pred.id});manual.parentId=g.id;Object.assign(auto,{parentId:g.id,mode:'auto'});p.tasks=[pred,g,manual,auto];
 const next=updateTask(p,pred.id,{endDate:'2026-09-05'});assert.equal(next.tasks[2].startDate,'2026-09-02');assert.equal(next.tasks[3].startDate,'2026-09-06');assert.ok(taskConflicts(next).some(c=>c.id===g.id));
 assert.equal(taskBounds(next,g.id)?.startDate,'2026-09-02');
 // Repeated unrelated edits must not repeatedly shift children.
 assert.equal(updateTask(next,pred.id,{memo:'메모'}).tasks[3].startDate,'2026-09-06');
});
test('indirect dependency through an ancestor group is rejected even in manual mode',()=>{
 const p=createProject('순환',crypto.randomUUID(),'u'),g=createTask('그룹','2026-09-01'),a=createTask('자식','2026-09-01'),b=createTask('외부','2026-09-02');g.kind='group';a.parentId=g.id;g.predecessorId=b.id;b.predecessorId=a.id;p.tasks=[g,a,b];
 assert.throws(()=>validateProject(p),/순환/);
});
test('editing an existing project or space preserves its index while new entries append',()=>{
 const a=createSpace('A','u'),b=createSpace('B','u'),c=createSpace('C','u');
 const p=createProject('P',a.id,'u'),q=createProject('Q',a.id,'u'),r=createProject('R',a.id,'u');
 const original={spaces:[a,b],projects:[p,q]};
 const edited=applyCommand(original,'u',{type:'saveProject',project:{...p,tasks:[createTask('추가 작업','2026-09-05')]},expectedRevision:1});
 assert.deepEqual(edited.projects.map(x=>x.id),[p.id,q.id]);assert.equal(edited.projects[0].tasks.length,1);
 const renamed=applyCommand(edited,'u',{type:'saveSpace',space:{...a,name:'수정 A'},expectedRevision:1});assert.deepEqual(renamed.spaces.map(x=>x.id),[a.id,b.id]);
 const appended=applyCommand(applyCommand(renamed,'u',{type:'saveSpace',space:c,expectedRevision:null}),'u',{type:'saveProject',project:r,expectedRevision:null});
 assert.deepEqual(appended.spaces.map(x=>x.id),[a.id,b.id,c.id]);assert.deepEqual(appended.projects.map(x=>x.id),[p.id,q.id,r.id]);
 assert.equal(original.projects[0].tasks.length,0);
});
test('empty groups and projects containing only empty groups have no derived bounds',()=>{
 const p=createProject('빈 그룹',crypto.randomUUID(),'u'),outer=createTask('상위 그룹','2026-09-05'),inner=createTask('하위 그룹','2026-09-06');
 outer.kind='group';outer.endDate='2026-09-07';inner.kind='group';inner.parentId=outer.id;p.tasks=[outer,inner];
 assert.equal(taskBounds(p,outer.id),null);assert.equal(taskBounds(p,inner.id),null);assert.equal(taskBounds(p),null);
 const leaf=createTask('작업','2026-09-08');leaf.parentId=inner.id;p.tasks.push(leaf);assert.equal(taskBounds(p,outer.id)?.startDate,'2026-09-08');assert.equal(taskBounds(p,leaf.id)?.endDate,'2026-09-08');
 leaf.kind='milestone';assert.equal(taskBounds(p,leaf.id)?.startDate,'2026-09-08');
});
test('an empty predecessor group supplies no schedule date or conflict until it has a leaf',()=>{
 const p=createProject('빈 선행',crypto.randomUUID(),'u'),g=createTask('아직 빈 그룹','2026-09-01'),t=createTask('후속','2026-09-05');
 g.kind='group';g.endDate='2026-09-20';Object.assign(t,{mode:'auto',predecessorId:g.id});p.tasks=[g,t];
 const same=updateTask(p,t.id,{memo:'메모'});assert.equal(same.tasks[1].startDate,'2026-09-05');assert.deepEqual(taskConflicts(same),[]);
 const child=createTask('실제 선행','2026-09-07');child.parentId=g.id;same.tasks.push(child);const scheduled=updateTask(same,child.id,{endDate:'2026-09-08'});assert.equal(scheduled.tasks[1].startDate,'2026-09-09');
});
