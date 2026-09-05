import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createSpace,createTask} from '../src/features/gantt/domain.ts';
import {createPreviewGateway,listCalendarEvents} from '../src/features/gantt/previewGateway.ts';
import {createGanttStore} from '../src/features/gantt/useGanttStore.ts';
import {relocateTask} from '../src/features/gantt/relocation.ts';
import type {GanttCommand,GanttSnapshot} from '../src/features/gantt/types.ts';
function storageOptions(){const rows=new Map<string,string>();let tail=Promise.resolve();return {seed:false,storage:{getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);}},locks:{request<T>(_name:string,run:()=>Promise<T>){const next=tail.then(run);tail=next.then(()=>undefined,()=>undefined);return next;}}};}
async function setup(){
 let calendarEdit=true;const options={...storageOptions(),canViewCalendar:()=>true,canEditCalendar:()=>calendarEdit},gateway=createPreviewGateway('owner',options),space=createSpace('공유','owner');space.shared=true;space.members=[{userId:'editor',canEdit:true}];
 const source=createProject('원본',space.id,'owner'),target=createProject('목적지',space.id,'owner');source.tasks=[{...createTask('이동할 작업'),calendarId:crypto.randomUUID()}];
 const execute=(command:GanttCommand,requestId=crypto.randomUUID())=>gateway.execute({requestId,command});
 await execute({type:'saveSpace',space,expectedRevision:null});for(const project of [source,target])await execute({type:'saveProject',project,expectedRevision:null});
 return {options,gateway,space,source,target,execute,setCalendarEdit:(value:boolean)=>{calendarEdit=value;}};
}
function pair(snapshot:GanttSnapshot,sourceId:string,targetId:string):GanttCommand {
 const source=snapshot.projects.find(p=>p.id===sourceId)!,target=snapshot.projects.find(p=>p.id===targetId)!;
 const moved=relocateTask(source,source.tasks[0].id,target,null,'inside');return {type:'saveProjectPair',projects:[{project:moved.sourceProject,expectedRevision:source.revision},{project:moved.targetProject,expectedRevision:target.revision}],expectedSpaces:[{spaceId:source.spaceId,expectedRevision:snapshot.spaces.find(s=>s.id===source.spaceId)!.revision}]};
}
test('project pair commits once, changes projection identity once, and rolls back both projects for stale target, ACL or calendar failures',async()=>{
 const h=await setup(),before=await h.gateway.read(),command=pair(before,h.source.id,h.target.id);assert.equal(command.type,'saveProjectPair');if(command.type!=='saveProjectPair')return;
 await assert.rejects(h.execute({...command,projects:[command.projects[0],{...command.projects[1],expectedRevision:99}]}),/다른 변경/);assert.deepEqual(await h.gateway.read(),before);
 h.setCalendarEdit(false);await assert.rejects(h.execute(command),/캘린더/);assert.deepEqual(await h.gateway.read(),before);h.setCalendarEdit(true);
 const request=crypto.randomUUID(),saved=await h.execute(command,request);assert.deepEqual(await h.execute(command,request),saved);assert.equal(saved.projects.find(p=>p.id===h.source.id)?.tasks.length,0);assert.equal(saved.projects.find(p=>p.id===h.target.id)?.revision,2);
 const events=await listCalendarEvents('owner',h.options);assert.equal(events.length,1);assert.equal(events[0].id,`gantt:${h.target.id}:${h.source.tasks[0].id}`);
});
test('folder ACL drift blocks a pair even when project revisions did not change',async()=>{
 const h=await setup(),command=pair(await h.gateway.read(),h.source.id,h.target.id);await h.execute({type:'saveSpace',space:{...h.space,members:[{userId:'editor',canEdit:false}]},expectedRevision:1});const before=await h.gateway.read();assert.equal(before.projects[0].revision,1);
 await assert.rejects(h.execute(command),/다른 변경/);assert.deepEqual(await h.gateway.read(),before);
 const editor=createPreviewGateway('editor',h.options);const fresh=pair(before,h.source.id,h.target.id);await assert.rejects(editor.execute({requestId:crypto.randomUUID(),command:fresh}),/권한/);assert.deepEqual(await h.gateway.read(),before);
});
test('pair undo and redo are atomic and reject remote changes to either project',async()=>{
 const h=await setup(),store=createGanttStore();await store.getState().initialize('owner',h.gateway);
 try{await store.getState().execute(pair(store.getState().snapshot,h.source.id,h.target.id));await store.getState().undo();assert.equal(store.getState().snapshot.projects.find(p=>p.id===h.source.id)?.tasks.length,1);assert.equal(store.getState().snapshot.projects.find(p=>p.id===h.target.id)?.tasks.length,0);
 await store.getState().redo();await store.getState().undo();const target=(await h.gateway.read()).projects.find(p=>p.id===h.target.id)!;await h.execute({type:'saveProject',project:{...target,memo:'원격'},expectedRevision:target.revision});const current=await h.gateway.read();await assert.rejects(store.getState().redo(),/다른 변경/);assert.deepEqual(await h.gateway.read(),current);
 }finally{await store.getState().initialize(null);}
});
test('failed pair response rolls optimistic changes back together',async()=>{
 const h=await setup(),store=createGanttStore(),before=await h.gateway.read();let reject!:(reason:Error)=>void;
 await store.getState().initialize('owner',{read:h.gateway.read,execute:()=>new Promise((_,no)=>{reject=no;})});try{const run=store.getState().execute(pair(before,h.source.id,h.target.id));assert.equal(store.getState().snapshot.projects.find(p=>p.id===h.source.id)?.tasks.length,0);reject(new Error('통신 실패'));await assert.rejects(run,/통신 실패/);assert.deepEqual(store.getState().snapshot,before);}finally{await store.getState().initialize(null);}
});
test('mixed single and pair edits can be undone and redone without bypassing either project revision',async()=>{
 const h=await setup(),store=createGanttStore();await store.getState().initialize('owner',h.gateway);try{
 const source=store.getState().snapshot.projects.find(p=>p.id===h.source.id)!;await store.getState().execute({type:'saveProject',project:{...source,memo:'앞선 수정'},expectedRevision:source.revision});
 await store.getState().execute(pair(store.getState().snapshot,h.source.id,h.target.id));const target=store.getState().snapshot.projects.find(p=>p.id===h.target.id)!;await store.getState().execute({type:'saveProject',project:{...target,memo:'뒤의 수정'},expectedRevision:target.revision});
 await store.getState().undo();await store.getState().undo();await store.getState().undo();assert.equal(store.getState().snapshot.projects.find(p=>p.id===source.id)?.memo,'');
 await store.getState().redo();await store.getState().redo();await store.getState().redo();assert.equal(store.getState().snapshot.projects.find(p=>p.id===target.id)?.memo,'뒤의 수정');assert.equal(store.getState().snapshot.projects.find(p=>p.id===target.id)?.tasks.length,1);
 }finally{await store.getState().initialize(null);}
});
test('remote content returned alongside a successful pair is not adopted as its undo baseline',async()=>{
 const h=await setup(),store=createGanttStore();await store.getState().initialize('owner',{read:h.gateway.read,execute:async request=>{await h.gateway.execute(request);const target=(await h.gateway.read()).projects.find(p=>p.id===h.target.id)!;await h.execute({type:'saveProject',project:{...target,memo:'동시 수정'},expectedRevision:target.revision});return h.gateway.read();}});
 try{await store.getState().execute(pair(store.getState().snapshot,h.source.id,h.target.id));const current=await h.gateway.read();await assert.rejects(store.getState().undo(),/다른 변경/);assert.deepEqual(await h.gateway.read(),current);}finally{await store.getState().initialize(null);}
});
