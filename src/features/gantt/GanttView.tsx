import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, FolderPlus, Plus, Redo2, Settings2, Undo2, X } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDataStore } from '@/stores/useDataStore';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { sceneProgress } from '@/utils/calcStats';
import { useGanttStore } from './useGanttStore';
import { canEditProject, completeTasks, taskBounds, updateTask } from './domain';
import type { GanttProject, GanttSpace, GanttTask } from './types';
import { GanttCanvas, localDate, moveDate } from './GanttCanvas';
import { GanttContextMenu, GanttModal, GanttSpaceDialog, type GanttContextTarget } from './GanttDialogs';
import { GanttInspector } from './GanttInspector';
import { GanttShareTooltip } from './GanttShareTooltip';
import './gantt.css';

const newTask=(kind:GanttTask['kind'],parentId:string|null,startDate=localDate(),endDate=moveDate(startDate,2)):GanttTask=>({id:crypto.randomUUID(),parentId,kind,title:kind==='group'?'새 그룹':kind==='milestone'?'새 마일스톤':'새 작업',memo:'',startDate,endDate:kind==='milestone'?startDate:endDate,allDay:true,startTime:'',endTime:'',mode:'manual',predecessorId:null,progress:0,progressMode:'manual',sceneLinks:[],workers:[],attendees:[],color:null,calendarId:null,calendarEventId:null,completed:false,sortOrder:0});
export function GanttView() {
  const user=useAuthStore(s=>s.currentUser),users=useAuthStore(s=>s.users),episodes=useDataStore(s=>s.episodes),calendars=useCalendarStore(s=>s.calendars);
  const state=useGanttStore();const {snapshot,pending,loading,error}=state;
  const [hidden,setHidden]=useState<string[]>([]),[collapsed,setCollapsed]=useState<string[]>([]),[closedSpaces,setClosedSpaces]=useState<string[]>([]);
  const [selected,setSelected]=useState<string[]>([]),[selectedProject,setSelectedProject]=useState<string|null>(null),[inspecting,setInspecting]=useState(false);
  const [done,setDone]=useState(false),[worker,setWorker]=useState(''),[search,setSearch]=useState(''),[navOpen,setNavOpen]=useState(true);
  const [prior,setPrior]=useState<string[]|null>(null),[spaceDialog,setSpaceDialog]=useState<GanttSpace|null|undefined>(),[projectDialog,setProjectDialog]=useState(false),[context,setContext]=useState<GanttContextTarget|null>(null);
  const [notice,setNotice]=useState(''),[confirm,setConfirm]=useState<string|null>(null),answer=useRef<((ok:boolean)=>void)|null>(null);
  const preferenceKey=`bflow-gantt-view:${user?.id||''}`;
  const [preferencesLoadedFor,setPreferencesLoadedFor]=useState('');
  useEffect(()=>{if(!user)return;void state.initialize(user.id);void useCalendarStore.getState().loadAll();try{const v=JSON.parse(localStorage.getItem(preferenceKey)||'{}');setHidden(v.hidden||[]);setCollapsed(v.collapsed||[]);setClosedSpaces(v.closedSpaces||[]);}catch{}setPreferencesLoadedFor(preferenceKey);setSelected([]);setInspecting(false);return()=>{answer.current?.(false);answer.current=null;void useGanttStore.getState().initialize(null);};},[user?.id]);
  useEffect(()=>{if(user&&preferencesLoadedFor===preferenceKey)try{localStorage.setItem(preferenceKey,JSON.stringify({hidden,collapsed,closedSpaces}));}catch{}},[hidden,collapsed,closedSpaces,preferenceKey,preferencesLoadedFor]);
  useEffect(()=>{const timer=setInterval(()=>void useGanttStore.getState().refresh(),15000);const refresh=()=>void useGanttStore.getState().refresh();window.addEventListener('focus',refresh);window.addEventListener('bflow:calendar-changed',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('bflow:calendar-changed',refresh);};},[]);
  useEffect(()=>{if(selectedProject&&!snapshot.projects.some(p=>p.id===selectedProject)){setSelectedProject(null);setSelected([]);setInspecting(false);}if(!pending)setContext(previous=>previous&&!snapshot.projects.some(p=>p.id===previous.project.id)?null:previous);},[snapshot,pending]);
  const names=useMemo(()=>Object.fromEntries(users.map(u=>[u.id,u.name])),[users]);
  const editable=(p:GanttProject)=>{const current=snapshot.projects.find(row=>row.id===p.id);return !!user&&!!current&&canEditProject(snapshot,user.id,current);};
  const p=snapshot.projects.find(p=>p.id===selectedProject),task=p?.tasks.find(t=>t.id===selected[0])||null;
  const effectiveProjects=useMemo(()=>snapshot.projects.map(p=>({...p,tasks:p.tasks.map(t=>{if(t.progressMode!=='scenes'||!t.sceneLinks.length)return t;const linked=t.sceneLinks.flatMap(l=>episodes.find(ep=>ep.episodeNumber===l.episodeNumber)?.parts.find(part=>part.sheetName===l.sheetName&&part.department===l.department)?.scenes.filter(s=>s.sceneId===l.sceneId)||[]);const progress=linked.length?Math.round(linked.reduce((sum,s)=>sum+sceneProgress(s),0)/linked.length):0;return {...t,progress,completed:progress===100};})})),[snapshot.projects,episodes]);
  const visibleProjects=effectiveProjects.filter(p=>!hidden.includes(p.id)&&(!search||p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())||p.tasks.some(t=>t.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))));
  const ask=(message:string)=>new Promise<boolean>(resolve=>{answer.current?.(false);answer.current=resolve;setConfirm(message);});
  const respond=(value:boolean)=>{answer.current?.(value);answer.current=null;setConfirm(null);};
  const run=async(action:()=>Promise<unknown>,message='저장했습니다.')=>{try{await action();setNotice(message);}catch(e){setNotice((e as Error).message);}};
  const saveProject=async(next:GanttProject,isNew=false)=>{await useGanttStore.getState().execute({type:'saveProject',project:next,expectedRevision:isNew?null:next.revision});};
  const patchTask=async(project:GanttProject,t:GanttTask,patch:Partial<GanttTask>)=>{
    const current=useGanttStore.getState().snapshot.projects.find(p=>p.id===project.id);if(!current)throw new Error('프로젝트가 더 이상 보이지 않습니다.');
    if(current.revision!==project.revision)throw new Error('다른 변경이 있습니다. 입력 내용을 복사한 뒤 최신 작업을 다시 열어 주세요.');
    if(t.mode==='auto'&&(patch.startDate!==undefined||patch.endDate!==undefined||patch.startTime!==undefined||patch.endTime!==undefined)&&patch.mode!=='manual'){
      const datesChanged=['startDate','endDate','startTime','endTime'].some(key=>patch[key as keyof GanttTask]!==undefined&&patch[key as keyof GanttTask]!==t[key as keyof GanttTask]);
      if(datesChanged){if(!await ask('자동 일정을 직접 이동하면 수동 일정으로 바뀝니다. 변경할까요?'))throw new Error('날짜 변경을 취소했습니다.');patch={...patch,mode:'manual'};}
    }
    await saveProject(updateTask(current,t.id,patch));
  };
  const addTask=async(project:GanttProject,kind:GanttTask['kind']='task',parentId:string|null=null,start=localDate(),end=moveDate(start,2),afterId?:string)=>{
    const latest=useGanttStore.getState(),current=latest.snapshot.projects.find(p=>p.id===project.id);
    if(!current||!user||!canEditProject(latest.snapshot,user.id,current))throw new Error('프로젝트 편집 권한이 없습니다.');
    if(latest.pending||current.completed)throw new Error('지금은 작업을 추가할 수 없습니다.');
    const siblings=current.tasks.filter(t=>t.parentId===parentId).sort((a,b)=>a.sortOrder-b.sortOrder);
    const after=afterId?siblings.findIndex(t=>t.id===afterId):-1;
    if(afterId&&after<0)throw new Error('선택한 작업이 변경되었습니다. 추가 위치를 다시 선택해 주세요.');
    const task=newTask(kind,parentId,start,end);
    siblings.splice(afterId?after+1:siblings.length,0,task);
    const order=new Map(siblings.map((t,index)=>[t.id,index]));
    const tasks=[...current.tasks,task].map(t=>order.has(t.id)?{...t,sortOrder:order.get(t.id)!}:t);
    await saveProject({...current,tasks});
    const expanded=new Set([project.id]);let ancestor=parentId;
    while(ancestor&&!expanded.has(ancestor)){expanded.add(ancestor);ancestor=current.tasks.find(t=>t.id===ancestor)?.parentId||null;}
    setHidden(h=>h.filter(id=>id!==current.id));setCollapsed(c=>c.filter(id=>!expanded.has(id)));setWorker('');setSearch('');
    setSelectedProject(project.id);setSelected([task.id]);setInspecting(true);
  };
  const chooseProject=(projectId:string)=>{setSelectedProject(projectId);setSelected([projectId]);setInspecting(false);};
  const select=(projectId:string,taskId:string|null,multiple=false)=>{setSelectedProject(projectId);setSelected(prev=>multiple&&taskId&&selectedProject===projectId?(prev.includes(taskId)?prev.filter(id=>id!==taskId):[...prev.filter(id=>id!==projectId),taskId]):[taskId||projectId]);setInspecting(!multiple);};
  const complete=async(project:GanttProject,t:GanttTask|null)=>{
    if(!t){if(!project.completed&&!await ask(`‘${project.name}’의 모든 일정을 완료할까요? 실행 취소로 되돌릴 수 있습니다.`))return;await saveProject({...completeTasks(project,project.tasks.map(t=>t.id),!project.completed),completed:!project.completed});}
    else {const displayed=effectiveProjects.find(p=>p.id===project.id)?.tasks.find(item=>item.id===t.id)||t;const isDone=displayed.completed||displayed.progress===100;await saveProject({...completeTasks(project,[t.id],!isDone),completed:isDone?false:project.completed});if(t.progressMode==='scenes')setNotice('씬 연결을 유지하고, 이 작업의 완료 상태는 직접 관리하도록 변경했습니다.');}
    setInspecting(false);setSelected([]);setContext(null);
  };
  const deleteSelection=async()=>{if(!p)return;if(!await ask(task?`‘${task.title}’과 하위 작업 및 연결 캘린더 일정을 삭제할까요?`:`‘${p.name}’ 프로젝트와 연결 일정을 삭제할까요?`))return;if(task){const ids=new Set([task.id]);let size=0;while(size!==ids.size){size=ids.size;p.tasks.forEach(t=>{if(t.parentId&&ids.has(t.parentId))ids.add(t.id);});}await saveProject({...p,tasks:p.tasks.filter(t=>!ids.has(t.id)).map(t=>({...t,predecessorId:t.predecessorId&&ids.has(t.predecessorId)?null:t.predecessorId}))});}else await state.execute({type:'deleteProject',projectId:p.id,expectedRevision:p.revision});setSelected([]);setInspecting(false);};
  const move=(direction:'up'|'down'|'indent'|'outdent')=>{if(!p||!task)return;void run(async()=>{const siblings=p.tasks.filter(t=>t.parentId===task.parentId).sort((a,b)=>a.sortOrder-b.sortOrder),index=siblings.findIndex(t=>t.id===task.id);if(direction==='indent'){const before=siblings[index-1];if(!before||before.kind!=='group')throw new Error('바로 위에 그룹이 있어야 들여쓸 수 있습니다.');await saveProject(updateTask(p,task.id,{parentId:before.id}));}else if(direction==='outdent'){const parent=p.tasks.find(t=>t.id===task.parentId);if(parent)await saveProject(updateTask(p,task.id,{parentId:parent.parentId,sortOrder:parent.sortOrder+0.5}));}else{const other=siblings[index+(direction==='up'?-1:1)];if(!other)return;const tasks=p.tasks.map(t=>t.id===task.id?{...t,sortOrder:other.sortOrder}:t.id===other.id?{...t,sortOrder:task.sortOrder}:t);await saveProject({...p,tasks});}},'작업 순서를 변경했습니다.');};
  const closeContext=useCallback(()=>setContext(null),[]);
  useEffect(()=>{const keyboard=(e:KeyboardEvent)=>{if((e.target as HTMLElement).closest('input,textarea,select,dialog'))return;if(e.key==='Escape'){setContext(null);setInspecting(false);setSelected([]);}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();void run(()=>e.shiftKey?state.redo():state.undo());}};window.addEventListener('keydown',keyboard);return()=>window.removeEventListener('keydown',keyboard);},[state.undo,state.redo]);
  const targetProject=p||visibleProjects.find(project=>!project.completed&&editable(project))||snapshot.projects.find(project=>!project.completed&&editable(project));
  const addFromToolbar=(kind:GanttTask['kind'])=>{
    if(!targetProject||!editable(targetProject)||pending||done||targetProject.completed)return;
    const anchor=targetProject.tasks.find(t=>t.id===selected[0]);
    const insideGroup=anchor?.kind==='group'&&kind!=='group';
    const parentId=insideGroup?anchor.id:anchor?.parentId||null;
    const start=taskBounds(targetProject,anchor?.id)?.startDate||anchor?.startDate||localDate();
    return addTask(targetProject,kind,parentId,start,moveDate(start,2),insideGroup?undefined:anchor?.id);
  };
  const activeSpace=p?snapshot.spaces.find(s=>s.id===p.spaceId):undefined;
  return <section className={`gantt ${navOpen?'':'nav-hidden'}`}>
    {navOpen&&<nav className="gantt-nav" aria-label="간트 폴더와 프로젝트"><div className="gantt-nav-heading"><strong>프로젝트</strong><button title="목록 접기" onClick={()=>setNavOpen(false)}><X size={14}/></button></div><input className="gantt-search" aria-label="프로젝트·작업 검색" placeholder="프로젝트·작업 검색" value={search} onChange={e=>setSearch(e.target.value)}/><div className="gantt-nav-actions"><button onClick={()=>setHidden([])}>전체 표시</button><button onClick={()=>setHidden(snapshot.projects.map(p=>p.id))}>모두 끄기</button>{prior&&<button onClick={()=>{setHidden(prior);setPrior(null);}}>이전 선택</button>}</div>
      {[false,true].map(shared=><div key={String(shared)}><h3>{shared?'공유 프로젝트':'내 프로젝트'}</h3>{snapshot.spaces.filter(s=>s.shared===shared).map(space=><details key={space.id} open={!closedSpaces.includes(space.id)} onToggle={e=>{const open=e.currentTarget.open;setClosedSpaces(prev=>open?prev.filter(id=>id!==space.id):prev.includes(space.id)?prev:[...prev,space.id]);}}><summary><ChevronRight size={12}/><span>{space.name}</span>{space.shared&&<GanttShareTooltip space={space} users={users}/>}{space.ownerId===user?.id&&<button aria-label={`${space.name} 공유 설정`} onClick={e=>{e.preventDefault();setSpaceDialog(space);}}><Settings2 size={12}/></button>}</summary><div className="gantt-tree-children">{effectiveProjects.filter(p=>p.spaceId===space.id&&(done?(p.completed||p.tasks.some(t=>t.completed||t.progress===100)):!p.completed)).map(project=><div className={`gantt-project-toggle ${hidden.includes(project.id)?'off':''}`} key={project.id}><label><input type="checkbox" checked={!hidden.includes(project.id)} onChange={e=>setHidden(ids=>e.target.checked?ids.filter(id=>id!==project.id):[...ids,project.id])}/><span onDoubleClick={()=>select(project.id,null)}>{project.name}</span></label><button title="이 프로젝트만 보기" onClick={()=>{setPrior(hidden);setHidden(snapshot.projects.filter(p=>p.id!==project.id).map(p=>p.id));chooseProject(project.id);}}>보기</button>{editable(project)&&<button aria-label={`${project.name} ${project.completed?'다시 열기':'일괄 완료'}`} disabled={pending} onClick={()=>void run(()=>complete(project,null))}><Check size={12}/></button>}</div>)}</div>{space.shared&&<small>{space.ownerId===user?.id||space.members.some(m=>m.userId===user?.id&&m.canEdit)?'편집 가능':'보기 전용'}</small>}</details>)}</div>)}
      <button className="gantt-nav-add" onClick={()=>setSpaceDialog(null)}><FolderPlus size={14}/> 폴더 만들기</button><button className="gantt-nav-add" disabled={!snapshot.spaces.some(s=>s.ownerId===user?.id||s.members.some(m=>m.userId===user?.id&&m.canEdit))} onClick={()=>setProjectDialog(true)}><Plus size={14}/> 프로젝트 만들기</button>
    </nav>}
    <main className="gantt-main"><div className="gantt-heading"><div>{!navOpen&&<button onClick={()=>setNavOpen(true)}><ChevronRight size={16}/> 프로젝트</button>}<h1>타임라인</h1></div><div><button disabled={!state.canUndo||pending} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소" onClick={()=>void run(()=>state.undo())}><Undo2 size={15}/></button><button disabled={!state.canRedo||pending} title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행" onClick={()=>void run(()=>state.redo())}><Redo2 size={15}/></button></div></div>
      <div className="gantt-toolbar"><div><button aria-pressed={!done} onClick={()=>{setDone(false);setInspecting(false);}}>진행 중</button><button aria-pressed={done} onClick={()=>{setDone(true);setInspecting(false);}}>완료</button><select aria-label="작업을 추가할 프로젝트" value={targetProject?.id||''} disabled={pending} onChange={e=>chooseProject(e.target.value)}>{!targetProject&&<option value="">프로젝트 선택</option>}{snapshot.projects.filter(p=>!p.completed||p.id===targetProject?.id).map(p=><option key={p.id} value={p.id}>{p.name}{!editable(p)?' · 보기 전용':p.completed?' · 완료':''}</option>)}</select>{(['task','group','milestone'] as const).map(kind=><button className={kind==='task'?'primary':''} key={kind} disabled={!targetProject||!editable(targetProject)||targetProject.completed||pending||done} onClick={()=>void run(async()=>{await addFromToolbar(kind);})}>{kind==='task'?'+ 작업':kind==='group'?'+ 그룹':'◇ 마일스톤'}</button>)}</div><label>작업자 <select value={worker} onChange={e=>setWorker(e.target.value)}><option value="">전체</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label></div>
      {selected.length>1&&<div className="gantt-selection-bar"><span>{selected.length}개 선택 · 같은 프로젝트</span><button disabled={pending||!p||!editable(p)} onClick={()=>void run(async()=>{if(!p||!editable(p))throw new Error('프로젝트 편집 권한이 없습니다.');await saveProject(completeTasks(p,selected,!done));setSelected([]);})}>{done?'선택 일정 복원':'선택 일정 완료'}</button><button onClick={()=>setSelected([])}>선택 해제</button></div>}
      {(error||notice)&&<div className={error?'gantt-error':'gantt-notice'} role={error?'alert':'status'}>{error||notice}{error&&<button onClick={()=>void state.refresh()}>다시 불러오기</button>}</div>}
      {loading&&!snapshot.spaces.length?<div className="gantt-empty">프로젝트를 불러오고 있습니다.</div>:<GanttCanvas projects={visibleProjects} selected={selected} done={done} worker={worker} collapsed={collapsed} names={names} canEdit={project=>!pending&&editable(project)} onCollapse={id=>setCollapsed(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id])} onSelect={select} onPatch={(p,t,patch)=>void run(()=>patchTask(p,t,patch))} onAdd={(p,parent,start,end)=>void run(()=>addTask(p,'task',parent,start,end))} onMenu={(project,task,x,y)=>{setContext({project:snapshot.projects.find(p=>p.id===project.id)!,task:task?snapshot.projects.find(p=>p.id===project.id)!.tasks.find(t=>t.id===task.id)!:null,x,y});}}/>}
      <footer className="gantt-footer"><span>{pending?'저장 중…':'프로젝트별 변경을 저장합니다.'}</span><span>빈 날짜 드래그로 작성 · 우클릭 빠른 편집 · Ctrl+클릭 여러 개 선택</span></footer>
    </main>
    {inspecting&&p&&<GanttInspector project={p} task={task} users={users} calendars={calendars} episodes={episodes} canEdit={editable(p)&&(!task?.calendarId||!!calendars.find(c=>c.id===task.calendarId)?.canEdit)} canManage={p.ownerId===user?.id||activeSpace?.ownerId===user?.id} memberOptions={users.filter(u=>u.id===activeSpace?.ownerId||activeSpace?.members.some(m=>m.userId===u.id)).map(u=>({...u,canEdit:u.id===activeSpace?.ownerId||!!activeSpace?.members.find(m=>m.userId===u.id)?.canEdit}))} pending={pending} onSaveTask={patch=>task?patchTask(p,task,patch):Promise.resolve()} onSaveProject={patch=>saveProject({...p,...patch})} onClose={()=>setInspecting(false)} onComplete={()=>void run(()=>complete(p,task))} onDelete={()=>void run(deleteSelection)} canAddChild={!done&&!p.completed} onAddChild={()=>void run(async()=>{await addFromToolbar('task');})} onMove={move}/>}
    {spaceDialog!==undefined&&user&&<GanttSpaceDialog space={spaceDialog} actorId={user.id} users={users} calendars={calendars} onClose={()=>setSpaceDialog(undefined)} onSave={async space=>{await state.execute({type:'saveSpace',space,expectedRevision:spaceDialog?.revision??null});}}/>}
    {projectDialog&&user&&<GanttModal title="새 프로젝트" onClose={()=>setProjectDialog(false)}><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),name=String(f.get('name')).trim(),spaceId=String(f.get('space'));void run(async()=>{const p:GanttProject={id:crypto.randomUUID(),spaceId,ownerId:user.id,name,memo:'',color:'#A29BFE',completed:false,revision:1,memberIds:null,editorIds:null,linkedEpisode:null,tasks:[]};await saveProject(p,true);setProjectDialog(false);select(p.id,null);});}}><label className="gantt-field">프로젝트 이름<input autoFocus name="name" required maxLength={180}/></label><label className="gantt-field">폴더<select name="space" required>{snapshot.spaces.filter(s=>s.ownerId===user.id||s.members.some(m=>m.userId===user.id&&m.canEdit)).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="gantt-dialog-actions"><button type="button" onClick={()=>setProjectDialog(false)}>취소</button><button disabled={pending} className="primary">만들기</button></div></form></GanttModal>}
    {context&&<GanttContextMenu key={`${context.project.id}:${context.task?.id}`} target={context} canEdit={editable(context.project)} onClose={closeContext} onDetail={()=>{select(context.project.id,context.task?.id||null);setContext(null);}} onSave={async patch=>{if(context.task)await patchTask(context.project,context.task,patch);else await saveProject({...context.project,...patch,color:patch.color||context.project.color});}} onComplete={()=>void run(()=>complete(context.project,context.task))}/>}
    {confirm&&<GanttModal title="변경 확인" onClose={()=>respond(false)}><p>{confirm}</p><div className="gantt-dialog-actions"><button onClick={()=>respond(false)}>취소</button><button className="primary" onClick={()=>respond(true)}>확인</button></div></GanttModal>}
  </section>;
}
