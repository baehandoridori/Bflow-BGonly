import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { BACKGROUND_SPATIAL_LIMITS, applyBackgroundCommand, emptyBackgroundSnapshot, filterBackgroundViews, mergeBackgroundGroup, validateBackgroundRequest, validateBackgroundSnapshot } from '../src/features/backgrounds/domain.ts';
import type { BackgroundPlace, BackgroundView, BackgroundMap, BackgroundGroup, BackgroundUsage, BackgroundSymbol, BackgroundSpace, BackgroundCamera, BackgroundNode } from '../src/features/backgrounds/types.ts';
import { addMapCamera, applyNodeWorldPose } from '../src/features/backgrounds/mapGeometry.ts';
import { MAP_SPATIAL_DEFAULTS, SYMBOL_VOLUME_HEIGHTS, cameraOrientation, createMapCamera, nodeOrientation } from '../src/features/backgrounds/mapSpatial.ts';

const place = (name: string): BackgroundPlace => ({ id: randomUUID(), revision: 0, name, parentId: null, folderPath: '' });
function fixture() {
  let s = emptyBackgroundSnapshot(true);
  const classroom = place('교실'), hall = place('복도');
  for (const p of [classroom, hall]) s = applyBackgroundCommand(s, { type:'save',kind:'place',entity:p,expectedRevision:null }, {canManage:true});
  const imageId = randomUUID();
  const view: BackgroundView = {id:randomUUID(),revision:0,name:'교실에서 복도',placeId:classroom.id,cameraPlaceId:classroom.id,visiblePlaceIds:[hall.id],relatedPlaceIds:[],shot:'wide',tags:[],memo:'',variants:[{id:randomUUID(),name:'낮',time:'day',activeRevisionId:imageId,revisions:[{id:imageId,imageUrl:'',filePath:'',createdAt:new Date().toISOString()}]}]};
  s = applyBackgroundCommand(s,{type:'save',kind:'view',entity:view,expectedRevision:null},{canManage:true});
  return {s,classroom:s.places[0],hall:s.places[1],view:s.views[0]};
}
test('방향과 보이는 장소를 구분하고 위치 없는 클로즈업은 origin 검색에서 제외한다',()=>{
  let {s,classroom,hall,view}=fixture();
  assert.equal(filterBackgroundViews(s,{placeId:hall.id,relation:'camera'}).length,0);
  assert.equal(filterBackgroundViews(s,{placeId:hall.id,relation:'visible'}).length,1);
  s=applyBackgroundCommand(s,{type:'save',kind:'view',entity:{...view,cameraPlaceId:null,relatedPlaceIds:[classroom.id],shot:'closeup'},expectedRevision:1},{canManage:true});
  assert.equal(filterBackgroundViews(s,{placeId:classroom.id,relation:'camera'}).length,0);
  assert.equal(filterBackgroundViews(s,{placeId:classroom.id,relation:'related'}).length,1);
});
test('낙관 revision 증가, stale 수정과 비관리자 자산 변경 거부',()=>{
  const {s,classroom}=fixture();
  assert.equal(classroom.revision,1);
  assert.throws(()=>applyBackgroundCommand(s,{type:'save',kind:'place',entity:{...classroom,name:'새 교실'},expectedRevision:0},{canManage:true}),/변경/);
  assert.throws(()=>applyBackgroundCommand(s,{type:'save',kind:'place',entity:classroom,expectedRevision:1},{canManage:false}),/관리자/);
});

test('이전 배경을 읽고 작업파일과 이미지파일 경로를 별도로 저장하며 빈 문자열 연결 해제를 보존한다',()=>{
  const {s,view}=fixture(),legacyPath='C:\\BG\\교실.psd';
  const legacy={...view,variants:view.variants.map(variant=>({...variant,revisions:variant.revisions.map(revision=>({...revision,filePath:legacyPath}))}))};
  const first=applyBackgroundCommand(s,{type:'save',kind:'view',entity:legacy,expectedRevision:1},{canManage:true});
  assert.equal(Object.hasOwn(first.views[0].variants[0],'workFilePath'),false);
  assert.equal(Object.hasOwn(first.views[0].variants[0].revisions[0],'sourceImagePath'),false);
  const linked={...first.views[0],variants:first.views[0].variants.map(variant=>({...variant,workFilePath:'G:\\배경\\교실_작업.psd',revisions:variant.revisions.map(revision=>({...revision,sourceImagePath:'G:\\배경\\교실.png'}))}))};
  const saved=applyBackgroundCommand(first,{type:'save',kind:'view',entity:linked,expectedRevision:2},{canManage:true});
  assert.deepEqual(saved.views[0].variants,linked.variants);
  assert.equal(saved.views[0].variants[0].revisions[0].filePath,legacyPath);
  const cleared={...saved.views[0],variants:saved.views[0].variants.map(variant=>({...variant,workFilePath:'',revisions:variant.revisions.map(revision=>({...revision,sourceImagePath:''}))}))};
  const unlinked=applyBackgroundCommand(saved,{type:'save',kind:'view',entity:cleared,expectedRevision:3},{canManage:true});
  assert.equal(unlinked.views[0].variants[0].workFilePath,'');assert.equal(unlinked.views[0].variants[0].revisions[0].sourceImagePath,'');
  assert.equal(unlinked.views[0].variants[0].revisions[0].filePath,legacyPath);
  assert.equal(unlinked.views[0].variants[0].revisions[0].imageUrl,s.views[0].variants[0].revisions[0].imageUrl);
});

test('선택적 파일 경로는 문자열과 4096자 제한을 적용하고 잘못된 위치 또는 추가 속성을 거부한다',()=>{
  const {view}=fixture(),variant=view.variants[0],revision=variant.revisions[0];
  const check=(next:unknown)=>validateBackgroundRequest({requestId:randomUUID(),command:{type:'save',kind:'view',entity:{...view,variants:[next]},expectedRevision:1}});
  assert.doesNotThrow(()=>check({...variant,workFilePath:'가'.repeat(4096),revisions:[{...revision,sourceImagePath:'나'.repeat(4096)}]}));
  for(const value of [null,undefined,42,true,[],{},'x'.repeat(4097)]){
    assert.throws(()=>check({...variant,workFilePath:value}),/작업파일 경로/);
    assert.throws(()=>check({...variant,revisions:[{...revision,sourceImagePath:value}]}),/이미지파일 경로/);
  }
  for(const next of [{...variant,workFilePath:'',extra:true},{...variant,sourceImagePath:''},{...variant,revisions:[{...revision,sourceImagePath:'',extra:true}]},{...variant,revisions:[{...revision,workFilePath:''}]}])assert.throws(()=>check(next),/속성/);
});

test('파일 연결도 관리자와 revision 검사를 거치며 거부된 변경은 기존 연결을 보존한다',()=>{
  const {s,view}=fixture(),before=structuredClone(s);
  const linked={...view,variants:view.variants.map(variant=>({...variant,workFilePath:'C:\\BG\\교실.psd',revisions:variant.revisions.map(revision=>({...revision,sourceImagePath:'C:\\BG\\교실.png'}))}))};
  assert.throws(()=>applyBackgroundCommand(s,{type:'save',kind:'view',entity:linked,expectedRevision:1},{canManage:false}),/관리자/);
  assert.throws(()=>applyBackgroundCommand(s,{type:'save',kind:'view',entity:linked,expectedRevision:0},{canManage:true}),/변경/);
  assert.deepEqual(s,before);
});
test('장소/도면 순환과 잘못된 하위 도면 연결 거부',()=>{
  let {s,classroom,hall}=fixture();
  s=applyBackgroundCommand(s,{type:'save',kind:'place',entity:{...hall,parentId:classroom.id},expectedRevision:1},{canManage:true});
  assert.throws(()=>applyBackgroundCommand(s,{type:'save',kind:'place',entity:{...classroom,parentId:hall.id},expectedRevision:1},{canManage:true}),/순환/);
  const a:BackgroundMap={id:randomUUID(),revision:0,name:'2층',parentId:null,placeId:null,imageUrl:'',nodes:[]};
  s=applyBackgroundCommand(s,{type:'save',kind:'map',entity:a,expectedRevision:null},{canManage:true});
  assert.throws(()=>applyBackgroundCommand(s,{type:'save',kind:'map',entity:{...a,parentId:a.id},expectedRevision:1},{canManage:true}),/순환/);
});
test('도면 공간 삭제는 자산·에피소드 기록을 보존한다',()=>{
  let {s,classroom,view}=fixture();
  const usage:BackgroundUsage={id:randomUUID(),revision:0,episodeNumber:3,placeId:classroom.id,variantIds:[view.variants[0].id],memo:'밤 장면'};
  s=applyBackgroundCommand(s,{type:'save',kind:'usage',entity:usage,expectedRevision:null},{canManage:false,episodeNumbers:[3]});
  const map:BackgroundMap={id:randomUUID(),revision:0,name:'교실',parentId:null,placeId:classroom.id,imageUrl:'',nodes:[{id:randomUUID(),type:'space',name:'교실',placeId:classroom.id,childMapId:null,x:100,y:100,width:400,height:300,rotation:0,shape:'rect',points:[],locked:false}]};
  s=applyBackgroundCommand(s,{type:'save',kind:'map',entity:map,expectedRevision:null},{canManage:true});
  const after=applyBackgroundCommand(s,{type:'save',kind:'map',entity:{...s.maps[0],nodes:[]},expectedRevision:1},{canManage:true});
  assert.deepEqual(after.views,s.views);assert.deepEqual(after.usages,s.usages);
  assert.throws(()=>applyBackgroundCommand(after,{type:'delete',kind:'view',id:view.id,expectedRevision:1},{canManage:true}),/참조|사용|변형/);
});
test('묶음 적용은 독립 ID 복사이며 중복과 잘못된 장소 연결을 방지한다',()=>{
  const {s,classroom,hall,view}=fixture();
  const group:BackgroundGroup={id:randomUUID(),revision:0,name:'기본',placeId:classroom.id,variantIds:[view.variants[0].id]};
  const usage:BackgroundUsage={id:randomUUID(),revision:0,episodeNumber:1,placeId:classroom.id,variantIds:[],memo:''};
  const applied=mergeBackgroundGroup(usage,group);group.variantIds=[];
  assert.deepEqual(applied.variantIds,[view.variants[0].id]);assert.notStrictEqual(applied.variantIds,group.variantIds);
  assert.equal(mergeBackgroundGroup(applied,{...group,variantIds:applied.variantIds}).variantIds.length,1);
  assert.throws(()=>applyBackgroundCommand(s,{type:'save',kind:'usage',entity:{...applied,placeId:hall.id},expectedRevision:null},{canManage:false}),/장소/);
});
test('변형 참조 유효성, 에피소드 중복·미존재, NaN 좌표를 거부한다',()=>{
  let {s,classroom,view}=fixture();
  const usage:BackgroundUsage={id:randomUUID(),revision:0,episodeNumber:2,placeId:classroom.id,variantIds:[view.variants[0].id],memo:''};
  assert.throws(()=>applyBackgroundCommand(s,{type:'save',kind:'usage',entity:usage,expectedRevision:null},{canManage:false,episodeNumbers:[1]}),/에피소드/);
  s=applyBackgroundCommand(s,{type:'save',kind:'usage',entity:usage,expectedRevision:null},{canManage:false});
  assert.throws(()=>applyBackgroundCommand(s,{type:'save',kind:'usage',entity:{...usage,id:randomUUID()},expectedRevision:null},{canManage:false}),/이미/);
  const map:BackgroundMap={id:randomUUID(),revision:0,name:'잘못된 도면',parentId:null,placeId:null,imageUrl:'',nodes:[{id:randomUUID(),type:'camera',name:'A',spaceId:null,x:NaN,y:0,angle:0,fov:60,viewIds:[],locked:false}]};
  assert.throws(()=>applyBackgroundCommand(s,{type:'save',kind:'map',entity:map,expectedRevision:null},{canManage:true}),/좌표/);
});

const blankMap=(name='도면'):BackgroundMap=>({id:randomUUID(),revision:0,name,parentId:null,placeId:null,imageUrl:'',nodes:[]});
const mapLink=(childMapId:string)=>({id:randomUUID(),type:'space' as const,name:'상세 공간',placeId:null,childMapId,x:0,y:0,width:200,height:100,rotation:0,shape:'rect' as const,points:[],locked:false});
const symbol=(spaceId:string|null=null):BackgroundSymbol=>({id:randomUUID(),type:'symbol',name:'출입문',symbol:'door',spaceId,x:20,y:40,width:80,height:80,rotation:90,locked:false,hinge:'left',swing:'inward'});

test('문 열림 방향과 가구 기호를 공간 및 카메라와 함께 보존하고 관리 권한을 적용한다',()=>{
  const {s,classroom,view}=fixture(),room={...mapLink(randomUUID()),childMapId:null},door=symbol(room.id);
  const kinds=['door','desk','chair','table','sofa','bed','cabinet','plant','custom'] as const;
  const map:BackgroundMap={...blankMap(),placeId:classroom.id,nodes:[room,{id:randomUUID(),type:'camera',name:'전경',spaceId:room.id,x:100,y:100,angle:0,fov:60,viewIds:[view.id],locked:false},...kinds.map(kind=>({...door,id:randomUUID(),symbol:kind}))]};
  const command={type:'save' as const,kind:'map' as const,entity:map,expectedRevision:null};
  assert.throws(()=>applyBackgroundCommand(s,command,{canManage:false}),/관리자/);
  const saved=applyBackgroundCommand(s,command,{canManage:true});
  assert.deepEqual(saved.maps[0].nodes,map.nodes);assert.equal(saved.maps[0].revision,1);assert.equal(s.maps.length,0);
  const changed={...saved.maps[0],nodes:saved.maps[0].nodes.map(node=>node.type==='symbol'?{...node,hinge:'right' as const,swing:'outward' as const}:node)};
  assert.deepEqual(applyBackgroundCommand(saved,{...command,entity:changed,expectedRevision:1},{canManage:true}).maps[0].nodes,changed.nodes);
});

test('기호 종류와 문 방향, 크기, 같은 도면의 공간 연결을 검사하고 실패한 도면 배치를 보존한다',()=>{
  const initial=emptyBackgroundSnapshot(true),room={...mapLink(randomUUID()),childMapId:null},a={...blankMap(),nodes:[room]},b=blankMap();
  const saved=applyBackgroundCommand(initial,{type:'save-maps',maps:[{entity:a,expectedRevision:null},{entity:b,expectedRevision:null}]},{canManage:true}),before=structuredClone(saved);
  for(const invalid of [{...symbol(),symbol:'unknown'},{...symbol(),hinge:'middle'},{...symbol(),swing:'up'},{...symbol(),width:9},{...symbol(),height:-10},{...symbol(),height:100001},{...symbol(),rotation:361},{...symbol(),x:Infinity},{...symbol(),spaceId:undefined},{...symbol(),viewIds:[]}]){
    assert.throws(()=>validateBackgroundRequest({requestId:randomUUID(),command:{type:'save',kind:'map',entity:{...b,nodes:[invalid]},expectedRevision:1}}));
  }
  for(const spaceId of [room.id,randomUUID()])assert.throws(()=>applyBackgroundCommand(saved,{type:'save-maps',maps:[{entity:{...a,name:'반영되면 안 됨'},expectedRevision:1},{entity:{...b,nodes:[symbol(spaceId)]},expectedRevision:1}]},{canManage:true}),/공간/);
  const free=applyBackgroundCommand(saved,{type:'save',kind:'map',entity:{...b,nodes:[symbol()]},expectedRevision:1},{canManage:true});
  assert.equal(free.maps.find(map=>map.id===b.id)?.nodes[0].type,'symbol');assert.deepEqual(saved,before);
});
test('도면 배치는 저장 전 부모와 상세 도면을 연결하고 기존 도면의 이동도 한 번에 반영한다',()=>{
  const parent=blankMap('상위'),child={...blankMap('상세'),parentId:parent.id};parent.nodes=[mapLink(child.id)];
  const initial=emptyBackgroundSnapshot(true);
  let snapshot=applyBackgroundCommand(initial,{type:'save-maps',maps:[{entity:parent,expectedRevision:null},{entity:child,expectedRevision:null}]},{canManage:true});
  assert.equal(initial.maps.length,0);assert.equal(snapshot.maps.length,2);assert.ok(snapshot.maps.every(map=>map.revision===1));
  const destination=blankMap('새 상위');destination.nodes=[mapLink(child.id)];
  snapshot=applyBackgroundCommand(snapshot,{type:'save-maps',maps:[{entity:{...child,parentId:destination.id},expectedRevision:1},{entity:destination,expectedRevision:null},{entity:{...parent,nodes:[]},expectedRevision:1}]},{canManage:true});
  assert.equal(snapshot.maps.find(map=>map.id===child.id)?.parentId,destination.id);
  assert.deepEqual(snapshot.maps.find(map=>map.id===parent.id)?.nodes,[]);
});
test('도면 배치는 오래된 버전이나 잘못된 최종 연결이 있으면 입력 전체를 보존한다',()=>{
  const a=blankMap('A'),b=blankMap('B');
  const snapshot=applyBackgroundCommand(emptyBackgroundSnapshot(true),{type:'save-maps',maps:[{entity:a,expectedRevision:null},{entity:b,expectedRevision:null}]},{canManage:true}),before=structuredClone(snapshot);
  assert.throws(()=>applyBackgroundCommand(snapshot,{type:'save-maps',maps:[{entity:{...a,name:'변경'},expectedRevision:1},{entity:b,expectedRevision:2}]},{canManage:true}),/변경/);
  assert.throws(()=>applyBackgroundCommand(snapshot,{type:'save-maps',maps:[{entity:{...a,parentId:b.id},expectedRevision:1},{entity:{...b,parentId:a.id},expectedRevision:1}]},{canManage:true}),/순환/);
  assert.throws(()=>applyBackgroundCommand(snapshot,{type:'save-maps',maps:[{entity:{...a,nodes:[mapLink(randomUUID())]},expectedRevision:1},{entity:{...b,name:'변경'},expectedRevision:1}]},{canManage:true}),/상세 도면/);
  assert.deepEqual(snapshot,before);
});
test('도면 배치는 관리자, 개수, 중복 ID, 필드, 버전 및 UTF-8 요청 크기를 검사한다',()=>{
  const a=blankMap(),item={entity:a,expectedRevision:null},check=(command:unknown)=>validateBackgroundRequest({requestId:randomUUID(),command});
  assert.throws(()=>applyBackgroundCommand(emptyBackgroundSnapshot(),{type:'save-maps',maps:[item]},{canManage:false}),/관리자/);
  for(const command of [{type:'save-maps',maps:[]},{type:'save-maps',maps:Array.from({length:101},()=>({entity:blankMap(),expectedRevision:null}))},{type:'save-maps',maps:[item,{...item,entity:{...a,id:a.id.toUpperCase()}}]},{type:'save-maps',maps:[{...item,kind:'map'}]},{type:'save-maps',maps:[{...item,expectedRevision:0}]},{type:'save-maps',maps:[item],kind:'map'},{type:'save-maps',maps:[{...item,entity:{...a,nodes:[{...mapLink(randomUUID()),width:1}]}}]}])assert.throws(()=>check(command));
  const imageUrl='https://example.test/'+'가'.repeat(1_900_000);
  assert.throws(()=>check({type:'save-maps',maps:Array.from({length:5},()=>({entity:{...blankMap(),imageUrl},expectedRevision:null}))}),/너무 큽니다/);
});

// Vertical-axis fields shared by the plan and 3D views. The matrix is spelled out here on purpose:
// it is the storage contract that the 3D migration SQL mirrors.
const spatialRange={elevation:[-100000,100000],volumeHeight:[1,100000],pitch:[-90,90],roll:[-180,180],aspect:[0.1,10]} as const;
type SpatialKey=keyof typeof spatialRange;
type NodeType=BackgroundNode['type'];
const spatialKeys=Object.keys(spatialRange) as SpatialKey[],nodeTypes:NodeType[]=['space','camera','symbol'];
const spatialLabel:Record<NodeType,Partial<Record<SpatialKey,RegExp>>>={
  space:{elevation:/바닥 높이/,volumeHeight:/입체 높이/},
  camera:{elevation:/카메라 높이/,pitch:/위아래 각도/,roll:/기울기/,aspect:/화면 비율/},
  symbol:{elevation:/바닥 높이/,volumeHeight:/입체 높이/,pitch:/위아래 각도/,roll:/기울기/},
};
const planSpace=():BackgroundSpace=>({...mapLink(randomUUID()),childMapId:null});
const planCamera=(spaceId:string|null=null):BackgroundCamera=>({id:randomUUID(),type:'camera',name:'카메라',spaceId,x:500,y:340,angle:0,fov:60,viewIds:[],locked:false});
const legacyNode:Record<NodeType,()=>BackgroundNode>={space:planSpace,camera:()=>planCamera(),symbol:()=>symbol()};
const checkNodes=(nodes:unknown[])=>validateBackgroundRequest({requestId:randomUUID(),command:{type:'save',kind:'map',entity:{...blankMap(),nodes},expectedRevision:null}});
const spatialNodes=():BackgroundNode[]=>{
  const room={...planSpace(),elevation:-12.5,volumeHeight:260.75};
  return [room,{...planCamera(room.id),angle:90,elevation:120.25,pitch:-90,roll:-33.5,aspect:16/9},{...symbol(room.id),elevation:35.125,volumeHeight:80.5,pitch:-45.5,roll:12.25},planCamera(),symbol()];
};

test('세로축 범위 상수는 저장 계약의 값 그대로다',()=>{
  assert.deepEqual(BACKGROUND_SPATIAL_LIMITS,Object.fromEntries(spatialKeys.map(key=>[key,{min:spatialRange[key][0],max:spatialRange[key][1]}])));
});
test('도면 계산 모듈은 저장 검증과 같은 세로축 범위를 쓴다',async()=>{
  const {MAP_SPATIAL_LIMITS}=await import('../src/features/backgrounds/mapSpatial.ts');
  assert.deepEqual(MAP_SPATIAL_LIMITS,BACKGROUND_SPATIAL_LIMITS);
});

test('높이 값이 없는 이전 도면은 그대로 검증·저장되고 기본값이 덧붙지 않는다',()=>{
  const room=planSpace(),nodes=[room,planCamera(room.id),symbol(room.id)],map={...blankMap('이전 도면'),nodes},actor={canManage:true};
  assert.doesNotThrow(()=>checkNodes(nodes));
  let saved=applyBackgroundCommand(emptyBackgroundSnapshot(true),{type:'save',kind:'map',entity:map,expectedRevision:null},actor);
  assert.deepEqual(saved.maps[0],{...map,revision:1});
  saved=applyBackgroundCommand(saved,{type:'save-maps',maps:[{entity:{...saved.maps[0],name:'이름만 변경'},expectedRevision:1}]},actor);
  assert.deepEqual(saved.maps[0].nodes,nodes);assert.doesNotThrow(()=>validateBackgroundSnapshot(saved));
  for(const node of saved.maps[0].nodes)for(const key of spatialKeys)assert.equal(Object.hasOwn(node,key),false,`${node.type}.${key}`);
});

test('높이·기울기·화면 비율은 단일 저장, 이름만 바꾼 저장, 묶음 저장에서 그대로 보존된다',()=>{
  const nodes=spatialNodes(),sent=structuredClone(nodes),map={...blankMap('입체 도면'),nodes},actor={canManage:true};
  let s=applyBackgroundCommand(emptyBackgroundSnapshot(true),{type:'save',kind:'map',entity:map,expectedRevision:null},actor);
  assert.deepEqual(s.maps[0],{...map,revision:1});
  s=applyBackgroundCommand(s,{type:'save',kind:'map',entity:{...s.maps[0],name:'이름만 변경'},expectedRevision:1},actor);
  assert.equal(s.maps[0].name,'이름만 변경');assert.equal(s.maps[0].revision,2);assert.deepEqual(s.maps[0].nodes,sent);
  const added={...blankMap('함께 저장'),nodes:[{...planCamera(),elevation:0,pitch:90}]};
  s=applyBackgroundCommand(s,{type:'save-maps',maps:[{entity:{...s.maps[0],name:'묶음 저장'},expectedRevision:2},{entity:added,expectedRevision:null}]},actor);
  assert.equal(s.maps[0].revision,3);assert.deepEqual(s.maps[0].nodes,sent);assert.deepEqual(s.maps[1],{...added,revision:1});
  assert.doesNotThrow(()=>validateBackgroundSnapshot(s));assert.deepEqual(nodes,sent);
  // Only the fields the user set are stored: the plain camera and symbol stay without them.
  for(const node of s.maps[0].nodes.slice(3))for(const key of spatialKeys)assert.equal(Object.hasOwn(node,key),false,`${node.type}.${key}`);
});

test('정확히 수직인 카메라와 모든 경계값을 받아들인다',()=>{
  const nodes:BackgroundNode[]=[
    {...planCamera(),elevation:100000,pitch:90,roll:180,aspect:10},{...planCamera(),elevation:-100000,pitch:-90,roll:-180,aspect:0.1},
    {...planSpace(),elevation:-100000,volumeHeight:1},{...planSpace(),elevation:100000,volumeHeight:100000},
    {...symbol(),elevation:100000,volumeHeight:1,pitch:90,roll:-180},{...symbol(),elevation:-100000,volumeHeight:100000,pitch:-90,roll:180},
  ];
  const saved=applyBackgroundCommand(emptyBackgroundSnapshot(true),{type:'save',kind:'map',entity:{...blankMap(),nodes},expectedRevision:null},{canManage:true});
  assert.deepEqual(saved.maps[0].nodes,nodes);
});

test('세로축 값은 유한한 숫자와 정해진 범위만 받는다',()=>{
  for(const type of nodeTypes)for(const key of spatialKeys){
    const label=spatialLabel[type][key],[min,max]=spatialRange[key],node=legacyNode[type]();
    if(!label)continue;
    for(const value of [NaN,Infinity,-Infinity,null,undefined,String(min),'',true,false,[],{},min-0.001,max+0.001,min-1,max+1])
      assert.throws(()=>checkNodes([{...node,[key]:value}]),label,`${type}.${key}=${inspect(value)}`);
    for(const value of [min,max,(min+max)/2+0.125])assert.doesNotThrow(()=>checkNodes([{...node,[key]:value}]),`${type}.${key}=${value}`);
  }
});

test('세로축 속성은 정해진 오브젝트에만 허용하고 모르는 속성은 거부한다',()=>{
  // pitch/roll/aspect on a space, volumeHeight on a camera, aspect on a symbol.
  const misplaced=nodeTypes.flatMap(type=>spatialKeys.filter(key=>!spatialLabel[type][key]).map(key=>[type,{[key]:spatialRange[key][1]}] as const));
  assert.deepEqual(misplaced.map(([type,extra])=>`${type}.${Object.keys(extra)[0]}`),['space.pitch','space.roll','space.aspect','camera.volumeHeight','symbol.aspect']);
  const unknown=nodeTypes.flatMap(type=>[{depth:10},{yaw:0},{tilt:0},{z:0},{scale:1},{Elevation:0},{volume_height:80}].map(extra=>[type,extra] as const));
  for(const [type,extra] of [...misplaced,...unknown])assert.throws(()=>checkNodes([{...legacyNode[type](),...extra}]),/속성/,`${type} ${JSON.stringify(extra)}`);
  assert.throws(()=>validateBackgroundRequest({requestId:randomUUID(),command:{type:'save',kind:'map',entity:{...blankMap(),elevation:0},expectedRevision:null}}),/속성/);
  assert.throws(()=>checkNodes([{...planSpace(),shape:'polygon',points:[{x:0,y:0,elevation:0},{x:1,y:0},{x:1,y:1}]}]),/속성/);
});

test('잘못된 세로축 값이 든 저장과 조회 결과는 통째로 거부되어 기존 도면을 바꾸지 않는다',()=>{
  const camera={...planCamera(),elevation:120,pitch:-35},actor={canManage:true};
  const saved=applyBackgroundCommand(emptyBackgroundSnapshot(true),{type:'save',kind:'map',entity:{...blankMap(),nodes:[camera]},expectedRevision:null},actor),before=structuredClone(saved);
  assert.throws(()=>applyBackgroundCommand(saved,{type:'save',kind:'map',entity:{...saved.maps[0],nodes:[{...camera,pitch:91}]},expectedRevision:1},actor),/위아래 각도/);
  assert.throws(()=>applyBackgroundCommand(saved,{type:'save-maps',maps:[{entity:{...saved.maps[0],name:'반영되면 안 됨'},expectedRevision:1},{entity:{...blankMap(),nodes:[{...planCamera(),elevation:NaN}]},expectedRevision:null}]},actor),/카메라 높이/);
  assert.deepEqual(saved,before);
  const broken=structuredClone(saved);(broken.maps[0].nodes[0] as unknown as Record<string,unknown>).pitch='up';
  assert.throws(()=>validateBackgroundSnapshot(broken),/위아래 각도/);
});

// The geometry module writes these values and this module accepts them: the two halves of one contract.
test('고정 위치에 추가한 카메라와 3D 편집 결과는 한계 밖으로 끌어도 그대로 저장된다',()=>{
  const room:BackgroundSpace={...planSpace(),x:100,y:110,width:470,height:300},lens:BackgroundCamera={...planCamera(room.id),x:470,y:340};
  const desk:BackgroundSymbol={...symbol(room.id),x:150,y:150,width:60,height:40,rotation:0},legacy:BackgroundMap={...blankMap('이전 도면'),nodes:[room,lens,desk]};
  const store=(entity:BackgroundMap)=>applyBackgroundCommand(emptyBackgroundSnapshot(true),{type:'save-maps',maps:[{entity,expectedRevision:null}]},{canManage:true}).maps[0];
  const added=[randomUUID(),randomUUID(),randomUUID()].reduce((current,id)=>addMapCamera(current,id).map,legacy);
  assert.deepEqual(store(added),{...added,revision:1});
  assert.deepEqual(added.nodes.slice(3).map(node=>[node.x,node.y,node.elevation,node.type==='camera'&&node.spaceId]),Array.from({length:3},()=>[500,340,120,room.id]));
  for(const node of added.nodes.slice(0,3))for(const key of spatialKeys)assert.equal(Object.hasOwn(node,key),false,`${node.type}.${key}`);
  const upright={x:0,y:0,z:0,w:1},one={x:1,y:1,z:1},far=1e9;
  const edits:[string,Parameters<typeof applyNodeWorldPose>[2]][]=[
    [lens.id,{position:{x:far,y:-far,z:-far},quaternion:cameraOrientation({angle:200.12345,pitch:89.9997,roll:-30}),scale:one}],
    [lens.id,{position:{x:470.0004,y:75.55555,z:340},quaternion:cameraOrientation({angle:359.9998,pitch:-90,roll:180}),scale:one}],
    [desk.id,{position:{x:0,y:far,z:0},quaternion:nodeOrientation({rotation:120.5,pitch:-45,roll:170}),scale:{x:far,y:far,z:far}}],
    [desk.id,{position:{x:-far,y:-far,z:far},quaternion:nodeOrientation({rotation:10,pitch:90,roll:0}),scale:{x:1e-9,y:0,z:-4}}],
    [room.id,{position:{x:335,y:0,z:100200},quaternion:upright,scale:one}],
    [room.id,{position:{x:-250000,y:99990,z:-250000},quaternion:nodeOrientation({rotation:33,pitch:20,roll:5}),scale:one}],
    [room.id,{position:{x:90000,y:-far,z:far},quaternion:nodeOrientation({rotation:271.5,pitch:0,roll:0}),scale:{x:1e6,y:1e6,z:1e6}}],
  ];
  for(const [index,[nodeId,pose]] of edits.entries()){
    const next=applyNodeWorldPose(legacy,nodeId,pose);
    assert.notEqual(next,legacy,`edit ${index}`);assert.deepEqual(store(next),{...next,revision:1},`edit ${index}`);
  }
  // A camera pushed up with its room stops at the height limit, and that is storable too.
  const high={...legacy,nodes:[room,{...lens,elevation:99990},desk]};
  const raised=applyNodeWorldPose(high,room.id,{position:{x:335,y:50,z:260},quaternion:upright,scale:one});
  assert.equal((raised.nodes[1] as BackgroundCamera).elevation,100000);assert.deepEqual(store(raised),{...raised,revision:1});
});

test('읽을 때 쓰는 기본값과 새 카메라의 고정 자세는 저장 범위 안이고 사물 종류 목록도 저장 검증과 같다',()=>{
  const defaults=MAP_SPATIAL_DEFAULTS,kinds=Object.keys(SYMBOL_VOLUME_HEIGHTS) as BackgroundSymbol['symbol'][];
  assert.deepEqual([...kinds].sort(),['bed','cabinet','chair','custom','desk','door','plant','sofa','table']);
  assert.doesNotThrow(()=>checkNodes([
    {...planSpace(),elevation:defaults.spaceElevation,volumeHeight:defaults.spaceVolumeHeight},
    {...planCamera(),elevation:defaults.cameraElevation,pitch:defaults.pitch,roll:defaults.roll,aspect:defaults.aspect},
    createMapCamera(randomUUID(),'카메라 1'),
    ...kinds.map(kind=>({...symbol(),id:randomUUID(),symbol:kind,elevation:defaults.symbolElevation,volumeHeight:SYMBOL_VOLUME_HEIGHTS[kind],pitch:defaults.pitch,roll:defaults.roll})),
  ]));
  assert.throws(()=>checkNodes([{...symbol(),symbol:'lamp'}]),/사물 기호/);
});
