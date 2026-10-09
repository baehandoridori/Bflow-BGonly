import type { BackgroundActor, BackgroundCameraColor, BackgroundCommand, BackgroundEntities, BackgroundGroup, BackgroundKind, BackgroundRequest, BackgroundSnapshot, BackgroundSpaceSurface, BackgroundSymbolKind, BackgroundUsage, BackgroundVariant, BackgroundView } from './types.ts';

export const backgroundCollections = { place:'places', map:'maps', view:'views', group:'groups', usage:'usages' } as const;
/** Vertical-axis bounds of map nodes. Single source for mapSpatial; mirrored by the 3D migration SQL. */
export const BACKGROUND_SPATIAL_LIMITS = { elevation:{min:-100000,max:100000}, volumeHeight:{min:1,max:100000}, pitch:{min:-90,max:90}, roll:{min:-180,max:180}, aspect:{min:0.1,max:10} } as const;
/** Closed lists of the stored map shape. Mirrored by DEVLOG/migrations/2026-10-09-background-map-elements.sql. */
export const BACKGROUND_SYMBOL_KINDS: readonly BackgroundSymbolKind[] = ['door', 'desk', 'chair', 'table', 'sofa', 'bed', 'cabinet', 'plant', 'custom', 'stairs'];
export const BACKGROUND_SPACE_SURFACES: readonly BackgroundSpaceSurface[] = ['road'];
export const BACKGROUND_CAMERA_COLORS: readonly BackgroundCameraColor[] = ['red', 'lime', 'green', 'teal', 'blue', 'pink'];
const kinds = Object.keys(backgroundCollections) as BackgroundKind[];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
/**
 * Thrown where stored data holds a key, or a value of a closed list, that this version does not know: most likely
 * written by a newer app. It is still an Error with the same message: nothing is accepted that was refused before.
 */
export class BackgroundUnsupportedError extends Error {
  /** What was not known (the keys, or the value). For the console only: no part of the message and never shown to the user. */
  readonly detail: string;
  constructor(message: string, detail: string) { super(message); this.name = 'BackgroundUnsupportedError'; this.detail = detail; }
}
/** A value of a closed list. A string outside the list is unknown (BackgroundUnsupportedError); anything else is invalid. */
function known(value: unknown, allowed: readonly string[], message: string): void {
  if (typeof value === 'string' && allowed.includes(value)) return;
  throw typeof value === 'string' ? new BackgroundUnsupportedError(message, `value ${JSON.stringify(value.slice(0, 80))}`) : new Error(message);
}
function object(value: unknown): asserts value is Record<string, unknown> { requireValue(value && typeof value === 'object' && !Array.isArray(value), '올바른 배경 데이터가 필요합니다.'); }
function text(value: unknown, max: number, label: string, required = false): asserts value is string { requireValue(typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0), `${label} 형식 또는 길이를 확인해 주세요.`); }
function id(value: unknown, nullable = false): void { requireValue(nullable && value === null || typeof value === 'string' && uuid.test(value), '배경 식별자가 올바르지 않습니다.'); }
function array(value: unknown, max: number): asserts value is unknown[] { requireValue(Array.isArray(value) && value.length <= max, '배경 목록의 크기 또는 형식이 올바르지 않습니다.'); }
function ids(value: unknown, max = 1000): asserts value is string[] { array(value,max); value.forEach(x=>id(x)); requireValue(new Set(value).size===value.length,'같은 항목을 중복 등록할 수 없습니다.'); }
function number(value: unknown, min: number, max: number, label: string): void { requireValue(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${label} 범위를 확인해 주세요.`); }
// Optional vertical-axis value. Omission keeps the default derived when reading; a present key must be a real number.
function spatial(node: Record<string, unknown>, key: keyof typeof BACKGROUND_SPATIAL_LIMITS, label: string): void { if(key in node)number(node[key],BACKGROUND_SPATIAL_LIMITS[key].min,BACKGROUND_SPATIAL_LIMITS[key].max,label); }
function image(value: unknown): void { text(value,2_000_000,'이미지 주소'); requireValue(value === '' || /^https:\/\/[^\s]+$/i.test(value) || /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value),'이미지는 HTTPS 주소 또는 PNG/JPEG/WebP 파일이어야 합니다.'); }
function onlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw new BackgroundUnsupportedError('지원하지 않는 배경 속성이 포함되어 있습니다.', `keys ${unknown.slice(0, 8).map(key => JSON.stringify(key.slice(0, 80))).join(', ')}`);
}
function commandSize(value: Record<string,unknown>): void {
  // PostgreSQL jsonb::text separates keys/items with spaces; count those without copying large images.
  const serialized=JSON.stringify(value);let quoted=false,escaped=false,spaces=0;
  for(const char of serialized){if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;}else if(char==='"')quoted=true;else if(char===','||char===':')spaces++;}
  requireValue(new TextEncoder().encode(serialized).byteLength+spaces<=28_000_000,'배경 요청이 너무 큽니다. 도면을 나누어 저장해 주세요.');
}
export function emptyBackgroundSnapshot(canManage = false): BackgroundSnapshot { return {places:[],maps:[],views:[],groups:[],usages:[],canManage}; }

export function validateBackgroundEntity(kind: BackgroundKind, value: unknown): void {
  object(value); id(value.id); requireValue(Number.isSafeInteger(value.revision) && Number(value.revision) >= 0,'배경 버전이 올바르지 않습니다.');
  if (kind !== 'usage') text(value.name,160,'이름',true);
  const shared=['id','revision'];
  if(kind==='place') {
    onlyKeys(value,[...shared,'name','parentId','folderPath']); id(value.parentId,true);text(value.folderPath,4096,'폴더 경로');
  } else if(kind==='map') {
    onlyKeys(value,[...shared,'name','parentId','placeId','imageUrl','nodes']);id(value.parentId,true);id(value.placeId,true);image(value.imageUrl);array(value.nodes,1000);
    const nodeIds=new Set<string>();
    for(const n of value.nodes) {
      object(n);known(n.type,['space','camera','symbol'],'지원하지 않는 도면 오브젝트입니다.');id(n.id);requireValue(!nodeIds.has(n.id as string),'도면 오브젝트 식별자가 중복되었습니다.');nodeIds.add(n.id as string);text(n.name,160,'오브젝트 이름',true);
      number(n.x,-100000,100000,'가로 좌표');number(n.y,-100000,100000,'세로 좌표');requireValue(typeof n.locked==='boolean','잠금 상태를 확인해 주세요.');
      const base=['id','type','name','x','y','locked'];
      if(n.type==='space') {
        onlyKeys(n,[...base,'placeId','childMapId','width','height','rotation','shape','points','elevation','volumeHeight','surface']);id(n.placeId,true);id(n.childMapId,true);
        number(n.width,10,100000,'공간 가로 길이');number(n.height,10,100000,'공간 세로 길이');number(n.rotation,-360,360,'회전');
        spatial(n,'elevation','바닥 높이');spatial(n,'volumeHeight','입체 높이');
        if('surface' in n)known(n.surface,BACKGROUND_SPACE_SURFACES,'공간 종류가 올바르지 않습니다.');
        known(n.shape,['rect','ellipse','polygon'],'공간 모양이 올바르지 않습니다.');array(n.points,200);
        if(n.shape==='polygon') requireValue(n.points.length>=3,'다각형에는 꼭짓점이 3개 이상 필요합니다.');
        for(const p of n.points){object(p);onlyKeys(p,['x','y']);number(p.x,0,1,'꼭짓점 좌표');number(p.y,0,1,'꼭짓점 좌표');}
      } else if(n.type==='camera') {
        onlyKeys(n,[...base,'spaceId','angle','fov','viewIds','elevation','pitch','roll','aspect','color']);id(n.spaceId,true);number(n.angle,-360,360,'카메라 방향');number(n.fov,1,179,'카메라 시야');ids(n.viewIds);
        spatial(n,'elevation','카메라 높이');spatial(n,'pitch','위아래 각도');spatial(n,'roll','기울기');spatial(n,'aspect','화면 비율');
        if('color' in n)known(n.color,BACKGROUND_CAMERA_COLORS,'카메라 색이 올바르지 않습니다.');
      } else {
        onlyKeys(n,[...base,'symbol','spaceId','width','height','rotation','hinge','swing','elevation','volumeHeight','pitch','roll']);id(n.spaceId,true);
        known(n.symbol,BACKGROUND_SYMBOL_KINDS,'사물 기호가 올바르지 않습니다.');
        number(n.width,10,100000,'기호 가로 길이');number(n.height,10,100000,'기호 세로 길이');number(n.rotation,-360,360,'회전');
        known(n.hinge,['left','right'],'문의 경첩 방향이 올바르지 않습니다.');known(n.swing,['inward','outward'],'문 열림 방향이 올바르지 않습니다.');
        spatial(n,'elevation','바닥 높이');spatial(n,'volumeHeight','입체 높이');spatial(n,'pitch','위아래 각도');spatial(n,'roll','기울기');
      }
    }
  } else if(kind==='view') {
    onlyKeys(value,[...shared,'name','placeId','cameraPlaceId','visiblePlaceIds','relatedPlaceIds','shot','tags','memo','variants']);id(value.placeId);id(value.cameraPlaceId,true);ids(value.visiblePlaceIds);ids(value.relatedPlaceIds);
    known(value.shot,['wide','medium','closeup','detail'],'구도 분류를 확인해 주세요.');array(value.tags,100);value.tags.forEach(t=>text(t,80,'태그',true));text(value.memo,10000,'메모');array(value.variants,100);requireValue(value.variants.length>0,'이미지 변형을 하나 이상 등록해 주세요.');
    const variantIds=new Set();
    for(const v of value.variants) {
      object(v);onlyKeys(v,['id','name','time','revisions','activeRevisionId','workFilePath']);id(v.id);requireValue(!variantIds.has(v.id),'변형 식별자가 중복되었습니다.');variantIds.add(v.id);text(v.name,160,'변형 이름',true);known(v.time,['day','night','other'],'시간대 분류를 확인해 주세요.');id(v.activeRevisionId);array(v.revisions,100);requireValue(v.revisions.length>0,'수정본이 하나 이상 필요합니다.');
      if('workFilePath' in v)text(v.workFilePath,4096,'작업파일 경로');
      const revisionIds=new Set();
      for(const r of v.revisions){object(r);onlyKeys(r,['id','imageUrl','filePath','createdAt','sourceImagePath']);id(r.id);requireValue(!revisionIds.has(r.id),'수정본 식별자가 중복되었습니다.');revisionIds.add(r.id);image(r.imageUrl);text(r.filePath,4096,'원본 파일 경로');if('sourceImagePath' in r)text(r.sourceImagePath,4096,'이미지파일 경로');text(r.createdAt,64,'등록 시간',true);requireValue(Number.isFinite(Date.parse(r.createdAt)),'등록 시간이 올바르지 않습니다.');}
      requireValue(revisionIds.has(v.activeRevisionId),'현재 수정본이 이미지 이력에 없습니다.');
    }
  } else if(kind==='group') {
    onlyKeys(value,[...shared,'name','placeId','variantIds']);id(value.placeId);ids(value.variantIds,10000);
  } else {
    onlyKeys(value,[...shared,'episodeNumber','placeId','variantIds','memo']);id(value.placeId);ids(value.variantIds,10000);text(value.memo,10000,'메모');requireValue(Number.isSafeInteger(value.episodeNumber)&&Number(value.episodeNumber)>0,'에피소드 번호가 올바르지 않습니다.');
  }
}

export function validateBackgroundRequest(value: unknown): asserts value is BackgroundRequest {
  object(value);onlyKeys(value,['requestId','command']);id(value.requestId);object(value.command);const c=value.command;commandSize(c);
  if(c.type==='save-maps') {
    onlyKeys(c,['type','maps']);array(c.maps,100);requireValue(c.maps.length>0,'저장할 도면을 하나 이상 선택해 주세요.');
    const seen=new Set<string>();
    for(const item of c.maps){object(item);onlyKeys(item,['entity','expectedRevision']);validateBackgroundEntity('map',item.entity);
      requireValue(item.expectedRevision===null||Number.isSafeInteger(item.expectedRevision)&&Number(item.expectedRevision)>=1&&Number(item.expectedRevision)<Number.MAX_SAFE_INTEGER,'요청 버전이 올바르지 않습니다.');
      const mapId=(item.entity as BackgroundEntities['map']).id.toLowerCase();requireValue(!seen.has(mapId),'같은 도면을 중복 저장할 수 없습니다.');seen.add(mapId);
    }
    return;
  }
  requireValue(kinds.includes(c.kind as BackgroundKind),'배경 분류가 올바르지 않습니다.');
  requireValue(c.type==='save'||c.type==='delete','알 수 없는 배경 요청입니다.');
  onlyKeys(c,c.type==='save'?['type','kind','entity','expectedRevision']:['type','kind','id','expectedRevision']);
  requireValue(c.type==='save'&&c.expectedRevision===null || Number.isSafeInteger(c.expectedRevision)&&Number(c.expectedRevision)>=0,'요청 버전이 올바르지 않습니다.');
  if(c.type==='save')validateBackgroundEntity(c.kind as BackgroundKind,c.entity);else id(c.id);
}

export function validateBackgroundSnapshot(snapshot: BackgroundSnapshot): void {
  object(snapshot);requireValue(typeof snapshot.canManage==='boolean','배경 권한 정보가 올바르지 않습니다.');
  for(const kind of kinds) {
    const rows=snapshot[backgroundCollections[kind]];array(rows,kind==='view'?20000:10000);const seen=new Set<string>();
    for(const row of rows){validateBackgroundEntity(kind,row);requireValue(!seen.has(row.id),'배경 식별자가 중복되었습니다.');seen.add(row.id);}
  }
  const places=new Set(snapshot.places.map(p=>p.id)),maps=new Map(snapshot.maps.map(m=>[m.id,m])),views=new Set(snapshot.views.map(v=>v.id)),variants=new Map<string,string>();
  const hasPlace=(value:string|null)=>requireValue(value===null||places.has(value),'참조한 장소가 없습니다. 사용 중인 장소는 먼저 연결을 해제해 주세요.');
  for(const rows of [snapshot.places,snapshot.maps]) {
    const parents=new Map<string,string|null>(rows.map(r=>[r.id,r.parentId] as const));
    for(const row of rows){let cursor:string|null=row.id;const seen=new Set();while(cursor){requireValue(!seen.has(cursor),'상위 항목을 순환 연결할 수 없습니다.');seen.add(cursor);requireValue(parents.has(cursor),'참조한 상위 항목이 없습니다. 하위 항목의 연결을 먼저 해제해 주세요.');cursor=parents.get(cursor)??null;}}
  }
  for(const view of snapshot.views){hasPlace(view.placeId);hasPlace(view.cameraPlaceId);view.visiblePlaceIds.forEach(hasPlace);view.relatedPlaceIds.forEach(hasPlace);for(const v of view.variants){requireValue(!variants.has(v.id),'서로 다른 배경에 같은 변형 식별자를 사용할 수 없습니다.');variants.set(v.id,view.placeId);}}
  for(const map of snapshot.maps){hasPlace(map.placeId);const spaces=new Set(map.nodes.filter(n=>n.type==='space').map(n=>n.id));
    for(const n of map.nodes){if(n.type==='space'){hasPlace(n.placeId);requireValue(!n.childMapId||maps.get(n.childMapId)?.parentId===map.id,'상세 도면은 현재 도면의 하위 도면이어야 합니다. 사용 중인 연결을 먼저 해제해 주세요.');}
      else{requireValue(!n.spaceId||spaces.has(n.spaceId),'카메라 또는 기호가 참조한 공간이 도면에 없습니다.');if(n.type==='camera')requireValue(n.viewIds.every(v=>views.has(v)),'카메라가 참조한 배경이 없습니다. 사용 중인 연결을 먼저 해제해 주세요.');}}
  }
  const used=new Set();
  for(const item of [...snapshot.groups,...snapshot.usages]){hasPlace(item.placeId);requireValue(item.variantIds.every(v=>variants.get(v)===item.placeId),'이 장소에 속하지 않거나 사용 중인 이미지 변형이 변경되었습니다. 연결을 확인해 주세요.');if('episodeNumber'in item){const key=`${item.episodeNumber}:${item.placeId}`;requireValue(!used.has(key),'이 에피소드에 장소가 이미 연결되어 있습니다.');used.add(key);}}
}

export function applyBackgroundCommand(snapshot: BackgroundSnapshot, command: BackgroundCommand, actor: BackgroundActor): BackgroundSnapshot {
  // Reuse the same structural validation in preview, optimistic state and main.
  validateBackgroundRequest({requestId:'00000000-0000-4000-8000-000000000000',command});
  if(command.type==='save-maps') {
    requireValue(actor.canManage,'배경 관리자가 편집할 수 있습니다.');
    // Check every original revision before applying anything; links are checked against the final graph.
    for(const {entity,expectedRevision} of command.maps){const current=snapshot.maps.find(map=>map.id===entity.id);requireValue(expectedRevision===null?!current:!!current&&current.revision===expectedRevision,'다른 사용자가 내용을 변경했습니다. 새로고침 후 다시 저장해 주세요.');}
    const result=structuredClone(snapshot);
    for(const {entity,expectedRevision} of command.maps){const index=result.maps.findIndex(map=>map.id===entity.id),saved={...structuredClone(entity),revision:(expectedRevision??0)+1};if(index<0)result.maps.push(saved);else result.maps[index]=saved;}
    validateBackgroundSnapshot(result);return result;
  }
  requireValue(actor.canManage||command.kind==='usage','배경 관리자가 편집할 수 있습니다.');
  const key=backgroundCollections[command.kind];const rows=snapshot[key] as BackgroundEntities[BackgroundKind][];
  const targetId=command.type==='save'?command.entity.id:command.id,current=rows.find(r=>r.id===targetId);
  requireValue(command.expectedRevision===null?!current:!!current&&current.revision===command.expectedRevision,'다른 사용자가 내용을 변경했습니다. 새로고침 후 다시 저장해 주세요.');
  if(command.type==='save'&&command.kind==='usage'&&actor.episodeNumbers)requireValue(actor.episodeNumbers.includes(command.entity.episodeNumber),'연결할 에피소드가 없습니다.');
  const result=structuredClone(snapshot);const next=result[key] as BackgroundEntities[BackgroundKind][];const index=next.findIndex(r=>r.id===targetId);
  if(command.type==='delete')next.splice(index,1);
  else{const saved={...structuredClone(command.entity),revision:(command.expectedRevision??0)+1};if(index<0)next.push(saved);else next[index]=saved;}
  validateBackgroundSnapshot(result);return result;
}

export function findBackgroundVariant(snapshot: BackgroundSnapshot, variantId: string): {view:BackgroundView;variant:BackgroundVariant}|undefined {
  for(const view of snapshot.views){const variant=view.variants.find(v=>v.id===variantId);if(variant)return {view,variant};}return undefined;
}
export interface BackgroundFilter { search?:string;placeId?:string;relation?:'home'|'camera'|'visible'|'related';shot?:BackgroundView['shot']|'all';time?:'day'|'night'|'other'|'all' }
export function filterBackgroundViews(snapshot:BackgroundSnapshot,filter:BackgroundFilter):BackgroundView[]{
  const search=filter.search?.trim().toLocaleLowerCase();
  return snapshot.views.filter(view=>{
    if(search&&!`${view.name} ${view.memo} ${view.tags.join(' ')} ${snapshot.places.find(p=>p.id===view.placeId)?.name??''}`.toLocaleLowerCase().includes(search))return false;
    if(filter.shot&&filter.shot!=='all'&&filter.shot!==view.shot)return false;
    if(filter.time&&filter.time!=='all'&&!view.variants.some(v=>v.time===filter.time))return false;
    if(!filter.placeId)return true;
    if(filter.relation==='camera')return view.cameraPlaceId===filter.placeId;
    if(filter.relation==='visible')return view.visiblePlaceIds.includes(filter.placeId);
    if(filter.relation==='related')return view.placeId===filter.placeId||view.cameraPlaceId===filter.placeId||view.visiblePlaceIds.includes(filter.placeId)||view.relatedPlaceIds.includes(filter.placeId);
    return view.placeId===filter.placeId;
  });
}
export function backgroundMapPath(snapshot:BackgroundSnapshot,mapId:string){const result:BackgroundSnapshot['maps']=[],seen=new Set<string>();let current=snapshot.maps.find(m=>m.id===mapId);while(current&&!seen.has(current.id)){result.unshift(current);seen.add(current.id);current=snapshot.maps.find(m=>m.id===current!.parentId);}return result;}
export function mergeBackgroundGroup(usage:BackgroundUsage,group:BackgroundGroup):BackgroundUsage{requireValue(usage.placeId===group.placeId,'같은 장소의 시점 묶음을 선택해 주세요.');return {...usage,variantIds:[...new Set([...usage.variantIds,...group.variantIds])]};}
