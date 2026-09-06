import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, FolderPlus, MoreHorizontal, Plus, Redo2, Settings2, Undo2, X } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDataStore } from '@/stores/useDataStore';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { sceneProgress } from '@/utils/calcStats';
import { useGanttStore } from './useGanttStore';
import { canEditProject, canManageSpace, canViewProject, completeTasks, descendantIds, isTaskComplete, scheduleProject, taskBounds, taskProgress, updateTask } from './domain';
import type { GanttProject, GanttSpace, GanttTask } from './types';
import { GanttCanvas, localDate, moveDate } from './GanttCanvas';
import { GanttContextMenu, GanttModal, GanttSpaceDialog, type GanttContextTarget } from './GanttDialogs';
import { GanttInspector } from './GanttInspector';
import { GanttSelect } from './GanttSelect';
import { GanttTree } from './GanttTree';
import { relocateTask, type RelocationPosition } from './relocation';
import './gantt.css';

const newTask=(kind:GanttTask['kind'],parentId:string|null,startDate=localDate(),endDate=moveDate(startDate,2)):GanttTask=>({id:crypto.randomUUID(),parentId,kind,title:kind==='group'?'새 그룹':kind==='milestone'?'새 마일스톤':'새 작업',memo:'',startDate,endDate:kind==='milestone'?startDate:endDate,allDay:true,startTime:'',endTime:'',mode:'manual',predecessorId:null,progress:0,progressMode:'manual',sceneLinks:[],workers:[],attendees:[],color:null,calendarId:null,calendarEventId:null,completed:false,sortOrder:0});
export function GanttView() {
  const user=useAuthStore(s=>s.currentUser),users=useAuthStore(s=>s.users),episodes=useDataStore(s=>s.episodes),calendars=useCalendarStore(s=>s.calendars);
  const state=useGanttStore();const {snapshot,pending,loading,error}=state;
  const [hidden,setHidden]=useState<string[]>([]),[collapsed,setCollapsed]=useState<string[]>([]),[treeCollapsed,setTreeCollapsed]=useState<string[]>([]),[closedSpaces,setClosedSpaces]=useState<string[]>([]);
  const [selected,setSelected]=useState<string[]>([]),[selectedProject,setSelectedProject]=useState<string|null>(null),[inspecting,setInspecting]=useState(false);
  const [statusFilter,setStatusFilter]=useState<'all'|'active'|'completed'>('all'),[worker,setWorker]=useState(''),[search,setSearch]=useState(''),[navOpen,setNavOpen]=useState(true);
  const done=statusFilter==='completed';
  const [prior,setPrior]=useState<string[]|null>(null),[spaceDialog,setSpaceDialog]=useState<GanttSpace|null|undefined>(),[projectDialog,setProjectDialog]=useState(false),[context,setContext]=useState<GanttContextTarget|null>(null);
  const [notice,setNotice]=useState(''),[confirm,setConfirm]=useState<string|null>(null),answer=useRef<((ok:boolean)=>void)|null>(null);
  const [draftProgress,setDraftProgress]=useState<Record<string,number>>({});
  const closeGuard=useRef<(()=>Promise<boolean>)|null>(null), navigationVersion=useRef(0);
  const registerCloseGuard=useCallback((guard:(()=>Promise<boolean>)|null)=>{closeGuard.current=guard;},[]);
  const previewProgress=useCallback((projectId:string,taskId:string,progress:number|null)=>setDraftProgress(previous=>{
    const key=`${projectId}:${taskId}`;if(previous[key]===progress || progress===null&&!(key in previous))return previous;
    const next={...previous};if(progress===null)delete next[key];else next[key]=progress;return next;
  }),[]);
  const afterDraft=(action:()=>void)=>{const ticket=++navigationVersion.current,guard=closeGuard.current;if(!guard){action();return;}void guard().then(ok=>{if(ok&&ticket===navigationVersion.current)action();}).catch(cause=>setNotice((cause as Error).message));};
  const preferenceKey=`bflow-gantt-view:${user?.id||''}`;
  const [preferencesLoadedFor,setPreferencesLoadedFor]=useState('');
  useEffect(()=>{
    navigationVersion.current++;closeGuard.current=null;setDraftProgress({});if(!user)return;
    void state.initialize(user.id);void useCalendarStore.getState().loadAll();
    let preferences:Record<string,unknown>={};
    try{const value=JSON.parse(localStorage.getItem(preferenceKey)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))preferences=value;}catch{}
    const ids=(value:unknown):string[]=>Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'):[];
    setHidden(ids(preferences.hidden));setCollapsed(ids(preferences.collapsed));
    // Keep legacy chart preferences, then let navigation branches evolve independently.
    setTreeCollapsed(ids(preferences.treeCollapsed??preferences.collapsed));setClosedSpaces(ids(preferences.closedSpaces));
    setPreferencesLoadedFor(preferenceKey);setSelectedProject(null);setSelected([]);setInspecting(false);setNotice('');
    return()=>{answer.current?.(false);answer.current=null;void useGanttStore.getState().initialize(null);};
  },[user?.id]);
  useEffect(()=>{if(user&&preferencesLoadedFor===preferenceKey)try{localStorage.setItem(preferenceKey,JSON.stringify({hidden,collapsed,treeCollapsed,closedSpaces}));}catch{}},[hidden,collapsed,treeCollapsed,closedSpaces,preferenceKey,preferencesLoadedFor]);
  useEffect(()=>{const timer=setInterval(()=>void useGanttStore.getState().refresh(),15000);const refresh=()=>void useGanttStore.getState().refresh();window.addEventListener('focus',refresh);window.addEventListener('bflow:calendar-changed',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('bflow:calendar-changed',refresh);};},[]);
  useEffect(()=>{if(selectedProject&&!snapshot.projects.some(p=>p.id===selectedProject)){setSelectedProject(null);setSelected([]);setInspecting(false);}if(!pending)setContext(previous=>previous&&!snapshot.projects.some(p=>p.id===previous.project.id)?null:previous);},[snapshot,pending]);
  const names=useMemo(()=>Object.fromEntries(users.map(u=>[u.id,u.name])),[users]);
  const editable=(p:GanttProject)=>{const current=snapshot.projects.find(row=>row.id===p.id);return !!user&&!!current&&canEditProject(snapshot,user.id,current);};
  const p=snapshot.projects.find(p=>p.id===selectedProject),task=p?.tasks.find(t=>t.id===selected[0])||null;
  const effectiveProjects=useMemo(()=>snapshot.projects.map(p=>({...p,tasks:p.tasks.map(t=>{const draft=draftProgress[`${p.id}:${t.id}`];if(draft!==undefined)return {...t,progress:draft,completed:draft===100};if(t.progressMode!=='scenes'||!t.sceneLinks.length)return t;const linked=t.sceneLinks.flatMap(l=>episodes.find(ep=>ep.episodeNumber===l.episodeNumber)?.parts.find(part=>part.sheetName===l.sheetName&&part.department===l.department)?.scenes.filter(s=>s.sceneId===l.sceneId)||[]);const progress=linked.length?Math.round(linked.reduce((sum,s)=>sum+sceneProgress(s),0)/linked.length):0;return {...t,progress,completed:progress===100};})})),[snapshot.projects,episodes,draftProgress]);
  const visibleProjects=effectiveProjects.filter(p=>!hidden.includes(p.id)&&(!search||p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())||p.tasks.some(t=>t.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))));
  const ask=(message:string)=>new Promise<boolean>(resolve=>{answer.current?.(false);answer.current=resolve;setConfirm(message);});
  const respond=(value:boolean)=>{answer.current?.(value);answer.current=null;setConfirm(null);};
  const run=async(action:()=>Promise<unknown>)=>{setNotice('');try{await action();}catch(e){setNotice((e as Error).message);}};
  const saveProject=async(next:GanttProject,isNew=false)=>{const actor=useGanttStore.getState().actorId;await useGanttStore.getState().execute({type:'saveProject',project:scheduleProject(next),expectedRevision:isNew?null:next.revision});const state=useGanttStore.getState(),saved=state.snapshot.projects.find(p=>p.id===next.id);if(state.actorId!==actor||!saved)throw new Error('프로젝트가 더 이상 보이지 않습니다.');return saved;};
  const patchTask=async(project:GanttProject,t:GanttTask,patch:Partial<GanttTask>,expectedRevision=project.revision)=>{
    const current=useGanttStore.getState().snapshot.projects.find(p=>p.id===project.id);if(!current)throw new Error('프로젝트가 더 이상 보이지 않습니다.');
    if(current.revision!==expectedRevision)throw new Error('다른 변경이 있습니다. 입력 내용을 복사한 뒤 최신 작업을 다시 열어 주세요.');
    const currentTask=current.tasks.find(item=>item.id===t.id);if(!currentTask)throw new Error('작업이 더 이상 보이지 않습니다.');t=currentTask;
    if(t.mode==='auto'&&(patch.startDate!==undefined||patch.endDate!==undefined||patch.startTime!==undefined||patch.endTime!==undefined)&&patch.mode!=='manual'){
      const datesChanged=['startDate','endDate','startTime','endTime'].some(key=>patch[key as keyof GanttTask]!==undefined&&patch[key as keyof GanttTask]!==t[key as keyof GanttTask]);
      if(datesChanged){if(!await ask('자동 일정을 직접 이동하면 수동 일정으로 바뀝니다. 변경할까요?'))throw new Error('날짜 변경을 취소했습니다.');patch={...patch,mode:'manual'};}
    }
    return saveProject(updateTask(current,t.id,patch));
  };
  const patchProject=async(project:GanttProject,patch:Partial<GanttProject>,expectedRevision=project.revision)=>{
    const current=useGanttStore.getState().snapshot.projects.find(p=>p.id===project.id);if(!current)throw new Error('프로젝트가 더 이상 보이지 않습니다.');
    if(current.revision!==expectedRevision)throw new Error('다른 변경이 있습니다. 최신 프로젝트를 다시 열어 주세요.');
    return saveProject({...current,...patch});
  };
  const addTask=async(project:GanttProject,kind:GanttTask['kind']='task',parentId:string|null=null,start=localDate(),end=moveDate(start,2),afterId?:string)=>{
    const ticket=++navigationVersion.current;
    if(closeGuard.current&&!await closeGuard.current())return false;
    if(ticket!==navigationVersion.current)return false;
    const latest=useGanttStore.getState(),current=latest.snapshot.projects.find(p=>p.id===project.id);
    if(!current||!user||!canEditProject(latest.snapshot,user.id,current))throw new Error('프로젝트 편집 권한이 없습니다.');
    if(latest.pending||current.completed)throw new Error('지금은 작업을 추가할 수 없습니다.');
    const siblings=current.tasks.filter(t=>t.parentId===parentId).sort((a,b)=>a.sortOrder-b.sortOrder);
    const after=afterId?siblings.findIndex(t=>t.id===afterId):-1;
    if(afterId&&after<0)throw new Error('선택한 작업이 변경되었습니다. 추가 위치를 다시 선택해 주세요.');
    const task=newTask(kind,parentId,start,end);
    const firstGroup=kind!=='group'?siblings.findIndex(t=>t.kind==='group'):-1;
    siblings.splice(afterId?after+1:firstGroup>=0?firstGroup:siblings.length,0,task);
    const order=new Map(siblings.map((t,index)=>[t.id,index]));
    const tasks=[...current.tasks,task].map(t=>order.has(t.id)?{...t,sortOrder:order.get(t.id)!}:t);
    await saveProject({...current,tasks});
    if(ticket!==navigationVersion.current||useGanttStore.getState().actorId!==user.id)return true;
    if(closeGuard.current&&!await closeGuard.current())return true;
    if(ticket!==navigationVersion.current||useGanttStore.getState().actorId!==user.id)return true;
    const expanded=new Set([project.id]);let ancestor=parentId;
    while(ancestor&&!expanded.has(ancestor)){expanded.add(ancestor);ancestor=current.tasks.find(t=>t.id===ancestor)?.parentId||null;}
    setHidden(h=>h.filter(id=>id!==current.id));setCollapsed(c=>c.filter(id=>!expanded.has(id)));setWorker('');setSearch('');
    setSelectedProject(project.id);setSelected([task.id]);setInspecting(true);
  };
  const chooseProject=(projectId:string)=>afterDraft(()=>{setSelectedProject(projectId);setSelected([projectId]);setInspecting(false);});
  const select=(projectId:string,taskId:string|null,multiple=false)=>afterDraft(()=>{setSelectedProject(projectId);setSelected(prev=>multiple&&taskId&&selectedProject===projectId?(prev.includes(taskId)?prev.filter(id=>id!==taskId):[...prev.filter(id=>id!==projectId),taskId]):[taskId||projectId]);setInspecting(!multiple);});
  const treeSelect=(projectId:string,taskId:string|null)=>afterDraft(()=>{
    const project=useGanttStore.getState().snapshot.projects.find(p=>p.id===projectId);if(!project)return;
    const open=new Set([projectId]);let parent=project.tasks.find(t=>t.id===taskId)?.parentId;
    while(parent&&!open.has(parent)){open.add(parent);parent=project.tasks.find(t=>t.id===parent)?.parentId;}
    setHidden(ids=>ids.filter(id=>id!==projectId));setCollapsed(ids=>ids.filter(id=>!open.has(id)));setSelectedProject(projectId);setSelected([taskId||projectId]);setInspecting(true);
  });
  const relocate=async(source:GanttProject,task:GanttTask,target:GanttProject,targetTaskId:string|null,position:RelocationPosition)=>{
    const ticket=++navigationVersion.current;
    if(closeGuard.current&&!await closeGuard.current())return false;
    if(ticket!==navigationVersion.current)return false;
    const latest=useGanttStore.getState(),current=latest.snapshot.projects.find(p=>p.id===source.id),destination=latest.snapshot.projects.find(p=>p.id===target.id);
    if(!user||latest.pending||!current||!destination||!canEditProject(latest.snapshot,user.id,current)||!canEditProject(latest.snapshot,user.id,destination))throw new Error('이동할 두 프로젝트의 편집 권한을 확인해 주세요.');
    if(current.revision!==source.revision||destination.revision!==target.revision)throw new Error('다른 변경이 반영되었습니다. 최신 위치에서 다시 이동해 주세요.');
    // Canvas projects contain derived scene/draft progress. Only raw canonical entities may be saved.
    const moved=relocateTask(current,task.id,destination,targetTaskId,position,{clearCrossingPredecessors:true});
    if(current.id===destination.id&&JSON.stringify(moved.sourceProject)===JSON.stringify(current))return false;
    const expectedSpaces=[...new Set([current.spaceId,destination.spaceId])].map(spaceId=>({spaceId,expectedRevision:latest.snapshot.spaces.find(space=>space.id===spaceId)!.revision}));
    const viewers=new Set(latest.snapshot.spaces.flatMap(space=>[space.ownerId,...space.members.map(member=>member.userId)]));
    const addedViewers=current.id!==destination.id?[...viewers].filter(id=>canViewProject(latest.snapshot,id,destination)&&!canViewProject(latest.snapshot,id,current)):[];
    const warnings=[
      addedViewers.length?`이동하면 ${addedViewers.map(id=>names[id]||'추가 멤버').join(', ')}도 제목·메모·작업자·연결 정보를 볼 수 있습니다.`:'',
      moved.crossingPredecessorCount?`프로젝트 밖으로 이어진 선행 관계 ${moved.crossingPredecessorCount}개는 해제됩니다. 이동하는 항목 안의 선행 관계는 유지합니다.`:'',
    ].filter(Boolean);
    if(warnings.length&&!await ask(`‘${task.title}’을 ‘${destination.name}’으로 이동할까요? ${warnings.join(' ')} 실행 취소로 되돌릴 수 있습니다.`))return false;
    if(current.id===destination.id)await saveProject(moved.sourceProject);
    else await latest.execute({type:'saveProjectPair',projects:[{project:moved.sourceProject,expectedRevision:current.revision},{project:moved.targetProject,expectedRevision:destination.revision}],expectedSpaces});
    if(ticket!==navigationVersion.current||useGanttStore.getState().actorId!==user.id)return true;
    if(closeGuard.current&&!await closeGuard.current())return true;
    if(ticket!==navigationVersion.current||useGanttStore.getState().actorId!==user.id)return true;
    const saved=useGanttStore.getState().snapshot.projects.find(p=>p.id===destination.id);
    if(!saved||!saved.tasks.some(t=>t.id===task.id))return false;
    const expanded=new Set([saved.id]);let parent=saved.tasks.find(t=>t.id===task.id)?.parentId;
    while(parent&&!expanded.has(parent)){expanded.add(parent);parent=saved.tasks.find(t=>t.id===parent)?.parentId;}
    setCollapsed(ids=>ids.filter(id=>!expanded.has(id)));setHidden(ids=>ids.filter(id=>id!==saved.id));setSelectedProject(saved.id);setSelected([task.id]);setInspecting(true);
    return true;
  };
  const complete=async(project:GanttProject,t:GanttTask|null)=>{
    if(!editable(project)||useGanttStore.getState().pending)throw new Error('지금은 완료 상태를 변경할 수 없습니다.');
    if(!t){
      if(project.completed)await saveProject({...project,completed:false});
      else {if(!await ask(`‘${project.name}’ 프로젝트와 하위 일정을 모두 완료할까요? 완료한 항목은 차트에 남습니다. 씬에서 계산하던 진행률은 직접 관리로 바뀝니다. 실행 취소로 되돌릴 수 있습니다.`))return;await saveProject({...completeTasks(project,project.tasks.map(t=>t.id),true),completed:true});}
    }else {
      const displayedProject=effectiveProjects.find(p=>p.id===project.id)||project;
      const displayed=displayedProject.tasks.find(item=>item.id===t.id)||t;
      const isDone=isTaskComplete(displayedProject,displayed);
      if(t.kind==='group'&&project.tasks.some(item=>item.parentId===t.id)&&!await ask(`‘${t.title}’의 하위 작업도 모두 ${isDone?'진행 중으로 다시 열까요? 하위 작업의 진행률은 0%로 바뀝니다.':'완료할까요? 완료한 작업은 차트에 남습니다.'} 실행 취소로 되돌릴 수 있습니다.`))return;
      await saveProject(completeTasks(project,[t.id],!isDone));
    }
    setContext(null);
  };
  const deleteItem=async(project:GanttProject,target:GanttTask|null)=>{
    if(!editable(project)||useGanttStore.getState().pending)throw new Error('지금은 삭제할 수 없습니다.');
    const ids=target?descendantIds(project,target.id):new Set(project.tasks.map(t=>t.id));
    const linked=project.tasks.filter(t=>ids.has(t.id)&&t.kind!=='group'&&t.calendarId).length;
    setContext(null);
    if(!await ask(`‘${target?.title||project.name}’${target?.kind==='group'?' 그룹을':target?' 작업을':' 프로젝트를'} 삭제할까요? ${ids.size}개 항목${linked?`과 연결 캘린더 일정 ${linked}개`:''}이 제거됩니다. 완료 기록을 남기려면 삭제 대신 완료를 선택해 주세요.`))return;
    if(target)await saveProject({...project,tasks:project.tasks.filter(t=>!ids.has(t.id)).map(t=>({...t,predecessorId:t.predecessorId&&ids.has(t.predecessorId)?null:t.predecessorId}))});
    else await state.execute({type:'deleteProject',projectId:project.id,expectedRevision:project.revision});
    if(selectedProject===project.id&&(!target||selected.some(id=>ids.has(id)))){setSelected([]);setInspecting(false);}
  };
  const deleteSpace=async(space:GanttSpace)=>{
    const latest=useGanttStore.getState(),current=latest.snapshot.spaces.find(s=>s.id===space.id);
    if(!current||!user||!canManageSpace(current,user.id))throw new Error('폴더 삭제 권한이 없습니다.');
    if(latest.snapshot.projects.some(p=>p.spaceId===space.id))throw new Error('안의 프로젝트를 먼저 삭제한 뒤 폴더를 삭제해 주세요.');
    await latest.execute({type:'deleteSpace',spaceId:space.id,expectedRevision:space.revision,requireEmpty:true});
    setSpaceDialog(undefined);
  };
  const move=(direction:'up'|'down'|'indent'|'outdent')=>{if(!p||!task)return;void run(async()=>{const siblings=p.tasks.filter(t=>t.parentId===task.parentId).sort((a,b)=>a.sortOrder-b.sortOrder),index=siblings.findIndex(t=>t.id===task.id);if(direction==='indent'){const before=siblings[index-1];if(!before||before.kind!=='group')throw new Error('바로 위에 그룹이 있어야 들여쓸 수 있습니다.');await saveProject(updateTask(p,task.id,{parentId:before.id}));}else if(direction==='outdent'){const parent=p.tasks.find(t=>t.id===task.parentId);if(parent)await saveProject(updateTask(p,task.id,{parentId:parent.parentId,sortOrder:parent.sortOrder+0.5}));}else{const other=siblings[index+(direction==='up'?-1:1)];if(!other)return;const tasks=p.tasks.map(t=>t.id===task.id?{...t,sortOrder:other.sortOrder}:t.id===other.id?{...t,sortOrder:task.sortOrder}:t);await saveProject({...p,tasks});}});};
  const closeContext=useCallback(()=>setContext(null),[]);
  useEffect(()=>{const keyboard=(e:KeyboardEvent)=>{if(e.defaultPrevented||(e.target as HTMLElement).closest('input,textarea,select,dialog,[role=combobox],[role=listbox],[role=tooltip]'))return;if(e.key==='Escape'){setContext(null);afterDraft(()=>{setInspecting(false);setSelected([]);});}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();void run(()=>e.shiftKey?state.redo():state.undo());}};window.addEventListener('keydown',keyboard);return()=>window.removeEventListener('keydown',keyboard);},[state.undo,state.redo,inspecting]);
  const targetProject=p||visibleProjects.find(project=>!project.completed&&editable(project))||snapshot.projects.find(project=>!project.completed&&editable(project));
  const addFromToolbar=(kind:GanttTask['kind'])=>{
    if(!targetProject||!editable(targetProject)||(pending&&!closeGuard.current)||done||targetProject.completed)return;
    const anchor=targetProject.tasks.find(t=>t.id===selected[0]);
    const insideGroup=anchor?.kind==='group'&&kind!=='group';
    const parentId=insideGroup?anchor.id:anchor?.parentId||null;
    const start=taskBounds(targetProject,anchor?.id)?.startDate||anchor?.startDate||localDate();
    return addTask(targetProject,kind,parentId,start,moveDate(start,2),insideGroup?undefined:anchor?.id);
  };
  const activeSpace=p?snapshot.spaces.find(s=>s.id===p.spaceId):undefined;
  return <section className={`gantt ${navOpen?'':'nav-hidden'}`}>
    {navOpen&&<nav className="gantt-nav" aria-label="간트 폴더와 프로젝트"><div className="gantt-nav-heading"><strong>폴더와 프로젝트</strong><button title="목록 접기" onClick={()=>setNavOpen(false)}><X size={14}/></button></div><input className="gantt-search" aria-label="프로젝트·작업 검색" placeholder="프로젝트·작업 검색" value={search} onChange={e=>setSearch(e.target.value)}/><div className="gantt-nav-actions"><button onClick={()=>setHidden([])}>전체 표시</button><button onClick={()=>setHidden(snapshot.projects.map(p=>p.id))}>모두 끄기</button>{prior&&<button onClick={()=>{setHidden(prior);setPrior(null);}}>이전 선택</button>}</div>
      <GanttTree spaces={snapshot.spaces} projects={effectiveProjects} userId={user?.id||''} users={users} selectedProject={selectedProject} selected={selected} closedSpaces={closedSpaces} collapsed={treeCollapsed} hidden={hidden} filter={statusFilter} search={search} worker={worker} onToggleFolder={id=>setClosedSpaces(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id])} onToggleBranch={id=>setTreeCollapsed(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id])} onToggleVisibility={id=>setHidden(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id])} onSelect={treeSelect} onFolderSettings={space=>afterDraft(()=>setSpaceDialog(space))} onMenu={(project,task,x,y)=>setContext({project:snapshot.projects.find(p=>p.id===project.id)!,task:task?snapshot.projects.find(p=>p.id===project.id)!.tasks.find(t=>t.id===task.id)!:null,x,y})}/>
      <details className="gantt-hierarchy-help"><summary>폴더 · 프로젝트 · 그룹이란?</summary><p>폴더는 프로젝트를 정리하고 공유하는 곳입니다.</p><p>프로젝트 안에 작업을 만들고, 필요할 때 그룹으로 묶습니다. 그룹 없이 작업만 만들어도 됩니다.</p><p>폴더 → 프로젝트 → 그룹(선택) → 작업</p></details><button className="gantt-nav-add" onClick={()=>setSpaceDialog(null)}><FolderPlus size={14}/> 폴더 만들기</button><button className="gantt-nav-add" disabled={!snapshot.spaces.some(s=>s.ownerId===user?.id||s.members.some(m=>m.userId===user?.id&&m.canEdit))} onClick={()=>setProjectDialog(true)}><Plus size={14}/> 프로젝트 만들기</button>
    </nav>}
    <main className="gantt-main"><div className="gantt-heading"><div>{!navOpen&&<button onClick={()=>setNavOpen(true)}><ChevronRight size={16}/> 프로젝트</button>}<h1>타임라인</h1></div><div><span className="gantt-save-indicator" role="status" aria-live="polite">{pending?'저장 중…':''}</span><button disabled={!state.canUndo||pending} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소" onClick={()=>void run(()=>state.undo())}><Undo2 size={15}/></button><button disabled={!state.canRedo||pending} title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행" onClick={()=>void run(()=>state.redo())}><Redo2 size={15}/></button></div></div>
      <div className="gantt-toolbar"><div>{(['all','active','completed'] as const).map(filter=><button key={filter} aria-pressed={statusFilter===filter} onClick={()=>setStatusFilter(filter)}>{filter==='all'?'전체':filter==='active'?'진행 중':'완료'}</button>)}<GanttSelect label="작업을 추가할 프로젝트" value={targetProject?.id||''} disabled={pending} onChange={chooseProject} options={[...(!targetProject?[{value:'',label:'프로젝트 선택'}]:[]),...snapshot.projects.filter(p=>!p.completed||p.id===targetProject?.id).map(p=>({value:p.id,label:p.name+(!editable(p)?' · 보기 전용':p.completed?' · 완료':'')}))]}/>{(['task','group','milestone'] as const).map(kind=><button className={kind==='task'?'primary':''} key={kind} disabled={!targetProject||!editable(targetProject)||targetProject.completed||(pending&&!closeGuard.current)||done} onClick={()=>void run(async()=>{await addFromToolbar(kind);})}>{kind==='task'?'+ 작업':kind==='group'?'+ 그룹':'◇ 마일스톤'}</button>)}</div><label>작업자 <GanttSelect label="작업자" value={worker} onChange={setWorker} options={[{value:'',label:'전체'},...users.map(u=>({value:u.id,label:u.name}))]}/></label></div>
      {selected.length>1&&<div className="gantt-selection-bar"><span>{selected.length}개 선택 · 같은 프로젝트</span><button disabled={pending||!p||!editable(p)} onClick={()=>void run(async()=>{if(!p||!editable(p))throw new Error('프로젝트 편집 권한이 없습니다.');await saveProject(completeTasks(p,selected,true));})}>선택 일정 완료</button><button disabled={pending||!p||!editable(p)} onClick={()=>void run(async()=>{if(!p||!editable(p))throw new Error('프로젝트 편집 권한이 없습니다.');if(await ask('선택한 작업과 하위 작업을 진행 중으로 다시 열까요? 진행률은 0%로 바뀝니다.'))await saveProject(completeTasks(p,selected,false));})}>선택 일정 다시 열기</button><button onClick={()=>setSelected([])}>선택 해제</button></div>}
      {(error||notice)&&<div className="gantt-error" role="alert"><span>{error||notice}</span>{error?<button onClick={()=>void state.refresh()}>다시 불러오기</button>:<button aria-label="오류 안내 닫기" onClick={()=>setNotice('')}><X size={14}/></button>}</div>}
      {loading&&!snapshot.spaces.length?<div className="gantt-empty">프로젝트를 불러오고 있습니다.</div>:<GanttCanvas projects={visibleProjects} selected={selected} statusFilter={statusFilter} worker={worker} collapsed={collapsed} names={names} onRelocate={(source,task,target,targetTaskId,position)=>void run(()=>relocate(source,task,target,targetTaskId,position))} canEdit={project=>!pending&&editable(project)} onCollapse={id=>setCollapsed(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id])} onSelect={select} onPatch={(p,t,patch)=>void run(()=>patchTask(p,t,patch))} onAdd={(p,parent,start,end)=>void run(()=>addTask(p,'task',parent,start,end))} onMenu={(project,task,x,y)=>{setContext({project:snapshot.projects.find(p=>p.id===project.id)!,task:task?snapshot.projects.find(p=>p.id===project.id)!.tasks.find(t=>t.id===task.id)!:null,x,y});}}/>}
    </main>
    {inspecting&&p&&<GanttInspector project={p} task={task} users={users} calendars={calendars} episodes={episodes} canEdit={editable(p)&&(!task?.calendarId||!!calendars.find(c=>c.id===task.calendarId)?.canEdit)} canManage={p.ownerId===user?.id||activeSpace?.ownerId===user?.id} memberOptions={users.filter(u=>u.id===activeSpace?.ownerId||activeSpace?.members.some(m=>m.userId===u.id)).map(u=>({...u,canEdit:u.id===activeSpace?.ownerId||!!activeSpace?.members.find(m=>m.userId===u.id)?.canEdit}))} pending={pending} onSaveTask={(patch,revision)=>task?patchTask(p,task,patch,revision):Promise.resolve()} onSaveProject={(patch,revision)=>patchProject(p,patch,revision)} onDraftProgress={previewProgress} onRegisterCloseGuard={registerCloseGuard} onClose={()=>setInspecting(false)} onComplete={()=>void run(()=>complete(p,task))} onDelete={()=>void run(()=>deleteItem(p,task))} completed={task?isTaskComplete(effectiveProjects.find(item=>item.id===p.id)||p,effectiveProjects.find(item=>item.id===p.id)?.tasks.find(item=>item.id===task.id)||task):p.completed} folderName={activeSpace?.name} displayProgress={task?taskProgress(effectiveProjects.find(item=>item.id===p.id)||p,effectiveProjects.find(item=>item.id===p.id)?.tasks.find(item=>item.id===task.id)||task):undefined} canAddChild={!done&&!p.completed} onAddChild={()=>void run(async()=>{await addFromToolbar('task');})} onMove={move}/>}
    {spaceDialog!==undefined&&user&&<GanttSpaceDialog space={spaceDialog} actorId={user.id} users={users} calendars={calendars} onClose={()=>setSpaceDialog(undefined)} projectCount={snapshot.projects.filter(p=>p.spaceId===spaceDialog?.id).length} onDelete={spaceDialog?()=>deleteSpace(spaceDialog):undefined} onSave={async space=>{await state.execute({type:'saveSpace',space,expectedRevision:spaceDialog?.revision??null});}}/>}
    {projectDialog&&user&&<GanttModal title="새 프로젝트" onClose={()=>setProjectDialog(false)}><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),name=String(f.get('name')).trim(),spaceId=String(f.get('space'));void run(async()=>{const p:GanttProject={id:crypto.randomUUID(),spaceId,ownerId:user.id,name,memo:'',color:'#A29BFE',completed:false,revision:1,memberIds:null,editorIds:null,linkedEpisode:null,tasks:[]};await saveProject(p,true);setProjectDialog(false);select(p.id,null);});}}><label className="gantt-field">프로젝트 이름<input autoFocus name="name" required maxLength={180}/></label><label className="gantt-field">폴더<GanttSelect name="space" label="폴더" options={snapshot.spaces.filter(s=>s.ownerId===user.id||s.members.some(m=>m.userId===user.id&&m.canEdit)).map(s=>({value:s.id,label:s.name}))}/></label><div className="gantt-dialog-actions"><button type="button" onClick={()=>setProjectDialog(false)}>취소</button><button disabled={pending} className="primary">만들기</button></div></form></GanttModal>}
    {context&&<GanttContextMenu key={`${context.project.id}:${context.task?.id}`} target={context} canEdit={!pending&&editable(context.project)} completed={context.task?isTaskComplete(effectiveProjects.find(p=>p.id===context.project.id)||context.project,effectiveProjects.find(p=>p.id===context.project.id)?.tasks.find(t=>t.id===context.task?.id)||context.task):context.project.completed} onDelete={()=>void run(()=>deleteItem(context.project,context.task))} onClose={closeContext} onDetail={()=>{select(context.project.id,context.task?.id||null);setContext(null);}} onSave={async patch=>{if(context.task)await patchTask(context.project,context.task,patch);else await saveProject({...context.project,...patch,color:patch.color||context.project.color});}} onComplete={()=>void run(()=>complete(context.project,context.task))}/>}
    {confirm&&<GanttModal title="변경 확인" onClose={()=>respond(false)}><p>{confirm}</p><div className="gantt-dialog-actions"><button onClick={()=>respond(false)}>취소</button><button className="primary" onClick={()=>respond(true)}>확인</button></div></GanttModal>}
  </section>;
}
