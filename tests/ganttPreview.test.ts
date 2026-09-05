import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewGateway, listCalendarEvents, patchCalendarEvent, deleteCalendarEvent } from '../src/features/gantt/previewGateway.ts';
import { createProject, createSpace, createTask } from '../src/features/gantt/domain.ts';
import { createGanttStore } from '../src/features/gantt/useGanttStore.ts';
function setup() {
 const rows=new Map<string,string>();const storage={getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);}};
 let tail=Promise.resolve();const locks={request<T>(_name:string,callback:()=>Promise<T>):Promise<T>{const result=tail.then(callback);tail=result.then(()=>undefined,()=>undefined);return result;}};
 return {storage,locks,seed:false};
}
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
