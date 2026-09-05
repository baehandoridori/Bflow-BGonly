import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createProject,createSpace,createTask} from '../src/features/gantt/domain.ts';
import {relocateTask} from '../src/features/gantt/relocation.ts';
import {createGanttStore} from '../src/features/gantt/useGanttStore.ts';
import type {GanttCommand,GanttSnapshot} from '../src/features/gantt/types.ts';
const runtime=process.env.BFLOW_PGLITE_MODULE;
const sql=(file:string)=>readFileSync(new URL(`../DEVLOG/migrations/${file}`,import.meta.url),'utf8');
const upgrade='20260905193555_gantt_project_pair.sql';
async function harness(upgraded=true){
 const {PGlite}=await import(pathToFileURL(runtime!).href),db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT DEFAULT 'user',password TEXT,slack_id TEXT,hire_date TEXT,birthday TEXT,is_initial_password BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT now(),is_compositor BOOLEAN DEFAULT false,is_acting_supervisor BOOLEAN DEFAULT false);
 CREATE TABLE calendars(id UUID PRIMARY KEY,owner_id TEXT REFERENCES users(id),visibility TEXT,is_personal BOOLEAN DEFAULT false,name TEXT,color TEXT);
 CREATE TABLE calendar_members(calendar_id UUID REFERENCES calendars(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,can_edit BOOLEAN,PRIMARY KEY(calendar_id,user_id));
 GRANT SELECT,INSERT,UPDATE,DELETE ON users,calendars,calendar_members TO anon;
 INSERT INTO users(id,name,password) VALUES('owner','owner','pw'),('editor','editor','pw'),('viewer','viewer','pw');`);
 for(const file of ['2026-09-05-gantt-workspaces.sql','2026-09-05-gantt-containment.sql','2026-09-05-app-sessions-gantt-auth.sql','20260905151837_gantt_release_acl.sql','20260905173804_gantt_revision_ledger.sql',...(upgraded?[upgrade]:[])])await db.exec(sql(file));
 await db.exec('SET ROLE anon');const tokens:Record<string,string>={};for(const user of ['owner','editor','viewer'])tokens[user]=(await db.query('SELECT app_login($1,$2) AS result',[user,'pw'])).rows[0].result.token;
 const execute=async(command:GanttCommand,actor='owner',requestId=crypto.randomUUID()):Promise<GanttSnapshot>=>(await db.query('SELECT gantt_session_execute($1,$2,$3) AS result',[tokens[actor],requestId,command])).rows[0].result;
 const read=async():Promise<GanttSnapshot>=>(await db.query('SELECT gantt_session_read($1) AS result',[tokens.owner])).rows[0].result;
 const events=async()=>(await db.query('SELECT gantt_session_calendar_events($1) AS result',[tokens.owner])).rows[0].result as Array<{id:string}>;
 const space=createSpace('공유','owner');space.shared=true;space.members=[{userId:'editor',canEdit:true},{userId:'viewer',canEdit:false}];
 const source=createProject('원본',space.id,'owner'),target=createProject('목적지',space.id,'owner');const calendarId=crypto.randomUUID();source.tasks=[{...createTask('옮길 작업'),calendarId}];
 await db.query("INSERT INTO calendars(id,owner_id,visibility) VALUES($1,'owner','team')",[calendarId]);await db.query("INSERT INTO calendar_members VALUES($1,'editor',true)",[calendarId]);
 await execute({type:'saveSpace',space,expectedRevision:null});for(const project of [source,target])await execute({type:'saveProject',project,expectedRevision:null});
 const pair=(snapshot:GanttSnapshot):Extract<GanttCommand,{type:'saveProjectPair'}>=>{const s=snapshot.projects.find(p=>p.id===source.id)!,t=snapshot.projects.find(p=>p.id===target.id)!,moved=relocateTask(s,s.tasks[0].id,t,null,'inside');return {type:'saveProjectPair',projects:[{project:moved.sourceProject,expectedRevision:s.revision},{project:moved.targetProject,expectedRevision:t.revision}],expectedSpaces:[{spaceId:space.id,expectedRevision:snapshot.spaces[0].revision}]};};
 return {db,execute,read,events,space,source,target,pair,calendarId};
}
test('SQL upgrade enables one atomic pair through existing private session wrapper, with replay and projection parity', {skip:!runtime},async()=>{
 const h=await harness(false);try{const before=await h.read(),command=h.pair(before);await assert.rejects(h.execute(command),/알 수 없는/);assert.deepEqual(await h.read(),before);await h.db.exec('RESET ROLE');await h.db.exec(sql(upgrade));await h.db.exec('SET ROLE anon');
 const request=crypto.randomUUID(),saved=await h.execute(command,'editor',request);assert.equal(saved.projects.find(p=>p.id===h.source.id)?.tasks.length,0);assert.equal(saved.projects.find(p=>p.id===h.target.id)?.tasks[0].id,h.source.tasks[0].id);assert.ok(saved.projects.every(p=>p.revision===2));assert.deepEqual(await h.execute(command,'editor',request),saved);assert.deepEqual((await h.events()).map(e=>e.id),[`gantt:${h.target.id}:${h.source.tasks[0].id}`]);
 await assert.rejects(h.execute({...command,expectedSpaces:[]},'editor',request),/같은 요청/);await assert.rejects(h.db.query("SELECT gantt_execute('owner','forged',$1)",[command]),/permission denied/);
 await h.db.exec('RESET ROLE');await h.db.exec(sql(upgrade));await h.db.exec('SET ROLE anon');assert.deepEqual(await h.read(),saved);
 }finally{await h.db.close();}
});
test('SQL pair validates second revision, permissions, metadata and malformed batch before either project changes', {skip:!runtime},async()=>{
 const h=await harness();try{const before=await h.read(),command=h.pair(before);
 const badCommands:GanttCommand[]=[{...command,projects:[command.projects[0],{...command.projects[1],expectedRevision:77}]},{...command,projects:[command.projects[0],{...command.projects[1],project:{...command.projects[1].project,name:'변조'}}]},{...command,projects:[command.projects[0],command.projects[0]]},{...command,expectedSpaces:[]}];
 for(const bad of badCommands){await assert.rejects(h.execute(bad));assert.deepEqual(await h.read(),before);}await assert.rejects(h.execute(command,'viewer'),/권한/);assert.deepEqual(await h.read(),before);
 const invalidTarget={...command.projects[1].project,tasks:[{...command.projects[1].project.tasks[0],parentId:crypto.randomUUID()}]};await assert.rejects(h.execute({...command,projects:[command.projects[0],{...command.projects[1],project:invalidTarget}]}));assert.deepEqual(await h.read(),before);
 await h.db.exec('RESET ROLE');const count=await h.db.query("SELECT count(*)::int AS n FROM gantt_requests WHERE command->>'type'='saveProjectPair'");assert.equal(count.rows[0].n,0);
 }finally{await h.db.close();}
});
test('SQL folder permission revisions and linked-calendar permission revocation abort the complete transfer', {skip:!runtime},async()=>{
 const h=await harness();try{const command=h.pair(await h.read());await h.execute({type:'saveSpace',space:{...h.space,name:'폴더 변경'},expectedRevision:1});const before=await h.read();assert.ok(before.projects.every(p=>p.revision===1));await assert.rejects(h.execute(command,'editor'),/폴더.*먼저 수정/);assert.deepEqual(await h.read(),before);
 await h.db.query("UPDATE calendar_members SET can_edit=false WHERE user_id='editor'");await assert.rejects(h.execute(h.pair(before),'editor'),/캘린더.*편집 권한/);assert.deepEqual(await h.read(),before);assert.equal((await h.events()).length,1);
 }finally{await h.db.close();}
});
test('real session RPC pair round trips through store undo/redo and aborts if target changes before restore', {skip:!runtime},async()=>{
 const h=await harness(),store=createGanttStore();try{await store.getState().initialize('owner',{read:h.read,execute:r=>h.execute(r.command,'owner',r.requestId)});await store.getState().execute(h.pair(store.getState().snapshot));await store.getState().undo();assert.equal((await h.events())[0].id,`gantt:${h.source.id}:${h.source.tasks[0].id}`);await store.getState().redo();assert.equal((await h.events())[0].id,`gantt:${h.target.id}:${h.source.tasks[0].id}`);
 const target=(await h.read()).projects.find(p=>p.id===h.target.id)!;await h.execute({type:'saveProject',project:{...target,memo:'다른 사용자의 수정'},expectedRevision:target.revision},'editor');const current=await h.read();await assert.rejects(store.getState().undo(),/다른 변경/);assert.deepEqual(await h.read(),current);
 }finally{await store.getState().initialize(null);await h.db.close();}
});
test('cross-folder pairs require both folder revisions and both project edit scopes', {skip:!runtime},async()=>{
 const h=await harness();try{const otherSpace=createSpace('개인 폴더','owner');await h.execute({type:'saveSpace',space:otherSpace,expectedRevision:null});const other=createProject('다른 폴더 프로젝트',otherSpace.id,'owner');await h.execute({type:'saveProject',project:other,expectedRevision:null});
 const before=await h.read(),source=before.projects.find(p=>p.id===h.source.id)!,moved=relocateTask(source,source.tasks[0].id,other,null,'inside');const command:Extract<GanttCommand,{type:'saveProjectPair'}>={type:'saveProjectPair',projects:[{project:moved.sourceProject,expectedRevision:1},{project:moved.targetProject,expectedRevision:1}],expectedSpaces:[{spaceId:h.space.id,expectedRevision:1},{spaceId:otherSpace.id,expectedRevision:1}]};
 await assert.rejects(h.execute({...command,expectedSpaces:[command.expectedSpaces[0]]}));await assert.rejects(h.execute(command,'editor'),/권한/);assert.deepEqual(await h.read(),before);
 const saved=await h.execute(command);assert.equal(saved.projects.find(p=>p.id===other.id)?.tasks[0].id,h.source.tasks[0].id);assert.equal(saved.projects.find(p=>p.id===source.id)?.tasks.length,0);assert.equal(saved.projects.find(p=>p.id===h.target.id)?.revision,1);
 }finally{await h.db.close();}
});
