import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createProject, createSpace, createTask } from '../src/features/gantt/domain.ts';

const runtime = process.env.BFLOW_PGLITE_MODULE;
const migration = (name: string) => readFileSync(new URL(`../DEVLOG/migrations/${name}`, import.meta.url), 'utf8');
const overviewId = 'fcc4b438-2696-4e88-a03f-d6f34e73e08f';
const privateId = '00000000-0000-4000-8000-000000000101';
const teamId = '00000000-0000-4000-8000-000000000102';
const tags = ['00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000203'];

test('calendar overview and multi-tag migration preserve legacy events and enforce session permissions', { skip: !runtime }, async (t) => {
 const { PGlite } = await import(pathToFileURL(runtime!).href);
 const db = new PGlite();
 try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT DEFAULT 'user',password TEXT,slack_id TEXT,hire_date TEXT,birthday TEXT,
    is_initial_password BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT now(),is_compositor BOOLEAN DEFAULT false,is_acting_supervisor BOOLEAN DEFAULT false);
   GRANT SELECT,INSERT,UPDATE,DELETE ON users TO anon,authenticated;
   INSERT INTO users(id,name,role,password) VALUES ('${overviewId}','overview','admin','test'),('owner','owner','user','test'),('viewer','viewer','user','test'),('other-admin','other-admin','admin','test');`);
  const shared = migration('2026-08-24-shared-calendars.sql');
  // Use the real calendar schema/RPC definitions; unrelated one-time legacy data
  // copies require production-only tables and are outside this upgrade's contract.
  await db.exec(shared.slice(0, shared.indexOf('-- ── 1-1)')));
  for(const name of ['list_calendar_events_authorized','create_calendar_event_authorized','update_calendar_event_authorized','replace_calendar_tags_authorized']){
   const definition=shared.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
   assert.ok(definition,`missing old RPC ${name}`);await db.exec(definition[0]);
  }
  await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON calendars,calendar_members,calendar_events,calendar_tags TO anon,authenticated');
  for(const file of ['2026-09-05-gantt-workspaces.sql','2026-09-05-app-sessions-gantt-auth.sql','20260905210416_gantt_calendar_color.sql'])await db.exec(migration(file));
  await db.exec(`INSERT INTO calendars(id,name,visibility,owner_id) VALUES ('${privateId}','비공개','private','owner'),('${teamId}','팀','team','owner');
   INSERT INTO calendar_tags(id,name,color,sort_order) VALUES ('${tags[0]}','A','#111111',0),('${tags[1]}','B','#222222',1),('${tags[2]}','C','#333333',2);
   INSERT INTO calendar_events(calendar_id,title,tag_id,start_date,end_date,created_by) VALUES ('${privateId}','구버전 일정','${tags[0]}','2026-09-16','2026-09-16','owner');`);
  const upgrade = migration('2026-09-16-calendar-admin-overview-tags.sql');
  await db.exec(upgrade);
  await db.exec(upgrade);
  const tokens: Record<string,string> = {};
  for(const name of ['overview','owner','viewer','other-admin'])tokens[name]=(await db.query('SELECT app_login($1,$2) AS value',[name,'test'])).rows[0].value.token;
  const input = (patch: Record<string,unknown> = {}) => ({calendar_id:privateId,title:'새 일정',memo:'',tag_id:tags[0],tag_ids:tags,
   all_day:true,start_date:'2026-09-16',end_date:'2026-09-16',start_time:null,end_time:null,linked_episode:null,
   linked_part:null,linked_sheet_name:null,linked_scene_id:null,linked_department:null,linked_todo_id:null,...patch});
  await db.exec('SET ROLE anon');
  const list = async (who:string) => (await db.query('SELECT calendar_session_list($1) AS value',[tokens[who]])).rows[0].value;
  const events = async (who:string) => (await db.query('SELECT * FROM calendar_session_events($1)',[tokens[who]])).rows;

  await t.test('migration is repeatable, legacy tags are backfilled, and only the designated admin sees private calendars',async()=>{
   assert.ok((await list('overview')).calendars.some((row:any)=>row.id===privateId));
   for(const who of ['viewer','other-admin']){
    assert.ok(!(await list(who)).calendars.some((row:any)=>row.id===privateId));
    assert.equal((await events(who)).filter((row:any)=>row.calendar_id===privateId).length,0);
   }
   assert.deepEqual((await events('overview')).find((row:any)=>row.title==='구버전 일정').tag_ids,[tags[0]]);
   await assert.rejects(db.query('SELECT calendar_session_list($1)',['invalid']),{code:'42501'});
   await assert.rejects(db.query('SELECT * FROM calendar_session_event_create($1,$2)',[tokens.overview,input()]),{code:'42501'});
  });

  let eventId:string;
  await t.test('new event writes preserve all tags, title-only old updates preserve them, and old tag edits remain valid',async()=>{
   const created=(await db.query('SELECT * FROM calendar_session_event_create($1,$2)',[tokens.owner,input()])).rows[0];eventId=created.id;
   assert.deepEqual(created.tag_ids,tags);assert.equal(created.tag_id,tags[0]);
   const titleOnly=(await db.query('SELECT * FROM update_calendar_event_authorized($1,$2,$3,$4)',['owner',eventId,privateId,{title:'구버전 제목 수정'}])).rows[0];
   assert.deepEqual(titleOnly.tag_ids,tags);
   const unchangedPrimary=(await db.query('SELECT * FROM update_calendar_event_authorized($1,$2,$3,$4)',['owner',eventId,privateId,{tag_id:tags[0]}])).rows[0];
   assert.deepEqual(unchangedPrimary.tag_ids,tags,'an unchanged legacy primary must not erase tags invisible to the old client');
   const legacyChanged=(await db.query('SELECT * FROM update_calendar_event_authorized($1,$2,$3,$4)',['owner',eventId,privateId,{tag_id:tags[1]}])).rows[0];
   assert.deepEqual(legacyChanged.tag_ids,[tags[1]]);
   const legacyCleared=(await db.query('SELECT * FROM update_calendar_event_authorized($1,$2,$3,$4)',['owner',eventId,privateId,{tag_id:null}])).rows[0];
   assert.deepEqual(legacyCleared.tag_ids,[]);assert.equal(legacyCleared.tag_id,null);
   const {tag_ids:_,...legacyInput}=input({tag_id:tags[2]});
   const legacyCreate=(await db.query('SELECT * FROM create_calendar_event_authorized($1,$2)',['owner',legacyInput])).rows[0];
   assert.deepEqual(legacyCreate.tag_ids,[tags[2]]);
   const oldRows=(await db.query('SELECT * FROM list_calendar_events_authorized($1)',['owner'])).rows;
   assert.ok(oldRows.some((row:any)=>row.id===legacyCreate.id));
  });

  await t.test('invalid tags roll back the entire update and an explicit empty tag list clears tags',async()=>{
   const before=(await events('owner')).find((row:any)=>row.id===eventId);
   await assert.rejects(db.query('SELECT * FROM calendar_session_event_update($1,$2,$3,$4)',[tokens.owner,eventId,privateId,{title:'되돌려야 함',tag_ids:['00000000-0000-4000-8000-999999999999']}]),{code:'23503'});
   assert.deepEqual((await events('owner')).find((row:any)=>row.id===eventId),before);
   const cleared=(await db.query('SELECT * FROM calendar_session_event_update($1,$2,$3,$4)',[tokens.owner,eventId,privateId,{tag_ids:[]}])).rows[0];
   assert.deepEqual(cleared.tag_ids,[]);assert.equal(cleared.tag_id,null);
  });

  await t.test('deleting a tag removes only that tag and the tag catalog cannot be changed without an admin session',async()=>{
   await db.query('SELECT * FROM calendar_session_event_update($1,$2,$3,$4)',[tokens.owner,eventId,privateId,{tag_ids:tags}]);
   await assert.rejects(db.query('SELECT * FROM calendar_session_tags_save($1,$2)',[tokens.owner,[]]),{code:'42501'});
   await assert.rejects(db.query('SELECT * FROM replace_calendar_tags_authorized($1,$2)',[overviewId,[]]),{code:'42501'});
   await assert.rejects(db.query('DELETE FROM calendar_tags WHERE id=$1',[tags[0]]),{code:'42501'});
   const catalog=(await db.query('SELECT id,name,color,sort_order FROM calendar_tags WHERE id<>$1',[tags[0]])).rows;
   await db.query('SELECT * FROM calendar_session_tags_save($1,$2)',[tokens.overview,catalog]);
   const updated=(await events('owner')).find((row:any)=>row.id===eventId);
   assert.deepEqual(updated.tag_ids,tags.slice(1));assert.equal(updated.tag_id,tags[1]);
  });

  await t.test('overview includes only calendar-linked private Gantt tasks and keeps them read-only',async()=>{
   const space=createSpace('비공개 폴더','owner'),project=createProject('비공개 프로젝트',space.id,'owner');
   const linked={...createTask('비공개 캘린더 연결','2026-09-16'),calendarId:privateId},unlinked=createTask('미연결 작업','2026-09-16');
   project.tasks=[linked,unlinked];
   await db.query('SELECT gantt_session_execute($1,$2,$3)',[tokens.owner,'create-space',{type:'saveSpace',space,expectedRevision:null}]);
   await db.query('SELECT gantt_session_execute($1,$2,$3)',[tokens.owner,'create-project',{type:'saveProject',project,expectedRevision:null}]);
   const projected=async(who:string)=>(await db.query('SELECT gantt_session_calendar_events($1) AS value',[tokens[who]])).rows[0].value;
   const visible=await projected('overview');assert.equal(visible.length,1);assert.equal(visible[0].linked_gantt_task_id,linked.id);assert.equal(visible[0].gantt_can_edit,false);
   assert.deepEqual(await projected('viewer'),[]);assert.deepEqual(await projected('other-admin'),[]);
   const overviewProjects=(await db.query('SELECT gantt_session_read($1) AS value',[tokens.overview])).rows[0].value;
   assert.equal(overviewProjects.projects.length,0);
  });
 } finally { await db.close(); }
});
