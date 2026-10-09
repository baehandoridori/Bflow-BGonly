import test from 'node:test';import assert from 'node:assert/strict';import { randomUUID } from 'node:crypto';
import { createBackgroundPreviewGateway } from '../src/features/backgrounds/previewGateway.ts';
import { BackgroundUnsupportedError } from '../src/features/backgrounds/domain.ts';
import type { BackgroundRequest, BackgroundMap, BackgroundNode } from '../src/features/backgrounds/types.ts';
const request=():BackgroundRequest=>({requestId:randomUUID(),command:{type:'save',kind:'place',entity:{id:randomUUID(),revision:0,name:'학교',parentId:null,folderPath:''},expectedRevision:null}});
function environment(){const values=new Map<string,string>();let tail=Promise.resolve();return {storage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}},locks:{request<T>(_key:string,fn:()=>Promise<T>):Promise<T>{const p=tail.then(fn);tail=p.then(()=>{},()=>{});return p;}},seed:false};}
test('preview 저장은 재시작에도 유지되고 같은 요청은 한번만 반영된다',async()=>{const options=environment(),actor={id:randomUUID(),canManage:true},g=createBackgroundPreviewGateway(actor,options),r=request();const a=await g.execute(r),b=await g.execute(r);assert.deepEqual(a,b);assert.equal((await createBackgroundPreviewGateway(actor,options).read()).places.length,1);await assert.rejects(g.execute({...r,command:{type:'delete',kind:'place',id:a.places[0].id,expectedRevision:1}}),/다른/);});
test('동시 저장 충돌은 한 명만 성공하고 삭제된 ID를 재사용할 수 없다',async()=>{const options=environment(),actor={id:randomUUID(),canManage:true},g=createBackgroundPreviewGateway(actor,options),r=request(),s=await g.execute(r),entity=s.places[0];const edit=(name:string):BackgroundRequest=>({requestId:randomUUID(),command:{type:'save',kind:'place',entity:{...entity,name},expectedRevision:1}});const results=await Promise.allSettled([g.execute(edit('A')),g.execute(edit('B'))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);await g.execute({requestId:randomUUID(),command:{type:'delete',kind:'place',id:entity.id,expectedRevision:2}});await assert.rejects(g.execute({...r,requestId:randomUUID()}),/삭제/);});
test('변경된 로그인 세션은 저장 직전에 거부한다',async()=>{const options=environment();let current=true;const g=createBackgroundPreviewGateway({id:randomUUID(),canManage:true},{...options,assertCurrent(){if(!current)throw new Error('로그인 세션 변경');}});current=false;await assert.rejects(g.execute(request()),/세션/);});
test('preview 일반 사용자도 관리자 자산 수정 권한을 얻지 못한다',async()=>{const options=environment(),g=createBackgroundPreviewGateway({id:randomUUID(),canManage:false},options);await assert.rejects(g.execute(request()),/관리자/);assert.equal((await g.read()).canManage,false);});

const blankMap=(name='도면'):BackgroundMap=>({id:randomUUID(),revision:0,name,parentId:null,placeId:null,imageUrl:'',nodes:[]});
test('preview 도면 배치는 재시도와 재시작에도 한 번만 저장되고 실패 시 부분 저장하지 않는다',async()=>{
  const options=environment(),actor={id:randomUUID(),canManage:true},g=createBackgroundPreviewGateway(actor,options);
  const parent=blankMap('상위'),child={...blankMap('상세'),parentId:parent.id};
  parent.nodes=[{id:randomUUID(),type:'space',name:'상세',placeId:null,childMapId:child.id,x:0,y:0,width:100,height:100,rotation:0,shape:'rect',points:[],locked:false}];
  const batch:BackgroundRequest={requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:parent,expectedRevision:null},{entity:child,expectedRevision:null}]}};
  const saved=await g.execute(batch);assert.deepEqual(await g.execute(batch),saved);assert.deepEqual(await createBackgroundPreviewGateway(actor,options).read(),saved);
  const reordered={requestId:batch.requestId,command:{maps:batch.command.type==='save-maps'?batch.command.maps:[],type:'save-maps' as const}};assert.deepEqual(await g.execute(reordered),saved);
  await assert.rejects(g.execute({...batch,command:{type:'save-maps',maps:[{entity:blankMap(),expectedRevision:null}]}}),/다른 내용/);
  const newMap=blankMap('새 지도');await assert.rejects(g.execute({requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:newMap,expectedRevision:null},{entity:parent,expectedRevision:2}]}}),/변경/);
  await assert.rejects(g.execute({requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:{...parent,parentId:child.id},expectedRevision:1},{entity:child,expectedRevision:1}]}}),/순환/);
  assert.deepEqual(await g.read(),saved);
});
test('preview 도면 배치는 모든 신규 ID의 삭제 기록과 관리자 권한을 확인한다',async()=>{
  const options=environment(),actor={id:randomUUID(),canManage:true},g=createBackgroundPreviewGateway(actor,options),retired=blankMap('삭제할 도면');
  await g.execute({requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:retired,expectedRevision:null}]}});
  await g.execute({requestId:randomUUID(),command:{type:'delete',kind:'map',id:retired.id,expectedRevision:1}});
  const batch:BackgroundRequest={requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:blankMap(),expectedRevision:null},{entity:retired,expectedRevision:null}]}};
  await assert.rejects(g.execute(batch),/삭제/);assert.equal((await g.read()).maps.length,0);
  await assert.rejects(g.execute({requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:{...retired,id:retired.id.toUpperCase()},expectedRevision:null}]}}),/삭제/);
  const member=createBackgroundPreviewGateway({id:randomUUID(),canManage:false},options);
  await assert.rejects(member.execute({requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:blankMap(),expectedRevision:null}]}}),/관리자/);
});

const spatialKeys=['elevation','volumeHeight','pitch','roll','aspect'];
function spatialNodes():BackgroundNode[]{
  const room:BackgroundNode={id:randomUUID(),type:'space',name:'교실',placeId:null,childMapId:null,x:100,y:110,width:470,height:300,rotation:0,shape:'rect',points:[],locked:false,elevation:-12.5,volumeHeight:260.75};
  return [room,
    {id:randomUUID(),type:'camera',name:'내려다보는 카메라',spaceId:room.id,x:500,y:340,angle:90,fov:55,viewIds:[],locked:false,elevation:120.25,pitch:-90,roll:-33.5,aspect:16/9},
    {id:randomUUID(),type:'camera',name:'올려다보는 카메라',spaceId:null,x:500,y:340,angle:0,fov:60,viewIds:[],locked:true,elevation:-100000,pitch:90,roll:180,aspect:0.1},
    {id:randomUUID(),type:'symbol',name:'책상',symbol:'table',spaceId:room.id,x:200,y:200,width:120,height:60,rotation:15,locked:false,hinge:'left',swing:'inward',elevation:35.125,volumeHeight:80.5,pitch:-45.5,roll:12.25},
    {id:randomUUID(),type:'camera',name:'평면 카메라',spaceId:null,x:10,y:20,angle:0,fov:60,viewIds:[],locked:false}];
}
test('preview 저장은 높이·기울기·화면 비율을 그대로 보존하고 같은 요청 재시도에도 한 번만 반영한다',async()=>{
  const options=environment(),actor={id:randomUUID(),canManage:true},g=createBackgroundPreviewGateway(actor,options);
  const nodes=spatialNodes(),map={...blankMap('입체 도면'),nodes};
  const save:BackgroundRequest={requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:map,expectedRevision:null}]}};
  const saved=await g.execute(save);assert.deepEqual(saved.maps,[{...map,revision:1}]);
  assert.deepEqual(await g.execute(save),saved);assert.deepEqual(await g.execute(structuredClone(save)),saved);
  const reopened=createBackgroundPreviewGateway(actor,options);assert.deepEqual(await reopened.read(),saved);
  for(const key of spatialKeys)assert.equal(Object.hasOwn(saved.maps[0].nodes[4],key),false,key);
  // The same request id carrying one different height is a different request, not a retry.
  const altered={...map,nodes:nodes.map(node=>node.type==='camera'&&node.pitch===-90?{...node,pitch:-89}:node)};
  await assert.rejects(reopened.execute({...save,command:{type:'save-maps',maps:[{entity:altered,expectedRevision:null}]}}),/다른 내용/);
  const renamed=await reopened.execute({requestId:randomUUID(),command:{type:'save',kind:'map',entity:{...saved.maps[0],name:'이름만 변경'},expectedRevision:1}});
  assert.equal(renamed.maps[0].revision,2);assert.deepEqual(renamed.maps[0].nodes,nodes);
  assert.deepEqual(await createBackgroundPreviewGateway(actor,options).read(),renamed);
});
test('preview 저장은 계단·도로·카메라 색을 그대로 보존하고 다시 열어도 그대로 읽는다',async()=>{
  const options=environment(),actor={id:randomUUID(),canManage:true},g=createBackgroundPreviewGateway(actor,options);
  const room:BackgroundNode={id:randomUUID(),type:'space',name:'교실',placeId:null,childMapId:null,x:100,y:110,width:470,height:300,rotation:0,shape:'rect',points:[],locked:false};
  const nodes:BackgroundNode[]=[room,
    {id:randomUUID(),type:'space',name:'큰길',placeId:null,childMapId:null,x:0,y:450,width:1000,height:80,rotation:0,shape:'rect',points:[],locked:false,surface:'road'},
    {id:randomUUID(),type:'space',name:'꺾인 길',placeId:null,childMapId:null,x:600,y:0,width:80,height:450,rotation:0,shape:'polygon',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],locked:false,surface:'road'},
    ...(['red','lime','green','teal','blue','pink'] as const).map((color,index):BackgroundNode=>({id:randomUUID(),type:'camera',name:`${color} 카메라`,spaceId:room.id,x:150+index*60,y:300,angle:0,fov:60,viewIds:[],locked:false,color})),
    {id:randomUUID(),type:'symbol',name:'계단',symbol:'stairs',spaceId:room.id,x:200,y:150,width:120,height:200,rotation:0,locked:false,hinge:'left',swing:'inward'},
    {id:randomUUID(),type:'camera',name:'기본 카메라',spaceId:null,x:10,y:20,angle:0,fov:60,viewIds:[],locked:false}];
  const map={...blankMap('새 요소 도면'),nodes};
  const save:BackgroundRequest={requestId:randomUUID(),command:{type:'save-maps',maps:[{entity:map,expectedRevision:null}]}};
  const saved=await g.execute(save);assert.deepEqual(saved.maps,[{...map,revision:1}]);
  const reopened=createBackgroundPreviewGateway(actor,options);assert.deepEqual(await reopened.read(),saved);
  // The room and the plain camera gain neither key.
  for(const index of [0,nodes.length-1])for(const key of ['surface','color'])assert.equal(Object.hasOwn(saved.maps[0].nodes[index],key),false,`${index}.${key}`);
  const renamed=await reopened.execute({requestId:randomUUID(),command:{type:'save',kind:'map',entity:{...saved.maps[0],name:'이름만 변경'},expectedRevision:1}});
  assert.equal(renamed.maps[0].revision,2);assert.deepEqual(renamed.maps[0].nodes,nodes);
  assert.deepEqual(await createBackgroundPreviewGateway(actor,options).read(),renamed);
});
test('preview는 잘못된 높이 값을 저장하지 않고 높이 값이 없는 이전 저장분은 그대로 읽고 다시 저장한다',async()=>{
  const options=environment(),actor={id:randomUUID(),canManage:true};
  // A store written before the vertical-axis fields existed.
  const old={...blankMap('이전 도면'),revision:3,nodes:spatialNodes().map(node=>Object.fromEntries(Object.entries(node).filter(([key])=>!spatialKeys.includes(key))) as unknown as BackgroundNode)};
  options.storage.setItem('bflow-background-library-preview-v1',JSON.stringify({snapshot:{places:[],maps:[old],views:[],groups:[],usages:[],canManage:true},receipts:{},retired:[]}));
  const g=createBackgroundPreviewGateway(actor,options),before=await g.read();assert.deepEqual(before.maps,[old]);
  const camera=old.nodes[1];
  for(const [bad,reason] of [[{pitch:91},/위아래 각도/],[{pitch:null},/위아래 각도/],[{roll:'0'},/기울기/],[{elevation:Infinity},/카메라 높이/],[{aspect:0},/화면 비율/],[{volumeHeight:80},/속성/],[{depth:1},/속성/]] as const)
    await assert.rejects(g.execute({requestId:randomUUID(),command:{type:'save',kind:'map',entity:{...old,nodes:old.nodes.map(node=>node.id===camera.id?{...node,...bad} as unknown as BackgroundNode:node)},expectedRevision:3}}),reason);
  assert.deepEqual(await g.read(),before);
  const renamed=await g.execute({requestId:randomUUID(),command:{type:'save',kind:'map',entity:{...old,name:'이름만 변경'},expectedRevision:3}});
  assert.deepEqual(renamed.maps,[{...old,name:'이름만 변경',revision:4}]);
  const raised=await g.execute({requestId:randomUUID(),command:{type:'save',kind:'map',entity:{...renamed.maps[0],nodes:old.nodes.map(node=>node.id===camera.id?{...node,elevation:180,pitch:-30}:node)},expectedRevision:4}});
  assert.deepEqual(raised.maps[0].nodes[1],{...camera,elevation:180,pitch:-30});assert.deepEqual(raised.maps[0].nodes[0],old.nodes[0]);
});
test('preview는 저장소에 든 모르는 종류를 모르는 것으로, 깨진 값을 그냥 오류로 거절하고 저장소는 그대로 둔다',async()=>{
  const actor={id:randomUUID(),canManage:true},key='bflow-background-library-preview-v1';
  // A store another build on the same origin wrote: one map holding one node.
  const stored=(node:Record<string,unknown>)=>{const options=environment();options.storage.setItem(key,JSON.stringify({snapshot:{places:[],maps:[{...blankMap('다른 버전의 도면'),revision:1,nodes:[node]}],views:[],groups:[],usages:[],canManage:true},receipts:{},retired:[]}));return options;};
  const lift={id:randomUUID(),type:'symbol',name:'승강기',symbol:'elevator',spaceId:null,x:200,y:150,width:120,height:200,rotation:0,locked:false,hinge:'left',swing:'inward'};
  const newer=stored(lift),written=newer.storage.getItem(key);
  await assert.rejects(createBackgroundPreviewGateway(actor,newer).read(),BackgroundUnsupportedError);
  await assert.rejects(createBackgroundPreviewGateway(actor,newer).read(),/사물 기호/);
  assert.equal(newer.storage.getItem(key),written);
  await assert.rejects(createBackgroundPreviewGateway(actor,stored({...lift,symbol:'stairs',x:'a'})).read(),(error:unknown)=>error instanceof Error&&!(error instanceof BackgroundUnsupportedError)&&/가로 좌표/.test(error.message));
});
