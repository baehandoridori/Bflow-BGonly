import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const runtime=process.env.BFLOW_PGLITE_MODULE;
const sql=(name:string)=>readFileSync(new URL(`../DEVLOG/migrations/${name}`,import.meta.url),'utf8');
const migration='20260921034101_calendar_feed_shared_links.sql';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
test('shared subscription aliases preserve legacy feeds, enforce source ACL and lifecycle, and keep recurrence payloads',{skip:!runtime},async(t)=>{
 const {PGlite}=await import(pathToFileURL(runtime!).href);
 const {pgcrypto}=await import(new URL('./contrib/pgcrypto.js',pathToFileURL(runtime!)).href);
 const db=new PGlite({extensions:{pgcrypto}});
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT DEFAULT 'user',password TEXT,slack_id TEXT,hire_date TEXT,birthday TEXT,is_initial_password BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT now(),is_compositor BOOLEAN DEFAULT false,is_acting_supervisor BOOLEAN DEFAULT false);
 INSERT INTO users(id,name,password) VALUES('owner','owner','pw'),('editor','editor','pw'),('reader','reader','pw'),('outsider','outsider','pw');`);
 const shared=sql('2026-08-24-shared-calendars.sql');await db.exec(shared.split('-- ── 1-1)')[0]);
 for(const name of ['create_calendar_event_authorized','update_calendar_event_authorized','delete_calendar_event_authorized','replace_calendar_tags_authorized'])await db.exec(shared.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))![0]);
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON calendars,calendar_members,calendar_events,calendar_tags TO anon,authenticated');
 for(const file of ['2026-09-05-gantt-workspaces.sql','2026-09-05-app-sessions-gantt-auth.sql','20260905210416_gantt_calendar_color.sql','2026-09-16-calendar-admin-overview-tags.sql','20260919170351_calendar_external_feed.sql','2026-09-17-calendar-linked-gantt.sql','20260920061229_calendar_recurrence.sql'])await db.exec(sql(file));

 // Vault is not shipped with PGlite: this fixture exercises its exact SQL interface
 // with real pgcrypto encryption. Production Vault/KMS must also pass rollback smoke.
 await db.exec(`CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 CREATE SCHEMA vault; CREATE TABLE vault.secrets(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),secret BYTEA);
 CREATE VIEW vault.decrypted_secrets AS SELECT id,extensions.pgp_sym_decrypt(secret,'local-test-key') AS decrypted_secret FROM vault.secrets;
 CREATE FUNCTION vault.create_secret(raw TEXT,name TEXT DEFAULT NULL,description TEXT DEFAULT NULL) RETURNS UUID LANGUAGE plpgsql AS $$DECLARE result UUID;BEGIN INSERT INTO vault.secrets(secret) VALUES(extensions.pgp_sym_encrypt(raw,'local-test-key')) RETURNING id INTO result;RETURN result;END$$;`);
 const calendar=crypto.randomUUID(),privateId=crypto.randomUUID(),overview='fcc4b438-2696-4e88-a03f-d6f34e73e08f';
 await db.query("INSERT INTO users(id,name,password,role) VALUES($1,'overview','pw','admin')",[overview]);
 await db.query("INSERT INTO calendars(id,name,owner_id,visibility) VALUES($1,'shared','owner','members'),($2,'private','owner','private')",[calendar,privateId]);
 await db.query("INSERT INTO calendar_members(calendar_id,user_id,can_edit) VALUES($1,'reader',false),($1,'editor',true)",[calendar]);
 await db.query("INSERT INTO calendar_events(calendar_id,title,start_date,end_date,recurrence_rule) VALUES($1,'Recurring','2026-09-21','2026-09-21',$2)",[calendar,{frequency:'weekly',interval:1,count:4}]);
 const tokens:Record<string,string>={};for(const actor of ['owner','reader','editor','outsider','overview'])tokens[actor]=(await db.query('SELECT app_login($1,$2) AS result',[actor,'pw'])).rows[0].result.token;
 const legacy='a'.repeat(64),next='b'.repeat(64);
 const manage=async(action:string,hash:string|null,revision:string|null,actor='owner')=>(await db.query('SELECT calendar_session_feed_manage($1,$2,$3,$4,$5) AS result',[tokens[actor],calendar,action,hash,revision])).rows[0].result as any;
 const status=async(actor='owner',id=calendar)=>(await db.query('SELECT calendar_session_feed_status($1,$2) AS result',[tokens[actor],id])).rows[0].result as any;
 const read=async(hash:string)=>{await db.exec('SET ROLE service_role');try{return (await db.query('SELECT calendar_feed_read($1) AS result',[hash])).rows[0].result as any;}finally{await db.exec('SET ROLE anon');}};
 const admin=async(query:string,args:unknown[]=[])=>{await db.exec('RESET ROLE');try{return await db.query(query,args);}finally{await db.exec('SET ROLE anon');}};
 const before=await manage('enable',legacy,null);
 await db.exec(sql(migration));
 await db.exec('SET ROLE anon');
 let first:any,rotated:any;
 await t.test('existing URL remains active; viewer and owner obtain the same stable alias without changing revision',async()=>{
 first=await status('reader');assert.match(first.aliasToken,/^[A-Za-z0-9_-]{43}$/);assert.equal(first.revision,before.revision);assert.deepEqual(await status(),first);assert.deepEqual(await status('editor'),first);assert.deepEqual(await status('reader'),first);
 assert.deepEqual(await read(legacy),await read(digest(first.aliasToken)));assert.equal((await read(digest(first.aliasToken))).events[0].recurrence_rule.frequency,'weekly');
 });
 await t.test('unshared/overview/invalid session cannot read; only owner can manage',async()=>{
 for(const actor of ['outsider','overview'])await assert.rejects(status(actor),{code:'42501'});
 await assert.rejects(status('reader',privateId),{code:'42501'});
 await assert.rejects(db.query('SELECT calendar_session_feed_status($1,$2)',['invalid',calendar]));
 for(const actor of ['reader','editor','outsider','overview'])await assert.rejects(manage('revoke',null,first.revision,actor),{code:'42501'});
 });
 await t.test('no direct alias, Vault plaintext, private helper or feed access for browser roles',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);for(const query of ['SELECT * FROM calendar_feed_private.aliases','SELECT * FROM vault.decrypted_secrets',"SELECT calendar_feed_private.read_primary('"+legacy+"')","SELECT calendar_feed_read('"+legacy+"')"])await assert.rejects(db.query(query),{code:'42501'});}
 await db.exec('SET ROLE service_role');await assert.rejects(db.query('SELECT * FROM calendar_feed_private.aliases'),{code:'42501'});await assert.rejects(db.query('SELECT calendar_feed_private.read_primary($1)',[legacy]),{code:'42501'});await db.exec('SET ROLE anon');
 });
 await t.test('membership and team changes immediately affect read ACL; reads never publish a disabled calendar',async()=>{
 await admin("DELETE FROM calendar_members WHERE calendar_id=$1 AND user_id='reader'",[calendar]);await assert.rejects(status('reader'),{code:'42501'});
 await admin("UPDATE calendars SET visibility='team' WHERE id=$1",[calendar]);assert.equal((await status('outsider')).aliasToken,first.aliasToken);
 await admin("UPDATE calendars SET visibility='members' WHERE id=$1",[calendar]);await assert.rejects(status('outsider'),{code:'42501'});
 const disabled=await status('owner',privateId);assert.equal(disabled.enabled,false);assert.equal(disabled.aliasToken,null);
 });
 await t.test('old-client rotate and exact retry maintain stable alias and retire both previous URLs',async()=>{
 rotated=await manage('rotate',next,first.revision);assert.notEqual(rotated.aliasToken,first.aliasToken);assert.equal(await read(legacy),null);assert.equal(await read(digest(first.aliasToken)),null);assert.ok(await read(next));assert.ok(await read(digest(rotated.aliasToken)));assert.deepEqual(await manage('rotate',next,first.revision),rotated);
 await assert.rejects(manage('revoke',null,first.revision),{code:'40001'});
 const secrets=await admin('SELECT count(*)::int AS n FROM vault.secrets');assert.equal(secrets.rows[0].n,1);
 });
 await t.test('revoke removes both URLs and secret; source owner transfer and deletion cannot resurrect either',async()=>{
 const revoked=await manage('revoke',null,rotated.revision);assert.equal(revoked.aliasToken,null);assert.equal(await read(next),null);assert.equal(await read(digest(rotated.aliasToken)),null);assert.equal((await admin('SELECT count(*)::int AS n FROM vault.secrets')).rows[0].n,0);
 const enabled=await manage('enable',legacy,revoked.revision);await admin("UPDATE calendars SET owner_id='editor' WHERE id=$1",[calendar]);assert.equal(await read(legacy),null);assert.equal(await read(digest(enabled.aliasToken)),null);await admin("UPDATE calendars SET owner_id='owner' WHERE id=$1",[calendar]);assert.equal((await status()).enabled,false);assert.equal((await admin('SELECT count(*)::int AS n FROM vault.secrets')).rows[0].n,0);
 await manage('enable',next,null);await admin('DELETE FROM calendars WHERE id=$1',[calendar]);assert.equal(await read(next),null);assert.equal((await admin('SELECT count(*)::int AS n FROM vault.secrets')).rows[0].n,0);
 });
 await db.exec('RESET ROLE');await db.exec(sql(migration));
 await db.exec(readFileSync(new URL('../docs/verification/2026-09-21-calendar-subscription-access/server-smoke.sql',import.meta.url),'utf8'));
 }finally{await db.close();}
});
