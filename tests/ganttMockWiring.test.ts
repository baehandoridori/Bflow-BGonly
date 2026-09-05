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

test('deleting a preview calendar unlinks every Gantt task and preserves subsequent edits', async () => {
  const keys = ['window', 'document', 'navigator', 'BroadcastChannel'];
  const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const values = new Map<string, string>();
  let failGanttWrites = false;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (failGanttWrites && key.includes('gantt')) throw new Error('저장 공간 부족'); values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  let tail = Promise.resolve();
  let hold: Promise<void> | null = null;
  const locks = { request<T>(_key: string, callback: () => Promise<T>): Promise<T> { const gate = hold; const result = tail.then(async () => { if (gate) await gate; return callback(); }); tail = result.then(() => undefined, () => undefined); return result; } };
  const win = { localStorage: storage, electronAPI: undefined as any };
  for (const [key, value] of Object.entries({ window: win, document: { documentElement: { dataset: {} } }, navigator: { locks }, BroadcastChannel: undefined })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  try {
    const bundle = await build({ stdin: { contents: "export { installDevElectronAPI } from './src/mocks/devElectronAPI.ts';", resolveDir: process.cwd() }, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false });
    const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}#calendar-delete`);
    module.installDevElectronAPI(); const api = win.electronAPI;
    await api.loginCanonicalSession({ name: '배한솔', password: '1234' });
    const calendar = await api.calendarCreate({ name: '삭제할 연결 캘린더', color: '#6C5CE7', visibility: 'members', members: [] });
    const space = createSpace('삭제 검증', '1');
    await api.ganttExecute({ requestId: crypto.randomUUID(), command: { type: 'saveSpace', space, expectedRevision: null } });
    const project = createProject('연결 작업 보존', space.id, '1');
    project.tasks = [createTask('연결 작업', '2026-09-06'), createTask('연결 마일스톤', '2026-09-07'), createTask('독립 작업', '2026-09-08')];
    project.tasks[0].calendarId = calendar.id;
    Object.assign(project.tasks[1], { calendarId: calendar.id, kind: 'milestone', allDay: false, startTime: '10:00', endTime: '10:00' });
    await api.ganttExecute({ requestId: crypto.randomUUID(), command: { type: 'saveProject', project, expectedRevision: null } });
    const milestoneId = `gantt:${project.id}:${project.tasks[1].id}`;
    const projection = (await api.calendarEventsList()).find((row: any) => row.id === milestoneId);
    assert.equal(projection.linked_gantt_task_kind, 'milestone');
    await api.calendarEventUpdate(milestoneId, { title: '시각 유지한 마일스톤' });
    let before = (await api.ganttRead()).projects.find((row: any) => row.id === project.id);
    assert.equal(before.tasks[1].startTime, '10:00'); assert.equal(before.tasks[1].endTime, '10:00');
    failGanttWrites = true;
    await assert.rejects(api.calendarDelete(calendar.id), /저장 공간/);
    failGanttWrites = false;
    assert.ok((await api.calendarList()).some((row: any) => row.id === calendar.id), 'failed Gantt write cannot delete the calendar');
    assert.deepEqual((await api.ganttRead()).projects.find((row: any) => row.id === project.id), before);
    await api.loginCanonicalSession({ name: '장삐쭈', password: '1234' });
    await assert.rejects(api.calendarDelete(calendar.id), /권한/);
    await api.loginCanonicalSession({ name: '배한솔', password: '1234' });
    assert.deepEqual((await api.ganttRead()).projects.find((row: any) => row.id === project.id), before, 'permission failure restores the Gantt half');
    let release!: () => void;
    hold = new Promise<void>(resolve => { release = resolve; });
    const pendingDelete = api.calendarDelete(calendar.id);
    await api.loginCanonicalSession({ name: '장삐쭈', password: '1234' });
    hold = null; release();
    await assert.rejects(pendingDelete, /변경/);
    await api.loginCanonicalSession({ name: '배한솔', password: '1234' });
    assert.ok((await api.calendarList()).some((row: any) => row.id === calendar.id));
    before = (await api.ganttRead()).projects.find((row: any) => row.id === project.id);
    await api.calendarDelete(calendar.id);
    const after = (await api.ganttRead()).projects.find((row: any) => row.id === project.id);
    assert.equal(after.revision, before.revision + 1, 'one cascade invalidates stale project writes');
    assert.deepEqual(after.tasks.map((task: any) => task.calendarId), [null, null, null]);
    assert.deepEqual(after.tasks.map((task: any) => task.calendarEventId), [null, null, null]);
    assert.deepEqual(after.tasks.map((task: any) => task.title), before.tasks.map((task: any) => task.title));
    assert.equal((await api.calendarEventsList()).some((row: any) => row.calendar_id === calendar.id), false);
    after.tasks[0].title = '캘린더 삭제 후 계속 편집';
    await api.ganttExecute({ requestId: crypto.randomUUID(), command: { type: 'saveProject', project: after, expectedRevision: after.revision } });
    assert.equal((await api.ganttRead()).projects.find((row: any) => row.id === project.id).tasks[0].title, '캘린더 삭제 후 계속 편집');
  } finally {
    for (const key of keys) { const descriptor = descriptors.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
