import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {getOccurrenceDates} from '../src/shared/calendarRecurrence.ts';
const runtime=process.env.BFLOW_PGLITE_MODULE;
const sql=(name:string)=>readFileSync(new URL(`../DEVLOG/migrations/${name}`,import.meta.url),'utf8');
const migration='20260920061229_calendar_recurrence.sql';
test('recurrence session mutations preserve source ACL, revisions, exceptions, splits, legacy safety and feeds',{skip:!runtime},async(t)=>{
 const {PGlite}=await import(pathToFileURL(runtime!).href);const db=new PGlite();
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT DEFAULT 'user',password TEXT,slack_id TEXT,hire_date TEXT,birthday TEXT,is_initial_password BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT now(),is_compositor BOOLEAN DEFAULT false,is_acting_supervisor BOOLEAN DEFAULT false);
 INSERT INTO users(id,name,password) VALUES('owner','owner','pw'),('editor','editor','pw'),('reader','reader','pw'),('outsider','outsider','pw');`);
 const shared=sql('2026-08-24-shared-calendars.sql');await db.exec(shared.split('-- ── 1-1)')[0]);
 for(const name of ['create_calendar_event_authorized','update_calendar_event_authorized','delete_calendar_event_authorized','replace_calendar_tags_authorized'])await db.exec(shared.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))![0]);
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON calendars,calendar_members,calendar_events,calendar_tags TO anon,authenticated');
 for(const file of ['2026-09-05-gantt-workspaces.sql','2026-09-05-app-sessions-gantt-auth.sql','20260905210416_gantt_calendar_color.sql','2026-09-16-calendar-admin-overview-tags.sql','20260919170351_calendar_external_feed.sql','2026-09-17-calendar-linked-gantt.sql',migration])await db.exec(sql(file));
 await db.exec(sql(migration));
 const calendar=crypto.randomUUID(),other=crypto.randomUUID();
 await db.query("INSERT INTO calendars(id,name,owner_id,visibility) VALUES($1,'source','owner','members'),($2,'denied','outsider','private')",[calendar,other]);
 await db.query("INSERT INTO calendar_members(calendar_id,user_id,can_edit) VALUES($1,'editor',true),($1,'reader',false)",[calendar]);
 const tokens:Record<string,string>={};for(const actor of ['owner','editor','reader','outsider'])tokens[actor]=(await db.query('SELECT app_login($1,$2) AS result',[actor,'pw'])).rows[0].result.token;
 await db.exec('SET ROLE anon');
 const list=async(actor='owner')=>(await db.query('SELECT calendar_session_recurrence_events($1) AS result',[tokens[actor]])).rows[0].result;
 const execute=async(action:string,id:string|null,revision:number,patch:any={},date:string|null=null,scope='all',actor='owner')=>(await db.query('SELECT calendar_session_recurrence_execute($1,$2,$3,$4,$5,$6,$7) AS result',[tokens[actor],action,id,date,scope,revision,{...(action==='create'?{}:{expected_calendar_id:calendar}),...patch}])).rows[0].result;
 const create=async(patch:any={},actor='owner')=>execute('create',null,0,{calendar_id:calendar,title:'Series',memo:'memo',all_day:true,start_date:'2026-01-31',end_date:'2026-01-31',recurrence_rule:{frequency:'monthly',interval:1,count:5},...patch},null,'all',actor);
 let event:any;
 await t.test('source editors can create; read-only members cannot; private exception rows cannot be accessed directly',async()=>{
  await assert.rejects(create({},'reader'),{code:'42501'});event=(await create({},'editor')).event;
  assert.equal(event.created_by,'editor');assert.equal(event.recurrence_revision,0);assert.deepEqual(event.recurrence_exceptions,[]);
  assert.equal((await list('reader')).length,1);assert.deepEqual(await list('outsider'),[]);
  await assert.rejects(db.query('SELECT * FROM calendar_event_exceptions'),{code:'42501'});
  await assert.rejects(execute('update',event.id,0,{title:'denied'},null,'all','reader'),{code:'42501'});
 });
 await t.test('invalid dates, injected fields, URLs, reminder bounds and rules rollback',async()=>{
  for(const patch of [{created_by:'outsider'},{meeting_url:'javascript:alert(1)'},{reminder_minutes:-1},{recurrence_rule:{frequency:'monthly',interval:0}},{recurrence_rule:{frequency:'daily',interval:1,count:2,until:'2027-01-01'}},{end_date:'2025-01-01'}])await assert.rejects(create(patch));
  await assert.rejects(execute('update',event.id,0,{title:'not occurrence'},'2026-02-28','this'),{code:'22023'});
  assert.equal((await list()).length,1);
 });
 await t.test('single override and cancel maintain identity and CAS; ordinary all edits retain exceptions',async()=>{
  event=(await execute('update',event.id,0,{title:'Moved',start_date:'2026-04-01',end_date:'2026-04-01',location:'room',meeting_url:'https://example.com/meet',reminder_minutes:10},'2026-03-31','this')).event;
  assert.equal(event.recurrence_revision,1);assert.equal(event.recurrence_exceptions[0].occurrence_date,'2026-03-31');assert.equal(event.recurrence_exceptions[0].patch.title,'Moved');
  await assert.rejects(execute('delete',event.id,0,{},'2026-05-31','this'),{code:'40001'});
  event=(await execute('delete',event.id,1,{},'2026-05-31','this')).event;assert.equal(event.recurrence_exceptions[1].cancelled,true);
  event=(await execute('update',event.id,2,{memo:'new memo'})).event;assert.equal(event.recurrence_exceptions.length,2);
 });
 await t.test('old APIs cannot accidentally edit/delete a whole recurring series',async()=>{
  await assert.rejects(db.query('SELECT * FROM calendar_session_event_update($1,$2,$3,$4)',[tokens.owner,event.id,calendar,{title:'old'}]),{code:'22023'});
  await assert.rejects(db.query('SELECT * FROM delete_calendar_event_authorized($1,$2,$3)',['owner',event.id,calendar]),{code:'22023'});
 });
 await t.test('following split counts only valid month dates and transfers future exceptions',async()=>{
  const split=await execute('update',event.id,3,{title:'Following'},'2026-03-31','following');
  assert.equal(split.event.recurrence_rule.until,'2026-03-30');assert.equal(split.event.recurrence_rule.count,undefined);
  assert.equal(split.split_event.start_date,'2026-03-31');assert.equal(split.split_event.recurrence_rule.count,4);
  assert.equal(split.event.recurrence_exceptions.length,0);assert.equal(split.split_event.recurrence_exceptions.length,2);
  event=split.split_event;
  event=(await execute('update',event.id,0,{recurrence_rule:{frequency:'weekly',interval:1,weekdays:[2],count:3}})).event;
  assert.deepEqual(event.recurrence_exceptions,[]);
 });
 await t.test('source moves verify both calendars and prior calendar; session expiry rejects all operations',async()=>{
  await assert.rejects(execute('update',event.id,1,{calendar_id:other}),{code:'42501'});
  await assert.rejects(execute('update',event.id,1,{expected_calendar_id:other,title:'stale'}),{code:'40001'});
  await assert.rejects(db.query('SELECT calendar_session_recurrence_events($1)',['invalid']),{code:'42501'});
 });
 await t.test('SQL membership indexes exactly match the shared engine for weekly, leap, last-day and nth-weekday rules',async()=>{
  const cases:any[]=[['2026-01-07',{frequency:'weekly',interval:2,weekdays:[0,1,5],count:19},'2027-01-01'],['2026-01-31',{frequency:'monthly',interval:1,count:9},'2028-01-01'],['2026-01-15',{frequency:'monthly',interval:2,monthlyMode:'lastDay',count:9},'2028-01-01'],['2026-01-01',{frequency:'monthly',interval:1,monthlyMode:'weekday',ordinal:5,weekday:4,count:10},'2029-01-01'],['2026-01-01',{frequency:'monthly',interval:1,monthlyMode:'weekday',ordinal:-1,weekday:1,until:'2027-04-01'},'2028-01-01'],['2024-02-29',{frequency:'yearly',interval:1,count:3},'2036-03-01'],['2026-01-01',{frequency:'daily',interval:3,count:10},'2026-06-01']];
  await db.exec('RESET ROLE');
  for(const [anchor,rule,end] of cases){
   const expected=getOccurrenceDates(anchor,rule,anchor,end);
   const actual=(await db.query(`SELECT to_char(d,'YYYY-MM-DD') AS date,calendar_recurrence_index($1,$2,d::date) AS index FROM generate_series($1::date,$3::date,interval '1 day') d`,[anchor,rule,end])).rows.filter((row:any)=>row.index>0);
   assert.deepEqual(actual.map((row:any)=>row.date),expected,JSON.stringify(rule));assert.deepEqual(actual.map((row:any)=>row.index),expected.map((_:string,i:number)=>i+1));
  }
  await db.exec('SET ROLE anon');
 });
 await t.test('normal events retain old-client updates and revision conflicts; direct recurring writes are denied',async()=>{
  const normal=(await create({recurrence_rule:null,title:'normal'})).event;
  const legacy=(await db.query('SELECT * FROM calendar_session_event_update($1,$2,$3,$4)',[tokens.owner,normal.id,calendar,{title:'old client edit'}])).rows[0];assert.equal(legacy.recurrence_revision,1);
  await assert.rejects(execute('update',normal.id,0,{memo:'stale'}),{code:'40001'});
  await assert.rejects(db.query("UPDATE calendar_events SET title='direct' WHERE id=$1",[event.id]),{code:'42501'});
  await assert.rejects(db.query('DELETE FROM calendar_events WHERE id=$1',[event.id]),{code:'42501'});
  await assert.rejects(execute('update',event.id,1,{calendar_id:calendar},'2026-03-31','this'),{code:'22023'});
  await assert.rejects(execute('update',normal.id,1,{title:'invalid occurrence'},'2026-01-31','this'),{code:'22023'});
 });
 await t.test('linked Gantt exposes raw recurrence metadata and no reverse calendar projection',async()=>{
  const result=await db.query('SELECT gantt_session_execute_v2($1,$2,$3) AS result',[tokens.owner,'link-recurring',{type:'linkCalendar',calendarId:calendar}]);
  const task=result.rows[0].result.projects[0].tasks.find((task:any)=>task.id===event.id);
  assert.deepEqual(task.recurrenceRule,event.recurrence_rule);assert.equal(task.sourceCalendarEventId,event.id);assert.equal(task.calendarId,null);
  assert.deepEqual((await db.query('SELECT gantt_session_calendar_events($1) AS result',[tokens.owner])).rows[0].result,[]);
 });
 await t.test('tag override cleanup is durable and feed exports exception tag names',async()=>{
  const tag=crypto.randomUUID();await db.exec('RESET ROLE');await db.query("INSERT INTO calendar_tags(id,name,color) VALUES($1,'Exception tag','#123456')",[tag]);await db.exec('SET ROLE anon');
  event=(await execute('update',event.id,1,{tag_ids:[tag]},'2026-03-31','this')).event;
  const projection=async()=>(await db.query('SELECT gantt_session_read_v2($1) AS result',[tokens.owner])).rows[0].result.projects[0].tasks.find((task:any)=>task.id===event.id);
  assert.equal((await projection()).recurrenceExceptions[0].patch.color,'#123456');
  await db.query('SELECT calendar_session_feed_manage($1,$2,$3,$4,$5)',[tokens.owner,calendar,'enable','a'.repeat(64),null]);
  await db.exec('SET ROLE service_role');let feed=(await db.query('SELECT calendar_feed_read($1) AS result',['a'.repeat(64)])).rows[0].result;
  assert.deepEqual(feed.events.find((row:any)=>row.id===event.id).recurrence_exceptions[0].patch.categories,['Exception tag']);
  await db.exec('RESET ROLE');await db.query('DELETE FROM calendar_tags WHERE id=$1',[tag]);await db.exec('SET ROLE anon');
  event=(await list()).find((row:any)=>row.id===event.id);assert.deepEqual(event.recurrence_exceptions[0].patch.tag_ids,[]);assert.equal(event.recurrence_exceptions[0].patch.tag_id,null);assert.ok(event.recurrence_revision>2);assert.equal((await projection()).recurrenceExceptions[0].patch.color,'#6C5CE7');
 });
 await t.test('following deletion truncates only future dates; changed patterns discard only future exceptions',async()=>{
  let source=(await create({start_date:'2026-01-01',end_date:'2026-01-01',recurrence_rule:{frequency:'daily',interval:1,count:10}})).event;
  source=(await execute('update',source.id,0,{memo:'past'},'2026-01-02','this')).event;
  source=(await execute('update',source.id,1,{memo:'future'},'2026-01-07','this')).event;
  const split=await execute('update',source.id,2,{recurrence_rule:{frequency:'weekly',interval:1,count:2}},'2026-01-05','following');
  assert.equal(split.event.recurrence_exceptions.length,1);assert.equal(split.split_event.recurrence_exceptions.length,0);
  const deleted=await execute('delete',split.split_event.id,0,{},'2026-01-12','following');assert.equal(deleted.event.recurrence_rule.until,'2026-01-11');
  const first=await execute('delete',deleted.event.id,1,{},'2026-01-05','following');assert.equal(first.deleted,true);
 });
 await t.test('all edits preserve override validity and changing start clears exceptions atomically',async()=>{
  let master=(await create({start_date:'2026-06-01',end_date:'2026-06-01',all_day:false,start_time:'09:00',end_time:'17:00',recurrence_rule:{frequency:'daily',interval:1,count:4}})).event;
  master=(await execute('update',master.id,0,{start_time:'16:00'},'2026-06-02','this')).event;
  await assert.rejects(execute('update',master.id,1,{end_time:'12:00'}),{code:'22023'});
  assert.equal((await list()).find((row:any)=>row.id===master.id).recurrence_revision,1);
  master=(await execute('update',master.id,1,{start_date:'2026-06-03',end_date:'2026-06-03'})).event;assert.deepEqual(master.recurrence_exceptions,[]);
 });
 await t.test('following inherited edits reject invalid transferred overrides and roll back the split',async()=>{
  let master=(await create({start_date:'2026-07-01',end_date:'2026-07-01',all_day:false,start_time:'09:00',end_time:'17:00',recurrence_rule:{frequency:'daily',interval:1,count:4}})).event;
  master=(await execute('update',master.id,0,{start_time:'16:00'},'2026-07-03','this')).event;
  const before=await list();await assert.rejects(execute('update',master.id,1,{end_time:'12:00'},'2026-07-02','following'),{code:'22023'});assert.deepEqual(await list(),before);
 });
 await t.test('source calendar deletion still cascades recurring masters and exceptions',async()=>{
  const disposable=crypto.randomUUID();await db.exec('RESET ROLE');await db.query("INSERT INTO calendars(id,name,owner_id) VALUES($1,'disposable','owner')",[disposable]);await db.exec('SET ROLE anon');
  const master=(await create({calendar_id:disposable})).event;
  await db.query('DELETE FROM calendars WHERE id=$1',[disposable]);assert.equal((await list()).some((row:any)=>row.id===master.id),false);
 });
 await t.test('service feed retains series metadata; revoked source members lose raw masters',async()=>{
  await db.query('SELECT calendar_session_feed_manage($1,$2,$3,$4,$5)',[tokens.owner,calendar,'enable','a'.repeat(64),null]);
  await db.exec('SET ROLE service_role');const feed=(await db.query('SELECT calendar_feed_read($1) AS result',['a'.repeat(64)])).rows[0].result;
  assert.ok(feed.events.find((row:any)=>row.id===event.id).recurrence_rule);await db.exec('RESET ROLE');
  await db.query("DELETE FROM calendar_members WHERE calendar_id=$1 AND user_id='reader'",[calendar]);await db.exec('SET ROLE anon');assert.deepEqual(await list('reader'),[]);
 });
 }finally{await db.close();}
});
