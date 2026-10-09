import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import type { BackgroundSnapshot } from '../src/features/backgrounds/types.ts';

const empty = (canManage=false): BackgroundSnapshot => ({ places:[],maps:[],views:[],groups:[],usages:[],canManage });
const request = () => ({ requestId:randomUUID(),command:{type:'delete',kind:'place',id:randomUUID(),expectedRevision:1} });
let nonce=0;
async function load(entry: string) {
  const result=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false});
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${nonce++}`);
}

test('background store sends only the canonical session token and preserves request identity',async()=>{
  const {createBackgroundStore}=await load('electron/backgroundStore.ts');const calls:unknown[]=[];const input=request();
  const store=createBackgroundStore({rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:empty(true),error:null};}},{tokenFor:(actor:string)=>`token-${actor}`});
  assert.equal((await store.read('alice')).canManage,true);await store.execute('alice',input);
  assert.deepEqual(calls,[{name:'background_library_read',args:{p_session_token:'token-alice'}},{name:'background_library_execute',args:{p_session_token:'token-alice',p_request_id:input.requestId,p_command:input.command}}]);
  assert.equal(JSON.stringify(calls).includes('p_actor_id'),false);
});

test('background store blocks missing sessions and malformed writes before invoking SQL',async()=>{
  const {createBackgroundStore}=await load('electron/backgroundStore.ts');let calls=0;
  const client={rpc:async()=>{calls++;return {data:empty(),error:null};}};
  const missing=createBackgroundStore(client,{tokenFor:()=>''});await assert.rejects(missing.read('alice'),/로그인/);await assert.rejects(missing.execute('alice',request()),/로그인/);
  const store=createBackgroundStore(client,{tokenFor:()=>'token'});
  for(const input of [null,{}, {...request(),requestId:'bad'}, {...request(),canManage:true},{requestId:randomUUID(),command:{type:'delete',kind:'place',id:'bad',expectedRevision:1}}])await assert.rejects(store.execute('alice',input));
  assert.equal(calls,0);
});

test('background store passes map batches as one RPC and rejects malformed batches before dispatch',async()=>{
  const {createBackgroundStore}=await load('electron/backgroundStore.ts');const calls:any[]=[];
  const store=createBackgroundStore({rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:empty(true),error:null};}},{tokenFor:()=>'token'});
  const map={id:randomUUID(),revision:0,name:'상위 도면',parentId:null,placeId:null,imageUrl:'',nodes:[]};
  const input={requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:map,expectedRevision:null}]}};
  await store.execute('admin',input);assert.equal(calls.length,1);assert.deepEqual(calls[0].args.p_command,input.command);
  await assert.rejects(store.execute('admin',{...input,command:{type:'save-maps',maps:[]}}));assert.equal(calls.length,1);
});

test('background store forwards vertical-axis map fields untouched both ways and stops invalid ones before SQL',async()=>{
  const {createBackgroundStore}=await load('electron/backgroundStore.ts');const calls:any[]=[];
  const room={id:randomUUID(),type:'space',name:'교실',placeId:null,childMapId:null,x:100,y:110,width:470,height:300,rotation:0,shape:'rect',points:[],locked:false,elevation:-12.5,volumeHeight:260.75};
  const lens={id:randomUUID(),type:'camera',name:'내려다보는 카메라',spaceId:room.id,x:500,y:340,angle:90,fov:55,viewIds:[],locked:false,elevation:120.25,pitch:-90,roll:-33.5,aspect:16/9};
  const desk={id:randomUUID(),type:'symbol',name:'책상',symbol:'table',spaceId:room.id,x:200,y:200,width:120,height:60,rotation:15,locked:false,hinge:'left',swing:'inward',elevation:35.125,volumeHeight:80.5,pitch:-45.5,roll:12.25};
  const flat={id:randomUUID(),type:'camera',name:'평면 카메라',spaceId:null,x:10,y:20,angle:0,fov:60,viewIds:[],locked:false};
  const map={id:randomUUID(),revision:0,name:'입체 도면',parentId:null,placeId:null,imageUrl:'',nodes:[room,lens,desk,flat]};
  const stored={...empty(true),maps:[{...map,revision:1}]};
  const store=createBackgroundStore({rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:structuredClone(stored),error:null};}},{tokenFor:()=>'token'});
  const batch={requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:map,expectedRevision:null}]}},single={requestId:randomUUID(),command:{type:'save',kind:'map',entity:{...map,name:'이름만 변경'},expectedRevision:1}};
  const sent=[JSON.stringify(batch.command),JSON.stringify(single.command)];
  // The reply is handed back as received: no field dropped, no default added to the plain camera.
  assert.deepEqual(await store.execute('admin',batch),stored);assert.deepEqual(await store.execute('admin',single),stored);assert.deepEqual(await store.read('admin'),stored);
  assert.deepEqual(calls.map(call=>call.name),['background_library_execute','background_library_execute','background_library_read']);
  assert.deepEqual(calls.slice(0,2).map(call=>JSON.stringify(call.args.p_command)),sent);
  assert.equal(JSON.stringify(calls[0].args.p_command.maps[0].entity.nodes[3]),JSON.stringify(flat));
  const save=(node:unknown)=>store.execute('admin',{requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:{...map,nodes:[room,node]},expectedRevision:null}]}});
  for(const [bad,reason] of [[{...lens,pitch:91},/위아래 각도/],[{...lens,elevation:null},/카메라 높이/],[{...lens,roll:undefined},/기울기/],[{...lens,aspect:NaN},/화면 비율/],[{...desk,volumeHeight:'80'},/입체 높이/],[{...lens,volumeHeight:80},/속성/],[{...desk,aspect:1},/속성/],[{...flat,depth:1},/속성/]] as const)await assert.rejects(save(bad),reason);
  await assert.rejects(store.execute('admin',{requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:{...map,nodes:[{...room,pitch:0}]},expectedRevision:null}]}}),/속성/);
  assert.equal(calls.length,3);
});

test('background store forwards stairs, roads and camera colours untouched both ways and stops unknown ones before SQL',async()=>{
  const {createBackgroundStore}=await load('electron/backgroundStore.ts');const calls:any[]=[];
  const room={id:randomUUID(),type:'space',name:'교실',placeId:null,childMapId:null,x:100,y:110,width:470,height:300,rotation:0,shape:'rect',points:[],locked:false};
  const road={id:randomUUID(),type:'space',name:'큰길',placeId:null,childMapId:null,x:0,y:450,width:1000,height:80,rotation:0,shape:'rect',points:[],locked:false,surface:'road'};
  const bend={id:randomUUID(),type:'space',name:'꺾인 길',placeId:null,childMapId:null,x:600,y:0,width:80,height:450,rotation:0,shape:'polygon',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],locked:false,surface:'road'};
  const lens={id:randomUUID(),type:'camera',name:'빨간 카메라',spaceId:room.id,x:500,y:340,angle:90,fov:55,viewIds:[],locked:false,color:'red'};
  const stairs={id:randomUUID(),type:'symbol',name:'계단',symbol:'stairs',spaceId:room.id,x:200,y:200,width:120,height:200,rotation:0,locked:false,hinge:'left',swing:'inward'};
  const plain={id:randomUUID(),type:'camera',name:'기본 카메라',spaceId:null,x:10,y:20,angle:0,fov:60,viewIds:[],locked:false};
  const map={id:randomUUID(),revision:0,name:'새 요소 도면',parentId:null,placeId:null,imageUrl:'',nodes:[room,road,bend,lens,stairs,plain]};
  const stored={...empty(true),maps:[{...map,revision:1}]};
  const store=createBackgroundStore({rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:structuredClone(stored),error:null};}},{tokenFor:()=>'token'});
  const batch={requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:map,expectedRevision:null}]}},single={requestId:randomUUID(),command:{type:'save',kind:'map',entity:{...map,name:'이름만 변경'},expectedRevision:1}};
  const sent=[JSON.stringify(batch.command),JSON.stringify(single.command)];
  assert.deepEqual(await store.execute('admin',batch),stored);assert.deepEqual(await store.execute('admin',single),stored);assert.deepEqual(await store.read('admin'),stored);
  assert.deepEqual(calls.map(call=>call.name),['background_library_execute','background_library_execute','background_library_read']);
  assert.deepEqual(calls.slice(0,2).map(call=>JSON.stringify(call.args.p_command)),sent);
  // Neither key is added on the way: the room stays a room and the plain camera keeps the default colour.
  assert.equal(JSON.stringify(calls[0].args.p_command.maps[0].entity.nodes[0]),JSON.stringify(room));assert.equal(JSON.stringify(calls[0].args.p_command.maps[0].entity.nodes[5]),JSON.stringify(plain));
  const save=(node:unknown)=>store.execute('admin',{requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:{...map,nodes:[room,node]},expectedRevision:null}]}});
  for(const [bad,reason] of [[{...road,surface:'river'},/공간 종류/],[{...lens,color:'purple'},/카메라 색/],[{...lens,color:null},/카메라 색/],[{...stairs,symbol:'elevator'},/사물 기호/],[{...lens,surface:'road'},/속성/],[{...road,color:'red'},/속성/]] as const)await assert.rejects(save(bad),reason);
  assert.equal(calls.length,3);
});

test('background store surfaces migration, session and conflict errors without returning demo data',async()=>{
  const {createBackgroundStore}=await load('electron/backgroundStore.ts');
  for(const [code,message,pattern] of [['PGRST202','missing',/저장소 준비/],['42501','로그인 만료',/로그인 만료/],['40001','먼저 변경했습니다',/먼저 변경/]] as const){
    const store=createBackgroundStore({rpc:async()=>({data:null,error:{code,message}})},{tokenFor:()=>'token'});
    await assert.rejects(store.read('alice'),pattern);
  }
  const malformed=createBackgroundStore({rpc:async()=>({data:{places:[]},error:null})},{tokenFor:()=>'token'});
  await assert.rejects(malformed.read('alice'),/올바른 결과/);
});

test('IPC checks the request epoch before work and discards reads from replaced sessions',async()=>{
  const {registerBackgroundIpc}=await load('electron/backgroundIpc.ts');const handlers=new Map<string,Function>();let origin={userId:'alice',epoch:1};let reads=0;let finish!:(value:BackgroundSnapshot)=>void;
  registerBackgroundIpc({ipc:{handle:(name:string,handler:Function)=>handlers.set(name,handler)},getSessionOriginOrThrow:()=>origin,onChanged(){},store:{read:()=>{reads++;return new Promise(resolve=>{finish=resolve;});},execute:async()=>empty()}});
  await assert.rejects(handlers.get('background:read')!({},0),/세션/);await assert.rejects(handlers.get('background:execute')!({},request(),2),/세션/);assert.equal(reads,0);
  const pending=handlers.get('background:read')!({},1);origin={userId:'alice',epoch:2};finish(empty());await assert.rejects(pending,/폐기/);
});

test('a committed background mutation invalidates every window even after its initiating session changes',async()=>{
  const {registerBackgroundIpc}=await load('electron/backgroundIpc.ts');const handlers=new Map<string,Function>();let origin={userId:'alice',epoch:1};let changed=0;let finish!:(value:BackgroundSnapshot)=>void;
  registerBackgroundIpc({ipc:{handle:(name:string,handler:Function)=>handlers.set(name,handler)},getSessionOriginOrThrow:()=>origin,onChanged(){changed++;},store:{read:async()=>empty(),execute:()=>new Promise(resolve=>{finish=resolve;})}});
  const pending=handlers.get('background:execute')!({},request(),1);origin={userId:'bob',epoch:2};finish(empty());await assert.rejects(pending,/폐기/);assert.equal(changed,1);
});

test('uploads require canonical admin rights and recheck session between authorization and write',async()=>{
  const {registerBackgroundIpc}=await load('electron/backgroundIpc.ts');const handlers=new Map<string,Function>();let origin={userId:'alice',epoch:1};let uploadCount=0;let finish!:(value:BackgroundSnapshot)=>void;
  registerBackgroundIpc({ipc:{handle:(name:string,handler:Function)=>handlers.set(name,handler)},getSessionOriginOrThrow:()=>origin,onChanged(){},store:{read:()=>new Promise(resolve=>{finish=resolve;}),execute:async()=>empty()},uploadImage:async()=>{uploadCount++;return {ok:true,url:'https://example.test/image.png'};}});
  const handler=handlers.get('background:upload-image')!;
  await assert.rejects(handler({},'data:text/plain;base64,dGVzdA==',1),/이미지/);
  const denied=handler({},'data:image/png;base64,dGVzdA==',1);finish(empty(false));await assert.rejects(denied,/관리자/);
  const stale=handler({},'data:image/png;base64,dGVzdA==',1);origin={userId:'bob',epoch:2};finish(empty(true));await assert.rejects(stale,/폐기/);assert.equal(uploadCount,0);
  const allowed=handler({},'data:image/png;base64,dGVzdA==',2);finish(empty(true));assert.equal((await allowed).ok,true);assert.equal(uploadCount,1);
});

test('background realtime forwards only invalidation and removes its channel on cleanup',async()=>{
  const {startBackgroundRealtime}=await load('electron/backgroundStore.ts');let callback!:Function;let statusCallback!:Function;let changed=0;let removed=0;
  const channel={on:(type:string,filter:unknown,cb:Function)=>{assert.equal(type,'broadcast');assert.deepEqual(filter,{event:'changed'});callback=cb;return channel;},subscribe:(cb:Function)=>{statusCallback=cb;return channel;}};
  const stop=startBackgroundRealtime({channel:(name:string)=>{assert.equal(name,'background-library');return channel;},removeChannel:async(value:unknown)=>{assert.equal(value,channel);removed++;}},()=>{changed++;});
  callback({payload:{untrusted:'never forwarded'}});assert.equal(changed,1);
  statusCallback('SUBSCRIBED');assert.equal(changed,2);statusCallback('CHANNEL_ERROR');assert.equal(changed,2);
  statusCallback('SUBSCRIBED');assert.equal(changed,3);stop();assert.equal(removed,1);
});

test('image file reads require a current canonical administrator before accessing disk', async () => {
  const { registerBackgroundIpc } = await load('electron/backgroundIpc.ts');
  const handlers = new Map<string, Function>(); let diskReads = 0, storeReads = 0, loggedIn = true, canManage = false;
  registerBackgroundIpc({
    ipc: { handle: (name: string, handler: Function) => handlers.set(name, handler) },
    getSessionOriginOrThrow: () => { if (!loggedIn) throw new Error('로그인이 필요합니다.'); return { userId: 'admin', epoch: 3 }; },
    onChanged() {}, store: { read: async () => { storeReads++; return empty(canManage); }, execute: async () => empty() },
    readImageFile: async (filePath: string) => { diskReads++; return { filePath, dataUrl: 'data:image/png;base64,valid' }; },
  });
  const handler = handlers.get('background:read-image-file')!;
  loggedIn = false; await assert.rejects(handler({}, 'C:\\image.png', 3), /로그인/); assert.equal(storeReads, 0);
  loggedIn = true; await assert.rejects(handler({}, 'C:\\image.png', 2), /세션/); assert.equal(storeReads, 0);
  await assert.rejects(handler({}, 'C:\\image.png', 3), /관리자/); assert.equal(diskReads, 0);
  canManage = true; await assert.rejects(handler({}, 42, 3), /경로/); assert.equal(diskReads, 0);
  const result = await handler({}, 'C:\\image.png', 3); assert.equal(result.filePath, 'C:\\image.png'); assert.equal(diskReads, 1);
});

test('image file reads discard sessions replaced during authorization or disk IO', async () => {
  const { registerBackgroundIpc } = await load('electron/backgroundIpc.ts');
  const handlers = new Map<string, Function>(); let origin = { userId: 'admin', epoch: 1 }, diskReads = 0;
  let authorize!: (value: BackgroundSnapshot) => void, finish!: (value: { dataUrl: string; filePath: string }) => void;
  registerBackgroundIpc({
    ipc: { handle: (name: string, handler: Function) => handlers.set(name, handler) }, getSessionOriginOrThrow: () => origin,
    onChanged() {}, store: { read: () => new Promise(resolve => { authorize = resolve; }), execute: async () => empty() },
    readImageFile: () => { diskReads++; return new Promise(resolve => { finish = resolve; }); },
  });
  const handler = handlers.get('background:read-image-file')!;
  const staleAuthorization = handler({}, 'C:\\image.png', 1); origin = { userId: 'member', epoch: 2 }; authorize(empty(true));
  await assert.rejects(staleAuthorization, /폐기/); assert.equal(diskReads, 0);
  const staleRead = handler({}, 'C:\\image.png', 2); authorize(empty(true)); await Promise.resolve();
  assert.equal(diskReads, 1); origin = { userId: 'admin', epoch: 3 }; finish({ dataUrl: 'data:image/png;base64,valid', filePath: 'C:\\image.png' });
  await assert.rejects(staleRead, /폐기/);
});

test('image file reads discard data if administrator rights are revoked during disk IO', async () => {
  const { registerBackgroundIpc } = await load('electron/backgroundIpc.ts');
  const handlers = new Map<string, Function>(); let canManage = true, diskReads = 0;
  registerBackgroundIpc({
    ipc: { handle: (name: string, handler: Function) => handlers.set(name, handler) },
    getSessionOriginOrThrow: () => ({ userId: 'admin', epoch: 1 }), onChanged() {},
    store: { read: async () => empty(canManage), execute: async () => empty() },
    readImageFile: async (filePath: string) => { diskReads++; canManage = false; return { filePath, dataUrl: 'data:image/png;base64,valid' }; },
  });
  await assert.rejects(handlers.get('background:read-image-file')!({}, 'C:\\image.png', 1), /관리자/);
  assert.equal(diskReads, 1);
});
