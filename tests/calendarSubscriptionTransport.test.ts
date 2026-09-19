import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import type {CalendarFeedRequest,CalendarFeedStatus} from '../src/shared/calendarSubscription.ts';
let loaded:Promise<any>|undefined;
function modules(){return loaded??=(async()=>{const result=await build({stdin:{contents:`export {createCalendarSubscriptionService} from './electron/calendarSubscriptionService.ts'; export {registerCalendarSubscriptionIpc} from './electron/calendarSubscriptionIpc.ts'; export {createCalendarSubscriptionPreview} from './src/mocks/calendarSubscriptionPreview.ts'; export {validateCalendarFeedRequest} from './src/shared/calendarSubscription.ts';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'no-electron-runtime',setup(builder){builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'stub'}));builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const ipcMain={handle(){throw new Error("inject IPC")}};'}));}}]});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));})();}
const calendarId=crypto.randomUUID();
const status=(enabled=false):CalendarFeedStatus=>({calendarId,enabled,issuedAt:enabled?'2026-09-20T00:00:00Z':null,revision:enabled?crypto.randomUUID():null});
const request=(action:CalendarFeedRequest['action']='enable',expectedRevision:string|null=null):CalendarFeedRequest=>({calendarId,action,expectedRevision});
function storage(){const rows=new Map<string,string>();return {getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value);},dump:()=>[...rows.values()].join('')};}
function serialLock(){let tail=Promise.resolve();return <T>(run:()=>Promise<T>):Promise<T>=>{const pending=tail.then(run);tail=pending.then(()=>{},()=>{});return pending;};}

test('real service issues32 random bytes, sends only hash and canonical session, and never returns bearer from status/revoke',async()=>{
 const {createCalendarSubscriptionService}=await modules();const calls:Array<{name:string;args:Record<string,unknown>}>=[];let current=status();
 const service=createCalendarSubscriptionService({baseUrl:'https://project.supabase.co/',tokenFor:(actor:string)=>{assert.equal(actor,'owner');return 'canonical-session';},rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});if(name.endsWith('_manage'))current=args.p_action==='revoke'?{...status(),revision:crypto.randomUUID()}:status(true);return {data:{...current,url:'untrusted-server-extra',token_hash:'not-returned'},error:null};}});
 const first=await service.manage('owner',request());const raw=new URL(first.url).pathname.split('/').at(-1)!.replace(/\.ics$/,'');assert.match(raw,/^[A-Za-z0-9_-]{43}$/);assert.equal(Buffer.from(raw,'base64url').length,32);assert.equal(calls[0].args.p_token_hash,createHash('sha256').update(raw).digest('hex'));assert.equal(calls[0].args.p_session_token,'canonical-session');assert.equal('p_actor_id' in calls[0].args,false);assert.equal(JSON.stringify(calls).includes(raw),false);assert.equal('url' in await service.status('owner',calendarId),false);
 const second=await service.manage('owner',request('rotate',first.revision));assert.notEqual(second.url,first.url);assert.equal(calls.at(-1)!.args.p_expected_revision,first.revision);
 assert.equal('url' in await service.manage('owner',request('revoke',second.revision)),false);assert.equal(calls.at(-1)!.args.p_token_hash,null);
});
test('service rejects forged requests before RPC, requires server session, and sanitizes rejected transport details',async()=>{
 const {createCalendarSubscriptionService}=await modules();let calls=0;const service=createCalendarSubscriptionService({baseUrl:'https://x',tokenFor:()=> 'session-do-not-echo',rpc:async()=>{calls++;throw new Error('session-do-not-echo bearer-do-not-echo');}});
 await assert.rejects(service.manage('owner',{...request(),actorId:'other'}));assert.equal(calls,0);await assert.rejects(service.status('owner',calendarId),(error:Error)=>!error.message.includes('do-not-echo'));
 const missing=createCalendarSubscriptionService({baseUrl:'https://x',tokenFor:()=>{throw new Error('로그인 세션 필요');},rpc:()=>{throw new Error('must not call');}});await assert.rejects(missing.manage('owner',request()),/로그인/);
});
test('service rejects cross-calendar or inconsistent success before releasing a URL',async()=>{
 const {createCalendarSubscriptionService}=await modules();for(const data of [{...status(true),calendarId:crypto.randomUUID()},status(false),{...status(true),revision:null},{...status(true),issuedAt:null}]){const service=createCalendarSubscriptionService({baseUrl:'https://x',tokenFor:()=> 'session',rpc:async()=>({data,error:null})});await assert.rejects(service.manage('owner',request()));}
 const service=createCalendarSubscriptionService({baseUrl:'https://x',tokenFor:()=> 'session',rpc:async()=>({data:status(true),error:null})});await assert.rejects(service.manage('owner',request('revoke',crypto.randomUUID())));
});
test('IPC rejects stale epochs and renderer actor claims without invoking service',async()=>{
 const {registerCalendarSubscriptionIpc}=await modules();const handlers=new Map<string,Function>();let calls=0;registerCalendarSubscriptionIpc({getSessionOriginOrThrow:()=>({userId:'owner',epoch:4}),ipc:{handle:(name:string,fn:Function)=>handlers.set(name,fn)},service:{status:async()=>{calls++;return status();},manage:async()=>{calls++;return status();}}});
 await assert.rejects(handlers.get('calendar-feed:status')!({},calendarId,3),/세션/);await assert.rejects(handlers.get('calendar-feed:manage')!({},request(),undefined),/세션/);await assert.rejects(handlers.get('calendar-feed:manage')!({},{...request(),userId:'other'},4));assert.equal(calls,0);
});
test('IPC binds canonical actor and discards an issued bearer when session changes mid-request',async()=>{
 const {registerCalendarSubscriptionIpc}=await modules();const handlers=new Map<string,Function>();let origin={userId:'owner',epoch:4};let resolve!:(value:unknown)=>void;let actor='';registerCalendarSubscriptionIpc({getSessionOriginOrThrow:()=>origin,ipc:{handle:(name:string,fn:Function)=>handlers.set(name,fn)},service:{status:async()=>status(),manage:async(id:string)=>{actor=id;return new Promise(done=>{resolve=done;});}}});const pending=handlers.get('calendar-feed:manage')!({},request(),4);assert.equal(actor,'owner');origin={userId:'other',epoch:5};resolve({...status(true),url:'do-not-deliver'});await assert.rejects(pending,/세션/);
});
test('preview owner/hash-only persistence and CAS mirror production, including revoked timestamp',async()=>{
 const {createCalendarSubscriptionPreview}=await modules();let actor={id:'owner',epoch:1};const saved=storage();const preview=createCalendarSubscriptionPreview({owner:()=> 'owner',actor:()=>actor,storage:saved,lock:serialLock()});assert.equal((await preview.status(calendarId)).enabled,false);actor={id:'admin',epoch:2};await assert.rejects(preview.status(calendarId),/소유자/);await assert.rejects(preview.manage(request()),/소유자/);actor={id:'owner',epoch:3};const issued=await preview.manage(request());const raw=issued.url.split('/').at(-1).replace(/\.ics$/,'');assert.equal(saved.dump().includes(raw),false);assert.equal(saved.dump().includes(createHash('sha256').update(raw).digest('hex')),true);assert.equal('url' in await preview.status(calendarId),false);
 const rotated=await preview.manage(request('rotate',issued.revision));await assert.rejects(preview.manage(request('revoke',issued.revision)),/변경/);assert.equal((await preview.status(calendarId)).revision,rotated.revision);const revoked=await preview.manage(request('revoke',rotated.revision));assert.equal(revoked.enabled,false);assert.equal(revoked.issuedAt,null);assert.equal(saved.dump().includes('"hash":null'),true);assert.deepEqual(await preview.manage(request('revoke',rotated.revision)),revoked);
});
test('preview concurrent rotate with same generation commits only one new bearer',async()=>{
 const {createCalendarSubscriptionPreview}=await modules();const preview=createCalendarSubscriptionPreview({owner:()=> 'owner',actor:()=>({id:'owner',epoch:1}),storage:storage(),lock:serialLock()});const issued=await preview.manage(request());const results=await Promise.allSettled([preview.manage(request('rotate',issued.revision)),preview.manage(request('rotate',issued.revision))]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected').length,1);
});
test('preview drops bearer after a session switch during lock response delivery',async()=>{
 const {createCalendarSubscriptionPreview}=await modules();let actor={id:'owner',epoch:1};const preview=createCalendarSubscriptionPreview({owner:()=>actor.id,actor:()=>actor,storage:storage(),lock:async(run:()=>Promise<unknown>)=>{const result=await run();actor={id:'other',epoch:2};return result;}});await assert.rejects(preview.manage(request()),/세션/);
});
test('preview source invalidation and observed owner change prevent old links reviving',async()=>{
 const {createCalendarSubscriptionPreview}=await modules();let owner='owner',actor={id:'owner',epoch:1};const preview=createCalendarSubscriptionPreview({owner:()=>owner,actor:()=>actor,storage:storage(),lock:serialLock()});await preview.manage(request());owner='other';actor={id:'other',epoch:2};assert.equal((await preview.status(calendarId)).enabled,false);owner='owner';actor={id:'owner',epoch:3};assert.equal((await preview.status(calendarId)).enabled,false);
 await preview.manage(request());await preview.invalidate(calendarId);assert.deepEqual(await preview.status(calendarId),{...status(),preview:true});
});

test('preview queued issuance rejects a switched session before persisting any hash',async()=>{
 const {createCalendarSubscriptionPreview}=await modules();let actor={id:'owner',epoch:1};let release!:()=>void;let queued!:()=>void;const waiting=new Promise<void>(resolve=>{queued=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});const saved=storage();const preview=createCalendarSubscriptionPreview({owner:()=> 'owner',actor:()=>actor,storage:saved,lock:async(run:()=>Promise<unknown>)=>{queued();await gate;return run();}});const pending=preview.manage(request());await waiting;actor={id:'other',epoch:2};release();await assert.rejects(pending,/세션|소유자/);assert.equal(saved.dump(),'');
});
