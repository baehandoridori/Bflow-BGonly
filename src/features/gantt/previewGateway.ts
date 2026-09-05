import type { GanttGateway, GanttProject, GanttRequest, GanttSnapshot, GanttTask } from './types.ts';
import { applyCommand, canEditProject, createProject, createSpace, createTask, rememberGanttRevisions, resolveTaskColor, shiftDate, todayDate, updateTask, visibleSnapshot } from './domain.ts';
import type { GanttRevisionLedger } from './domain.ts';

export interface PreviewCalendar { id:string; owner_id:string; visibility:string; members?:Array<{user_id:string;can_edit:boolean}> }
export interface PreviewOptions {
  storage?: { getItem(key:string):string|null; setItem(key:string,value:string):void };
  locks?: { request<T>(name:string,callback:()=>Promise<T>):Promise<T> };
  calendars?:()=>PreviewCalendar[];
  canViewCalendar?:(calendarId:string,actorId:string)=>boolean;
  canEditCalendar?:(calendarId:string,actorId:string)=>boolean;
  assertCurrent?:()=>void;
  seed?:boolean;
}
export interface GanttCalendarEventRow {
  id:string; calendar_id:string; title:string; memo:string|null; tag_id:null; all_day:boolean;
  start_date:string; end_date:string; start_time:string|null; end_time:string|null;
  linked_episode:null; linked_part:null; linked_sheet_name:null; linked_scene_id:null; linked_department:null; linked_todo_id:null;
  created_by:string|null; created_at:string; updated_at:string;
  linked_gantt_project_id:string; linked_gantt_task_id:string; linked_gantt_task_kind:GanttTask['kind']; gantt_can_edit:boolean;
  gantt_color:string;
}
interface Authority { snapshot:GanttSnapshot; receipts:Record<string,{actorId:string;command:string}>; seededUsers:string[]; revisions:GanttRevisionLedger; retiredIds:string[] }
const KEY='bflow-gantt-preview-authority-v1',LOCK='bflow:gantt:preview:authority',CHANNEL='bflow:gantt:changed';
const localListeners=new Set<()=>void>();
function browserStorage():Storage { if(typeof localStorage==='undefined')throw new Error('간트 저장소를 사용할 수 없습니다.');return localStorage; }
function readAuthority(options:PreviewOptions):Authority {
  const raw=(options.storage??browserStorage()).getItem(KEY);
  if(!raw)return {snapshot:{spaces:[],projects:[]},receipts:{},seededUsers:[],revisions:{},retiredIds:[]};
  const value=JSON.parse(raw) as Authority;
  if(!Array.isArray(value.snapshot?.spaces)||!Array.isArray(value.snapshot?.projects)||!value.receipts||!Array.isArray(value.seededUsers))throw new Error('간트 저장 데이터가 올바르지 않습니다.');
  if(!value.revisions){
    value.revisions={};rememberGanttRevisions(value.revisions,value.snapshot);
    for(const receipt of Object.values(value.receipts)){
      const command=JSON.parse(receipt.command) as GanttRequest['command'];
      if(command.type==='saveProjectPair'){
        for(const item of command.projects){const key=`project:${item.project.id}`,committed=item.expectedRevision+1;if(Number.isSafeInteger(committed)&&committed>0)value.revisions[key]=Math.max(value.revisions[key]??0,committed);}
        continue;
      }
      const kind=command.type==='saveProject'||command.type==='deleteProject'?'project':'space';
      const id=command.type==='saveProject'?command.project.id:command.type==='saveSpace'?command.space.id:command.type==='deleteProject'?command.projectId:command.spaceId;
      const committed=command.type==='saveProject'||command.type==='saveSpace'?(command.expectedRevision??0)+1:command.expectedRevision;
      if(Number.isSafeInteger(committed)&&committed>0)value.revisions[`${kind}:${id}`]=Math.max(value.revisions[`${kind}:${id}`]??0,committed);
    }
    const liveIds=new Set([...value.snapshot.spaces.map(entity=>`space:${entity.id}`),...value.snapshot.projects.map(entity=>`project:${entity.id}`)]);
    value.retiredIds=Object.keys(value.revisions).filter(key=>!liveIds.has(key));
    // Invalidate pre-upgrade snapshots once, including revisions reused before the ledger existed.
    for(const [kind,entities] of [['space',value.snapshot.spaces],['project',value.snapshot.projects]] as const)
      for(const entity of entities)entity.revision=value.revisions[`${kind}:${entity.id}`]+1;
  }
  value.retiredIds??=[];
  rememberGanttRevisions(value.revisions,value.snapshot);
  return value;
}
function writeAuthority(options:PreviewOptions,value:Authority):void { rememberGanttRevisions(value.revisions,value.snapshot);(options.storage??browserStorage()).setItem(KEY,JSON.stringify(value)); }
async function withLock<T>(options:PreviewOptions,run:()=>Promise<T>):Promise<T> {
  if(options.locks)return options.locks.request(LOCK,run);
  if(typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request(LOCK,run);
  return Promise.reject(new Error('이 환경은 안전한 간트 동시 저장을 지원하지 않습니다. 최신 브라우저에서 열어 주세요.'));
}
function notify():void {
  for(const listener of localListeners){try{listener();}catch{/* A view failure cannot undo a committed write. */}}
  if(typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'){
    try{const channel=new BroadcastChannel(CHANNEL);try{channel.postMessage({changed:true});}finally{channel.close();}}catch{/* The next read still uses committed storage. */}
  }
}
function seedInto(value:Authority,actorId:string):void {
  if(value.seededUsers.includes(actorId))return;
  value.seededUsers.push(actorId);
  // Samples belong only to the currently signed-in actor. No synthetic user IDs.
  const personal=createSpace('개인',actorId),training=createSpace('신입 교육',actorId),team=createSpace('팀 제작',actorId);
  const lesson=createProject('신입 교육 커리큘럼',training.id,actorId),production=createProject('이번 주 제작 계획',team.id,actorId),own=createProject('나의 작업',personal.id,actorId);
  lesson.color='#8B78D4';production.color='#5696B8';own.color='#6F9D82';
  const date=todayDate(),group=createTask('기초 과정',date);group.kind='group';
  const a=createTask('오리엔테이션',date);a.parentId=group.id;a.workers=[actorId];a.memo='폴더 구성과 제작 흐름을 함께 살펴봅니다.';
  const b=createTask('레퍼런스 분석',shiftDate(date,1));b.parentId=group.id;b.endDate=shiftDate(date,3);b.mode='auto';b.predecessorId=a.id;b.workers=[actorId];
  const c=createTask('배경 실습',shiftDate(date,4));c.parentId=group.id;c.endDate=shiftDate(date,8);c.predecessorId=b.id;c.mode='auto';
  const m=createTask('교육 과정 완료',shiftDate(date,9));m.kind='milestone';m.predecessorId=c.id;m.mode='auto';lesson.tasks=[group,a,b,c,m];
  production.tasks=[createTask('레이아웃 확인',date),createTask('키 배경 제작',shiftDate(date,3))];production.tasks[0].endDate=shiftDate(date,2);production.tasks[1].endDate=shiftDate(date,7);
  own.tasks=[createTask('교육 자료 정리',date)];own.tasks[0].endDate=shiftDate(date,2);
  for(const project of [lesson,production,own])project.tasks.forEach((task,index)=>task.sortOrder=index);
  value.snapshot.spaces.push(personal,training,team);value.snapshot.projects.push(lesson,production,own);
}
function calendarAllowed(options:PreviewOptions,calendarId:string,actorId:string,edit:boolean):boolean {
  const callback=edit?options.canEditCalendar:options.canViewCalendar;
  if(callback){try{return callback(calendarId,actorId);}catch{return false;}}
  const calendar=options.calendars?.().find(c=>c.id===calendarId);if(!calendar)return false;
  if(calendar.owner_id===actorId)return true;
  const member=calendar.members?.find(m=>m.user_id===actorId);
  return edit?Boolean(member?.can_edit):calendar.visibility==='team'||(calendar.visibility==='members'&&Boolean(member));
}
function checkLinkedChanges(before:GanttSnapshot,after:GanttSnapshot,actorId:string,options:PreviewOptions):void {
  const fields=(t:GanttTask)=>JSON.stringify([t.calendarId,t.kind,t.title,t.memo,t.startDate,t.endDate,t.startTime,t.endTime,t.allDay]);
  for(const project of [...before.projects,...after.projects.filter(p=>!before.projects.some(x=>x.id===p.id))]) {
    const old=before.projects.find(p=>p.id===project.id),next=after.projects.find(p=>p.id===project.id);
    const ids=new Set([...(old?.tasks??[]).map(t=>t.id),...(next?.tasks??[]).map(t=>t.id)]);
    for(const id of ids){const a=old?.tasks.find(t=>t.id===id),b=next?.tasks.find(t=>t.id===id);if(a&&b&&fields(a)===fields(b))continue;
      for(const calendarId of new Set([a?.calendarId,b?.calendarId].filter((x):x is string=>Boolean(x))))if(!calendarAllowed(options,calendarId,actorId,true))throw new Error('연결된 캘린더의 편집 권한이 필요합니다.');
    }
  }
}
export function createPreviewGateway(actorId:string,options:PreviewOptions={}):GanttGateway {
  if(!actorId)throw new Error('로그인이 필요합니다.');
  return {
    async read(){
      options.assertCurrent?.();
      if(options.seed===false)return visibleSnapshot(readAuthority(options).snapshot,actorId);
      return withLock(options,async()=>{options.assertCurrent?.();const authority=readAuthority(options);if(!authority.seededUsers.includes(actorId)){seedInto(authority,actorId);writeAuthority(options,authority);}return visibleSnapshot(authority.snapshot,actorId);});
    },
    async execute(request:GanttRequest){
      const result=await withLock(options,async()=>{
        options.assertCurrent?.();
        if(!request.requestId||request.requestId.length>200)throw new Error('요청 ID가 필요합니다.');
        const value=readAuthority(options),serialized=JSON.stringify(request.command),receipt=value.receipts[request.requestId];
        if(receipt){if(receipt.actorId!==actorId||receipt.command!==serialized)throw new Error('이미 사용한 요청 ID입니다.');return visibleSnapshot(value.snapshot,actorId);}
        const snapshot=applyCommand(value.snapshot,actorId,request.command,value.revisions,value.retiredIds);checkLinkedChanges(value.snapshot,snapshot,actorId,options);
        value.snapshot=snapshot;value.receipts[request.requestId]={actorId,command:serialized};
        writeAuthority(options,value);return visibleSnapshot(snapshot,actorId);
      });notify();return result;
    },
    subscribe:subscribePreviewGantt,
  };
}
export function subscribePreviewGantt(listener:()=>void):()=>void {
  localListeners.add(listener);const channel=typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'?new BroadcastChannel(CHANNEL):null;
  channel?.addEventListener('message',listener);
  (channel as (BroadcastChannel & {unref?:()=>void})|null)?.unref?.();
  return()=>{localListeners.delete(listener);channel?.close();};
}
export function calendarEventId(projectId:string,taskId:string):string{return `gantt:${projectId}:${taskId}`;}
function projection(project:GanttProject,task:GanttTask,canEdit=true):GanttCalendarEventRow {
  // Revision-derived timestamps remain stable between reads; actual content is canonical task data.
  const stamp=new Date(project.revision*1000).toISOString();
  return {id:calendarEventId(project.id,task.id),calendar_id:task.calendarId!,title:task.title,memo:task.memo,tag_id:null,all_day:task.allDay,start_date:task.startDate,end_date:task.endDate,start_time:task.allDay?null:task.startTime,end_time:task.allDay?null:task.endTime,linked_episode:null,linked_part:null,linked_sheet_name:null,linked_scene_id:null,linked_department:null,linked_todo_id:null,created_by:project.ownerId,created_at:stamp,updated_at:stamp,linked_gantt_project_id:project.id,linked_gantt_task_id:task.id,linked_gantt_task_kind:task.kind,gantt_can_edit:canEdit,gantt_color:resolveTaskColor(project,task)};
}
export async function listCalendarEvents(actorId:string,options:PreviewOptions={}):Promise<GanttCalendarEventRow[]> {
  if(!actorId)return [];
  options.assertCurrent?.();const snapshot=readAuthority(options).snapshot;
  return snapshot.projects.flatMap(p=>p.tasks.filter(t=>t.calendarId&&t.kind!=='group'&&calendarAllowed(options,t.calendarId,actorId,false)).map(t=>projection(p,t,canEditProject(snapshot,actorId,p)&&calendarAllowed(options,t.calendarId!,actorId,true))));
}
export async function patchCalendarEvent(actorId:string,eventId:string,patch:Record<string,unknown>,options:PreviewOptions={}):Promise<GanttCalendarEventRow> {
  const result=await withLock(options,async()=>{
    options.assertCurrent?.();
    const value=readAuthority(options);const match=findEvent(value.snapshot,eventId);if(!match)throw new Error('간트 일정을 찾을 수 없습니다.');
    const {project,task}=match;
    if(!canEditProject(value.snapshot,actorId,project)||!calendarAllowed(options,task.calendarId!,actorId,true))throw new Error('간트와 캘린더 양쪽 편집 권한이 필요합니다.');
    const allowed=['title','memo','start_date','end_date','start_time','end_time','all_day'];
    // Calendar forms may submit unchanged non-shared fields. Reject only actual unsupported changes.
    const current=projection(project,task) as unknown as Record<string,unknown>;
    for(const key of Object.keys(patch))if(!allowed.includes(key)&&patch[key]!==current[key])throw new Error('연결된 간트에서는 제목·메모·날짜·시간만 수정할 수 있습니다.');
    const converted:Partial<GanttTask>={};const pairs={title:'title',memo:'memo',start_date:'startDate',end_date:'endDate',start_time:'startTime',end_time:'endTime',all_day:'allDay'} as const;
    for(const key of Object.keys(pairs) as Array<keyof typeof pairs>)if(key in patch)(converted as Record<string,unknown>)[pairs[key]]=patch[key]===null?'':patch[key];
    const scheduling=['start_date','end_date','start_time','end_time','all_day'].some(k=>k in patch&&patch[k]!==current[k]);
    if(scheduling&&task.mode==='auto')throw new Error('자동 작업의 날짜는 간트에서 수동으로 전환한 뒤 수정해 주세요.');
    const changed=updateTask(project,task.id,converted),next=applyCommand(value.snapshot,actorId,{type:'saveProject',project:changed,expectedRevision:project.revision},value.revisions,value.retiredIds);
    checkLinkedChanges(value.snapshot,next,actorId,options);value.snapshot=next;writeAuthority(options,value);
    return projection(next.projects.find(p=>p.id===project.id)!,changed.tasks.find(t=>t.id===task.id)!);
  });notify();return result;
}
function findEvent(snapshot:GanttSnapshot,eventId:string):{project:GanttProject;task:GanttTask}|null {
  for(const project of snapshot.projects){const task=project.tasks.find(t=>t.calendarId&&calendarEventId(project.id,t.id)===eventId);if(task)return {project,task};}return null;
}
export async function deleteCalendarEvent(actorId:string,eventId:string,options:PreviewOptions={}):Promise<void> {
  await withLock(options,async()=>{
    options.assertCurrent?.();
    const value=readAuthority(options),match=findEvent(value.snapshot,eventId);if(!match)throw new Error('간트 일정을 찾을 수 없습니다.');
    const {project,task}=match;
    if(!canEditProject(value.snapshot,actorId,project)||!calendarAllowed(options,task.calendarId!,actorId,true))throw new Error('간트와 캘린더 양쪽 편집 권한이 필요합니다.');
    const changed=structuredClone(project),target=changed.tasks.find(t=>t.id===task.id)!;target.calendarId=null;target.calendarEventId=null;
    value.snapshot=applyCommand(value.snapshot,actorId,{type:'saveProject',project:changed,expectedRevision:project.revision},value.revisions,value.retiredIds);writeAuthority(options,value);
  });notify();
}

/** Calendar deletion owns its permission check; task links follow that deletion without deleting tasks. */
export async function unlinkDeletedCalendar(calendarId:string,commitDelete:()=>void,options:PreviewOptions={}):Promise<void> {
  await withLock(options,async()=>{
    options.assertCurrent?.();
    const value=readAuthority(options),before=structuredClone(value);
    let changed=false;
    value.snapshot.projects=value.snapshot.projects.map(project=>{
      if(!project.tasks.some(task=>task.calendarId===calendarId))return project;
      changed=true;
      return {...project,revision:project.revision+1,tasks:project.tasks.map(task=>task.calendarId===calendarId?{...task,calendarId:null,calendarEventId:null}:task)};
    });
    if(changed)writeAuthority(options,value);
    try{commitDelete();}catch(error){if(changed)writeAuthority(options,before);throw error;}
  });notify();
}
