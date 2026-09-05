import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import type { Episode } from '@/types';
import type { BflowCalendar } from '@/types/calendar';
import { descendantIds, durationLabel, taskBounds, taskProgress } from './domain';
import type { GanttProject, GanttSceneLink, GanttTask } from './types';
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
  onSaveTask: (patch: Partial<GanttTask>) => Promise<void>;
  onSaveProject: (patch: Partial<GanttProject>) => Promise<void>;
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
function projectSettings(project: GanttProject) {
  return Object.fromEntries(PROJECT_FIELDS.map(key => [key, project[key]]));
}
function signature(project: GanttProject, task: GanttTask | null) {
  return JSON.stringify([project.revision, task || projectSettings(project)]);
}

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
  const [taskDraft, setTaskDraft] = useState<GanttTask | null>(() => task ? structuredClone(task) : null);
  const [projectDraft, setProjectDraft] = useState(() => structuredClone(project));
  const [dirty, setDirty] = useState(false), [externalChange, setExternalChange] = useState(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [audienceAccepted, setAudienceAccepted] = useState(false);
  const [sceneEpisode, setSceneEpisode] = useState<string>(() => String(project.linkedEpisode ?? task?.sceneLinks[0]?.episodeNumber ?? episodes[0]?.episodeNumber ?? ''));
  const [sceneSearch, setSceneSearch] = useState('');
  const baseline = useRef({ project: structuredClone(project), task: task ? structuredClone(task) : null, signature: signature(project, task), key: `${project.id}:${task?.id || 'project'}` });
  const latest = useRef({ project, task });latest.current = { project, task };
  const savingRef = useRef(false);
  const targetKey = `${project.id}:${task?.id || 'project'}`;
  const sourceSignature = signature(project, task);
  const disabled = !canEdit || pending || saving;

  const reload = useCallback((sourceProject: GanttProject, sourceTask: GanttTask | null) => {
    baseline.current = { project: structuredClone(sourceProject), task: sourceTask ? structuredClone(sourceTask) : null, signature: signature(sourceProject, sourceTask), key: `${sourceProject.id}:${sourceTask?.id || 'project'}` };
    setProjectDraft(structuredClone(sourceProject));setTaskDraft(sourceTask ? structuredClone(sourceTask) : null);
    setDirty(false);setExternalChange(false);setAudienceAccepted(false);setError('');
  }, []);

  useEffect(() => {
    if (baseline.current.key !== targetKey) {
      reload(project, task);
      setSceneEpisode(String(project.linkedEpisode ?? task?.sceneLinks[0]?.episodeNumber ?? episodes[0]?.episodeNumber ?? ''));
      setSceneSearch('');return;
    }
    if (sourceSignature === baseline.current.signature || savingRef.current) return;
    if (dirty) setExternalChange(true);
    else reload(project, task);
  }, [project, task, targetKey, sourceSignature, dirty, reload, episodes]);

  const changeTask = (patch: Partial<GanttTask>) => {
    setTaskDraft(current => current ? { ...current, ...patch } : current);
    setDirty(true);setError('');
    if (Object.prototype.hasOwnProperty.call(patch, 'calendarId')) setAudienceAccepted(false);
  };
  const changeProject = (patch: Partial<GanttProject>) => {setProjectDraft(current => ({ ...current, ...patch }));setDirty(true);setError('');};
  const names = useMemo(() => new Map(users.map(user => [user.id, user.name])), [users]);
  const people: Person[] = memberOptions || users;
  const excluded = useMemo(() => task ? descendantIds(project, task.id) : new Set<string>(), [project, task]);
  const parentChoices = project.tasks.filter(candidate => candidate.kind === 'group' && !excluded.has(candidate.id));
  const hasChildren = task ? project.tasks.some(candidate => candidate.parentId === task.id) : false;
  const predecessorChoices = project.tasks.filter(candidate => {
    if (!task || excluded.has(candidate.id)) return false;
    const visited = new Set<string>();let parent = taskDraft?.parentId;
    while (parent && !visited.has(parent)) {if (parent === candidate.id) return false;visited.add(parent);parent = project.tasks.find(row => row.id === parent)?.parentId;}
    return true;
  });
  const targetCalendar = calendars.find(calendar => calendar.id === taskDraft?.calendarId);
  const calendarChanged = Boolean(taskDraft?.calendarId && taskDraft.calendarId !== baseline.current.task?.calendarId);
  const audience = targetCalendar ? targetCalendar.visibility === 'team' ? '전체 팀원' : [...new Set([targetCalendar.ownerId, ...targetCalendar.members.map(member => member.userId)])].map(id => names.get(id) || `멤버 ${id.slice(0, 8)}`).join(', ') : '';
  useEffect(() => { setAudienceAccepted(false); }, [taskDraft?.calendarId, audience]);
  const calendarChoices = calendars.filter(calendar => calendar.canEdit || calendar.id === taskDraft?.calendarId);
  const group = taskDraft?.kind === 'group';
  const milestone = taskDraft?.kind === 'milestone';
  const bounds = task ? taskBounds(project, task.id) : taskBounds(project);
  const scenes = useMemo(() => episodes.filter(episode => String(episode.episodeNumber) === sceneEpisode).flatMap(episode => episode.parts.flatMap(part => part.scenes.map(scene => ({
    link: { episodeNumber: episode.episodeNumber, sheetName: part.sheetName, department: part.department, sceneId: scene.sceneId } as GanttSceneLink,
    title: `${part.department === 'bg' ? 'BG' : '액팅'} · ${part.partId} · ${scene.sceneId}`,
    worker: scene.assignee,
  })))).filter(scene => !sceneSearch.trim() || `${scene.title} ${scene.worker}`.toLowerCase().includes(sceneSearch.trim().toLowerCase())), [episodes, sceneEpisode, sceneSearch]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if (disabled || externalChange) return;
    const startedKey = targetKey;
    setError('');
    if (taskDraft && calendarChanged && !audienceAccepted) {setError('캘린더에 공유되는 대상과 내용을 확인해 주세요.');return;}
    if (taskDraft?.calendarId && calendarChanged && !targetCalendar?.canEdit) {setError('편집할 수 있는 캘린더를 선택해 주세요.');return;}
    if (taskDraft?.progressMode === 'scenes' && !taskDraft.sceneLinks.length && !group) {setError('진행률을 가져올 씬을 하나 이상 선택해 주세요.');return;}
    savingRef.current = true;setSaving(true);
    try {
      if (taskDraft && baseline.current.task) {
        const next = { ...taskDraft, title: taskDraft.title.trim() };
        if (!next.title) throw new Error('제목을 입력해 주세요.');
        if (next.allDay) {next.startTime = '';next.endTime = '';}
        if (next.kind === 'milestone') {next.endDate = next.startDate;next.endTime = next.startTime;}
        const patch = Object.fromEntries(TASK_FIELDS.filter(key => JSON.stringify(next[key]) !== JSON.stringify(baseline.current.task![key])).map(key => [key, next[key]])) as Partial<GanttTask>;
        if (Object.keys(patch).length) await onSaveTask(patch);
      } else {
        const next = { ...projectDraft, name: projectDraft.name.trim() };
        if (!next.name) throw new Error('프로젝트 이름을 입력해 주세요.');
        const fields = PROJECT_FIELDS.filter(key => canManage || (key !== 'memberIds' && key !== 'editorIds'));
        const patch = Object.fromEntries(fields.filter(key => JSON.stringify(next[key]) !== JSON.stringify(baseline.current.project[key])).map(key => [key, next[key]])) as Partial<GanttProject>;
        if (Object.keys(patch).length) await onSaveProject(patch);
      }
      if (baseline.current.key === startedKey) reload(latest.current.project, latest.current.task);
    } catch (cause) {
      if (baseline.current.key === startedKey) {
        setError(cause instanceof Error ? cause.message : '저장하지 못했습니다. 다시 시도해 주세요.');
        if (signature(latest.current.project, latest.current.task) !== baseline.current.signature) setExternalChange(true);
      }
    } finally {savingRef.current = false;setSaving(false);}
  }

  return <aside className="gantt-inspector" aria-label={task ? '작업 상세' : '프로젝트 상세'}>
    <div className="gantt-inspector-header"><div><span className="gantt-inspector-eyebrow">{[props.folderName,project.name,task?.parentId?project.tasks.find(t=>t.id===task.parentId)?.title:undefined].filter(Boolean).join(' › ')}</span><h2>{task ? task.kind==='group'?'그룹 상세':task.kind==='milestone'?'마일스톤 상세':'작업 상세' : '프로젝트 설정'}</h2></div><button className="gantt-button" type="button" aria-label="상세 닫기" onClick={onClose}><X size={17} /></button></div>
    {!canEdit && <p className="gantt-inspector-notice">보기 권한으로 열었습니다.</p>}
    {externalChange && <div className="gantt-inspector-notice warning" role="status"><p>다른 변경이 도착했습니다. 작성 중인 내용은 유지했습니다. 최신 내용을 불러온 뒤 다시 편집해 주세요.</p><button type="button" className="gantt-button" onClick={() => reload(latest.current.project, latest.current.task)}><RotateCcw size={13} /> 최신 내용 불러오기</button></div>}
    <form onSubmit={submit} className="gantt-inspector-form">
      <fieldset disabled={disabled} className="gantt-inspector-fields">
        {taskDraft ? <>
          <label className="gantt-field">제목<input name="title" value={taskDraft.title} onChange={event => changeTask({ title: event.target.value })} maxLength={200} required /></label>
          <div className="gantt-pair"><label className="gantt-field">종류<select value={taskDraft.kind} onChange={event => changeTask({ kind: event.target.value as GanttTask['kind'] })}>
            <option value="task" disabled={hasChildren}>작업</option><option value="group">그룹</option><option value="milestone" disabled={hasChildren}>마일스톤</option>
          </select></label><label className="gantt-field">상위 그룹<select value={taskDraft.parentId || ''} onChange={event => changeTask({ parentId: event.target.value || null })}><option value="">프로젝트 바로 아래</option>{parentChoices.map(parent => <option key={parent.id} value={parent.id}>{parent.title}</option>)}</select></label></div>
          {hasChildren && <p className="gantt-inspector-hint">하위 작업이 있는 그룹의 종류는 바꿀 수 없습니다.</p>}
          <section className="gantt-inspector-section"><h3>일정</h3>
            {group ? <p className="gantt-inspector-hint">{bounds ? <>{bounds.startDate} — {bounds.endDate}<br />총 {durationLabel({ ...bounds, kind: 'group' })}<br />그룹 기간은 하위 작업에서 자동으로 계산합니다.</> : '하위 작업을 추가하면 그룹 기간이 자동으로 표시됩니다.'}</p> : <>
              <div className="gantt-pair"><label className="gantt-field">시작일<input type="date" value={taskDraft.startDate} required readOnly={taskDraft.mode === 'auto' && !!taskDraft.predecessorId} onChange={event => changeTask({ startDate: event.target.value, ...(milestone ? { endDate: event.target.value } : {}) })} /></label><label className="gantt-field">종료일<input type="date" value={milestone ? taskDraft.startDate : taskDraft.endDate} required disabled={milestone} readOnly={taskDraft.mode === 'auto' && !!taskDraft.predecessorId} onChange={event => changeTask({ endDate: event.target.value })} /></label></div>
              <label className="gantt-inspector-check"><input type="checkbox" checked={taskDraft.allDay} onChange={event => changeTask(event.target.checked ? { allDay: true, startTime: '', endTime: '' } : { allDay: false, startTime: taskDraft.startTime || '10:00', endTime: taskDraft.endTime || (milestone ? '10:00' : '11:00') })} />하루 종일</label>
              {!taskDraft.allDay && <div className="gantt-pair"><label className="gantt-field">시작 시간<input type="time" value={taskDraft.startTime} required readOnly={taskDraft.mode === 'auto' && !!taskDraft.predecessorId} onChange={event => changeTask({ startTime: event.target.value, ...(milestone ? { endTime: event.target.value } : {}) })} /></label><label className="gantt-field">종료 시간<input type="time" value={milestone ? taskDraft.startTime : taskDraft.endTime} required disabled={milestone} readOnly={taskDraft.mode === 'auto' && !!taskDraft.predecessorId} onChange={event => changeTask({ endTime: event.target.value })} /></label></div>}
            </>}
            <label className="gantt-field">일정 계산<select value={taskDraft.mode} onChange={event => changeTask({ mode: event.target.value as GanttTask['mode'] })}><option value="manual">수동 · 날짜 유지</option><option value="auto">자동 · 선행 작업 따라가기</option></select></label>
            <label className="gantt-field">선행 작업<select value={taskDraft.predecessorId || ''} onChange={event => changeTask({ predecessorId: event.target.value || null })}><option value="">없음</option>{predecessorChoices.map(previous => <option key={previous.id} value={previous.id}>{previous.title}</option>)}</select></label>
            {taskDraft.mode === 'auto' && taskDraft.predecessorId && <p className="gantt-inspector-hint">선행 작업이 끝나면 시작합니다. 날짜를 직접 지정하려면 수동으로 바꾸세요.</p>}
          </section>
          <label className="gantt-field">메모<textarea value={taskDraft.memo} maxLength={20000} rows={4} onChange={event => changeTask({ memo: event.target.value })} placeholder="작업 내용이나 참고 사항을 남기세요." /></label>
          <PeoplePicker title="작업자" selected={taskDraft.workers} people={users} disabled={disabled} onChange={workers => changeTask({ workers })} />
          <PeoplePicker title="참석자" selected={taskDraft.attendees} people={users} disabled={disabled} onChange={attendees => changeTask({ attendees })} />
          <section className="gantt-inspector-section"><h3>진행률</h3>{group ? <p className="gantt-inspector-hint">{props.displayProgress??taskProgress(project,taskDraft)}% · 하위 작업의 진행률을 종합합니다.</p> : <>
            <label className="gantt-field"><span className="gantt-inspector-sr">진행률 계산 방식</span><select value={taskDraft.progressMode} onChange={event => changeTask({ progressMode: event.target.value as GanttTask['progressMode'] })}><option value="manual">직접 입력</option><option value="scenes">연결된 씬에서 자동 계산</option></select></label>
            {taskDraft.progressMode === 'manual' ? <label className="gantt-field">진행 {taskDraft.progress}%<input type="range" min={0} max={100} step={5} value={taskDraft.progress} onChange={event => changeTask({ progress: Number(event.target.value) })} /></label> : <p className="gantt-inspector-hint">{props.displayProgress??taskDraft.progress}% · 연결한 씬의 작업 현황을 따라갑니다.</p>}
          </>}</section>
          <details className="gantt-inspector-scenes" open={taskDraft.progressMode === 'scenes' ? true : undefined}><summary>씬 연결 <span>{taskDraft.sceneLinks.length}개</span></summary>
            <label className="gantt-field">에피소드<select value={sceneEpisode} onChange={event => setSceneEpisode(event.target.value)}><option value="">에피소드 선택</option>{episodes.map(episode => <option key={episode.episodeNumber} value={episode.episodeNumber}>{episode.title || `EP ${episode.episodeNumber}`}</option>)}</select></label>
            <label className="gantt-field"><span className="gantt-inspector-sr">씬 검색</span><input type="search" value={sceneSearch} onChange={event => setSceneSearch(event.target.value)} placeholder="씬 번호 또는 담당자 검색" /></label>
            <div className="gantt-inspector-scene-list">{scenes.length ? scenes.map(scene => {
              const key = sceneKey(scene.link), checked = taskDraft.sceneLinks.some(link => sceneKey(link) === key);
              return <label key={key} className="gantt-inspector-check"><input type="checkbox" checked={checked} onChange={event => changeTask({ sceneLinks: event.target.checked ? [...taskDraft.sceneLinks, scene.link] : taskDraft.sceneLinks.filter(link => sceneKey(link) !== key) })} /><span>{scene.title}{scene.worker && <small>{scene.worker}</small>}</span></label>;
            }) : <p className="gantt-inspector-hint">표시할 씬이 없습니다.</p>}</div>
            {taskDraft.sceneLinks.some(link => String(link.episodeNumber) !== sceneEpisode) && <p className="gantt-inspector-hint">다른 에피소드의 씬 연결도 유지됩니다.</p>}
          </details>
          <section className="gantt-inspector-section"><h3>막대 색상</h3><ColorPicker color={taskDraft.color} inherited disabled={disabled} onChange={color => changeTask({ color })} /></section>
          {!group && <section className="gantt-inspector-section"><h3>캘린더 연결</h3><label className="gantt-field">표시할 캘린더<select value={taskDraft.calendarId || ''} onChange={event => changeTask({ calendarId: event.target.value || null })}><option value="">표시하지 않음</option>{taskDraft.calendarId && !targetCalendar && <option value={taskDraft.calendarId} disabled>접근할 수 없는 연결 캘린더</option>}{calendarChoices.map(calendar => <option key={calendar.id} value={calendar.id} disabled={!calendar.canEdit}>{calendar.name}{!calendar.canEdit ? ' · 보기 전용' : ''}</option>)}</select></label>
            {targetCalendar && <div className="gantt-inspector-audience"><b>공유 대상</b><p>{audience}</p><p>이 캘린더에 제목·날짜·메모가 표시됩니다. 양쪽 편집 권한이 있는 사람은 수정할 수 있습니다.</p>{calendarChanged && <label className="gantt-inspector-check"><input type="checkbox" checked={audienceAccepted} onChange={event => setAudienceAccepted(event.target.checked)} />공유 대상과 내용을 확인했습니다.</label>}</div>}
            {task?.calendarId && !taskDraft.calendarId && <p className="gantt-inspector-hint">저장하면 캘린더 표시가 해제되고 간트 작업은 유지됩니다.</p>}
          </section>}
        </> : <>
          <label className="gantt-field">프로젝트 이름<input name="name" value={projectDraft.name} onChange={event => changeProject({ name: event.target.value })} maxLength={200} required /></label>
          <label className="gantt-field">메모<textarea value={projectDraft.memo} onChange={event => changeProject({ memo: event.target.value })} rows={4} maxLength={20000} /></label>
          {bounds && <p className="gantt-inspector-hint">{bounds.startDate} — {bounds.endDate}<br />총 {durationLabel({ ...bounds, kind: 'group' })} · 하위 작업에서 계산</p>}
          <section className="gantt-inspector-section"><h3>기본 색상</h3><ColorPicker color={projectDraft.color} disabled={disabled} onChange={color => changeProject({ color: color || '#6C5CE7' })} /></section>
          <label className="gantt-field">연결 에피소드<select value={projectDraft.linkedEpisode ?? ''} onChange={event => changeProject({ linkedEpisode: event.target.value === '' ? null : Number(event.target.value) })}><option value="">연결하지 않음</option>{episodes.map(episode => <option key={episode.episodeNumber} value={episode.episodeNumber}>{episode.title || `EP ${episode.episodeNumber}`}</option>)}</select></label>
          <section className="gantt-inspector-section"><h3>프로젝트 공유</h3>{!canManage && <p className="gantt-inspector-hint">공유 범위와 편집 권한은 소유자가 관리합니다.</p>}
            <label className="gantt-inspector-check"><input type="checkbox" checked={projectDraft.memberIds === null} disabled={!canManage} onChange={event => changeProject({ memberIds: event.target.checked ? null : people.map(person => person.id) })} />폴더의 모든 멤버에게 공개</label>
            {projectDraft.memberIds !== null && <PeoplePicker title="볼 수 있는 사람" selected={projectDraft.memberIds} people={people} pinnedId={project.ownerId} disabled={disabled || !canManage} onChange={memberIds => changeProject({ memberIds, editorIds: projectDraft.editorIds?.filter(id => memberIds.includes(id) || id === project.ownerId) ?? null })} />}
            <label className="gantt-inspector-check"><input type="checkbox" checked={projectDraft.editorIds === null} disabled={!canManage} onChange={event => changeProject({ editorIds: event.target.checked ? null : people.filter(person => person.canEdit !== false && (projectDraft.memberIds === null || projectDraft.memberIds.includes(person.id))).map(person => person.id) })} />폴더의 편집 권한을 그대로 사용</label>
            {projectDraft.editorIds !== null && <PeoplePicker title="편집할 수 있는 사람" selected={projectDraft.editorIds} people={people.filter(person => person.canEdit !== false && (projectDraft.memberIds === null || projectDraft.memberIds.includes(person.id) || person.id === project.ownerId))} pinnedId={project.ownerId} disabled={disabled || !canManage} onChange={editorIds => changeProject({ editorIds })} />}
            <p className="gantt-inspector-hint">프로젝트 공유는 폴더에 참여한 멤버 안에서 설정합니다.</p>
          </section>
        </>}
      </fieldset>
      {error && <p className="gantt-inspector-error" role="alert">{error}</p>}
      <div className="gantt-inspector-save"><button className="gantt-button" type="submit" disabled={disabled || !dirty || externalChange || (calendarChanged && !audienceAccepted)}><Save size={14} />{saving || pending ? '저장 중…' : '변경 저장'}</button>{dirty && <span>저장하지 않은 변경</span>}</div>
    </form>
    <div className="gantt-inspector-actions">
      {task && <div className="gantt-inspector-order">{([['up', '위로', ArrowUp], ['down', '아래로', ArrowDown], ['indent', '하위로', ArrowRight], ['outdent', '상위로', ArrowLeft]] as const).map(([direction, label, Icon]) => <button key={direction} type="button" className="gantt-button" title={label} aria-label={label} disabled={disabled || dirty} onClick={() => onMove(direction)}><Icon size={14} /></button>)}</div>}
      {task?.kind === 'group' && <button className="gantt-button" type="button" disabled={disabled || dirty || props.canAddChild === false} onClick={onAddChild}><Plus size={14} />하위 작업</button>}
      <button className="gantt-button" type="button" disabled={disabled || dirty} onClick={onComplete}><Check size={14} />{(props.completed ?? (task ? task.completed || task.progress === 100 : project.completed)) ? '다시 열기' : '완료 표시'}</button>
      <button className="gantt-button gantt-inspector-delete" type="button" disabled={disabled || dirty} onClick={onDelete}><Trash2 size={14} />삭제</button>
    </div>
  </aside>;
}
