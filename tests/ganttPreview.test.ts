import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewGateway, listCalendarEvents, patchCalendarEvent, deleteCalendarEvent } from '../src/features/gantt/previewGateway.ts';
import { createProject, createSpace, createTask, shiftTaskSubtree } from '../src/features/gantt/domain.ts';
import { createGanttStore } from '../src/features/gantt/useGanttStore.ts';
import { expandLinkedCalendarProjects } from '../src/features/gantt/linkedCalendarRecurrence.ts';
function setup() {
 const rows=new Map<string,string>();const storage={getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);}};
 let tail=Promise.resolve();const locks={request<T>(_name:string,callback:()=>Promise<T>):Promise<T>{const result=tail.then(callback);tail=result.then(()=>undefined,()=>undefined);return result;}};
 return {storage,locks,seed:false};
}

function linkedCalendarSetup() {
 const memory=setup();
 const calendar={id:crypto.randomUUID(),name:'공유 원본',color:'#5489BB',owner_id:'owner',visibility:'members',members:[{user_id:'editor',can_edit:true},{user_id:'reader',can_edit:false}]};
 const event={id:crypto.randomUUID(),calendar_id:calendar.id,title:'원본 일정',memo:'원본 메모',all_day:false,start_date:'2026-09-17',end_date:'2026-09-18',start_time:'23:00',end_time:'01:30',created_at:'2026-09-17T00:00:00Z',updated_at:'2026-09-17T00:00:00Z'};
 const calendars=[calendar],events=[event];
 const options={...memory,calendars:()=>calendars,calendarEvents:()=>events};
 const gateway=(actor:string)=>createPreviewGateway(actor,options);
 const link=(actor:string,requestId=crypto.randomUUID())=>gateway(actor).execute({requestId,command:{type:'linkCalendar',calendarId:calendar.id}} as any);
 return {memory,calendar,event,calendars,events,options,gateway,link};
}

test('linked calendar reads current native events and sharing without copying authority or reverse projections',async()=>{
 const f=linkedCalendarSetup();
 const initial=await f.link('reader');
 assert.equal(initial.spaces.length,1);assert.equal(initial.projects.length,1);
 const project=initial.projects[0],space=initial.spaces[0];
 assert.equal(project.ownerId,'owner');assert.equal(space.ownerId,'owner');
 assert.equal(project.calendarLink?.canEdit,false);assert.equal(project.calendarLink?.canUnlink,true);
 assert.equal(project.tasks[0].id,f.event.id);assert.equal(project.tasks[0].endDate,'2026-09-18');
 assert.equal(project.tasks[0].endTime,'01:30');assert.equal(project.tasks[0].calendarId,null);
 assert.equal((await f.gateway('outsider').read()).projects.length,0);
 const beforeStorage=f.memory.storage.getItem('bflow-gantt-preview-authority-v1')!;
 assert.equal(beforeStorage.includes('원본 메모'),false,'binding storage does not retain source event payload');
 f.calendar.name='변경한 이름';f.event.title='다른 사용자가 수정';
 f.events.push({...f.event,id:crypto.randomUUID(),title:'추가 일정'});
 let next=(await f.gateway('editor').read()).projects[0];
 assert.equal(next.id,project.id);assert.equal(next.name,'변경한 이름');assert.equal(next.tasks.length,2);
 assert.equal(next.tasks.find(t=>t.id===f.event.id)?.title,'다른 사용자가 수정');
 f.events.splice(0,1);next=(await f.gateway('reader').read()).projects[0];assert.equal(next.tasks.length,1);
 f.calendar.members=f.calendar.members.filter(m=>m.user_id!=='reader');
 assert.equal((await f.gateway('reader').read()).projects.length,0);
 f.calendar.visibility='team';const team=(await f.gateway('new-team-user').read()).projects;
 assert.equal(team.length,1);assert.equal(team[0].calendarLink?.canEdit,false,'team visibility never grants source edit permission');
 assert.deepEqual(await listCalendarEvents('owner',f.options),[],'calendar-backed tasks never project themselves back into the source');
 assert.equal(f.memory.storage.getItem('bflow-gantt-preview-authority-v1'),beforeStorage,'live reads never rewrite source copies');
});

test('calendar binding is atomic across actors, receipts recheck access, and generic mutations cannot replace derived rows',async()=>{
 const f=linkedCalendarSetup();
 const requestId=crypto.randomUUID();
 const [a,b]=await Promise.all([f.link('reader',requestId),f.link('editor')]);
 assert.equal(a.projects[0].id,b.projects[0].id);assert.equal(b.projects.length,1);
 const project=a.projects[0],space=a.spaces[0];
 const strippedProject=structuredClone(project);delete strippedProject.calendarLink;strippedProject.tasks.forEach(t=>{delete t.sourceCalendarEventId;});
 const ordinarySpace=createSpace('일반 폴더','owner'),ordinaryProject=createProject('일반 프로젝트',ordinarySpace.id,'owner');
 await f.gateway('owner').execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:ordinarySpace,expectedRevision:null}});
 await f.gateway('owner').execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:ordinaryProject,expectedRevision:null}});
 for(const command of [
  {type:'saveProject',project:{...project,name:'위조'},expectedRevision:null},
  {type:'saveProject',project:strippedProject,expectedRevision:null},
  {type:'saveSpace',space:{...ordinarySpace,id:project.id},expectedRevision:null},
  {type:'saveProject',project:{...ordinaryProject,id:space.id},expectedRevision:null},
  {type:'saveProject',project:{...ordinaryProject,spaceId:space.id},expectedRevision:1},
  {type:'saveSpace',space:{...space,name:'위조'},expectedRevision:null},
  {type:'saveProjectPair',projects:[{project:strippedProject,expectedRevision:1},{project:ordinaryProject,expectedRevision:1}],expectedSpaces:[{spaceId:space.id,expectedRevision:1},{spaceId:ordinarySpace.id,expectedRevision:1}]},
  {type:'deleteProject',projectId:project.id,expectedRevision:project.revision},
  {type:'deleteSpace',spaceId:space.id,expectedRevision:space.revision},
 ]) await assert.rejects(f.gateway('owner').execute({requestId:crypto.randomUUID(),command} as any),/캘린더|연결/);
 f.calendar.members=[];
 const replay=await f.link('reader',requestId);assert.equal(replay.projects.length,0,'receipt response uses current source access');
 await assert.rejects(f.link('reader'),/권한|캘린더/);
 await assert.rejects(f.gateway('reader').execute({requestId:crypto.randomUUID(),command:{type:'unlinkCalendar',calendarId:f.calendar.id,linkId:project.calendarLink!.linkId}}),/권한/,'creator cannot unlink after source access is revoked');
 assert.equal((await f.gateway('owner').read()).projects.length,2);
});

test('admin overview is actor-scoped and never grants hidden source editing or personal-calendar management',async()=>{
 const f=linkedCalendarSetup();f.calendar.visibility='private';f.calendar.members=[];Object.assign(f.calendar,{is_personal:true});
 const options={...f.options,canViewCalendar:(_id:string,actor:string)=>actor==='owner'||actor==='designated-admin',canManageCalendar:()=>false};
 const owner=createPreviewGateway('owner',options);await owner.execute({requestId:crypto.randomUUID(),command:{type:'linkCalendar',calendarId:f.calendar.id}});
 const admin=createPreviewGateway('designated-admin',options),snapshot=await admin.read();
 assert.equal(snapshot.projects.length,1);assert.equal(snapshot.projects[0].calendarLink?.actorId,'designated-admin');
 assert.equal(snapshot.projects[0].calendarLink?.isAdminOverview,true);assert.equal(snapshot.projects[0].calendarLink?.canEdit,false);assert.equal(snapshot.projects[0].calendarLink?.canUnlink,false);
 assert.equal((await createPreviewGateway('other-admin',options).read()).projects.length,0);
 const command={type:'unlinkCalendar',calendarId:f.calendar.id,linkId:snapshot.projects[0].calendarLink!.linkId} as const;
 await assert.rejects(admin.execute({requestId:crypto.randomUUID(),command}),/권한/);
 assert.equal(snapshot.spaces[0].ownerId,'owner');assert.deepEqual(snapshot.spaces[0].members,[]);
});

test('linked projection excludes Gantt exports and follows source tag colors without ordinary task count limits',async()=>{
 const f=linkedCalendarSetup(),tag={id:crypto.randomUUID(),color:'#DDAA55'};
 Object.assign(f.event,{tag_ids:[tag.id]});
 f.events.push({...f.event,id:`gantt:${crypto.randomUUID()}:${crypto.randomUUID()}`,title:'이미 간트에 있는 작업'});
 for(let index=0;index<3001;index++)f.events.push({...f.event,id:crypto.randomUUID()});
 const gateway=createPreviewGateway('owner',{...f.options,calendarTags:()=>[tag]});
 const result=await gateway.execute({requestId:crypto.randomUUID(),command:{type:'linkCalendar',calendarId:f.calendar.id}});
 assert.equal(result.projects[0].tasks.length,3002);
 assert.equal(result.projects[0].tasks[0].color,tag.color);
 assert.equal(result.projects[0].tasks.some(t=>t.id.startsWith('gantt:')),false);
 tag.color='#BB66AA';assert.equal((await gateway.read()).projects[0].tasks[0].color,tag.color);
});

test('preview linked calendar keeps recurrence metadata, all-day semantics and live exception tag colors',async()=>{
 const f=linkedCalendarSetup(),tag={id:crypto.randomUUID(),color:'#DDAA55'};
 const rule={frequency:'daily' as const,interval:1,count:3};
 Object.assign(f.event,{all_day:true,start_date:'2026-09-17',end_date:'2026-09-17',recurrence_rule:rule,recurrence_revision:7,location:'회의실',meeting_url:'https://example.com/meet',reminder_minutes:30,
  recurrence_exceptions:[{occurrence_date:'2026-09-18',cancelled:true,patch:{}},{occurrence_date:'2026-09-19',cancelled:false,patch:{title:'이동한 회의',start_date:'2026-10-01',end_date:'2026-10-01',tag_ids:[tag.id]}}]});
 const gateway=createPreviewGateway('reader',{...f.options,calendarTags:()=>[tag]});
 const snapshot=await gateway.execute({requestId:crypto.randomUUID(),command:{type:'linkCalendar',calendarId:f.calendar.id}}),task=snapshot.projects[0].tasks[0];
 assert.deepEqual(task.recurrenceRule,rule);assert.equal(task.recurrenceRevision,7);assert.equal(task.allDay,true);assert.equal(task.startTime,'');assert.equal(task.endTime,'');
 assert.equal(task.location,'회의실');assert.equal(task.meetingUrl,'https://example.com/meet');assert.equal(task.reminderMinutes,30);assert.equal(task.recurrenceExceptions?.[1].patch?.color,tag.color);
 const displayed=expandLinkedCalendarProjects(snapshot.projects,{from:'2026-10-01',to:'2026-10-01'});assert.equal(displayed[0].tasks.length,1);assert.equal(displayed[0].tasks[0].title,'이동한 회의');assert.equal(displayed[0].tasks[0].color,tag.color);assert.equal(displayed[0].calendarLink?.canEdit,false);
 tag.color='#123456';assert.equal((await gateway.read()).projects[0].tasks[0].recurrenceExceptions?.[1].patch?.color,'#123456');
 const withoutTag=createPreviewGateway('reader',{...f.options,calendarTags:()=>[]});assert.equal((await withoutTag.read()).projects[0].tasks[0].recurrenceExceptions?.[1].patch?.color,f.calendar.color);
 assert.equal(f.memory.storage.getItem('bflow-gantt-preview-authority-v1')!.includes('recurrence_rule'),false,'recurrence remains calendar-owned, never copied into Gantt storage');
});

test('unlink removes only the binding and queued linking cannot cross a session change',async()=>{
 const f=linkedCalendarSetup(),snapshot=await f.link('reader');
 const unlink={type:'unlinkCalendar',calendarId:f.calendar.id,linkId:snapshot.projects[0].calendarLink!.linkId} as const;
 await assert.rejects(f.gateway('editor').execute({requestId:crypto.randomUUID(),command:unlink}),/권한|소유자/);
 await f.gateway('owner').execute({requestId:crypto.randomUUID(),command:unlink});
 assert.equal((await f.gateway('owner').read()).projects.length,0);assert.equal(f.events.length,1);
 await f.link('owner');f.calendars.splice(0);
 assert.equal((await f.gateway('owner').read()).projects.length,0,'deleted source calendars are not rendered');
 let current=true,release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const gateway=createPreviewGateway('owner',{...f.options,assertCurrent:()=>{if(!current)throw new Error('로그인 변경');},locks:{request:async(_key,callback)=>{await gate;return callback();}}});
 const pending=gateway.execute({requestId:crypto.randomUUID(),command:{type:'linkCalendar',calendarId:f.calendar.id}} as any);
 current=false;release();await assert.rejects(pending,/로그인 변경/);
});

test('a full subtree shift is one optimistic save and one undo entry with matching calendar dates', async () => {
 const memory=setup();let writes=0;
 const options={...memory,storage:{...memory.storage,setItem:(key:string,value:string)=>{writes++;memory.storage.setItem(key,value);}},canViewCalendar:()=>true,canEditCalendar:()=>true};
 const base=createPreviewGateway('owner',options),space=createSpace('폴더','owner'),project=createProject('한 번에 이동',space.id,'owner'),calendarId=crypto.randomUUID();
 const group={...createTask('상위','2024-03-01'),kind:'group' as const};
 const nested={...createTask('접힌 하위','2024-03-01'),kind:'group' as const,parentId:group.id};
 const completed={...createTask('완료 작업','2024-03-01'),endDate:'2024-03-02',parentId:nested.id,completed:true,progress:100,calendarId};
 const timed={...createTask('자정을 넘는 작업','2024-03-02'),endDate:'2024-03-03',parentId:nested.id,allDay:false,startTime:'23:15',endTime:'02:45',progress:40,calendarId};
 const milestone={...createTask('마일스톤','2024-03-03'),kind:'milestone' as const,parentId:group.id,allDay:false,startTime:'10:00',endTime:'10:00',calendarId};
 const successor={...createTask('외부 자동 후속','2024-03-04'),mode:'auto' as const,predecessorId:group.id,calendarId};
 project.tasks=[group,nested,completed,timed,milestone,successor];
 await base.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space,expectedRevision:null}});
 await base.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project,expectedRevision:null}});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const requests:Parameters<typeof base.execute>[0][]=[];
 const gateway={read:base.read,execute:async(request:Parameters<typeof base.execute>[0])=>{requests.push(request);await gate;return base.execute(request);}};
 const store=createGanttStore();await store.getState().initialize('owner',gateway);
 try {
  const before=structuredClone(store.getState().snapshot.projects[0]),writesBefore=writes;
  const mutation=store.getState().execute({type:'saveProject',project:shiftTaskSubtree(before,group.id,3),expectedRevision:before.revision});
  assert.equal(store.getState().pending,true);
  assert.equal(store.getState().snapshot.projects[0].tasks.find(task=>task.id===completed.id)!.startDate,'2024-03-04');
  assert.deepEqual((await base.read()).projects[0],before,'the authority waits for the one project write');
  assert.equal(requests.length,1);assert.equal(requests[0].command.type,'saveProject');
  release();await mutation;
  const shifted=store.getState().snapshot.projects[0];
  assert.equal(shifted.revision,before.revision+1);assert.equal(writes,writesBefore+1);
  assert.equal(store.getState().canUndo,true);assert.equal(store.getState().canRedo,false);
  const projectedDates=async()=>{
   const rows=await listCalendarEvents('owner',options);
   return [completed,timed,milestone,successor].map(task=>{const row=rows.find(row=>row.linked_gantt_task_id===task.id)!;return [row.start_date,row.end_date,row.start_time,row.end_time];});
  };
  const movedDates=[['2024-03-04','2024-03-05',null,null],['2024-03-05','2024-03-06','23:15','02:45'],['2024-03-06','2024-03-06','10:00','10:00'],['2024-03-07','2024-03-07',null,null]];
  assert.deepEqual(await projectedDates(),movedDates);
  await store.getState().undo();
  const undone=store.getState().snapshot.projects[0];
  assert.equal(undone.revision,before.revision+2);assert.deepEqual({...undone,revision:before.revision},before);
  assert.equal(store.getState().canUndo,false,'the entire movement created exactly one history entry');
  assert.equal(store.getState().canRedo,true);
  assert.deepEqual(await projectedDates(),[['2024-03-01','2024-03-02',null,null],['2024-03-02','2024-03-03','23:15','02:45'],['2024-03-03','2024-03-03','10:00','10:00'],['2024-03-04','2024-03-04',null,null]]);
  await store.getState().redo();
  const redone=store.getState().snapshot.projects[0];
  assert.equal(redone.revision,before.revision+3);assert.deepEqual({...redone,revision:shifted.revision},shifted);
  assert.deepEqual(await projectedDates(),movedDates);
  assert.equal(requests.length,3);assert.equal(writes,writesBefore+3);
  assert.deepEqual(requests.map(({command})=>{assert.equal(command.type,'saveProject');return command.type==='saveProject'?command.expectedRevision:undefined;}),[1,2,3]);
 } finally { release();await store.getState().initialize(null); }
});

test('one read-only descendant calendar rolls back the full optimistic shift without a revision or undo entry', async () => {
 const memory=setup(),editableCalendar=crypto.randomUUID(),lockedCalendar=crypto.randomUUID();let locked=false,writes=0;
 const options={...memory,storage:{...memory.storage,setItem:(key:string,value:string)=>{writes++;memory.storage.setItem(key,value);}},canViewCalendar:()=>true,canEditCalendar:(calendarId:string)=>!locked||calendarId!==lockedCalendar};
 const base=createPreviewGateway('owner',options),space=createSpace('폴더','owner'),project=createProject('원자적 이동',space.id,'owner');
 const group={...createTask('상위','2024-02-28'),kind:'group' as const};
 const nested={...createTask('접힌 하위','2024-02-28'),kind:'group' as const,parentId:group.id};
 const editable={...createTask('편집 가능한 작업','2024-02-28'),parentId:group.id,calendarId:editableCalendar};
 const readOnly={...createTask('완료한 읽기 전용 작업','2024-02-29'),parentId:nested.id,completed:true,progress:100,calendarId:lockedCalendar};
 const successor={...createTask('외부 자동 후속','2024-03-01'),mode:'auto' as const,predecessorId:readOnly.id,calendarId:editableCalendar};
 project.tasks=[group,nested,editable,readOnly,successor];
 await base.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space,expectedRevision:null}});
 await base.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project,expectedRevision:null}});
 locked=true;
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let requests=0;
 const gateway={read:base.read,execute:async(request:Parameters<typeof base.execute>[0])=>{requests++;await gate;return base.execute(request);}};
 const store=createGanttStore();await store.getState().initialize('owner',gateway);
 try {
  const before=structuredClone(store.getState().snapshot),eventsBefore=await listCalendarEvents('owner',options),writesBefore=writes;
  const current=before.projects[0];
  const mutation=store.getState().execute({type:'saveProject',project:shiftTaskSubtree(current,group.id,3),expectedRevision:current.revision});
  assert.equal(store.getState().pending,true);
  assert.equal(store.getState().snapshot.projects[0].tasks.find(task=>task.id===readOnly.id)!.startDate,'2024-03-03');
  const rejection=assert.rejects(mutation,/캘린더.*권한/);release();await rejection;
  assert.equal(requests,1);assert.equal(writes,writesBefore,'nothing was committed before the permission failure');
  assert.deepEqual(store.getState().snapshot,before);assert.deepEqual(await base.read(),before);
  assert.deepEqual(await listCalendarEvents('owner',options),eventsBefore);
  assert.equal(store.getState().pending,false);assert.equal(store.getState().canUndo,false);assert.equal(store.getState().canRedo,false);
  assert.match(store.getState().error!,/캘린더.*권한/);
 } finally { release();await store.getState().initialize(null); }
});
test('shared authority serializes CAS, deduplicates retry and persists across gateways',async()=>{
 const options=setup(),a=createPreviewGateway('owner',options),b=createPreviewGateway('owner',options);const s=createSpace('공유','owner');
 const req={requestId:crypto.randomUUID(),command:{type:'saveSpace' as const,space:s,expectedRevision:null}};
 await a.execute(req);await b.execute(req);assert.equal((await b.read()).spaces.length,1);
 const results=await Promise.allSettled([a.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:{...s,name:'A'},expectedRevision:1}}),b.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:{...s,name:'B'},expectedRevision:1}})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await a.read()).spaces[0].revision,2);
});
test('storage failures reject and cannot publish a committed state',async()=>{
 const options=setup();const gateway=createPreviewGateway('u',{...options,storage:{...options.storage,setItem:()=>{throw new Error('disk full');}}});
 await assert.rejects(gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:createSpace('개인','u'),expectedRevision:null}}),/disk full/);
});
test('calendar projections use same tasks, permission intersection, auto chain and unlink',async()=>{
 const cal=crypto.randomUUID(),options={...setup(),canViewCalendar:()=>true,canEditCalendar:(_id:string,actor:string)=>actor==='owner'};
 const gateway=createPreviewGateway('owner',options),s=createSpace('개인','owner');await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:s,expectedRevision:null}});
 const p=createProject('교육',s.id,'owner'),a=createTask('교육','2026-09-04'),b=createTask('실습','2026-09-05');a.calendarId=cal;b.predecessorId=a.id;b.mode='auto';p.tasks=[a,b];
 await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:p,expectedRevision:null}});
 const events=await listCalendarEvents('owner',options);assert.equal(events[0].id,`gantt:${p.id}:${a.id}`);
 assert.equal((await listCalendarEvents('outsider',options)).length,1);
 await assert.rejects(patchCalendarEvent('outsider',events[0].id,{title:'불가'},options),/권한/);
 await patchCalendarEvent('owner',events[0].id,{end_date:'2026-09-07'},options);
 assert.equal((await gateway.read()).projects[0].tasks[1].startDate,'2026-09-08');
 await deleteCalendarEvent('owner',events[0].id,options);assert.equal((await listCalendarEvents('owner',options)).length,0);assert.equal((await gateway.read()).projects[0].tasks.length,2);
});

test('calendar projection inherits task, nearest group and project colors without sharing the project',async()=>{
 const options={...setup(),canViewCalendar:()=>true,canEditCalendar:(_id:string,actor:string)=>actor==='owner'};
 const gateway=createPreviewGateway('owner',options),s=createSpace('비공개','owner');
 await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:s,expectedRevision:null}});
 let p=createProject('색상',s.id,'owner');p.color='#74B9FF';
 const group={...createTask('상위','2026-09-05'),kind:'group' as const,color:'#FDCB6E'};
 const nested={...createTask('하위','2026-09-05'),kind:'group' as const,parentId:group.id};
 const task={...createTask('연결','2026-09-05'),parentId:nested.id,calendarId:crypto.randomUUID()};p.tasks=[group,nested,task];
 p=(await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:p,expectedRevision:null}})).projects[0];
 const readColor=async()=>{const [row]=await listCalendarEvents('outsider',options);assert.equal(row.gantt_can_edit,false);return row.gantt_color;};
 assert.equal((await createPreviewGateway('outsider',options).read()).projects.length,0);
 assert.equal(await readColor(),'#FDCB6E');
 for(const [taskColor,groupColor,expected] of [['#FF6B6B','#FDCB6E','#FF6B6B'],[null,null,'#74B9FF']] as const){
   p={...p,tasks:p.tasks.map(t=>t.id===task.id?{...t,color:taskColor}:t.id===group.id?{...t,color:groupColor}:t)};
   p=(await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:p,expectedRevision:p.revision}})).projects[0];
   assert.equal(await readColor(),expected);
 }
 const row=await patchCalendarEvent('owner',`gantt:${p.id}:${task.id}`,{title:'바뀐 제목'},options);
 assert.equal(row.gantt_color,'#74B9FF');
});
test('store ignores previous account reads and supports CAS guarded undo/redo',async()=>{
 const options=setup(),gateway=createPreviewGateway('u',options),store=createGanttStore();
 let release!:(x:{spaces:never[];projects:never[]})=>void;
 const slow={read:()=>new Promise<{spaces:never[];projects:never[]}>(r=>{release=r;}),execute:gateway.execute};
 const first=store.getState().initialize('old',slow);await store.getState().initialize('u',gateway);release({spaces:[],projects:[]});await first;
 assert.equal(store.getState().actorId,'u');
 const s=createSpace('원본','u');await store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});
 await store.getState().execute({type:'saveSpace',space:{...s,name:'수정'},expectedRevision:1});await store.getState().undo();assert.equal(store.getState().snapshot.spaces[0].name,'원본');
 await store.getState().redo();assert.equal(store.getState().snapshot.spaces[0].name,'수정');
 const remote=(await gateway.read()).spaces[0];await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:{...remote,name:'원격'},expectedRevision:remote.revision}});
 await assert.rejects(store.getState().undo(),/다른 변경/);assert.equal(store.getState().snapshot.spaces[0].name,'원격');
  await store.getState().initialize(null);
});
test('multiple local edits can be undone and redone without mistaking own revisions for remote edits',async()=>{
 const gateway=createPreviewGateway('u',setup()),store=createGanttStore();await store.getState().initialize('u',gateway);
 const s=createSpace('A','u');await store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});
 await store.getState().execute({type:'saveSpace',space:{...s,name:'B'},expectedRevision:1});
 await store.getState().undo();await store.getState().undo();assert.equal(store.getState().snapshot.spaces.length,0);
 await store.getState().redo();await store.getState().redo();assert.equal(store.getState().snapshot.spaces[0].name,'B');
 await store.getState().initialize(null);
});
test('late mutation response from previous account cannot overwrite new session',async()=>{
 const store=createGanttStore(),oldSnapshot={spaces:[],projects:[]};let finish!:(snapshot:any)=>void;
 const slow={read:async()=>oldSnapshot,execute:()=>new Promise<any>(resolve=>{finish=resolve;})};
 await store.getState().initialize('old',slow);const s=createSpace('old folder','old');const mutation=store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});
 await store.getState().initialize('new',createPreviewGateway('new',setup()));finish({spaces:[s],projects:[]});await mutation;
 assert.equal(store.getState().actorId,'new');assert.equal(store.getState().snapshot.spaces.length,0);assert.equal(store.getState().pending,false);
 await store.getState().initialize(null);
});
test('failed mutation retains its pending lock until canonical recovery finishes',async()=>{
 const s=createSpace('정본','u'),snapshot={spaces:[s],projects:[]},store=createGanttStore();
 let reads=0,executions=0,finish!:(value:typeof snapshot)=>void,entered!:()=>void;
 const recoveryStarted=new Promise<void>(resolve=>{entered=resolve;});
 const gateway={read:async()=>{if(reads++===0)return snapshot;entered();return new Promise<typeof snapshot>(resolve=>{finish=resolve;});},execute:async()=>{executions++;throw new Error('저장 실패');}};
 await store.getState().initialize('u',gateway);
 const failed=store.getState().execute({type:'saveSpace',space:{...s,name:'첫 변경'},expectedRevision:1}).catch(error=>error);
 await recoveryStarted;
 assert.equal(store.getState().pending,true);
 await assert.rejects(store.getState().execute({type:'saveSpace',space:{...s,name:'뒤 변경'},expectedRevision:2}),/저장하고/);
 assert.equal(executions,1);
 finish(snapshot);assert.match((await failed).message,/저장 실패/);
 assert.equal(store.getState().pending,false);assert.equal(store.getState().snapshot.spaces[0].name,'정본');assert.match(store.getState().error!,/저장 실패/);
 await store.getState().initialize(null);
});

test('a committed new folder or project survives a lost save response without prompting a duplicate create', async (t) => {
 for (const kind of ['space','project'] as const) await t.test(kind,async()=>{
  const base=createPreviewGateway('u',setup()),store=createGanttStore();
  const space=createSpace('새 폴더','u'),project=createProject('새 프로젝트',space.id,'u');
  if(kind==='project')await base.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space,expectedRevision:null}});
  let loseResponse=true,executions=0;
  await store.getState().initialize('u',{read:base.read,execute:async request=>{
   executions++;const saved=await base.execute(request);
   if(loseResponse){loseResponse=false;throw new Error('저장 응답 연결 끊김');}return saved;
  }});
  try{
   await assert.doesNotReject(store.getState().execute(kind==='space'
    ?{type:'saveSpace',space,expectedRevision:null}
    :{type:'saveProject',project,expectedRevision:null}));
   assert.equal(executions,1,'recovery verifies the commit without another write');
   assert.equal(store.getState().error,null);assert.equal(store.getState().canUndo,true);
   assert.equal(kind==='space'?store.getState().snapshot.spaces.length:store.getState().snapshot.projects.length,1);
   await store.getState().undo();
   assert.equal(kind==='space'?store.getState().snapshot.spaces.length:store.getState().snapshot.projects.length,0);
  }finally{await store.getState().initialize(null);}
 });
});

test('new entity recovery does not hide a failed commit, changed entity, or failed authoritative read', async (t) => {
 for(const failure of ['uncommitted','changed','read-failed'] as const)await t.test(failure,async()=>{
  const base=createPreviewGateway('u',setup()),store=createGanttStore(),space=createSpace('요청한 이름','u');let reads=0;
  await store.getState().initialize('u',{
   read:async()=>{if(reads++>0&&failure==='read-failed')throw new Error('조회 실패');return base.read();},
   execute:async request=>{
    if(failure!=='uncommitted')await base.execute(request);
    if(failure==='changed')await base.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:{...space,name:'다른 사람이 수정'},expectedRevision:1}});
    throw new Error('저장 응답 실패');
   },
  });
  try{
   await assert.rejects(store.getState().execute({type:'saveSpace',space,expectedRevision:null}),/저장 응답 실패/);
   assert.equal(reads,2,'creation recovery uses one authoritative read');
   assert.equal(store.getState().canUndo,false);assert.equal(store.getState().pending,false);
   assert.match(store.getState().error!,/저장 응답 실패/);
   if(failure==='changed')assert.equal(store.getState().snapshot.spaces[0].name,'다른 사람이 수정');
  }finally{await store.getState().initialize(null);}
 });
});

test('creation recovery keeps its write lock and cannot overwrite a new login session', async () => {
 const space=createSpace('이전 사용자 폴더','old'),store=createGanttStore();let reads=0;
 let finish!:(snapshot:{spaces:typeof space[];projects:never[]})=>void,started!:()=>void;
 const recoveryStarted=new Promise<void>(resolve=>{started=resolve;});
 await store.getState().initialize('old',{
  read:async()=>{if(reads++===0)return {spaces:[],projects:[]};started();return new Promise(resolve=>{finish=resolve;});},
  execute:async()=>{throw new Error('저장 응답 끊김');},
 });
 const creation=store.getState().execute({type:'saveSpace',space,expectedRevision:null});
 await recoveryStarted;
 assert.equal(store.getState().pending,true);
 await assert.rejects(store.getState().execute({type:'saveSpace',space:createSpace('중복 시도','old'),expectedRevision:null}),/저장하고/);
 await store.getState().initialize('new',createPreviewGateway('new',setup()));
 finish({spaces:[space],projects:[]});await creation;
 assert.equal(store.getState().actorId,'new');assert.equal(store.getState().pending,false);
 assert.equal(store.getState().snapshot.spaces.length,0);assert.equal(store.getState().canUndo,false);
 await store.getState().initialize(null);
});
test('successful refresh clears an initial load error',async()=>{
 const store=createGanttStore();let reads=0;
 await store.getState().initialize('u',{read:async()=>{if(reads++===0)throw new Error('초기 연결 실패');return {spaces:[],projects:[]};},execute:async()=>({spaces:[],projects:[]})});
 assert.match(store.getState().error!,/초기 연결 실패/);await store.getState().refresh();assert.equal(store.getState().error,null);assert.equal(store.getState().loading,false);
 await store.getState().initialize(null);
});
test('canonical preview reload keeps project and folder order after task creation and rename',async()=>{
 const options=setup(),gateway=createPreviewGateway('u',options),s=createSpace('A','u'),s2=createSpace('B','u');
 for(const space of [s,s2])await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space,expectedRevision:null}});
 const a=createProject('첫 프로젝트',s.id,'u'),b=createProject('두 번째',s.id,'u');
 for(const project of [a,b])await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project,expectedRevision:null}});
 await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:{...a,tasks:[createTask('새 작업','2026-09-05')]},expectedRevision:1}});
 await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:{...s,name:'수정 이름'},expectedRevision:1}});
 const loaded=await createPreviewGateway('u',options).read();assert.deepEqual(loaded.projects.map(p=>p.id),[a.id,b.id]);assert.deepEqual(loaded.spaces.map(x=>x.id),[s.id,s2.id]);
});

test('own project changes do not block undo and redo across a folder rename',async()=>{
 const store=createGanttStore(),gateway=createPreviewGateway('u',setup());await store.getState().initialize('u',gateway);
 const s=createSpace('폴더','u'),p=createProject('프로젝트',s.id,'u');
 await store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});await store.getState().execute({type:'saveProject',project:p,expectedRevision:null});await store.getState().execute({type:'saveSpace',space:{...s,name:'이름 수정'},expectedRevision:1});
 await store.getState().undo();await store.getState().undo();await store.getState().undo();assert.equal(store.getState().snapshot.spaces.length,0);
 await store.getState().redo();await store.getState().redo();await store.getState().redo();assert.equal(store.getState().snapshot.spaces[0].name,'이름 수정');assert.equal(store.getState().snapshot.projects.length,1);
 await store.getState().initialize(null);
});

test('a cascading folder access change clears history and keeps the remaining owner able to edit',async()=>{
 const options=setup(),owner=createPreviewGateway('owner',options),member=createPreviewGateway('member',options),store=createGanttStore();await store.getState().initialize('owner',owner);
 const s={...createSpace('공유','owner'),shared:true,members:[{userId:'member',canEdit:true}]};await store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});
 const p=createProject('팀원 프로젝트',s.id,'member');await member.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:p,expectedRevision:null}});await store.getState().refresh();
 await store.getState().execute({type:'saveSpace',space:{...s,members:[]},expectedRevision:1});
 assert.equal(store.getState().canUndo,false);assert.equal(store.getState().canRedo,false);assert.equal((await member.read()).projects.length,0);
 const current=store.getState().snapshot.projects[0];assert.equal(current.ownerId,'owner');await store.getState().execute({type:'saveProject',project:{...current,name:'계속 편집'},expectedRevision:current.revision});
 await store.getState().initialize(null);
});

test('a concurrent new project in the mutation response cannot be blessed by local undo bookkeeping',async()=>{
 const options=setup(),base=createPreviewGateway('u',options),store=createGanttStore(),s=createSpace('폴더','u'),p=createProject('내 변경',s.id,'u'),remote=createProject('다른 창 변경',s.id,'u');
 const gateway={read:base.read,execute:async(request:Parameters<typeof base.execute>[0])=>{const result=await base.execute(request);if(request.command.type==='saveProject'&&request.command.expectedRevision===null){await base.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:remote,expectedRevision:null}});return base.read();}return result;}};
 await store.getState().initialize('u',gateway);await store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});await store.getState().execute({type:'saveProject',project:p,expectedRevision:null});await store.getState().undo();
 await assert.rejects(store.getState().undo(),/다른 변경/);assert.equal((await base.read()).projects[0].id,remote.id);await store.getState().initialize(null);
});

test('changing a linked task to a group needs calendar edit permission before hiding its projection',async()=>{
 const cal=crypto.randomUUID();let edit=true;const options={...setup(),canViewCalendar:()=>true,canEditCalendar:()=>edit};const gateway=createPreviewGateway('u',options),s=createSpace('폴더','u'),p=createProject('프로젝트',s.id,'u'),t=createTask('연결','2026-09-05');t.calendarId=cal;p.tasks=[t];
 await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:s,expectedRevision:null}});await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:p,expectedRevision:null}});edit=false;
 await assert.rejects(gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:{...p,tasks:[{...t,kind:'group'}]},expectedRevision:1}}),/캘린더.*권한/);
 assert.equal((await listCalendarEvents('u',options)).length,1);
});

test('a remote child arriving in a folder rename undo response is never included in the earlier creation undo',async()=>{
 const base=createPreviewGateway('u',setup()),store=createGanttStore(),s=createSpace('처음','u'),remote=createProject('다른 창 프로젝트',s.id,'u');let inject=false;
 const gateway={read:base.read,execute:async(request:Parameters<typeof base.execute>[0])=>{const result=await base.execute(request);if(inject){inject=false;await base.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:remote,expectedRevision:null}});return base.read();}return result;}};
 await store.getState().initialize('u',gateway);await store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});await store.getState().execute({type:'saveSpace',space:{...s,name:'수정'},expectedRevision:1});inject=true;
 await store.getState().undo();await assert.rejects(store.getState().undo(),/다른 변경/);
 assert.equal((await base.read()).projects[0].id,remote.id);assert.equal((await base.read()).spaces.length,1);await store.getState().initialize(null);
});

test('a remote child preceding a local rename remains a conflict for the original folder creation history',async()=>{
 const base=createPreviewGateway('u',setup()),store=createGanttStore(),s=createSpace('처음','u'),remote=createProject('먼저 도착한 프로젝트',s.id,'u');
 await store.getState().initialize('u',base);await store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});await base.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:remote,expectedRevision:null}});await store.getState().refresh();
 await store.getState().execute({type:'saveSpace',space:{...s,name:'수정'},expectedRevision:1});await store.getState().undo();await assert.rejects(store.getState().undo(),/다른 변경/);
 assert.equal((await base.read()).projects[0].id,remote.id);await store.getState().initialize(null);
});

test('redo does not rebase its next entry over a remote folder edit returned with the response',async()=>{
 const base=createPreviewGateway('u',setup()),store=createGanttStore(),s=createSpace('처음','u');let inject=false;
 const gateway={read:base.read,execute:async(request:Parameters<typeof base.execute>[0])=>{const result=await base.execute(request);if(inject){inject=false;const latest=result.spaces[0];await base.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:{...latest,name:'다른 창 제목'},expectedRevision:latest.revision}});return base.read();}return result;}};
 await store.getState().initialize('u',gateway);await store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});await store.getState().execute({type:'saveSpace',space:{...s,name:'두 번째'},expectedRevision:1});await store.getState().execute({type:'saveSpace',space:{...s,name:'세 번째'},expectedRevision:2});await store.getState().undo();await store.getState().undo();inject=true;
 await store.getState().redo();await assert.rejects(store.getState().redo(),/다른 변경/);assert.equal((await base.read()).spaces[0].name,'다른 창 제목');await store.getState().initialize(null);
});

test('redoing a previously empty folder deletion cannot remove a child arriving in its restore response',async()=>{
 const base=createPreviewGateway('u',setup()),store=createGanttStore(),s=createSpace('빈 폴더','u'),remote=createProject('복원 중 도착',s.id,'u');let inject=false;
 const gateway={read:base.read,execute:async(request:Parameters<typeof base.execute>[0])=>{const result=await base.execute(request);if(inject){inject=false;await base.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:remote,expectedRevision:null}});return base.read();}return result;}};
 await store.getState().initialize('u',gateway);await store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});await store.getState().execute({type:'deleteSpace',spaceId:s.id,expectedRevision:1});inject=true;
 await store.getState().undo();await assert.rejects(store.getState().redo(),/다른 변경/);assert.equal((await base.read()).projects[0].id,remote.id);await store.getState().initialize(null);
});

test('folder creation undo checks for remote children again inside the canonical write lock',async()=>{
 const base=createPreviewGateway('u',setup()),store=createGanttStore(),s=createSpace('빈 폴더','u'),remote=createProject('저장 직전 도착',s.id,'u');let inject=false;
 const gateway={read:base.read,execute:async(request:Parameters<typeof base.execute>[0])=>{if(inject){inject=false;await base.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:remote,expectedRevision:null}});}return base.execute(request);}};
 await store.getState().initialize('u',gateway);await store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});inject=true;
 await assert.rejects(store.getState().undo(),/다른 변경|작업|프로젝트/);assert.equal((await base.read()).projects[0].id,remote.id);assert.equal(store.getState().snapshot.projects[0].id,remote.id);
 const latest=(await base.read()).spaces[0];await base.execute({requestId:crypto.randomUUID(),command:{type:'deleteSpace',spaceId:s.id,expectedRevision:latest.revision}});assert.equal((await base.read()).spaces.length,0,'explicit cascade deletion remains available');await store.getState().initialize(null);
});

test('a remote revision is not mistaken for our own undo even when its final folder content matches',async()=>{
 const base=createPreviewGateway('u',setup()),store=createGanttStore(),s=createSpace('원래 이름','u');await store.getState().initialize('u',base);await store.getState().execute({type:'saveSpace',space:s,expectedRevision:null});
 await base.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:{...s,name:'다른 창 수정'},expectedRevision:1}});await base.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:s,expectedRevision:2}});await store.getState().refresh();
 const latest=store.getState().snapshot.spaces[0];await store.getState().execute({type:'saveSpace',space:{...latest,name:'내 수정'},expectedRevision:latest.revision});await store.getState().undo();
 await assert.rejects(store.getState().undo(),/다른 변경/);assert.equal((await base.read()).spaces[0].name,'원래 이름');await store.getState().initialize(null);
});

test('refresh reports true only for the applied latest read and false for superseded reads',async()=>{
 const store=createGanttStore(), initial={spaces:[],projects:[]}, newest={spaces:[createSpace('최신 공유','u')],projects:[]};
 const reads:Array<(snapshot:typeof initial)=>void>=[];
 let initialized=false;
 const gateway={read:async()=>{if(!initialized){initialized=true;return initial;}return new Promise<typeof initial>(resolve=>reads.push(resolve));},execute:async()=>initial};
 await store.getState().initialize('u',gateway);
 const older=store.getState().refresh(),latest=store.getState().refresh();
 reads[0](initial);assert.equal(await older,false);assert.equal(store.getState().error,null);
 reads[1](newest);assert.equal(await latest,true);assert.equal(store.getState().snapshot,newest);
 await store.getState().initialize(null);
});

test('refresh reports false for session changes, missing gateway, pending mutation and failed reads',async()=>{
 const store=createGanttStore(), initial={spaces:[],projects:[]};
 assert.equal(await store.getState().refresh(),false);
 let release!:(snapshot:typeof initial)=>void,initialized=false;
 await store.getState().initialize('u',{read:async()=>{if(!initialized){initialized=true;return initial;}return new Promise<typeof initial>(resolve=>{release=resolve;});},execute:async()=>initial});
 const stale=store.getState().refresh();await store.getState().initialize(null);release(initial);assert.equal(await stale,false);
 await store.getState().initialize('u',{read:async()=>initial,execute:async()=>initial});
 store.setState({pending:true});assert.equal(await store.getState().refresh(),false);store.setState({pending:false});
 let count=0;await store.getState().initialize('u',{read:async()=>{if(count++)throw new Error('offline');return initial;},execute:async()=>initial});
 assert.equal(await store.getState().refresh(),false);assert.match(store.getState().error!,/offline/);
 await store.getState().initialize(null);
});
