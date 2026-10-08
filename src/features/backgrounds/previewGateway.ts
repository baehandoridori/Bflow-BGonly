import type { BackgroundActor, BackgroundGateway, BackgroundRequest, BackgroundSnapshot, BackgroundView } from './types.ts';
import { applyBackgroundCommand, emptyBackgroundSnapshot, validateBackgroundRequest, validateBackgroundSnapshot } from './domain.ts';

export interface BackgroundPreviewOptions {
  storage?: Pick<Storage,'getItem'|'setItem'>;
  locks?: { request<T>(key:string,run:()=>Promise<T>):Promise<T> };
  assertCurrent?:()=>void; seed?:boolean;
}
interface Authority {snapshot:BackgroundSnapshot;receipts:Record<string,{actorId:string;command:string}>;retired:string[]}
const KEY='bflow-background-library-preview-v1',CHANNEL='bflow-background-library-changed';
const listeners=new Set<()=>void>();
const canonicalJson=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
function notify(){for(const listener of listeners)try{listener();}catch{}if(typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel(CHANNEL);channel.postMessage({changed:true});channel.close();}}
export function subscribeBackgroundPreview(listener:()=>void):()=>void {
  listeners.add(listener);const channel=typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'?new BroadcastChannel(CHANNEL):null;
  if(channel)channel.onmessage=()=>listener();const storage=(event:StorageEvent)=>{if(event.key===KEY)listener();};
  if(typeof window!=='undefined')window.addEventListener('storage',storage);
  return()=>{listeners.delete(listener);channel?.close();if(typeof window!=='undefined')window.removeEventListener('storage',storage);};
}
function seed():BackgroundSnapshot {
  const snapshot=emptyBackgroundSnapshot(true),newId=()=>crypto.randomUUID();
  const school={id:newId(),revision:1,name:'학교',parentId:null,folderPath:''};
  const classroom={id:newId(),revision:1,name:'2-1 교실',parentId:school.id,folderPath:''},hall={id:newId(),revision:1,name:'2층 복도',parentId:school.id,folderPath:''};snapshot.places=[school,classroom,hall];
  const view=(name:string,placeId:string,cameraPlaceId:string|null,visiblePlaceIds:string[],shot:BackgroundView['shot']):BackgroundView=>({id:newId(),revision:1,name,placeId,cameraPlaceId,visiblePlaceIds,relatedPlaceIds:[],shot,tags:['체험 자료'],memo:'테스트 모드용 자료입니다. 실제 이미지를 등록해 볼 수 있습니다.',variants:['낮','밤'].map((name,i)=>{const id=newId();return{id:newId(),name,time:i?'night':'day',activeRevisionId:id,revisions:[{id,imageUrl:'',filePath:'',createdAt:'2026-09-21T00:00:00.000Z'}]};})});
  snapshot.views=[view('열린 문 너머 복도',classroom.id,classroom.id,[hall.id],'wide'),view('복도에서 바라본 교실',hall.id,hall.id,[classroom.id],'wide'),view('교실 문손잡이 클로즈업',classroom.id,null,[],'closeup')];
  const campus=newId(),building=newId(),floor=newId(),detail=newId(),spaceId=newId();
  const space=(name:string,x:number,y:number,width:number,height:number,placeId:string|null,childMapId:string|null)=>({id:newId(),type:'space' as const,name,x,y,width,height,placeId,childMapId,rotation:0,shape:'rect' as const,points:[],locked:false});
  snapshot.maps=[{id:campus,revision:1,name:'학교',parentId:null,placeId:school.id,imageUrl:'',nodes:[space('본관',170,120,660,410,school.id,building)]},{id:building,revision:1,name:'본관',parentId:campus,placeId:school.id,imageUrl:'',nodes:[space('2층',140,170,720,330,school.id,floor)]},{id:floor,revision:1,name:'2층',parentId:building,placeId:school.id,imageUrl:'',nodes:[{...space('2-1 교실',100,110,470,300,classroom.id,detail),id:spaceId},space('2층 복도',100,450,780,120,hall.id,null),{id:newId(),type:'camera',name:'교실 → 복도',spaceId,x:470,y:340,angle:90,fov:55,viewIds:[snapshot.views[0].id],locked:false}]},{id:detail,revision:1,name:'2-1 교실',parentId:floor,placeId:classroom.id,imageUrl:'',nodes:[space('교실 내부',140,110,720,430,classroom.id,null)]}];
  snapshot.groups=[{id:newId(),revision:1,name:'교실 기본 시점',placeId:classroom.id,variantIds:[snapshot.views[0].variants[0].id]},{id:newId(),revision:1,name:'주요 클로즈업',placeId:classroom.id,variantIds:[snapshot.views[2].variants[0].id]}];
  return snapshot;
}
export function createBackgroundPreviewGateway(actor:BackgroundActor&{id:string},options:BackgroundPreviewOptions={}):BackgroundGateway {
  const storage=()=>options.storage??localStorage;
  const readAuthority=():Authority=>{
    const raw=storage().getItem(KEY);if(!raw)return{snapshot:options.seed===false?emptyBackgroundSnapshot():seed(),receipts:{},retired:[]};
    const value=JSON.parse(raw) as Authority;validateBackgroundSnapshot(value.snapshot);
    if(!value.receipts||typeof value.receipts!=='object'||!Array.isArray(value.retired))throw new Error('배경 테스트 저장소를 읽을 수 없습니다.');return value;
  };
  const assertCurrent=()=>{if(!actor.id)throw new Error('로그인 세션이 필요합니다.');options.assertCurrent?.();};
  const locked=<T>(run:()=>Promise<T>):Promise<T>=>{
    const locks=options.locks??(typeof navigator==='undefined'?undefined:navigator.locks);
    if(!locks)return Promise.reject(new Error('안전한 동시 저장을 지원하는 브라우저에서 열어 주세요.'));
    return locks.request(KEY,run);
  };
  const visible=(value:Authority):BackgroundSnapshot=>({...structuredClone(value.snapshot),canManage:actor.canManage});
  return {
    read:()=>locked(async()=>{assertCurrent();const value=readAuthority();if(storage().getItem(KEY)===null){assertCurrent();storage().setItem(KEY,JSON.stringify(value));}return visible(value);}),
    execute:async(request:BackgroundRequest)=>{
      const result=await locked(async()=>{
        assertCurrent();validateBackgroundRequest(request);const value=readAuthority(),serialized=canonicalJson(request.command),receipt=value.receipts[request.requestId];
        if(receipt){if(receipt.actorId!==actor.id||receipt.command!==serialized)throw new Error('이미 처리한 요청에 다른 내용이 포함되어 있습니다.');return visible(value);}
        const command=request.command;
        const creations=command.type==='save-maps'?command.maps.filter(item=>item.expectedRevision===null).map(item=>`map:${item.entity.id}`):command.type==='save'&&command.expectedRevision===null?[`${command.kind}:${command.entity.id}`]:[];
        const retired=new Set(value.retired.map(key=>key.toLowerCase()));
        if(creations.some(key=>retired.has(key.toLowerCase())))throw new Error('삭제한 항목의 식별자는 다시 사용할 수 없습니다.');
        value.snapshot=applyBackgroundCommand(value.snapshot,command,actor);
        if(command.type==='delete')value.retired.push(`${command.kind}:${command.id}`);
        value.receipts[request.requestId]={actorId:actor.id,command:serialized};
        assertCurrent();storage().setItem(KEY,JSON.stringify(value));return visible(value);
      });notify();return result;
    },subscribe:subscribeBackgroundPreview,
  };
}
