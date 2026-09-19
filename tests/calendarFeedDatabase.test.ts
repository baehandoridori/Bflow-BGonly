import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createSpace,createProject,createTask} from '../src/features/gantt/domain.ts';
const runtime=process.env.BFLOW_PGLITE_MODULE;
const sql=(name:string)=>readFileSync(new URL(`../DEVLOG/migrations/${name}`,import.meta.url),'utf8');
const migration='20260919170351_calendar_external_feed.sql';
test('external feed owner management, service-only lookup, projections, rotation/CAS, and source invalidation',{skip:!runtime},async()=>{
 const {PGlite}=await import(pathToFileURL(runtime!).href);const db=new PGlite();
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT DEFAULT 'user',password TEXT,slack_id TEXT,hire_date TEXT,birthday TEXT,is_initial_password BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT now(),is_compositor BOOLEAN DEFAULT false,is_acting_supervisor BOOLEAN DEFAULT false);
 INSERT INTO users(id,name,password,role) VALUES('owner','owner','pw','user'),('editor','editor','pw','user'),('other','other','pw','user'),('fcc4b438-2696-4e88-a03f-d6f34e73e08f','overview','pw','admin');`);
 await db.exec(sql('2026-08-24-shared-calendars.sql').split('-- ── 1-1)')[0]);await db.exec("ALTER TABLE calendar_events ADD COLUMN tag_ids UUID[] NOT NULL DEFAULT '{}'");
 for(const file of ['2026-09-05-gantt-workspaces.sql','2026-09-05-gantt-containment.sql','2026-09-05-app-sessions-gantt-auth.sql','20260905151837_gantt_release_acl.sql','20260905173804_gantt_revision_ledger.sql','20260905193555_gantt_project_pair.sql','20260905210416_gantt_calendar_color.sql',migration])await db.exec(sql(file));
 const calendar=crypto.randomUUID(),hidden=crypto.randomUUID(),event=crypto.randomUUID(),tag=crypto.randomUUID();
 await db.query("INSERT INTO calendars(id,name,owner_id,visibility) VALUES($1,'구독 대상','owner','members'),($2,'비공개 제외','owner','private')",[calendar,hidden]);await db.query("INSERT INTO calendar_members(calendar_id,user_id,can_edit) VALUES($1,'editor',true)",[calendar]);
 await db.query("INSERT INTO calendar_tags(id,name,color) VALUES($1,'회의','#123456')",[tag]);await db.query("INSERT INTO calendar_events(id,calendar_id,title,memo,start_date,end_date,tag_ids) VALUES($1,$2,'원본','메모','2026-09-20','2026-09-20',ARRAY[$3::uuid])",[event,calendar,tag]);await db.query("INSERT INTO calendar_events(calendar_id,title,start_date,end_date) VALUES($1,'노출 금지','2026-09-20','2026-09-20')",[hidden]);
 await db.exec('SET ROLE anon');const tokens:Record<string,string>={};for(const actor of ['owner','editor','other','overview'])tokens[actor]=(await db.query('SELECT app_login($1,$2) AS result',[actor,'pw'])).rows[0].result.token;
 const status=async(actor='owner')=>(await db.query('SELECT calendar_session_feed_status($1,$2) AS result',[tokens[actor],calendar])).rows[0].result;
 const manage=async(action:string,hash:string|null,revision:string|null,actor='owner')=>(await db.query('SELECT calendar_session_feed_manage($1,$2,$3,$4,$5) AS result',[tokens[actor],calendar,action,hash,revision])).rows[0].result;
 const read=async(hash:string)=>{await db.exec('SET ROLE service_role');try{return (await db.query('SELECT calendar_feed_read($1) AS result',[hash])).rows[0].result;}finally{await db.exec('SET ROLE anon');}};
 const mutate=async(statement:string,args:unknown[]=[])=>{await db.exec('RESET ROLE');try{await db.query(statement,args);}finally{await db.exec('SET ROLE anon');}};
 const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
 assert.deepEqual(await status(),{calendarId:calendar,enabled:false,issuedAt:null,revision:null});
 for(const actor of ['editor','other','overview']){await assert.rejects(status(actor),/소유자/);await assert.rejects(manage('enable',a,null,actor),/소유자/);}
 await assert.rejects(db.query('SELECT * FROM calendar_external_feeds'),/permission denied/);await assert.rejects(db.query('SELECT calendar_feed_read($1)',[a]),/permission denied/);await db.exec('SET ROLE authenticated');await assert.rejects(db.query('SELECT calendar_feed_read($1)',[a]),/permission denied/);await db.exec('SET ROLE anon');
 assert.equal(await read(a),null);await assert.rejects(manage('enable','short',null),/해시/);await assert.rejects(manage('rotate',a,null),/활성화/);
 const enabled=await manage('enable',a,null);assert.equal(enabled.enabled,true);assert.ok(enabled.revision);assert.ok(enabled.issuedAt);assert.equal(JSON.stringify(enabled).includes(a),false);assert.deepEqual(await manage('enable',a,null),enabled);
 let data=await read(a);assert.equal(data.calendar.id,calendar);assert.deepEqual(data.events.map((x:any)=>x.title),['원본']);assert.deepEqual(data.events[0].categories,['회의']);assert.equal('created_by' in data.events[0],false);
 const space=createSpace('프로젝트 비밀','owner'),project=createProject('프로젝트 비밀',space.id,'owner');project.tasks=[{...createTask('간트 노출','2026-09-20'),calendarId:calendar},{...createTask('간트 제외','2026-09-20'),calendarId:hidden},{...createTask('그룹 제외','2026-09-20'),kind:'group',calendarId:calendar}];
 await db.query('SELECT gantt_session_execute($1,$2,$3)',[tokens.owner,'s',{type:'saveSpace',space,expectedRevision:null}]);await db.query('SELECT gantt_session_execute($1,$2,$3)',[tokens.owner,'p',{type:'saveProject',project,expectedRevision:null}]);data=await read(a);assert.equal(data.events.length,2);assert.equal(new Set(data.events.map((x:any)=>x.id)).size,2);assert.equal(JSON.stringify(data).includes('프로젝트 비밀'),false);assert.equal(JSON.stringify(data).includes('간트 제외'),false);assert.equal(JSON.stringify(data).includes('그룹 제외'),false);
 const otherSpace=createSpace('다른 소유자의 비공개 프로젝트','editor'),otherProject=createProject('다른 소유자 제목 비밀',otherSpace.id,'editor');otherProject.memo='프로젝트 메모 비밀';otherProject.tasks=[{...createTask('캘린더에 명시적으로 공유한 작업','2026-09-20'),calendarId:calendar}];
 await db.query('SELECT gantt_session_execute($1,$2,$3)',[tokens.editor,'editor-s',{type:'saveSpace',space:otherSpace,expectedRevision:null}]);await db.query('SELECT gantt_session_execute($1,$2,$3)',[tokens.editor,'editor-p',{type:'saveProject',project:otherProject,expectedRevision:null}]);
 const ownerSnapshot=(await db.query('SELECT gantt_session_read($1) AS result',[tokens.owner])).rows[0].result;assert.equal(ownerSnapshot.projects.some((p:any)=>p.id===otherProject.id),false);
 const crossOwnerFeed=await read(a);assert.ok(crossOwnerFeed.events.some((e:any)=>e.title==='캘린더에 명시적으로 공유한 작업'));assert.equal(JSON.stringify(crossOwnerFeed).includes('프로젝트 메모 비밀'),false);assert.equal(JSON.stringify(crossOwnerFeed).includes('다른 소유자 제목 비밀'),false);
 await mutate("UPDATE calendar_events SET title='변경' WHERE id=$1",[event]);assert.ok((await read(a)).events.some((x:any)=>x.title==='변경'));await mutate('DELETE FROM calendar_events WHERE id=$1',[event]);assert.equal((await read(a)).events.length,2);
 const rotated=await manage('rotate',b,enabled.revision);assert.notEqual(rotated.revision,enabled.revision);assert.equal(await read(a),null);assert.ok(await read(b));await assert.rejects(manage('revoke',null,enabled.revision),/변경/);await assert.rejects(manage('rotate',c,enabled.revision),/변경/);assert.ok(await read(b));assert.deepEqual(await manage('rotate',b,enabled.revision),rotated);
 const revoked=await manage('revoke',null,rotated.revision);assert.equal(revoked.enabled,false);assert.equal(await read(b),null);assert.deepEqual(await manage('revoke',null,rotated.revision),revoked);await assert.rejects(manage('enable',c,null),/변경/);const reenabled=await manage('enable',c,revoked.revision);assert.ok(reenabled.enabled);
 await mutate("UPDATE calendars SET owner_id='editor' WHERE id=$1",[calendar]);assert.equal(await read(c),null);await assert.rejects(status('owner'),/소유자/);assert.equal((await status('editor')).enabled,false);await mutate("UPDATE calendars SET owner_id='owner' WHERE id=$1",[calendar]);assert.equal(await read(c),null);assert.equal((await status()).revision,null);
 await manage('enable',a,null);await mutate('DELETE FROM calendars WHERE id=$1',[calendar]);assert.equal(await read(a),null);await assert.rejects(status(),/소유자/);
 await db.exec('RESET ROLE');await db.exec(sql(migration));
 }finally{await db.close();}
});
