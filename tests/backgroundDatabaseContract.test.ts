import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID,createHash } from 'node:crypto';
import { BACKGROUND_SPATIAL_LIMITS } from '../src/features/backgrounds/domain.ts';
import { mapSaveWasApplied } from '../src/features/backgrounds/mapWorkflow.ts';
import { addMapCamera, applyNodeWorldPose } from '../src/features/backgrounds/mapGeometry.ts';
import { cameraOrientation, nodeOrientation } from '../src/features/backgrounds/mapSpatial.ts';

const migration=(name:string)=>readFileSync(new URL(`../DEVLOG/migrations/${name}`,import.meta.url),'utf8');
// The 3D file replaces one function of the base file, so every run applies them in this order.
const sql=migration('2026-09-21-background-library.sql'),sql3d=migration('2026-10-07-background-map-3d.sql');
const runtime=process.env.BFLOW_PGLITE_MODULE;
const id=()=>randomUUID();
const place=(name='교실',parentId:string|null=null)=>({id:id(),revision:0,name,parentId,folderPath:''});
const map=(placeId:string|null=null,parentId:string|null=null)=>({id:id(),revision:0,name:'도면',placeId,parentId,imageUrl:'',nodes:[] as any[]});
const view=(placeId:string)=>{const revision={id:id(),imageUrl:'https://example.test/bg.png',filePath:'C:\\BG\\교실.png',createdAt:'2026-09-21T00:00:00.000Z'};return {id:id(),revision:0,name:'교실 전경',placeId,cameraPlaceId:placeId,visiblePlaceIds:[],relatedPlaceIds:[],shot:'wide',tags:[],memo:'',variants:[{id:id(),name:'낮',time:'day',revisions:[revision],activeRevisionId:revision.id}]};};
const space=(placeId:string|null=null)=>({id:id(),type:'space',name:'공간',placeId,childMapId:null,x:0,y:0,width:100,height:100,rotation:0,shape:'rect',points:[],locked:false});
const camera=(spaceId:string|null=null)=>({id:id(),type:'camera',name:'카메라',spaceId,x:0,y:0,angle:0,fov:60,viewIds:[],locked:false});
const symbol=(spaceId:string|null=null)=>({id:id(),type:'symbol',name:'문',symbol:'door',spaceId,x:20,y:30,width:60,height:60,rotation:90,hinge:'left',swing:'inward',locked:false});
// Vertical-axis contract of the shared plan/3D editor, written out so SQL, the app and the tests cannot drift silently.
const spatialRange={elevation:[-100000,100000],volumeHeight:[1,100000],pitch:[-90,90],roll:[-180,180],aspect:[0.1,10]} as const;
const spatialFields={space:['elevation','volumeHeight'],camera:['elevation','pitch','roll','aspect'],symbol:['elevation','volumeHeight','pitch','roll']} as const;
type SpatialKey=keyof typeof spatialRange;type NodeType=keyof typeof spatialFields;
const spatialKeys=Object.keys(spatialRange) as SpatialKey[],nodeTypes=Object.keys(spatialFields) as NodeType[];
const spatialSample:Record<SpatialKey,number>={elevation:120.25,volumeHeight:80.5,pitch:-35.5,roll:12.25,aspect:16/9};
const plain:Record<NodeType,()=>any>={space:()=>space(),camera:()=>camera(),symbol:()=>symbol()};
const slots=nodeTypes.flatMap(type=>spatialFields[type].map(key=>[type,key as SpatialKey] as const));
const misplaced=nodeTypes.flatMap(type=>spatialKeys.filter(key=>!(spatialFields[type] as readonly string[]).includes(key)).map(key=>[type,key] as const));
const code=(text:string)=>text.replace(/--.*$/gm,'');
const entityValidator=(text:string)=>{const start=text.indexOf('CREATE OR REPLACE FUNCTION public.background_library_validate_entity('),end=text.indexOf('END $$;',start);assert.ok(start>=0&&end>start);return text.slice(start,end).split(/\r?\n/);};

test('3D migration widens only the map node validator with the app ranges, never injects defaults and keeps the lockdown',()=>{
  const body=code(sql3d);
  assert.match(sql3d,/^-- Prerequisite: 2026-09-21-background-library\.sql/m);assert.match(sql3d,/^-- .*not applied to production/im);
  assert.match(body,/^BEGIN;\r?\nSET LOCAL lock_timeout = '5s';\r?\nSET LOCAL statement_timeout = '45s';/m);assert.match(body,/^COMMIT;\s*$/m);
  assert.deepEqual(body.match(/CREATE OR REPLACE FUNCTION public\.\w+/g),['CREATE OR REPLACE FUNCTION public.background_library_validate_entity']);
  assert.match(body,/to_regprocedure\('public\.background_library_validate_entity\(text,jsonb\)'\) IS NULL/);
  assert.deepEqual(misplaced.map(([type,key])=>`${type}.${key}`),['space.pitch','space.roll','space.aspect','camera.volumeHeight','symbol.aspect']);
  for(const type of nodeTypes)assert.ok(body.includes(`WHEN '${type}' THEN ARRAY[${spatialFields[type].map(key=>`'${key}'`).join(',')}]`),`${type} optional keys`);
  assert.match(body,/public\.background_library_object\(n-spatial,keys\)/);
  // Every range check applies only when the key is present and uses exactly the app's bounds.
  const checks=[...body.matchAll(/\(NOT \(n \? '(\w+)'\) OR public\.background_library_number\(n->'(\w+)',(-?[\d.]+),(-?[\d.]+)\)\)/g)];
  assert.deepEqual(checks.map(match=>match[2]),slots.map(([,key])=>key));
  for(const [,guard,key,lo,hi] of checks){
    assert.equal(guard,key);assert.deepEqual([Number(lo),Number(hi)],[...spatialRange[key as SpatialKey]]);
    assert.deepEqual({min:Number(lo),max:Number(hi)},BACKGROUND_SPATIAL_LIMITS[key as SpatialKey]);
  }
  assert.equal(body.match(/background_library_number\(n->'(elevation|volumeHeight|pitch|roll|aspect)'/g)?.length,slots.length);
  // A validator returning nothing cannot rewrite the row; lost-reply recovery compares the submitted JSON as stored.
  assert.match(body,/RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER/);
  assert.doesNotMatch(body,/jsonb_set|jsonb_insert|jsonb_build_object|jsonb_strip_nulls|COALESCE|\|\||DEFAULT|\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE TABLE)\b/i);
  assert.match(sql,/candidate:=jsonb_set\(candidate,'\{revision\}',to_jsonb\(COALESCE\(expected,0\)\+1\)\);/);assert.equal(sql.match(/jsonb_set\(/g)?.length,1);
  assert.match(body,/REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC/);assert.match(body,/REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I/);
  assert.match(body,/GRANT EXECUTE ON FUNCTION public\.background_library_read\(text\),public\.background_library_execute\(text,text,jsonb\) TO %I/);
  assert.match(body,/^NOTIFY pgrst, 'reload schema';/m);
});

test('3D migration keeps every other rule of the base entity validator verbatim',()=>{
  const base=entityValidator(sql),next=entityValidator(sql3d);
  const widened=base.map(line=>line.replace('keys TEXT[];','keys TEXT[]; spatial TEXT[];').replace('public.background_library_object(n,keys)','public.background_library_object(n-spatial,keys)'));
  assert.equal(widened.filter((line,index)=>line!==base[index]).length,2);
  const added=next.filter(line=>!widened.includes(line));
  assert.deepEqual(next.filter(line=>widened.includes(line)),widened);
  assert.equal(added.length,7);assert.ok(added.every(line=>/\b(spatial|elevation|volumeHeight|pitch|roll|aspect)\b/.test(line)),added.join('\n'));
  // The base alone still lists only the plan keys, which is why both files ship together.
  for(const key of spatialKeys)assert.equal(base.some(line=>line.includes(`'${key}'`)),false,key);
});

test('3D migration header tells the operator to apply it again after every run of the base file',()=>{
  // The base file is re-runnable and restores its own narrower validator; see the base-after-3D runtime test below.
  assert.match(sql3d,/^-- Re-run this file after every run of 2026-09-21-background-library\.sql/m);
  assert.ok(sql3d.indexOf('-- Re-run this file after every run')<sql3d.indexOf('BEGIN;'));
});

test('background migration exposes only session RPCs and stores entities separately with durable tombstones',()=>{
  assert.match(sql,/background_library_entities/);assert.match(sql,/PRIMARY KEY \(kind,id\)/);assert.match(sql,/deleted_at TIMESTAMPTZ/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/g);assert.match(sql,/app_session_user_id\(p_session_token\)/);assert.match(sql,/FROM PUBLIC/);
  assert.match(sql,/REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I/);assert.match(sql,/GRANT EXECUTE ON FUNCTION public.background_library_read/);
  assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/receipt<>p_command/);assert.match(sql,/previous.revision<>expected/);
  assert.match(sql,/USING '\{\}'::jsonb,'changed','background-library',false/);
});

const tokens={admin:'a'.repeat(64),member:'b'.repeat(64)};
/** A database that has everything the background migrations require, and none of them applied yet. */
async function boot(){
  const {PGlite}=await import(pathToFileURL(runtime!).href);const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
      CREATE TABLE public.users(id TEXT PRIMARY KEY,role TEXT NOT NULL);
      CREATE TABLE public.episodes(episode_number INTEGER PRIMARY KEY);
      INSERT INTO users VALUES('admin','admin'),('member','user');INSERT INTO episodes VALUES(1),(2);
      CREATE SCHEMA realtime;CREATE TABLE realtime.messages(payload JSONB,event TEXT,topic TEXT,private BOOLEAN);
      CREATE FUNCTION realtime.send(payload JSONB,event TEXT,topic TEXT,private BOOLEAN) RETURNS VOID LANGUAGE SQL AS 'INSERT INTO realtime.messages VALUES(payload,event,topic,private)';`);
    // Execute the actual existing token resolver and app_sessions schema, not an actor-id test stub.
    const auth=readFileSync(new URL('../DEVLOG/migrations/2026-09-05-app-sessions-gantt-auth.sql',import.meta.url),'utf8');
    await db.exec(auth.slice(0,auth.indexOf('-- ── 3)')));
    await db.exec('REVOKE ALL ON FUNCTION public.app_session_user_id(text) FROM PUBLIC,anon,authenticated');
    for(const who of ['admin','member'] as const)await db.query('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'1 day\')',[createHash('sha256').update(tokens[who]).digest('hex'),who]);
    return db;
  } catch(error) {await db.close();throw error;}
}

test('background RPC runtime validates sessions, permissions, CAS, idempotency and every entity reference',{skip:!runtime},async(t)=>{
  const db=await boot();
  try {
    await db.exec(sql);await db.exec(sql);await db.exec(sql3d);await db.exec(sql3d);await db.exec('SET ROLE anon');
    const read=async(who:'admin'|'member'='admin')=>(await db.query('SELECT background_library_read($1) AS value',[tokens[who]])).rows[0].value;
    const run=async(command:any,who:'admin'|'member'='admin',requestId=id())=>(await db.query('SELECT background_library_execute($1,$2,$3) AS value',[tokens[who],requestId,command])).rows[0].value;
    const save=(kind:string,entity:any,expectedRevision:number|null=null,who:'admin'|'member'='admin')=>run({type:'save',kind,entity,expectedRevision},who);
    const remove=(kind:string,entity:any,revision=entity.revision)=>run({type:'delete',kind,id:entity.id,expectedRevision:revision});
    let classroom:any,asset:any;

    await t.test('anonymous/expired tokens and direct objects cannot bypass canonical permissions',async()=>{
      await assert.rejects(db.query('SELECT background_library_read($1)',['invalid']),{code:'42501'});
      for(const table of ['background_library_entities','background_library_receipts'])await assert.rejects(db.query(`SELECT * FROM ${table}`),{code:'42501'});
      await assert.rejects(db.query('SELECT background_library_snapshot($1)',['admin']),{code:'42501'});
      await assert.rejects(save('place',place(),null,'member'),{code:'42501'});
      assert.equal((await read('admin')).canManage,true);assert.equal((await read('member')).canManage,false);
      await assert.rejects(run({type:'save',kind:'place',entity:place(),expectedRevision:null,canManage:true}),{code:'22023'});
    });
    await t.test('entity CAS and request receipts preserve independent edits and reject changed retry payloads',async()=>{
      classroom=place();const command={type:'save',kind:'place',entity:classroom,expectedRevision:null};const requestId=id();
      const first=await run(command,'admin',requestId);assert.equal(first.places[0].revision,1);classroom=first.places[0];
      assert.deepEqual(await run(command,'admin',requestId),first);
      await assert.rejects(run({...command,entity:{...classroom,name:'다른 이름'}},'admin',requestId),{code:'22023'});
      await save('place',place('독립된 장소'));const updated=await save('place',{...classroom,name:'교실 수정'},1);classroom=updated.places.find((p:any)=>p.id===classroom.id);
      assert.equal(classroom.revision,2);await assert.rejects(save('place',{...classroom,name:'늦은 수정'},1),{code:'40001'});
      assert.equal((await run(command,'admin',requestId)).places.find((p:any)=>p.id===classroom.id).name,'교실 수정');
    });
    await t.test('deleted entity IDs remain tombstoned and cannot be recreated by stale tabs',async()=>{
      const p=place('삭제할 장소');await save('place',p);await remove('place',p,1);
      await assert.rejects(save('place',p),{code:'40001'});await assert.rejects(save('place',p,1),{code:'40001'});
    });
    await t.test('usage edits are available to members and copy group selections independently',async()=>{
      asset=view(classroom.id);await save('view',asset);asset.revision=1;
      const group={id:id(),revision:0,name:'전경 묶음',placeId:classroom.id,variantIds:[asset.variants[0].id]};await save('group',group);
      const usage={id:id(),revision:0,episodeNumber:1,placeId:classroom.id,variantIds:[...group.variantIds],memo:'장소별 메모'};
      await save('usage',usage,null,'member');await remove('group',group,1);
      assert.deepEqual((await read('member')).usages[0].variantIds,usage.variantIds);
      await assert.rejects(save('usage',{...usage,id:id()},null,'member'),{code:'22023'});
      await assert.rejects(save('usage',{...usage,id:id(),episodeNumber:999},null,'member'),{code:'22023'});
      await assert.rejects(remove('view',asset,1),{code:'22023'});await assert.rejects(remove('place',classroom),{code:'22023'});
      const replacement=view(classroom.id);await assert.rejects(save('view',{...asset,variants:replacement.variants},1),{code:'22023'});
      const otherPlace=place('다른 장소');await save('place',otherPlace);
      await assert.rejects(save('group',{...group,id:id(),placeId:otherPlace.id}),{code:'22023'});
      const duplicate=view(classroom.id);duplicate.variants[0].id=asset.variants[0].id;await assert.rejects(save('view',duplicate),{code:'22023'});
    });
    await t.test('map placement removal preserves original assets and usage while local references stay valid',async()=>{
      const m=map(classroom.id);const s=space(classroom.id);m.nodes=[s];await save('map',m);
      await save('map',{...m,nodes:[]},1);const snapshot=await read();assert.equal(snapshot.views.length,1);assert.equal(snapshot.usages.length,1);
      await remove('map',m,2);assert.equal((await read()).views[0].id,asset.id);
      const bad=map(classroom.id);bad.nodes=[camera(id())];await assert.rejects(save('map',bad),{code:'22023'});
      const missingView=map();missingView.nodes=[{...camera(),viewIds:[id()]}];await assert.rejects(save('map',missingView),{code:'22023'});
    });
    await t.test('mixed maps persist doors and furniture, keep canonical permissions and reject invalid symbol writes atomically',async()=>{
      const room=space(classroom.id),m=map(classroom.id),door=symbol(room.id);
      m.nodes=[room,{...camera(room.id),viewIds:[asset.id]},...['door','desk','chair','table','sofa','bed','cabinet','plant','custom'].map(kind=>({...door,id:id(),symbol:kind}))];
      const before=await read();await assert.rejects(save('map',m,null,'member'),{code:'42501'});assert.deepEqual(await read(),before);
      await save('map',m);assert.deepEqual((await read('member')).maps.find((item:any)=>item.id===m.id).nodes,m.nodes);
      const edited={...m,nodes:m.nodes.map(node=>node.type==='symbol'?{...node,hinge:'right',swing:'outward'}:node)};
      await save('map',edited,1);assert.deepEqual((await read()).maps.find((item:any)=>item.id===m.id).nodes,edited.nodes);
      const saved=await read();
      const invalid=[{...symbol(),symbol:'unknown'},{...symbol(),hinge:'middle'},{...symbol(),swing:'up'},{...symbol(),width:9},{...symbol(),height:-1},{...symbol(),height:100001},{...symbol(),rotation:361},{...symbol(),spaceId:undefined},{...symbol(),viewIds:[]},{...symbol(),spaceId:room.id}];
      for(const node of invalid){await assert.rejects(run({type:'save-maps',maps:[{entity:{...edited,name:'반영되면 안 됨'},expectedRevision:2},{entity:{...map(),nodes:[node]},expectedRevision:null}]}),{code:'22023'});assert.deepEqual(await read(),saved);}
      await assert.rejects(save('map',{...edited,nodes:[{...door,spaceId:edited.nodes[1].id}]},2),{code:'22023'});assert.deepEqual(await read(),saved);
      const detached={...edited,nodes:[{...door,spaceId:null}]};await save('map',detached,2);
      assert.deepEqual((await read()).maps.find((item:any)=>item.id===m.id).nodes,detached.nodes);
    });
    await t.test('place and map cycles, missing parents and invalid detail links are rejected atomically',async()=>{
      const a=place('상위'),b=place('하위',a.id);await save('place',a);await save('place',b);
      await assert.rejects(save('place',{...a,parentId:b.id},1),{code:'22023'});await assert.rejects(save('place',place('없는 상위',id())),{code:'22023'});
      const parent=map(),child=map(null,parent.id);await save('map',parent);await save('map',child);
      await assert.rejects(save('map',{...parent,parentId:child.id},1),{code:'22023'});
      const link={...space(),childMapId:child.id};await save('map',{...parent,nodes:[link]},1);
      await assert.rejects(remove('map',child,1),{code:'22023'});await assert.rejects(remove('map',parent,2),{code:'22023'});
      await assert.rejects(save('map',{...child,nodes:[{...space(),childMapId:parent.id}]},1),{code:'22023'});
    });
    await t.test('malformed direct RPC data cannot bypass types, bounds, enums or duplicate checks',async()=>{
      const invalidPlaces=[{...place(),name:42},{...place(),name:''},{...place(),parentId:undefined},{...place(),folderPath:'x'.repeat(4097)},{...place(),extra:'untrusted'}];
      for(const p of invalidPlaces)await assert.rejects(save('place',p),{code:'22023'});
      const invalidNodes=[{...space(),x:100001},{...space(),width:9},{...space(),locked:'true'},{...space(),shape:'polygon',points:[{x:0,y:0}]},{...space(),shape:'polygon',points:[{x:0,y:0},{x:1,y:0},{x:2,y:1}]},{...camera(),fov:180}];
      for(const node of invalidNodes)await assert.rejects(save('map',{...map(),nodes:[node]}),{code:'22023'});
      const duplicate=space();await assert.rejects(save('map',{...map(),nodes:[duplicate,duplicate]}),{code:'22023'});
      const badViews=[{...view(classroom.id),variants:[]},{...view(classroom.id),shot:'invalid'},{...view(classroom.id),tags:['x'.repeat(81)]},{...view(classroom.id),visiblePlaceIds:[id()]},{...view(classroom.id),memo:'x'.repeat(10001)}];
      for(const v of badViews)await assert.rejects(save('view',v),{code:'22023'});
      const active=view(classroom.id);active.variants[0].activeRevisionId=id();await assert.rejects(save('view',active),{code:'22023'});
      const invalidDate=view(classroom.id);invalidDate.variants[0].revisions[0].createdAt='infinity';await assert.rejects(save('view',invalidDate),{code:'22023'});
      await assert.rejects(run({type:'delete',kind:'place',id:classroom.id,expectedRevision:null}),{code:'22023'});
      await assert.rejects(run({type:'save',kind:'place',entity:place(),expectedRevision:null},'admin','not-a-uuid'),{code:'22023'});
    });
    await t.test('legacy assets and separate work/image links roundtrip with explicit unlink and unchanged image history',async()=>{
      const old=view(classroom.id);await save('view',old);
      const legacy=(await read()).views.find((item:any)=>item.id===old.id);
      assert.equal(Object.hasOwn(legacy.variants[0],'workFilePath'),false);assert.equal(Object.hasOwn(legacy.variants[0].revisions[0],'sourceImagePath'),false);
      const linked={...legacy,variants:legacy.variants.map((variant:any)=>({...variant,workFilePath:'G:\\배경\\작업.psd',revisions:variant.revisions.map((revision:any)=>({...revision,sourceImagePath:'G:\\배경\\이미지.png'}))}))};
      const saved=await save('view',linked,1);assert.deepEqual(saved.views.find((item:any)=>item.id===old.id).variants,linked.variants);
      const bounded={...linked,variants:linked.variants.map((variant:any)=>({...variant,workFilePath:'가'.repeat(4096),revisions:variant.revisions.map((revision:any)=>({...revision,sourceImagePath:'나'.repeat(4096)}))}))};
      await save('view',bounded,2);assert.deepEqual((await read('member')).views.find((item:any)=>item.id===old.id).variants,bounded.variants);
      const unlinked={...linked,variants:linked.variants.map((variant:any)=>({...variant,workFilePath:'',revisions:variant.revisions.map((revision:any)=>({...revision,sourceImagePath:''}))}))};
      await save('view',unlinked,3);const result=(await read()).views.find((item:any)=>item.id===old.id).variants[0];
      assert.equal(result.workFilePath,'');assert.equal(result.revisions[0].sourceImagePath,'');
      assert.equal(result.revisions[0].filePath,old.variants[0].revisions[0].filePath);assert.equal(result.revisions[0].imageUrl,old.variants[0].revisions[0].imageUrl);
    });
    await t.test('file-link writes reject non-admins, stale revisions, bad optional values and extra keys without changing data',async()=>{
      const base=view(classroom.id);await save('view',base);const before=await read(),variant=base.variants[0],revision=variant.revisions[0];
      const linked={...base,variants:[{...variant,workFilePath:'C:\\BG\\교실.psd',revisions:[{...revision,sourceImagePath:'C:\\BG\\교실.png'}]}]};
      await assert.rejects(save('view',linked,1,'member'),{code:'42501'});await assert.rejects(save('view',linked,2),{code:'40001'});
      for(const value of [null,42,true,[],{},'x'.repeat(4097)]){
        await assert.rejects(save('view',{...base,variants:[{...variant,workFilePath:value}]},1),{code:'22023'});
        await assert.rejects(save('view',{...base,variants:[{...variant,revisions:[{...revision,sourceImagePath:value}]}]},1),{code:'22023'});
      }
      for(const bad of [{...variant,workFilePath:'',extra:true},{...variant,sourceImagePath:''},{...variant,revisions:[{...revision,sourceImagePath:'',extra:true}]},{...variant,revisions:[{...revision,workFilePath:''}]}])await assert.rejects(save('view',{...base,variants:[bad]},1),{code:'22023'});
      assert.deepEqual(await read(),before);
    });
    await t.test('deleted episodes preserve usage history without blocking unrelated edits or history removal',async()=>{
      const p=place('삭제된 EP 연결 장소');await save('place',p);
      const usage={id:id(),revision:0,episodeNumber:2,placeId:classroom.id,variantIds:[asset.variants[0].id],memo:'남겨 둘 과거 기록'};
      const command={type:'save',kind:'usage',entity:usage,expectedRevision:null};const requestId=id();
      await run(command,'member',requestId);
      await db.exec('RESET ROLE');await db.exec('DELETE FROM episodes WHERE episode_number=2');await db.exec('SET ROLE anon');
      const changed=await save('place',{...p,name:'EP 삭제 후 장소 수정'},1);
      assert.equal(changed.places.find((item:any)=>item.id===p.id).name,'EP 삭제 후 장소 수정');
      await save('map',map(classroom.id));
      const history=(await read('member')).usages.find((item:any)=>item.id===usage.id);
      assert.equal(history.memo,usage.memo);assert.deepEqual(history.variantIds,usage.variantIds);
      assert.deepEqual((await run(command,'member',requestId)).usages.find((item:any)=>item.id===usage.id),history);
      await assert.rejects(save('usage',{...usage,id:id(),placeId:p.id,variantIds:[]},null,'member'),/에피소드가 존재하지 않습니다/);
      await assert.rejects(save('usage',{...usage,memo:'삭제된 EP 기록 수정'},1,'member'),/에피소드가 존재하지 않습니다/);
      const removed=await run({type:'delete',kind:'usage',id:usage.id,expectedRevision:1},'member');
      assert.equal(removed.usages.some((item:any)=>item.id===usage.id),false);
      assert.equal(removed.views.some((item:any)=>item.id===asset.id),true);
    });
    await t.test('map batches create linked unsaved parents and children and atomically reparent existing links',async()=>{
      const parent=map(),child=map(null,parent.id);parent.nodes=[{...space(),childMapId:child.id}];
      const command={type:'save-maps',maps:[{entity:parent,expectedRevision:null},{entity:child,expectedRevision:null}]},requestId=id();
      const saved=await run(command,'admin',requestId);
      assert.equal(saved.maps.find((m:any)=>m.id===parent.id).revision,1);assert.equal(saved.maps.find((m:any)=>m.id===child.id).parentId,parent.id);
      assert.deepEqual(await run(command,'admin',requestId),saved);
      await assert.rejects(run({type:'save-maps',maps:[{entity:map(),expectedRevision:null}]},'admin',requestId),{code:'22023'});
      const destination=map();destination.nodes=[{...space(),childMapId:child.id}];
      const moved=await run({type:'save-maps',maps:[{entity:{...child,parentId:destination.id},expectedRevision:1},{entity:destination,expectedRevision:null},{entity:{...parent,nodes:[]},expectedRevision:1}]});
      assert.equal(moved.maps.find((m:any)=>m.id===child.id).parentId,destination.id);assert.deepEqual(moved.maps.find((m:any)=>m.id===parent.id).nodes,[]);
      assert.equal((await run(command,'admin',requestId)).maps.find((m:any)=>m.id===child.id).revision,2);
    });
    await t.test('map batch stale revisions, cycles and missing final references roll back every map and receipt',async()=>{
      const a=map(),b=map();await save('map',a);await save('map',b);const before=await read();
      const extra=map(),requestId=id();
      const stale={type:'save-maps',maps:[{entity:extra,expectedRevision:null},{entity:{...a,name:'저장되면 안 됨'},expectedRevision:1},{entity:b,expectedRevision:2}]};
      await assert.rejects(run(stale,'admin',requestId),{code:'40001'});assert.deepEqual(await read(),before);
      await assert.rejects(run({type:'save-maps',maps:[{entity:{...a,parentId:b.id},expectedRevision:1},{entity:{...b,parentId:a.id},expectedRevision:1}]}),{code:'22023'});assert.deepEqual(await read(),before);
      await assert.rejects(run({type:'save-maps',maps:[{entity:extra,expectedRevision:null},{entity:{...a,nodes:[{...space(),childMapId:id()}]},expectedRevision:1}]}),{code:'22023'});assert.deepEqual(await read(),before);
      // A rolled-back failed request leaves no receipt, so the corrected save can reuse its identity.
      const repaired=await run({...stale,maps:stale.maps.map((item:any)=>item.entity.id===b.id?{...item,expectedRevision:1}:item)},'admin',requestId);
      assert.equal(repaired.maps.find((m:any)=>m.id===extra.id).revision,1);
    });
    await t.test('map batch permissions, strict shape, duplicate IDs and bounds cannot be bypassed through RPC',async()=>{
      const m=map(),item={entity:m,expectedRevision:null},before=await read();
      await assert.rejects(run({type:'save-maps',maps:[item]},'member'),{code:'42501'});
      for(const command of [{type:'save-maps',maps:[]},{type:'save-maps',maps:Array.from({length:101},()=>({entity:map(),expectedRevision:null}))},{type:'save-maps',maps:[item,{...item,entity:{...m,id:m.id.toUpperCase()}}]},{type:'save-maps',maps:[{...item,extra:true}]},{type:'save-maps',maps:[{...item,expectedRevision:0}]},{type:'save-maps',maps:[item],kind:'map'},{type:'save-maps',maps:[{...item,entity:{...m,nodes:[{...space(),width:1}]}}]}])await assert.rejects(run(command),{code:'22023'});
      assert.deepEqual(await read(),before);
    });
    await t.test('map batches check tombstones for every new map and retain successful receipts after deletion',async()=>{
      const m=map(),command={type:'save-maps',maps:[{entity:m,expectedRevision:null}]},requestId=id();await run(command,'admin',requestId);await remove('map',m,1);
      const before=await read();await assert.rejects(run({type:'save-maps',maps:[{entity:map(),expectedRevision:null},{entity:m,expectedRevision:null}]}),{code:'40001'});
      assert.deepEqual(await read(),before);assert.deepEqual(await run(command,'admin',requestId),before);
    });
    let tall:any;
    await t.test('vertical-axis fields roundtrip exactly, plain nodes gain nothing and plan-only saves keep every value',async()=>{
      const room={...space(classroom.id),elevation:-12.5,volumeHeight:260.75},find=(snapshot:any)=>snapshot.maps.find((item:any)=>item.id===m.id);
      const m=map(classroom.id);m.nodes=[room,
        {...camera(room.id),viewIds:[asset.id],angle:90,elevation:120.25,pitch:-90,roll:-33.5,aspect:16/9},
        {...camera(),elevation:100000,pitch:90,roll:180,aspect:10},{...camera(),elevation:-100000,pitch:0.001,roll:-180,aspect:0.1},{...camera(),elevation:1e-7,pitch:-89.999,roll:0,aspect:2.39},
        {...symbol(room.id),elevation:35.125,volumeHeight:1,pitch:-45.5,roll:12.25},{...symbol(),elevation:-100000,volumeHeight:100000,pitch:90,roll:-180},{...symbol(),elevation:99999.999,volumeHeight:80.5,pitch:-90,roll:180},
        {...space(),elevation:100000,volumeHeight:1},{...space(),elevation:-100000,volumeHeight:100000},
        space(),camera(),symbol()];
      const saved=find(await save('map',m));assert.deepEqual(saved,{...m,revision:1});
      // Values that were never set stay unset: the server writes no defaults into plain nodes.
      for(const node of saved.nodes.slice(-3))for(const key of spatialKeys)assert.equal(Object.hasOwn(node,key),false,`${node.type}.${key}`);
      const renamed=find(await save('map',{...saved,name:'이름만 바꾼 도면'},1));assert.deepEqual(renamed,{...m,name:'이름만 바꾼 도면',revision:2});
      const moved={...renamed,nodes:renamed.nodes.map((node:any)=>node.type==='camera'?{...node,x:node.x+25,y:node.y-10,angle:-45}:node)};
      await save('map',moved,2);tall=find(await read('member'));assert.deepEqual(tall,{...moved,revision:3});
      for(const role of ['anon','authenticated']){
        const open=(await db.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'background_library_%' AND has_function_privilege($1::name,p.oid,'EXECUTE') ORDER BY 1",[role])).rows;
        assert.deepEqual(open.map((row:any)=>row.proname),['background_library_execute','background_library_read']);
      }
      await assert.rejects(db.query("SELECT background_library_validate_entity('map','{}'::jsonb)"),{code:'42501'});
    });
    await t.test('a lost reply is recognised only while the stored map equals every submitted vertical-axis value',async()=>{
      const entity={...map(),nodes:[{...space(),elevation:40,volumeHeight:300},{...camera(),elevation:150.5,pitch:-90,roll:7.25,aspect:16/9},{...symbol(),elevation:12.5,volumeHeight:75,pitch:30,roll:-15},camera()]};
      const command:any={type:'save-maps',maps:[{entity,expectedRevision:null}]};
      await run(command);const stored=await read();
      assert.equal(mapSaveWasApplied(stored,command),true);
      for(const [index,node] of entity.nodes.entries())for(const key of spatialKeys)if(key in node){
        const other=structuredClone(command);other.maps[0].entity.nodes[index][key]+=0.25;
        assert.equal(mapSaveWasApplied(stored,other),false,`${node.type}.${key}`);
      }
      // The plain camera was stored without defaults, so a request that spells one out is a different save.
      const spelled=structuredClone(command);spelled.maps[0].entity.nodes[3].pitch=0;assert.equal(mapSaveWasApplied(stored,spelled),false);
      const next:any={type:'save-maps',maps:[{entity:{...entity,nodes:entity.nodes.map((node:any)=>'aspect' in node?{...node,pitch:-89.5}:node)},expectedRevision:1}]};
      await run(next);const after=await read();
      assert.equal(mapSaveWasApplied(after,next),true);assert.equal(mapSaveWasApplied(after,command),false);
    });
    await t.test('invalid vertical-axis values and misplaced or unknown keys are rejected with 22023 and change nothing',async()=>{
      const before=await read();
      const refuse=async(type:NodeType,extra:Record<string,unknown>,message:RegExp)=>{
        const entity={...map(),nodes:[{...plain[type](),...extra}]},label=`${type} ${JSON.stringify(extra)}`;
        await assert.rejects(save('map',entity),{code:'22023',message},label);
        // Also inside a batch next to an otherwise valid edit: nothing of the batch may land.
        await assert.rejects(run({type:'save-maps',maps:[{entity:{...tall,name:'반영되면 안 됨'},expectedRevision:tall.revision},{entity,expectedRevision:null}]}),{code:'22023',message},label);
        assert.deepEqual(await read(),before,label);
      };
      // NaN and ±Infinity have no JSON form and reach SQL as an explicit null.
      for(const [type,key] of slots){const [min,max]=spatialRange[key];
        for(const value of [null,NaN,Infinity,-Infinity,String(min),'',true,false,[],{},min-0.001,max+0.001,min-1,max+1])await refuse(type,{[key]:value},/높이|각도|기울기|비율/);
      }
      for(const [type,key] of misplaced)await refuse(type,{[key]:spatialSample[key]},/도면 배치 항목/);
      for(const type of nodeTypes)for(const extra of [{depth:10},{yaw:0},{z:0},{Elevation:0},{volume_height:80}])await refuse(type,extra,/도면 배치 항목/);
      const worse={...tall,nodes:tall.nodes.map((node:any)=>node.type==='camera'?{...node,pitch:90.5}:node)};
      await assert.rejects(save('map',worse,tall.revision),{code:'22023',message:/위아래 각도/});assert.deepEqual(await read(),before);
    });
    await t.test('maps written by the fixed camera spawn and by 3D gizmo edits are stored exactly as produced',async()=>{
      const room={...space(classroom.id),x:100,y:110,width:470,height:300},lens={...camera(room.id),x:470,y:340},desk={...symbol(room.id),x:150,y:150,width:60,height:40,rotation:0};
      const legacy:any={...map(classroom.id),nodes:[room,lens,desk]},find=(snapshot:any,entity:any)=>snapshot.maps.find((item:any)=>item.id===entity.id);
      const spawned=[id(),id(),id()].reduce((current,cameraId)=>addMapCamera(current,cameraId).map,legacy);
      const command:any={type:'save-maps',maps:[{entity:spawned,expectedRevision:null}]},stored=await run(command);
      let current=find(stored,spawned);assert.deepEqual(current,{...spawned,revision:1});assert.equal(mapSaveWasApplied(stored,command),true);
      assert.deepEqual(current.nodes.slice(3).map((node:any)=>[node.x,node.y,node.elevation,node.pitch,node.roll,node.aspect,node.spaceId]),Array.from({length:3},()=>[500,340,120,0,0,16/9,room.id]));
      for(const node of current.nodes.slice(0,3))for(const key of spatialKeys)assert.equal(Object.hasOwn(node,key),false,`${node.type}.${key}`);
      const upright={x:0,y:0,z:0,w:1},one={x:1,y:1,z:1},far=1e9;
      const edits:[string,any][]=[
        [lens.id,{position:{x:470.0004,y:75.55555,z:333.3333333},quaternion:cameraOrientation({angle:200.12345,pitch:-89.9997,roll:-30}),scale:one}],
        [desk.id,{position:{x:201.23456,y:15,z:300},quaternion:nodeOrientation({rotation:120.5,pitch:-45,roll:170}),scale:{x:2,y:2,z:0.5}}],
        [spawned.nodes[4].id,{position:{x:far,y:-far,z:-far},quaternion:cameraOrientation({angle:359.9998,pitch:90,roll:180}),scale:one}],
        [room.id,{position:{x:345.6789,y:42.4242,z:250},quaternion:nodeOrientation({rotation:33.3333,pitch:0,roll:0}),scale:{x:1.5,y:2,z:0.75}}],
        // A runaway drag: the space and the members it carries all stop at the saved limit.
        [room.id,{position:{x:-250000,y:0,z:250000},quaternion:upright,scale:one}],
        [desk.id,{position:{x:0,y:far,z:0},quaternion:upright,scale:{x:far,y:far,z:far}}],
      ];
      for(const [index,[nodeId,pose]] of edits.entries()){
        const next=applyNodeWorldPose(current,nodeId,pose),request:any={type:'save-maps',maps:[{entity:next,expectedRevision:current.revision}]};
        assert.notEqual(next,current,`edit ${index}`);
        const after=await run(request);assert.deepEqual(find(after,next),{...next,revision:current.revision+1},`edit ${index}`);
        assert.equal(mapSaveWasApplied(after,request),true,`edit ${index}`);current=find(after,next);
      }
      assert.deepEqual(current.nodes.slice(0,3).map((node:any)=>[Math.abs(node.x)<=100000,Math.abs(node.y)<=100000]),Array.from({length:3},()=>[true,true]));
      assert.equal(current.nodes[1].pitch,-90);assert.equal(current.revision,1+edits.length);
    });
    await t.test('role changes apply immediately and realtime never broadcasts entity content',async()=>{
      await db.exec('RESET ROLE');await db.exec("UPDATE users SET role='user' WHERE id='admin'");await db.exec('SET ROLE anon');
      assert.equal((await read('admin')).canManage,false);await assert.rejects(save('place',place()),{code:'42501'});
      await db.exec('RESET ROLE');const messages=(await db.query('SELECT * FROM realtime.messages')).rows;assert.ok(messages.length>0);
      assert.ok(messages.every((m:any)=>JSON.stringify(m.payload)==='{}'&&m.event==='changed'&&m.topic==='background-library'&&m.private===false));
      const flags=(await db.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('background_library_entities','background_library_receipts')")).rows;assert.ok(flags.every((row:any)=>row.relrowsecurity));
    });
  } finally {await db.close();}
});

test('the base migration alone rejects vertical-axis fields, so the 3D migration ships with it and only on top of it',{skip:!runtime},async()=>{
  const db=await boot();
  try {
    // Out of order the 3D file stops at its prerequisite check and leaves nothing behind.
    await assert.rejects(db.exec(sql3d),{code:'55000'});await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT count(*)::int AS total FROM pg_proc WHERE proname LIKE 'background_library_%'")).rows[0].total,0);
    await db.exec(sql);await db.exec('SET ROLE anon');
    const store=async(entity:any)=>(await db.query('SELECT background_library_execute($1,$2,$3) AS value',[tokens.admin,id(),{type:'save',kind:'map',entity,expectedRevision:null}])).rows[0].value.maps.find((item:any)=>item.id===entity.id);
    const plan={...map(),nodes:[space(),camera(),symbol()]};assert.deepEqual(await store(plan),{...plan,revision:1});
    for(const [type,key] of slots)await assert.rejects(store({...map(),nodes:[{...plain[type](),[key]:spatialSample[key]}]}),{code:'22023',message:/도면 배치 항목/},`${type}.${key}`);
    await db.exec('RESET ROLE');await db.exec(sql3d);await db.exec('SET ROLE anon');
    for(const [type,key] of slots){const entity={...map(),nodes:[{...plain[type](),[key]:spatialSample[key]}]};assert.deepEqual(await store(entity),{...entity,revision:1},`${type}.${key}`);}
    // Rows written before the 3D file was applied read back untouched afterwards.
    assert.deepEqual((await db.query('SELECT background_library_read($1) AS value',[tokens.admin])).rows[0].value.maps.find((item:any)=>item.id===plan.id),{...plan,revision:1});
  } finally {await db.close();}
});

test('re-running the base migration over stored 3D maps loses nothing and is repaired by applying the 3D migration again',{skip:!runtime},async()=>{
  const db=await boot();
  try {
    await db.exec(sql);await db.exec(sql3d);await db.exec('SET ROLE anon');
    const read=async()=>(await db.query('SELECT background_library_read($1) AS value',[tokens.admin])).rows[0].value;
    const save=async(kind:string,entity:any,expectedRevision:number|null=null)=>(await db.query('SELECT background_library_execute($1,$2,$3) AS value',[tokens.admin,id(),{type:'save',kind,entity,expectedRevision}])).rows[0].value;
    const apply=async(text:string)=>{await db.exec('RESET ROLE');await db.exec(text);await db.exec('SET ROLE anon');};
    const tall={...map(),nodes:[{...space(),elevation:5,volumeHeight:250},{...camera(),elevation:150,pitch:-90,roll:10,aspect:16/9},{...symbol(),elevation:12.5,volumeHeight:75,pitch:30,roll:-15}]};
    const flat={...map(),nodes:[space(),camera(),symbol()]};
    await save('map',tall);await save('map',flat);await save('place',place());const before=await read();
    // The base file is written to be re-runnable, and a rerun brings back its own validator without the vertical keys.
    await apply(sql);assert.deepEqual(await read(),before);
    // Each write re-checks every stored row, so the stored 3D map blocks even edits that carry no vertical field.
    for(const write of [()=>save('place',place('새 장소')),()=>save('map',map()),()=>save('map',{...flat,name:'이름만 바꾼 평면 도면'},1),()=>save('map',{...tall,name:'이름만 바꾼 입체 도면'},1)])
      await assert.rejects(write(),{code:'22023',message:/도면 배치 항목/});
    assert.deepEqual(await read(),before);
    // Applying the 3D file again is the whole repair: nothing was lost and every write works as before.
    await apply(sql3d);assert.deepEqual(await read(),before);
    const renamed=await save('map',{...tall,name:'이름만 바꾼 입체 도면'},1);
    assert.deepEqual(renamed.maps.find((item:any)=>item.id===tall.id),{...tall,name:'이름만 바꾼 입체 도면',revision:2});
    assert.deepEqual(renamed.maps.find((item:any)=>item.id===flat.id),{...flat,revision:1});
    assert.equal((await save('place',place('새 장소'))).places.length,2);
    for(const role of ['anon','authenticated']){
      const open=(await db.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'background_library_%' AND has_function_privilege($1::name,p.oid,'EXECUTE') ORDER BY 1",[role])).rows;
      assert.deepEqual(open.map((row:any)=>row.proname),['background_library_execute','background_library_read']);
    }
  } finally {await db.close();}
});
