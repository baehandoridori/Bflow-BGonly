import type { GanttCommand, GanttProject, GanttSnapshot, GanttSpace, GanttTask } from './types.ts';

const DAY = 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
function fail(message: string): never { throw new Error(message); }
function id(value: string): void { if (typeof value !== 'string' || !UUID.test(value)) fail('올바른 ID가 필요합니다.'); }
function text(value: string, label: string, max = 200): void { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label}을 확인해 주세요.`); }
function userIds(values: string[]): void { if (!Array.isArray(values) || new Set(values).size !== values.length || values.some(v => typeof v !== 'string' || !v.trim() || v.length > 200)) fail('멤버 ID를 확인해 주세요.'); }
function revision(value: number): void { if (!Number.isSafeInteger(value) || value < 1) fail('올바른 revision이 필요합니다.'); }
export function dateStamp(date: string, time = ''): number {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) fail('날짜 또는 시간을 확인해 주세요.');
  const result = Date.parse(`${date}T${time || '00:00'}:00Z`);
  if (!Number.isFinite(result) || new Date(result).toISOString().slice(0, 10) !== date) fail('날짜를 확인해 주세요.');
  return result;
}
export function shiftDate(date: string, days: number): string { return new Date(dateStamp(date) + days * DAY).toISOString().slice(0, 10); }
export function daysBetween(a: string, b: string): number { return Math.round((dateStamp(b) - dateStamp(a)) / DAY); }
export function todayDate(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function createTask(title = '새 작업', startDate = todayDate()): GanttTask {
  return { id: crypto.randomUUID(), parentId: null, kind: 'task', title, memo: '', startDate, endDate: startDate, allDay: true, startTime: '', endTime: '', mode: 'manual', predecessorId: null, progress: 0, progressMode: 'manual', sceneLinks: [], workers: [], attendees: [], color: null, calendarId: null, calendarEventId: null, completed: false, sortOrder: 0 };
}
export function createProject(name: string, spaceId: string, ownerId: string): GanttProject {
  return { id: crypto.randomUUID(), name, spaceId, ownerId, memo: '', color: '#6C5CE7', completed: false, revision: 1, memberIds: null, editorIds: null, linkedEpisode: null, tasks: [] };
}
export function createSpace(name: string, ownerId: string): GanttSpace { return { id: crypto.randomUUID(), name, ownerId, shared: false, members: [], revision: 1 }; }
export type TaskBounds = Pick<GanttTask, 'startDate' | 'endDate' | 'startTime' | 'endTime' | 'allDay'>;
function children(project: GanttProject, taskId: string): GanttTask[] { return project.tasks.filter(t => t.parentId === taskId); }
function ancestors(project:GanttProject,task:GanttTask):GanttTask[] {
  const result:GanttTask[]=[],seen=new Set<string>();let parentId=task.parentId;
  while(parentId&&!seen.has(parentId)){seen.add(parentId);const parent=project.tasks.find(t=>t.id===parentId);if(!parent)break;result.push(parent);parentId=parent.parentId;}
  return result;
}
export function descendantIds(project: GanttProject, taskId: string): Set<string> {
  const found = new Set([taskId]); let previous: number;
  do { previous = found.size; for (const t of project.tasks) if (t.parentId && found.has(t.parentId)) found.add(t.id); } while (previous !== found.size);
  return found;
}
export function taskBounds(project: GanttProject, taskId?: string): TaskBounds | null {
  const task = taskId ? project.tasks.find(t => t.id === taskId) : null;
  if (taskId && !task) return null;
  const list = task ? task.kind === 'group' ? project.tasks.filter(t => descendantIds(project, task.id).has(t.id) && t.kind !== 'group') : [task] : project.tasks.filter(t => t.kind !== 'group');
  if (!list.length) return null;
  const first = [...list].sort((a,b)=>start(a)-start(b))[0], last = [...list].sort((a,b)=>finish(b)-finish(a))[0];
  return {startDate:first.startDate,endDate:last.endDate,startTime:first.startTime,endTime:last.endTime,allDay:first.allDay || last.allDay};
}
function start(t: TaskBounds): number { return dateStamp(t.startDate,t.allDay ? '' : t.startTime); }
function finish(t: TaskBounds & { kind?: string }): number { return t.kind === 'milestone' ? start(t) : dateStamp(t.endDate,t.allDay ? '' : t.endTime)+(t.allDay?DAY:0); }
export function durationLabel(task: Pick<GanttTask,'kind'|'startDate'|'endDate'|'allDay'|'startTime'|'endTime'>): string {
  if(task.kind==='milestone') return '0일';
  if(task.allDay) return `${daysBetween(task.startDate,task.endDate)+1}일`;
  const minutes=Math.max(0,Math.round((finish(task)-start(task))/60000));const days=Math.floor(minutes/1440),hours=Math.floor((minutes%1440)/60),rest=minutes%60;
  return [days?`${days}일`:'',hours?`${hours}시간`:'',rest?`${rest}분`:''].filter(Boolean).join(' ') || '0분';
}
export function resolveTaskColor(project: GanttProject, task: GanttTask): string {
  let current:GanttTask|undefined=task;const seen=new Set<string>();
  while(current&&!seen.has(current.id)) {seen.add(current.id);if(current.color) return current.color;current=project.tasks.find(t=>t.id===current?.parentId);}
  return project.color;
}
export function validateProject(project: GanttProject): void {
  id(project.id);id(project.spaceId);text(project.ownerId,'소유자');text(project.name,'프로젝트 이름');revision(project.revision);
  if(!COLOR.test(project.color)) fail('프로젝트 색상을 확인해 주세요.');
  if(typeof project.memo!=='string'||project.memo.length>20000||typeof project.completed!=='boolean') fail('프로젝트 정보를 확인해 주세요.');
  if(project.memberIds!==null) userIds(project.memberIds);if(project.editorIds!==null) userIds(project.editorIds);
  if(project.linkedEpisode!==null&&(!Number.isSafeInteger(project.linkedEpisode)||project.linkedEpisode<0)) fail('에피소드를 확인해 주세요.');
  if(!Array.isArray(project.tasks)||project.tasks.length>3000) fail('작업 목록을 확인해 주세요.');
  const map=new Map(project.tasks.map(t=>[t.id,t]));if(map.size!==project.tasks.length) fail('작업 ID가 중복됩니다.');
  for(const t of project.tasks) {
    id(t.id);text(t.title,'작업 제목');if(typeof t.memo!=='string'||t.memo.length>20000) fail('메모가 너무 깁니다.');
    if(!['task','group','milestone'].includes(t.kind)||!['auto','manual'].includes(t.mode)||!['manual','scenes'].includes(t.progressMode)) fail('작업 유형을 확인해 주세요.');
    if(typeof t.allDay!=='boolean'||typeof t.completed!=='boolean'||!Number.isFinite(t.progress)||t.progress<0||t.progress>100||!Number.isFinite(t.sortOrder)) fail('작업 상태를 확인해 주세요.');
    if(t.color!==null&&!COLOR.test(t.color)) fail('작업 색상을 확인해 주세요.');
    if(typeof t.startTime!=='string'||typeof t.endTime!=='string'||(!t.allDay&&(!t.startTime||!t.endTime))) fail('시작·종료 시간을 입력해 주세요.');
    dateStamp(t.startDate,t.startTime);dateStamp(t.endDate,t.endTime);
    if(dateStamp(t.endDate,t.allDay?'':t.endTime)<start(t)) fail('종료 날짜는 시작보다 빠를 수 없습니다.');
    if(t.kind==='milestone'&&(t.startDate!==t.endDate||(!t.allDay&&t.startTime!==t.endTime))) fail('마일스톤은 하나의 시점으로 지정해 주세요.');
    userIds(t.workers);userIds(t.attendees);
    if(t.calendarId!==null) id(t.calendarId);
    if(t.calendarEventId!==null&&typeof t.calendarEventId!=='string') fail('캘린더 연결을 확인해 주세요.');
    if(!Array.isArray(t.sceneLinks)||t.sceneLinks.some(l=>!Number.isSafeInteger(l.episodeNumber)||typeof l.sheetName!=='string'||typeof l.sceneId!=='string'||!['bg','acting'].includes(l.department))) fail('씬 연결을 확인해 주세요.');
    if(t.parentId!==null){id(t.parentId);if(t.parentId===t.id||map.get(t.parentId)?.kind!=='group') fail('상위 그룹을 확인해 주세요.');}
    if(t.predecessorId!==null){id(t.predecessorId);if(t.predecessorId===t.id||!map.has(t.predecessorId)) fail('선행 작업을 확인해 주세요.');}
  }
  function check(edges:(t:GanttTask)=>string[]) {
    const done=new Set<string>(),visiting=new Set<string>();
    const visit=(key:string)=>{if(visiting.has(key)) fail('작업에 순환 관계가 있습니다.');if(done.has(key))return;visiting.add(key);for(const edge of edges(map.get(key)!))visit(edge);visiting.delete(key);done.add(key);};
    project.tasks.forEach(t=>visit(t.id));
  }
  check(t=>t.parentId?[t.parentId]:[]);
  check(t=>[...(t.predecessorId?[t.predecessorId]:[]),...children(project,t.id).map(c=>c.id),...ancestors(project,t).flatMap(p=>p.predecessorId?[p.predecessorId]:[])]);
  for(const t of project.tasks) if(t.predecessorId && descendantIds(project,t.id).has(t.predecessorId)) fail('그룹과 하위 작업을 선행 관계로 연결할 수 없습니다.');
}
function moveTo(task:GanttTask,target:number):void {
  if(task.allDay) {const span=daysBetween(task.startDate,task.endDate);task.startDate=new Date(Math.ceil(target/DAY)*DAY).toISOString().slice(0,10);task.endDate=shiftDate(task.startDate,span);}
  else {const span=dateStamp(task.endDate,task.endTime)-start(task),a=new Date(target).toISOString(),b=new Date(target+span).toISOString();Object.assign(task,{startDate:a.slice(0,10),startTime:a.slice(11,16),endDate:b.slice(0,10),endTime:b.slice(11,16)});}
}
export function updateTask(project:GanttProject,taskId:string,patch:Partial<GanttTask>):GanttProject {
  const next=structuredClone(project),task=next.tasks.find(t=>t.id===taskId);if(!task) fail('작업을 찾을 수 없습니다.');
  if(patch.id&&patch.id!==taskId) fail('작업 ID를 바꿀 수 없습니다.');
  Object.assign(task,patch);if(task.allDay){task.startTime='';task.endTime='';}if(task.kind==='milestone'){task.endDate=task.startDate;task.endTime=task.startTime;}
  if(patch.progress!==undefined&&task.progressMode==='manual')task.completed=task.progress===100;
  if(!task.completed)next.completed=false;
  validateProject(next);
  const scheduled=new Set<string>();
  const schedule=(t:GanttTask)=>{
    if(scheduled.has(t.id))return;
    for(const child of children(next,t.id)) schedule(child);
    const predecessor=t.predecessorId?next.tasks.find(p=>p.id===t.predecessorId)!:null;
    if(predecessor)schedule(predecessor);
    const inherited=ancestors(next,t).filter(p=>p.mode==='auto'&&p.predecessorId).map(p=>next.tasks.find(x=>x.id===p.predecessorId)!);
    inherited.forEach(schedule);
    // Groups summarize their children. Their constraints never translate manual
    // children: only automatic leaves take the ancestor's finish as a lower bound.
    if(t.mode==='auto'&&t.kind!=='group'&&(predecessor||inherited.length)){
      const boundary=(p:GanttTask)=>{const bounds=taskBounds(next,p.id);return bounds?finish({...bounds,kind:p.kind}):null;};
      const ownStart=(predecessor?boundary(predecessor):null)??start(t);
      moveTo(t,Math.max(ownStart,...inherited.map(boundary).filter((value):value is number=>value!==null)));
    }
    scheduled.add(t.id);
  };
  next.tasks.forEach(schedule);validateProject(next);return next;
}
export function taskConflicts(project:GanttProject):Array<{id:string;message:string}> {
  return project.tasks.flatMap(t=>{if(!t.predecessorId)return [];const p=project.tasks.find(x=>x.id===t.predecessorId);if(!p)return [];const bounds=taskBounds(project,t.id),previous=taskBounds(project,p.id);if(!bounds||!previous)return [];return start(bounds)<finish({...previous,kind:p.kind})?[{id:t.id,message:`선행 작업 ‘${p.title}’이 끝나기 전에 시작합니다.`}]:[];});
}
export function completeTasks(project:GanttProject,ids:string[],completed:boolean):GanttProject {
  const next=structuredClone(project),selected=new Set<string>();
  for(const key of ids){const t=next.tasks.find(t=>t.id===key);if(!t)fail('작업을 찾을 수 없습니다.');for(const child of t.kind==='group'?descendantIds(next,key):[key])selected.add(child);}
  for(const t of next.tasks)if(selected.has(t.id)){t.completed=completed;t.progress=completed?100:0;t.progressMode='manual';}
  if(!completed&&selected.size)next.completed=false;
  return next;
}
export function canManageSpace(space:GanttSpace,actorId:string):boolean {return Boolean(actorId)&&space.ownerId===actorId;}
export function canViewSpace(space:GanttSpace,actorId:string):boolean {return Boolean(actorId)&&(space.ownerId===actorId||(space.shared&&space.members.some(m=>m.userId===actorId)));}
export function canEditSpace(space:GanttSpace,actorId:string):boolean {return space.ownerId===actorId||(space.shared&&space.members.some(m=>m.userId===actorId&&m.canEdit));}
export function canViewProject(snapshot:GanttSnapshot,actorId:string,project:GanttProject):boolean {
  const space=snapshot.spaces.find(s=>s.id===project.spaceId);return Boolean(space&&canViewSpace(space,actorId)&&(space.ownerId===actorId||project.ownerId===actorId||project.memberIds===null||project.memberIds.includes(actorId)));
}
export function canEditProject(snapshot:GanttSnapshot,actorId:string,project:GanttProject):boolean {
  const space=snapshot.spaces.find(s=>s.id===project.spaceId);return Boolean(space&&canViewProject(snapshot,actorId,project)&&canEditSpace(space,actorId)&&(space.ownerId===actorId||project.ownerId===actorId||project.editorIds===null||project.editorIds.includes(actorId)));
}
export function visibleSnapshot(snapshot:GanttSnapshot,actorId:string):GanttSnapshot {return structuredClone({spaces:snapshot.spaces.filter(s=>canViewSpace(s,actorId)),projects:snapshot.projects.filter(p=>canViewProject(snapshot,actorId,p))});}
export function applyCommand(snapshot:GanttSnapshot,actorId:string,command:GanttCommand):GanttSnapshot {
  text(actorId,'로그인 사용자');const next=structuredClone(snapshot);
  const cas=(current:number|undefined,expected:number|null)=>{if(current===undefined?expected!==null:expected!==current)fail('다른 변경이 있습니다. 최신 내용을 다시 불러와 주세요.');};
  if(command.type==='saveSpace') {
    const s=command.space;id(s.id);text(s.name,'폴더 이름');text(s.ownerId,'소유자');revision(s.revision);
    if(typeof s.shared!=='boolean'||!Array.isArray(s.members)||s.members.some(m=>typeof m.canEdit!=='boolean'))fail('공유 설정을 확인해 주세요.');userIds(s.members.map(m=>m.userId));
    const old=next.spaces.find(x=>x.id===s.id);if((old&&!canManageSpace(old,actorId))||(!old&&s.ownerId!==actorId)||old&&old.ownerId!==s.ownerId)fail('폴더 관리 권한이 없습니다.');cas(old?.revision,command.expectedRevision);
    const saved={...structuredClone(s),revision:(old?.revision??0)+1};
    if(old)next.spaces=next.spaces.map(x=>x.id===s.id?saved:x);else next.spaces.push(saved);
  }else if(command.type==='saveProject') {
    const p=command.project;validateProject(p);const s=next.spaces.find(s=>s.id===p.spaceId),old=next.projects.find(x=>x.id===p.id);
    if(!s||!canEditSpace(s,actorId)||(old&&!canEditProject(next,actorId,old))||(!old&&p.ownerId!==actorId))fail('프로젝트 편집 권한이 없습니다.');
    if(old&&(old.ownerId!==p.ownerId||old.spaceId!==p.spaceId))fail('소유자와 폴더는 변경할 수 없습니다.');
    if(old&&actorId!==old.ownerId&&actorId!==s.ownerId&&(JSON.stringify(old.memberIds)!==JSON.stringify(p.memberIds)||JSON.stringify(old.editorIds)!==JSON.stringify(p.editorIds)))fail('프로젝트 공유 관리 권한이 없습니다.');
    const members=new Set([s.ownerId,...(s.shared?s.members.map(m=>m.userId):[])]);
    if(!members.has(p.ownerId)||(p.memberIds??[]).some(u=>!members.has(u))||(p.editorIds??[]).some(u=>!members.has(u)||(p.memberIds!==null&&!p.memberIds.includes(u)&&u!==p.ownerId)))fail('프로젝트 멤버는 폴더 범위 안에서 선택해 주세요.');
    cas(old?.revision,command.expectedRevision);
    const saved={...structuredClone(p),revision:(old?.revision??0)+1};
    if(old)next.projects=next.projects.map(x=>x.id===p.id?saved:x);else next.projects.push(saved);
  }else if(command.type==='deleteProject') {
    const p=next.projects.find(p=>p.id===command.projectId);if(!p||!canEditProject(next,actorId,p))fail('프로젝트 삭제 권한이 없습니다.');cas(p.revision,command.expectedRevision);next.projects=next.projects.filter(x=>x.id!==p.id);
  }else if(command.type==='deleteSpace') {
    const s=next.spaces.find(s=>s.id===command.spaceId);if(!s||!canManageSpace(s,actorId))fail('폴더 삭제 권한이 없습니다.');cas(s.revision,command.expectedRevision);next.spaces=next.spaces.filter(x=>x.id!==s.id);next.projects=next.projects.filter(p=>p.spaceId!==s.id);
  }else fail('지원하지 않는 변경입니다.');
  return next;
}
