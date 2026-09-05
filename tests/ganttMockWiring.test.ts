import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createProject, createSpace, createTask } from '../src/features/gantt/domain.ts';

test('mock API persists gantt, projects calendar edits, rejects privacy replacement and fences queued session writes',async()=>{
  const keys=['window','document','navigator','BroadcastChannel'];const descriptors=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const values=new Map<string,string>();let tail=Promise.resolve();let hold:Promise<void>|null=null;
  const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
  const locks={request<T>(_key:string,callback:()=>Promise<T>):Promise<T>{const gate=hold;const result=tail.then(async()=>{if(gate)await gate;return callback();});tail=result.then(()=>undefined,()=>undefined);return result;}};
  const win={localStorage:storage,electronAPI:undefined as any};
  for(const [key,value] of Object.entries({window:win,document:{documentElement:{dataset:{}}},navigator:{locks},BroadcastChannel:undefined}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  try {
    const bundle=await build({stdin:{contents:"export { installDevElectronAPI } from './src/mocks/devElectronAPI.ts';",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false});
    const module=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);module.installDevElectronAPI();const api=win.electronAPI;
    await assert.rejects(api.ganttRead(),/로그인/);
    await api.loginCanonicalSession({name:'배한솔',password:'1234'});
    const snapshot=await api.ganttRead();assert.ok(snapshot.projects.length>0);
    const calendar=await api.calendarCreate({name:'간트 공유',color:'#6C5CE7',visibility:'members',members:[{user_id:'2',can_edit:true}]});
    const s=createSpace('검증','1');await api.ganttExecute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:s,expectedRevision:null}});
    const p=createProject('검증',s.id,'1'),t=createTask('교육','2026-09-04');t.calendarId=calendar.id;p.tasks=[t];
    let invalidations=0;const unsub=api.onCalendarChanged(()=>{invalidations++;});
    await api.ganttExecute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:p,expectedRevision:null}});
    const id=`gantt:${p.id}:${t.id}`;let row=(await api.calendarEventsList()).find((r:any)=>r.id===id);
    assert.equal(row.gantt_can_edit,true);assert.ok(invalidations>0);
    await api.calendarEventUpdate(id,{title:'캘린더 변경'});assert.equal((await api.ganttRead()).projects.find((x:any)=>x.id===p.id).tasks[0].title,'캘린더 변경');
    assert.equal((await api.calendarEventsList({from:'2026-10-01'})).some((r:any)=>r.id===id),false);
    await assert.rejects(api.calendarPrivacyReplacementCreate({storage:'bflow',source:{storage:'bflow',event_id:id,calendar_id:calendar.id},event:row}),/간트 상세/);
    await api.loginCanonicalSession({name:'장삐쭈',password:'1234'});row=(await api.calendarEventsList()).find((r:any)=>r.id===id);assert.equal(row.gantt_can_edit,false);
    await assert.rejects(api.calendarEventUpdate(id,{title:'금지'}),/권한/);
    await api.loginCanonicalSession({name:'배한솔',password:'1234'});
    let release!:()=>void;hold=new Promise<void>(resolve=>{release=resolve;});
    const pending=api.ganttExecute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:{...s,name:'old actor'},expectedRevision:1}});
    await api.loginCanonicalSession({name:'장삐쭈',password:'1234'});hold=null;release();await assert.rejects(pending,/변경/);
    await api.loginCanonicalSession({name:'배한솔',password:'1234'});assert.equal((await api.ganttRead()).spaces.find((x:any)=>x.id===s.id).name,'검증');
    await api.calendarEventDelete(id);assert.equal((await api.calendarEventsList()).some((r:any)=>r.id===id),false);assert.equal((await api.ganttRead()).projects.find((x:any)=>x.id===p.id).tasks.length,1);unsub();
  } finally {for(const key of keys){const descriptor=descriptors.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
