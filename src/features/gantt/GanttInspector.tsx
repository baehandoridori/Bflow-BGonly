import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { Episode } from '@/types';
import type { BflowCalendar } from '@/types/calendar';
import { descendantIds, durationLabel, taskBounds, taskProgress, validateProject } from './domain';
import type { GanttProject, GanttSceneLink, GanttTask } from './types';
import { GanttSelect } from './GanttSelect';
import { InspectorAutosave, type InspectorSource } from './inspectorAutosave';
import './inspector.css';

type Person = { id: string; name: string; canEdit?: boolean };
export interface GanttInspectorProps {
  project: GanttProject;
  task: GanttTask | null;
  users: Array<{ id: string; name: string }>;
  calendars: BflowCalendar[];
  episodes: Episode[];
  canEdit: boolean;
  canManage?: boolean;
  memberOptions?: Person[];
  pending: boolean;
  onSaveTask: (patch: Partial<GanttTask>, expectedRevision?: number) => Promise<GanttProject | void>;
  onSaveProject: (patch: Partial<GanttProject>, expectedRevision?: number) => Promise<GanttProject | void>;
  onDraftProgress?: (projectId: string, taskId: string, progress: number | null) => void;
  onRegisterCloseGuard?: (guard: (() => Promise<boolean>) | null) => void;
  onClose: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onAddChild: () => void;
  canAddChild?: boolean;
  completed?: boolean;
  displayProgress?: number;
  folderName?: string;
  onMove: (direction: 'up' | 'down' | 'indent' | 'outdent') => void;
}

const COLORS = [
  ['#6C5CE7', '보라'], ['#A29BFE', '연보라'], ['#74B9FF', '파랑'], ['#65BCA7', '초록'],
  ['#E6BB68', '노랑'], ['#DE879A', '분홍'], ['#E88C70', '주황'], ['#A0A6B5', '회색'],
] as const;
const TASK_FIELDS = ['title', 'memo', 'kind', 'parentId', 'startDate', 'endDate', 'allDay', 'startTime', 'endTime', 'mode', 'predecessorId', 'progress', 'progressMode', 'sceneLinks', 'workers', 'attendees', 'color', 'calendarId'] as const;
const PROJECT_FIELDS = ['name', 'memo', 'color', 'linkedEpisode', 'memberIds', 'editorIds'] as const;
const sceneKey = (scene: GanttSceneLink) => JSON.stringify([scene.episodeNumber, scene.department, scene.sheetName, scene.sceneId]);
const toggle = (values: string[], id: string, checked: boolean) => checked ? [...new Set([...values, id])] : values.filter(value => value !== id);

function ColorPicker({ color, inherited, onChange, disabled }: { color: string | null; inherited?: boolean; onChange: (color: string | null) => void; disabled: boolean }) {
  return <div className="gantt-inspector-colors" role="group" aria-label="막대 색상">
    {COLORS.map(([value, name]) => <button key={value} type="button" className="gantt-inspector-swatch" title={name} aria-label={`${name} 색상`} aria-pressed={color?.toLowerCase() === value.toLowerCase()} disabled={disabled} onClick={() => onChange(value)} style={{ backgroundColor: value }} />)}
    {inherited && <button type="button" className="gantt-button gantt-inspector-inherit" aria-pressed={color === null} disabled={disabled} onClick={() => onChange(null)}>상위 색상</button>}
  </div>;
}

function PeoplePicker({ title, selected, people, disabled, onChange, pinnedId }: { title: string; selected: string[]; people: Person[]; disabled: boolean; onChange: (ids: string[]) => void; pinnedId?: string }) {
  const listed = new Set(people.map(person => person.id));
  const choices = [...people, ...selected.filter(id => !listed.has(id)).map(id => ({ id, name: `현재 멤버 · ${id.slice(0, 8)}` }))];
  return <details className="gantt-inspector-people">
    <summary><span>{title}</span><span className="gantt-inspector-summary">{selected.length ? `${selected.length}명` : '없음'} <ChevronDown size={12} /></span></summary>
    <fieldset disabled={disabled} className="gantt-inspector-person-list"><legend className="gantt-inspector-sr">{title} 선택</legend>
      {choices.length ? choices.map(person => <label className="gantt-inspector-check" key={person.id}>
        <input type="checkbox" checked={selected.includes(person.id) || person.id === pinnedId} disabled={person.id === pinnedId} onChange={event => onChange(toggle(selected, person.id, event.target.checked))} />
        <span>{person.name}{person.id === pinnedId ? ' · 소유자' : ''}</span>
      </label>) : <p className="gantt-inspector-hint">선택할 멤버가 없습니다.</p>}
    </fieldset>
  </details>;
}

export function GanttInspector(props: GanttInspectorProps) {
  const { project, task, users, calendars, episodes, canEdit, canManage = false, memberOptions, pending, onSaveTask, onSaveProject, onClose, onComplete, onDelete, onAddChild, onMove } = props;
  const [, redraw] = useState(0);
  const previewCallback = useRef(props.onDraftProgress);previewCallback.current = props.onDraftProgress;
  const queueRef = useRef<InspectorAutosave | null>(null);
  if (!queueRef.current) queueRef.current = new InspectorAutosave(() => redraw(version => version + 1), progress => {
    const [projectId, taskId] = queueRef.current?.snapshot().key?.split(':') || [];
    if (projectId && taskId && taskId !== 'project') previewCallback.current?.(projectId, taskId, progress);
  });
  const queue = queueRef.current;
  const [audienceAccepted, setAudienceAccepted] = useState(false), accepted = useRef('');
  const [sceneEpisode, setSceneEpisode] = useState(String(project.linkedEpisode ?? task?.sceneLinks[0]?.episodeNumber ?? episodes[0]?.episodeNumber ?? ''));
  const [sceneSearch, setSceneSearch] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const key = `${project.id}:${task?.id || 'project'}`;
  const saved = queue.snapshot();
  const taskDraft = task ? (saved.key === key ? saved.values : task) as unknown as GanttTask : null;
  const projectDraft = (saved.key === key && !task ? saved.values : project) as unknown as GanttProject;
  const dirty = saved.key === key && saved.dirty, saving = saved.key === key && saved.status === 'saving';
  const externalChange = saved.key === key && saved.status === 'conflict';
  const disabled = !canEdit;
  const names = useMemo(() => new Map(users.map(person => [person.id, person.name])), [users]);
  const people: Person[] = memberOptions || users;
  const excluded = task ? descendantIds(project, task.id) : new Set<string>();
  const parentChoices = project.tasks.filter(candidate => candidate.kind === 'group' && !excluded.has(candidate.id));
  const hasChildren = !!task && project.tasks.some(candidate => candidate.parentId === task.id);
  const predecessorChoices = project.tasks.filter(candidate => {
    if (!task || excluded.has(candidate.id)) return false;
    const seen = new Set<string>();let parent = taskDraft?.parentId;
    while (parent && !seen.has(parent)) {if (parent === candidate.id) return false;seen.add(parent);parent = project.tasks.find(row => row.id === parent)?.parentId;}
    return true;
  });
  const targetCalendar = calendars.find(calendar => calendar.id === taskDraft?.calendarId);
  const calendarChanged = !!taskDraft?.calendarId && taskDraft.calendarId !== task?.calendarId;
  const audience = targetCalendar ? targetCalendar.visibility === 'team' ? '전체 팀원' : [...new Set([targetCalendar.ownerId, ...targetCalendar.members.map(member => member.userId)])].map(id => names.get(id) || `멤버 ${id.slice(0, 8)}`).join(', ') : '';
  const audienceKey = JSON.stringify([taskDraft?.calendarId, audience, targetCalendar?.canEdit]);
  const group = taskDraft?.kind === 'group', milestone = taskDraft?.kind === 'milestone';
  const bounds = task ? taskBounds(project, task.id) : taskBounds(project);
  const fields = task ? TASK_FIELDS : PROJECT_FIELDS.filter(field => canManage || (field !== 'memberIds' && field !== 'editorIds'));
  const source = (canonical: GanttProject): InspectorSource => {
    const target = task ? canonical.tasks.find(row => row.id === task.id) : canonical;
    if (!target) throw new Error('이 작업이 삭제되었거나 접근 권한이 변경되었습니다.');
    return { key, revision: canonical.revision, values: structuredClone(target) as unknown as Record<string, unknown> };
  };
  useLayoutEffect(() => {
    queue.receive(source(project), {
      fields,
      prepare(values) {
        if (!canEdit) return { values, error: '현재 항목을 편집할 권한이 없습니다.' };
        try {
          if (task) {
            const next = { ...values, title: String(values.title || '').trim() } as unknown as GanttTask;
            if (!next.title) throw new Error('제목을 입력하면 자동으로 저장합니다.');
            if (next.allDay) {next.startTime = '';next.endTime = '';}
            if (next.kind === 'milestone') {next.endDate = next.startDate;next.endTime = next.startTime;}
            if (next.calendarId && next.calendarId !== task.calendarId) {
              const calendar = calendars.find(item => item.id === next.calendarId);
              if (!calendar?.canEdit) throw new Error('편집할 수 있는 캘린더를 선택해 주세요.');
              if (accepted.current !== audienceKey) throw new Error('아래 캘린더 연결에서 공유 대상을 확인해 주세요.');
            }
            if (next.kind !== 'group' && next.progressMode === 'scenes' && !next.sceneLinks.length) throw new Error('연결할 씬을 하나 이상 선택해 주세요.');
            validateProject({ ...project, tasks: project.tasks.map(row => row.id === task.id ? next : row) });
            return { values: next as unknown as Record<string, unknown> };
          }
          const next = { ...project, ...values, name: String(values.name || '').trim() } as GanttProject;
          if (!next.name) throw new Error('프로젝트 이름을 입력하면 자동으로 저장합니다.');
          validateProject(next);return { values: next as unknown as Record<string, unknown> };
        } catch (cause) {return { values, error: cause instanceof Error ? cause.message : '입력 내용을 확인해 주세요.' };}
      },
      async save(patch, revision) {
        const canonical = task ? await onSaveTask(patch as Partial<GanttTask>, revision) : await onSaveProject(patch as Partial<GanttProject>, revision);
        if (canonical) return source(canonical);
        // Compatibility for callers that do not yet return the canonical entity.
        return { key, revision: revision + 1, values: { ...(task || project), ...patch } as unknown as Record<string, unknown> };
      },
    });
    queue.setPaused(pending && !queue.isSaving());
  });
  useEffect(() => {accepted.current = '';setAudienceAccepted(false);}, [key, audienceKey]);
  useEffect(() => {setSceneEpisode(String(project.linkedEpisode ?? task?.sceneLinks[0]?.episodeNumber ?? episodes[0]?.episodeNumber ?? ''));setSceneSearch('');}, [key]);
  useLayoutEffect(() => {if (formRef.current) formRef.current.scrollTop = 0;}, [key]);
  useEffect(() => {props.onRegisterCloseGuard?.(() => queue.flush());return () => props.onRegisterCloseGuard?.(null);}, [queue, props.onRegisterCloseGuard]);
  useEffect(() => () => queue.dispose(), [queue]);
  const changeTask = (patch: Partial<GanttTask>, immediate = true) => {
    if (disabled) return;
    if ('calendarId' in patch) {accepted.current = '';setAudienceAccepted(false);}
    queue.change(patch as Record<string, unknown>, immediate);
  };
  const changeProject = (patch: Partial<GanttProject>, immediate = true) => {if (!disabled) queue.change(patch as Record<string, unknown>, immediate);};
  const flush = () => {void queue.flush();};
  const close = async () => {if (await queue.flush()) onClose();};
  const scenes = useMemo(() => episodes.filter(episode => String(episode.episodeNumber) === sceneEpisode).flatMap(episode => episode.parts.flatMap(part => part.scenes.map(scene => ({
    link: { episodeNumber: episode.episodeNumber, sheetName: part.sheetName, department: part.department, sceneId: scene.sceneId } as GanttSceneLink,
    title: `${part.department === 'bg' ? 'BG' : '액팅'} · ${part.partId} · ${scene.sceneId}`, worker: scene.assignee,
  })))).filter(scene => !sceneSearch.trim() || `${scene.title} ${scene.worker}`.toLowerCase().includes(sceneSearch.trim().toLowerCase())), [episodes, sceneEpisode, sceneSearch]);
  const progress = Math.max(0, Math.min(100, group ? props.displayProgress ?? taskProgress(project, taskDraft!) : taskDraft?.progressMode === 'scenes' ? props.displayProgress ?? taskDraft.progress : Number(taskDraft?.progress) || 0));
  const actionDisabled = disabled || dirty || saving || pending || externalChange;
  const stateText = !canEdit ? '보기 전용' : saved.status === 'saving' ? '저장 중…' : saved.status === 'saved' ? '저장 완료' : saved.status === 'error' ? '저장 실패 · 입력은 보관했습니다' : saved.status === 'conflict' ? '다른 변경 확인 필요' : saved.status === 'blocked' ? '입력 확인 후 자동 저장' : dirty ? pending ? '앞선 변경 저장 후 자동 저장' : '자동 저장 대기…' : '변경하면 자동 저장합니다';
  const select = (label: string, value: string, options: Array<{value: string;label: string;disabled?: boolean}>, onChange: (value: string) => void, locked = false) => <GanttSelect label={label} value={value} options={options} onChange={onChange} disabled={disabled || locked} portalOwner="gantt-inspector" />;
  const location = [props.folderName, task ? project.name : undefined, task?.parentId ? project.tasks.find(row => row.id === task.parentId)?.title : undefined].filter(Boolean).join(' › ');

  return <aside className="gantt-inspector" aria-label={task ? '작업 상세' : '프로젝트 상세'}>
    <div className="gantt-inspector-sticky">
      <div className="gantt-inspector-header"><div>{location&&<span className="gantt-inspector-eyebrow" title={location}>{location}</span>}<h2>{task ? group?'그룹 상세':milestone?'마일스톤 상세':'작업 상세' : '프로젝트 설정'}</h2></div><button className="gantt-button" type="button" aria-label="상세 닫기" onClick={()=>void close()}><X size={17}/></button></div>
      <label className="gantt-field gantt-inspector-title-field"><span className="gantt-inspector-sr">{taskDraft ? '제목' : '프로젝트 이름'}</span><textarea className="gantt-inspector-title" name={taskDraft ? 'title' : 'name'} value={taskDraft ? taskDraft.title : projectDraft.name} rows={1} disabled={disabled} maxLength={200} required onChange={event=>{const value=event.target.value.replace(/[\r\n]+/g,' ');if(taskDraft)changeTask({title:value},false);else changeProject({name:value},false);}} onBlur={flush} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();flush();}}}/></label>
      <div className="gantt-autosave-status" data-status={saved.status} role="status" aria-live="polite"><span>{saved.status==='saved'&&<Check size={12}/>} {stateText}</span>{saved.status==='error'&&<button type="button" className="gantt-button" onClick={()=>void queue.retry()}>다시 시도</button>}{externalChange&&<button type="button" className="gantt-button" disabled={saving} onClick={()=>queue.reload()}><RotateCcw size={12}/>최신 내용 불러오기</button>}</div>
      {saved.error&&<p className="gantt-inspector-error" role="alert">{saved.error}</p>}
    </div>
    <form ref={formRef} onSubmit={event=>{event.preventDefault();flush();}} className="gantt-inspector-form">
      <fieldset disabled={disabled} className="gantt-inspector-fields">
        {taskDraft ? <>
          <section className="gantt-progress-editor" style={{'--task-progress':`${progress}%`,'--task-progress-glow':progress/100} as CSSProperties}>
            <div className="gantt-progress-heading"><h3>진행률</h3>{!group&&taskDraft.progressMode==='manual'?<label><input type="number" aria-label="진행률" min={0} max={100} step={1} value={taskDraft.progress} onChange={event=>changeTask({progress:(event.target.value===''?'':Number(event.target.value)) as unknown as number},false)} onBlur={flush}/><span>%</span></label>:<strong>{progress}%</strong>}</div>
            <div className="gantt-progress-meter" aria-hidden="true"><span/></div>
            {!group&&taskDraft.progressMode==='manual'&&<input className="gantt-progress-slider" type="range" aria-label="진행률 슬라이더" min={0} max={100} step={1} value={progress} onChange={event=>changeTask({progress:Number(event.target.value)},false)} onPointerUp={flush} onKeyUp={flush} onBlur={flush}/>}
            <p className="gantt-inspector-hint">{group?'하위 작업과 빈 그룹의 진행률을 종합합니다.':taskDraft.progressMode==='scenes'?'연결한 씬의 작업 현황을 따라갑니다.':'숫자를 입력하거나 슬라이더를 움직이세요.'}</p>
          </section>
          <section className="gantt-inspector-section gantt-primary-dates"><h3>기간</h3>{group?<p className="gantt-inspector-hint">{bounds?`${bounds.startDate} — ${bounds.endDate} · ${durationLabel({...bounds,kind:'group'})}`:'하위 작업을 추가하면 기간이 표시됩니다.'}</p>:<>
            <div className="gantt-pair"><label className="gantt-field">시작일<input type="date" value={taskDraft.startDate} required readOnly={taskDraft.mode==='auto'&&!!taskDraft.predecessorId} onChange={event=>changeTask({startDate:event.target.value,...(milestone?{endDate:event.target.value}:{})},false)} onBlur={flush}/></label><label className="gantt-field">종료일<input type="date" value={taskDraft.endDate} required disabled={milestone} readOnly={taskDraft.mode==='auto'&&!!taskDraft.predecessorId} onChange={event=>changeTask({endDate:event.target.value},false)} onBlur={flush}/></label></div>
            <label className="gantt-inspector-check"><input type="checkbox" checked={taskDraft.allDay} onChange={event=>changeTask(event.target.checked?{allDay:true,startTime:'',endTime:''}:{allDay:false,startTime:taskDraft.startTime||'10:00',endTime:taskDraft.endTime||(milestone?'10:00':'11:00')})}/>하루 종일</label>
            {!taskDraft.allDay&&<div className="gantt-pair"><label className="gantt-field">시작 시간<input type="time" value={taskDraft.startTime} required readOnly={taskDraft.mode==='auto'&&!!taskDraft.predecessorId} onChange={event=>changeTask({startTime:event.target.value,...(milestone?{endTime:event.target.value}:{})},false)} onBlur={flush}/></label><label className="gantt-field">종료 시간<input type="time" value={taskDraft.endTime} required disabled={milestone} readOnly={taskDraft.mode==='auto'&&!!taskDraft.predecessorId} onChange={event=>changeTask({endTime:event.target.value},false)} onBlur={flush}/></label></div>}
          </>}</section>
          <PeoplePicker title="작업자" selected={taskDraft.workers} people={users} disabled={disabled} onChange={workers=>changeTask({workers})}/>
          <details className="gantt-inspector-fold"><summary>메모 · 참석자 · 색상</summary><div className="gantt-inspector-fold-content"><label className="gantt-field">메모<textarea value={taskDraft.memo} maxLength={20000} rows={3} onChange={event=>changeTask({memo:event.target.value},false)} onBlur={flush} placeholder="작업 내용이나 참고 사항"/></label><PeoplePicker title="참석자" selected={taskDraft.attendees} people={users} disabled={disabled} onChange={attendees=>changeTask({attendees})}/><ColorPicker color={taskDraft.color} inherited disabled={disabled} onChange={color=>changeTask({color})}/></div></details>
          <details className="gantt-inspector-fold"><summary>종류와 상위 그룹</summary><div className="gantt-inspector-fold-content"><label className="gantt-field">종류{select('종류',taskDraft.kind,[{value:'task',label:'작업',disabled:hasChildren},{value:'group',label:'그룹'},{value:'milestone',label:'마일스톤',disabled:hasChildren}],value=>changeTask({kind:value as GanttTask['kind']}))}</label><label className="gantt-field">상위 그룹{select('상위 그룹',taskDraft.parentId||'',[{value:'',label:'없음'},...parentChoices.map(parent=>({value:parent.id,label:parent.title}))],value=>changeTask({parentId:value||null}))}</label>{hasChildren&&<p className="gantt-inspector-hint">하위 작업이 있는 그룹은 종류를 바꿀 수 없습니다.</p>}</div></details>
          <details className="gantt-inspector-fold"><summary>선행 작업과 자동 일정</summary><div className="gantt-inspector-fold-content"><label className="gantt-field">일정 계산{select('일정 계산',taskDraft.mode,[{value:'manual',label:'수동 · 날짜 유지'},{value:'auto',label:'자동 · 선행 작업 따라가기'}],value=>changeTask({mode:value as GanttTask['mode']}))}</label><label className="gantt-field">선행 작업{select('선행 작업',taskDraft.predecessorId||'',[{value:'',label:'없음'},...predecessorChoices.map(previous=>({value:previous.id,label:previous.title}))],value=>changeTask({predecessorId:value||null}))}</label>{taskDraft.mode==='auto'&&taskDraft.predecessorId&&<p className="gantt-inspector-hint">선행 작업이 끝나면 시작합니다. 날짜를 직접 지정하려면 수동으로 바꾸세요.</p>}</div></details>
          <details className="gantt-inspector-fold" open={taskDraft.progressMode==='scenes'?true:undefined}><summary>씬 연결 · 진행률 계산</summary><div className="gantt-inspector-fold-content">
            {!group&&<label className="gantt-field">진행률 계산 방식{select('진행률 계산 방식',taskDraft.progressMode,[{value:'manual',label:'직접 입력'},{value:'scenes',label:'연결된 씬에서 자동 계산'}],value=>changeTask({progressMode:value as GanttTask['progressMode']}))}</label>}
            <label className="gantt-field">에피소드{select('에피소드',sceneEpisode,[{value:'',label:'에피소드 선택'},...episodes.map(episode=>({value:String(episode.episodeNumber),label:episode.title||`EP ${episode.episodeNumber}`}))],setSceneEpisode)}</label><label className="gantt-field"><span className="gantt-inspector-sr">씬 검색</span><input type="search" value={sceneSearch} onChange={event=>setSceneSearch(event.target.value)} placeholder="씬 번호 또는 담당자 검색"/></label>
            <div className="gantt-inspector-scene-list">{scenes.length?scenes.map(scene=>{const sceneId=sceneKey(scene.link),checked=taskDraft.sceneLinks.some(link=>sceneKey(link)===sceneId);return <label key={sceneId} className="gantt-inspector-check"><input type="checkbox" checked={checked} onChange={event=>changeTask({sceneLinks:event.target.checked?[...taskDraft.sceneLinks,scene.link]:taskDraft.sceneLinks.filter(link=>sceneKey(link)!==sceneId)})}/><span>{scene.title}{scene.worker&&<small>{scene.worker}</small>}</span></label>;}):<p className="gantt-inspector-hint">표시할 씬이 없습니다.</p>}</div><p className="gantt-inspector-hint">총 {taskDraft.sceneLinks.length}개 씬 연결 · 다른 에피소드의 연결도 유지됩니다.</p>
          </div></details>
          {!group&&<details className="gantt-inspector-fold"><summary>캘린더 연결 {targetCalendar?`· ${targetCalendar.name}`:''}</summary><div className="gantt-inspector-fold-content"><label className="gantt-field">표시할 캘린더{select('표시할 캘린더',taskDraft.calendarId||'',[{value:'',label:'표시하지 않음'},...(taskDraft.calendarId&&!targetCalendar?[{value:taskDraft.calendarId,label:'접근할 수 없는 연결 캘린더',disabled:true}]:[]),...calendars.filter(calendar=>calendar.canEdit||calendar.id===taskDraft.calendarId).map(calendar=>({value:calendar.id,label:calendar.name,disabled:!calendar.canEdit}))],value=>changeTask({calendarId:value||null}))}</label>{targetCalendar&&<div className="gantt-inspector-audience"><b>공유 대상</b><p>{audience}</p><p>이 캘린더에 제목·날짜·메모가 표시됩니다. 양쪽 편집 권한이 있는 사람은 수정할 수 있습니다.</p>{calendarChanged&&<label className="gantt-inspector-check"><input type="checkbox" checked={audienceAccepted} onChange={event=>{accepted.current=event.target.checked?audienceKey:'';setAudienceAccepted(event.target.checked);if(event.target.checked)void queue.flush();}}/>공유 대상과 내용을 확인했습니다.</label>}</div>}{task?.calendarId&&!taskDraft.calendarId&&<p className="gantt-inspector-hint">캘린더 표시만 해제하고 간트 작업은 유지합니다.</p>}</div></details>}
        </> : <>
          {bounds&&<p className="gantt-inspector-hint">{bounds.startDate} — {bounds.endDate} · 총 {durationLabel({...bounds,kind:'group'})}</p>}
          <details className="gantt-inspector-fold"><summary>메모 · 기본 색상 · 에피소드</summary><div className="gantt-inspector-fold-content"><label className="gantt-field">메모<textarea value={projectDraft.memo} rows={3} maxLength={20000} onChange={event=>changeProject({memo:event.target.value},false)} onBlur={flush}/></label><ColorPicker color={projectDraft.color} disabled={disabled} onChange={color=>changeProject({color:color||'#6C5CE7'})}/><label className="gantt-field">연결 에피소드{select('연결 에피소드',String(projectDraft.linkedEpisode??''),[{value:'',label:'연결하지 않음'},...episodes.map(episode=>({value:String(episode.episodeNumber),label:episode.title||`EP ${episode.episodeNumber}`}))],value=>changeProject({linkedEpisode:value===''?null:Number(value)}))}</label></div></details>
          <details className="gantt-inspector-fold"><summary>프로젝트 공유</summary><div className="gantt-inspector-fold-content">{!canManage&&<p className="gantt-inspector-hint">공유 범위와 편집 권한은 소유자가 관리합니다.</p>}<label className="gantt-inspector-check"><input type="checkbox" checked={projectDraft.memberIds===null} disabled={!canManage} onChange={event=>changeProject({memberIds:event.target.checked?null:people.map(person=>person.id)})}/>폴더의 모든 멤버에게 공개</label>{projectDraft.memberIds!==null&&<PeoplePicker title="볼 수 있는 사람" selected={projectDraft.memberIds} people={people} pinnedId={project.ownerId} disabled={disabled||!canManage} onChange={memberIds=>changeProject({memberIds,editorIds:projectDraft.editorIds?.filter(id=>memberIds.includes(id)||id===project.ownerId)??null})}/>}<label className="gantt-inspector-check"><input type="checkbox" checked={projectDraft.editorIds===null} disabled={!canManage} onChange={event=>changeProject({editorIds:event.target.checked?null:people.filter(person=>person.canEdit!==false&&(projectDraft.memberIds===null||projectDraft.memberIds.includes(person.id))).map(person=>person.id)})}/>폴더의 편집 권한을 그대로 사용</label>{projectDraft.editorIds!==null&&<PeoplePicker title="편집할 수 있는 사람" selected={projectDraft.editorIds} people={people.filter(person=>person.canEdit!==false&&(projectDraft.memberIds===null||projectDraft.memberIds.includes(person.id)||person.id===project.ownerId))} pinnedId={project.ownerId} disabled={disabled||!canManage} onChange={editorIds=>changeProject({editorIds})}/>}<p className="gantt-inspector-hint">폴더에 참여한 멤버 안에서 설정합니다.</p></div></details>
        </>}
      </fieldset>
    </form>
    <div className="gantt-inspector-actions">
      {task&&<div className="gantt-inspector-order">
        {([['up','위로',ArrowUp],['down','아래로',ArrowDown],['indent','하위로',ArrowRight],['outdent','상위로',ArrowLeft]] as const).map(([direction,label,Icon])=><button key={direction} type="button" className="gantt-button" aria-label={label} title={label} disabled={actionDisabled} onClick={()=>onMove(direction)}><Icon size={14}/></button>)}
        {group&&<button className="gantt-button gantt-inspector-add-child" type="button" disabled={actionDisabled||props.canAddChild===false} onClick={onAddChild}><Plus size={14}/>하위 작업</button>}
      </div>}
      <div className="gantt-inspector-primary-actions"><button className="gantt-button" type="button" disabled={actionDisabled} onClick={onComplete}><Check size={14}/>{(props.completed??(task?task.completed||task.progress===100:project.completed))?'다시 열기':'완료 표시'}</button><button className="gantt-button gantt-inspector-delete" type="button" disabled={actionDisabled} onClick={onDelete}><Trash2 size={14}/>삭제</button></div>
    </div>
  </aside>;
}
