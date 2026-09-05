import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, createProject, createSpace, durationLabel, updateTask, completeTasks, taskBounds, resolveTaskColor, validateProject, applyCommand, visibleSnapshot, taskConflicts, isTaskComplete, scheduleProject, taskProgress } from '../src/features/gantt/domain.ts';

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

test('removing folder members transfers their projects and prunes access in the same revision change',()=>{
 const s=createSpace('공유','owner');s.shared=true;s.members=[{userId:'removed',canEdit:true},{userId:'remaining',canEdit:true}];
 const p=createProject('이관',s.id,'removed');p.memberIds=['removed','remaining'];p.editorIds=['removed','remaining'];
 const untouched=createProject('유지',s.id,'owner');
 const original={spaces:[s],projects:[p,untouched]};
 const next=applyCommand(original,'owner',{type:'saveSpace',space:{...s,members:s.members.slice(1)},expectedRevision:1});
 assert.equal(next.projects[0].ownerId,'owner');assert.deepEqual(next.projects[0].memberIds,['remaining']);assert.deepEqual(next.projects[0].editorIds,['remaining']);assert.equal(next.projects[0].revision,2);
 assert.equal(next.projects[1].revision,1);assert.equal(visibleSnapshot(next,'removed').projects.length,0);
 assert.doesNotThrow(()=>applyCommand(next,'owner',{type:'saveProject',project:{...next.projects[0],name:'정리 가능'},expectedRevision:2}));
 assert.equal(original.projects[0].ownerId,'removed');
 const privateFolder=applyCommand(original,'owner',{type:'saveSpace',space:{...s,shared:false},expectedRevision:1});
 assert.equal(privateFolder.projects[0].ownerId,'owner');assert.deepEqual(privateFolder.projects[0].memberIds,[]);assert.deepEqual(privateFolder.projects[0].editorIds,[]);assert.equal(visibleSnapshot(privateFolder,'remaining').projects.length,0);
});

test('reopening one child updates completed ancestor groups without resetting sibling work',()=>{
 const p=createProject('완료 후 재개',crypto.randomUUID(),'u'),outer=createTask('상위','2026-09-05'),inner=createTask('하위','2026-09-05'),a=createTask('a','2026-09-05'),b=createTask('b','2026-09-06'),unrelated=createTask('별도 작업','2026-09-07');
 outer.kind=inner.kind='group';inner.parentId=outer.id;a.parentId=b.parentId=inner.id;unrelated.progress=35;unrelated.memo='이 내용은 유지';p.tasks=[outer,inner,a,b,unrelated];
 const done=completeTasks(p,[outer.id],true);done.completed=true;
 const reopened=completeTasks(done,[a.id],false);
 assert.deepEqual(reopened.tasks.map(t=>[t.completed,t.progress]),[[false,50],[false,50],[false,0],[true,100],[false,35]]);
 assert.equal(reopened.completed,false);assert.deepEqual(reopened.tasks[4],unrelated);assert.ok(done.tasks.slice(0,4).every(t=>t.completed));
});

test('all individually completed children complete their group display but do not close the project',()=>{
 const p=createProject('개별 완료',crypto.randomUUID(),'u'),g=createTask('그룹','2026-09-05'),a=createTask('a','2026-09-05'),b=createTask('b','2026-09-06');g.kind='group';a.parentId=b.parentId=g.id;p.tasks=[g,a,b];
 const done=completeTasks(completeTasks(p,[a.id],true),[b.id],true);
 assert.equal(done.tasks[0].completed,true);assert.equal(done.tasks[0].progress,100);assert.equal(done.completed,false);
 const stale=structuredClone(done);stale.tasks[0].completed=false;stale.tasks[0].progress=0;
 assert.equal(isTaskComplete(stale,stale.tasks[0]),true);assert.equal(stale.tasks[0].completed,false);
});

test('empty and nested empty groups use explicit completion until real descendants are added',()=>{
 const p=createProject('빈 그룹',crypto.randomUUID(),'u'),outer=createTask('상위','2026-09-05'),inner=createTask('빈 하위','2026-09-05'),leaf=createTask('완료 작업','2026-09-06');outer.kind=inner.kind='group';inner.parentId=outer.id;leaf.parentId=outer.id;leaf.completed=true;leaf.progress=100;p.tasks=[outer,inner,leaf];
 assert.equal(isTaskComplete(p,inner),false);assert.equal(isTaskComplete(p,outer),false);
 const done=completeTasks(p,[inner.id],true);assert.equal(isTaskComplete(done,done.tasks[1]),true);assert.equal(isTaskComplete(done,done.tasks[0]),true);
 const child=createTask('새 하위 작업','2026-09-07');child.parentId=inner.id;done.tasks.push(child);
 const next=scheduleProject(done);assert.equal(next.tasks[0].completed,false);assert.equal(next.tasks[1].completed,false);assert.equal(isTaskComplete(next,next.tasks[0]),false);
});

test('partial progress and newly added work reopen groups and closed projects while preserving finished siblings',()=>{
 const p=createProject('작업 추가',crypto.randomUUID(),'u'),g=createTask('그룹','2026-09-05'),a=createTask('a','2026-09-05'),b=createTask('b','2026-09-06');g.kind='group';a.parentId=b.parentId=g.id;p.tasks=[g,a,b];
 const done=completeTasks(p,[g.id],true);done.completed=true;
 const changed=updateTask(done,a.id,{progress:40});assert.equal(changed.tasks[0].completed,false);assert.equal(changed.tasks[0].progress,70);assert.equal(changed.completed,false);assert.deepEqual(changed.tasks[2],done.tasks[2]);
 const fresh=createTask('추가','2026-09-07');fresh.parentId=g.id;done.tasks.push(fresh);
 const scheduled=scheduleProject(done);assert.equal(scheduled.completed,false);assert.equal(scheduled.tasks[0].completed,false);assert.equal(scheduled.tasks[0].progress,67);assert.deepEqual(scheduled.tasks[2],done.tasks[2]);
});

test('completion display honors scene-derived leaf values without mutating scene links or original state',()=>{
 const p=createProject('씬 완료 표시',crypto.randomUUID(),'u'),g=createTask('그룹','2026-09-05'),t=createTask('씬 연결','2026-09-05');g.kind='group';t.parentId=g.id;t.progressMode='scenes';t.sceneLinks=[{episodeNumber:1,sheetName:'EP1',sceneId:'1',department:'bg'}];p.tasks=[g,t];
 const effective={...p,tasks:p.tasks.map(row=>row.id===t.id?{...row,completed:true,progress:100}:row)};
 assert.equal(isTaskComplete(p,g),false);assert.equal(isTaskComplete(effective,g),true);assert.equal(p.tasks[1].progressMode,'scenes');assert.equal(p.tasks[1].progress,0);assert.deepEqual(effective.tasks[1].sceneLinks,t.sceneLinks);
});

test('display progress includes empty groups and weights nested terminal work consistently with completion',()=>{
 const p=createProject('진행률 표시',crypto.randomUUID(),'u'),outer=createTask('상위','2026-09-05'),inner=createTask('하위','2026-09-05'),empty=createTask('빈 그룹','2026-09-05'),done=createTask('완료 작업','2026-09-05'),partial=createTask('진행 작업','2026-09-05');
 outer.kind=inner.kind=empty.kind='group';inner.parentId=partial.parentId=outer.id;empty.parentId=done.parentId=inner.id;done.completed=true;done.progress=100;partial.progress=40;p.tasks=[outer,inner,empty,done,partial];
 assert.equal(taskProgress(p,inner),50);assert.equal(taskProgress(p,outer),47);
 assert.equal(taskProgress(p,empty),0);assert.equal(taskProgress(p,done),100);assert.equal(taskProgress(p,partial),40);
 assert.equal(isTaskComplete(p,inner),false);assert.equal(inner.progress,0,'reading derived progress must not rewrite the snapshot');
});

test('display progress follows effective scene progress while the stored task and scene links remain unchanged',()=>{
 const p=createProject('씬 진행률',crypto.randomUUID(),'u'),g=createTask('그룹','2026-09-05'),t=createTask('씬','2026-09-05');g.kind='group';t.parentId=g.id;t.progressMode='scenes';t.sceneLinks=[{episodeNumber:1,sheetName:'EP1',sceneId:'1',department:'bg'}];p.tasks=[g,t];
 const effective={...p,tasks:[g,{...t,progress:100,completed:true}]};
 assert.equal(taskProgress(p,g),0);assert.equal(taskProgress(effective,g),100);assert.equal(taskProgress(effective,effective.tasks[1]),100);
 assert.equal(t.progress,0);assert.equal(t.progressMode,'scenes');assert.equal(t.sceneLinks.length,1);
});
