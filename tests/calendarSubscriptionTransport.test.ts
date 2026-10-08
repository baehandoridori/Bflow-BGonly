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

test('real service uses only validated server alias, reopens it for viewers, and sends only a hash on owner commands',async()=>{
 const {createCalendarSubscriptionService}=await modules();const calls:any[]=[];let current:any=status();let alias='a'.repeat(43);
 const service=createCalendarSubscriptionService({baseUrl:'https://project.supabase.co/',tokenFor:()=> 'canonical-session',rpc:async(name:string,args:any)=>{calls.push({name,args});if(name.endsWith('_manage')){alias=alias==='a'.repeat(43)?'b'.repeat(43):'a'.repeat(43);current=args.p_action==='revoke'?{...status(),revision:crypto.randomUUID()}:status(true);}return {data:{...current,aliasToken:current.enabled?alias:null,url:'https://evil.invalid/'},error:null};}});
 const first=await service.manage('owner',request());assert.equal(first.url,`https://project.supabase.co/functions/v1/calendar-feed/${alias}.ics`);assert.match(calls[0].args.p_token_hash,/^[a-f0-9]{64}$/);assert.equal(calls[0].args.p_session_token,'canonical-session');assert.equal(JSON.stringify(calls).includes(alias),false);assert.equal('aliasToken' in first,false);assert.equal((await service.status('viewer',calendarId)).url,first.url);
 const second=await service.manage('owner',request('rotate',first.revision));assert.notEqual(second.url,first.url);assert.equal(calls.at(-1).args.p_expected_revision,first.revision);
 assert.equal('url' in await service.manage('owner',request('revoke',second.revision)),false);assert.equal(calls.at(-1).args.p_token_hash,null);
 for(const aliasToken of ['bad',null,'/'.repeat(43)]){const bad=createCalendarSubscriptionService({baseUrl:'https://x',tokenFor:()=> 's',rpc:async()=>({data:{...status(true),aliasToken},error:null})});await assert.rejects(bad.status('viewer',calendarId));}
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
test('preview owner management and recoverable fake URL persistence mirror production, including revoked timestamp',async()=>{
 const {createCalendarSubscriptionPreview}=await modules();let actor={id:'owner',epoch:1};const saved=storage();const preview=createCalendarSubscriptionPreview({owner:()=> 'owner',actor:()=>actor,storage:saved,lock:serialLock()});assert.equal((await preview.status(calendarId)).enabled,false);actor={id:'admin',epoch:2};await assert.rejects(preview.status(calendarId),/소유자/);await assert.rejects(preview.manage(request()),/소유자/);actor={id:'owner',epoch:3};const issued=await preview.manage(request());const raw=issued.url.split('/').at(-1).replace(/\.ics$/,'');assert.equal(saved.dump().includes(raw),true);assert.equal(saved.dump().includes(createHash('sha256').update(raw).digest('hex')),true);assert.equal((await preview.status(calendarId)).url,issued.url);
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

test('preview actual viewers can reopen stable URL but cannot manage; membership revocation denies future reads',async()=>{
 const {createCalendarSubscriptionPreview}=await modules();let actor={id:'owner',epoch:1};let allowed=true;const saved=storage();const deps={owner:()=> 'owner',canRead:(_:string,id:string)=>id==='owner'||(id==='reader'&&allowed),actor:()=>actor,storage:saved,lock:serialLock()};const preview=createCalendarSubscriptionPreview(deps);const first=await preview.manage(request());actor={id:'reader',epoch:2};assert.equal((await preview.status(calendarId)).url,first.url);assert.equal((await createCalendarSubscriptionPreview(deps).status(calendarId)).url,first.url);await assert.rejects(preview.manage(request('revoke',first.revision)),/소유자/);allowed=false;await assert.rejects(preview.status(calendarId));actor={id:'overview',epoch:3};await assert.rejects(preview.status(calendarId));
});

test('preview upgrades old enabled demo records once without changing revision',async()=>{
 const {createCalendarSubscriptionPreview}=await modules();const saved=storage();const revision=crypto.randomUUID();saved.setItem('bflow-preview-calendar-feeds-v1',JSON.stringify({[calendarId]:{calendarId,ownerId:'owner',enabled:true,issuedAt:'2026-09-20',revision,hash:'a'.repeat(64)}}));const deps={owner:()=> 'owner',canRead:()=>true,actor:()=>({id:'reader',epoch:1}),storage:saved,lock:serialLock()};const first=await createCalendarSubscriptionPreview(deps).status(calendarId);assert.match(first.url,/^https:\/\/bflow-preview\.invalid\/calendar-feed\/[A-Za-z0-9_-]{43}\.ics$/);assert.equal(first.revision,revision);assert.equal((await createCalendarSubscriptionPreview(deps).status(calendarId)).url,first.url);
});
test('IPC discards a re-read URL after same-user epoch changes',async()=>{
 const {registerCalendarSubscriptionIpc}=await modules();const handlers=new Map<string,Function>();let origin={userId:'reader',epoch:7};let resolve!:(value:unknown)=>void;registerCalendarSubscriptionIpc({getSessionOriginOrThrow:()=>origin,ipc:{handle:(name:string,fn:Function)=>handlers.set(name,fn)},service:{status:async()=>new Promise(done=>{resolve=done;}),manage:async()=>status()}});const pending=handlers.get('calendar-feed:status')!({},calendarId,7);origin={userId:'reader',epoch:8};resolve({...status(true),url:'do-not-deliver'});await assert.rejects(pending,/세션/);
});
