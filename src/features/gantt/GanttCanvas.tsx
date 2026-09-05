import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, GripVertical, Hand, Minus, MoreHorizontal, Plus, Scan } from 'lucide-react';
import { descendantIds, durationLabel, isTaskComplete, projectProgress, resolveTaskColor, taskBounds, taskConflicts, taskProgress } from './domain';
import { barGeometry, rebaseScroll, zoomScroll } from './geometry';
import { rowDrop, type RowDrop, type RowDropPosition } from './rowDrag';
import { GanttTooltip, type GanttHover } from './GanttTooltip';
import type { GanttProject, GanttTask } from './types';

const DAY = 86400000, ROW = 40, RULER = 48;
const dateMs = (d: string) => Date.parse(d + 'T00:00:00Z');
const dayDiff = (a: string, b: string) => Math.round((dateMs(b) - dateMs(a)) / DAY);
export const moveDate = (date: string, days: number) => new Date(dateMs(date) + days * DAY).toISOString().slice(0, 10);
export const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
interface ChartRow { id: string; project: GanttProject; task: GanttTask | null; depth: number; completed: boolean; bounds: ReturnType<typeof taskBounds> }
type Gesture = { pointer: number; target: HTMLElement; x: number; y: number; moved: boolean } & (
  | { kind: 'pan'; left: number; top: number }
  | { kind: 'row'; row: ChartRow; drop: RowDrop | null; lastX: number; lastY: number }
  | { kind: 'edit' | 'create'; row: ChartRow; edge?: string; delta: number; first: number }
);
interface Props {
  projects: GanttProject[]; selected: string[]; statusFilter: 'all' | 'active' | 'completed'; worker: string;
  collapsed: string[]; onCollapse: (id: string) => void; names: Record<string, string>;
  canEdit: (p: GanttProject) => boolean;
  onSelect: (projectId: string, taskId: string | null, multiple?: boolean) => void;
  onPatch: (p: GanttProject, task: GanttTask, patch: Partial<GanttTask>) => void;
  onMenu: (p: GanttProject, task: GanttTask | null, x: number, y: number) => void;
  onAdd: (p: GanttProject, parentId: string | null, start: string, end: string) => void;
  onRelocate?: (sourceProject: GanttProject, task: GanttTask, targetProject: GanttProject, targetTaskId: string | null, position: RowDropPosition) => void;
}
export function GanttCanvas(props: Props) {
  const { projects, selected, statusFilter = 'all', worker, collapsed, onCollapse, names } = props;
  const chart = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(48), widthRef = useRef(48);
  const [layout, setLayout] = useState<'beside' | 'list'>(() => localStorage.getItem('bflow-gantt-name-layout') === 'beside' ? 'beside' : 'list');
  const [hover, setHover] = useState<GanttHover | null>(null);
  const [drag, setDrag] = useState<{ id: string; delta: number; edge?: string } | null>(null);
  const [creating, setCreating] = useState<{ id: string; first: number; last: number } | null>(null);
  const [mode, setMode] = useState<'pan' | 'create'>('pan');
  const [spaceHeld, setSpaceHeld] = useState(false), spaceRef = useRef(false), pointerOver = useRef(false);
  const [panning, setPanning] = useState(false);
  const [rowDragging, setRowDragging] = useState<{row: ChartRow; drop: RowDrop | null; x: number; y: number} | null>(null);
  const dragRef = useRef<Gesture | null>(null);
  const suppressClick = useRef(false), zoomFrame = useRef(0), goal = useRef(48), pointer = useRef(0);
  const leftWidth = layout === 'list' ? 380 : 0;
  const allDates = projects.flatMap(p => p.tasks.map(t => t.startDate));
  const firstDate = allDates.sort()[0] || localDate();
  const [base, setBase] = useState(() => moveDate(firstDate < localDate() ? firstDate : localDate(), -6));
  const pendingScroll = useRef<number | null>(null);
  // Keep the viewport date stable when a project with earlier work is enabled.
  useLayoutEffect(() => {
    const candidate = moveDate(firstDate, -6);
    if (candidate < base) {
      pendingScroll.current = rebaseScroll(base, candidate, chart.current?.scrollLeft || 0, widthRef.current);
      setBase(candidate);
    } else if (pendingScroll.current !== null && chart.current) {
      chart.current.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [firstDate, base]);
  const lastDate = projects.flatMap(p => p.tasks.map(t => t.endDate)).sort().at(-1) || localDate();
  const extent = useRef(60);
  extent.current = Math.max(extent.current, dayDiff(base, lastDate) + 30);
  const days = extent.current;
  const rows = useMemo(() => {
    const result: ChartRow[] = [];
    for (const p of projects) {
      const wanted = (t: GanttTask) => (statusFilter === 'all' || (statusFilter === 'completed' ? isTaskComplete(p,t) : !isTaskComplete(p,t))) && (!worker || t.workers.includes(worker));
      const included = new Set(p.tasks.filter(wanted).map(t => t.id));
      // A filtered child still needs its full project/group context, including
      // nested empty groups. Completion of a group never hides matching children.
      for (const t of p.tasks.filter(t => included.has(t.id))) {
        let parent = t.parentId;
        while (parent && !included.has(parent)) { included.add(parent); parent = p.tasks.find(t => t.id === parent)?.parentId ?? null; }
      }
      const projectMatches = statusFilter === 'all' || (statusFilter === 'completed' ? p.completed : !p.completed);
      if (!included.size && (!projectMatches || !!worker)) continue;
      if (statusFilter === 'active' && p.completed) continue;
      result.push({ id: p.id, project: p, task: null, depth: 0, completed: p.completed, bounds: taskBounds(p) });
      if (collapsed.includes(p.id)) continue;
      const visit = (parent: string | null, depth: number) => {
        for (const t of p.tasks.filter(t => t.parentId === parent).sort((a,b) => a.sortOrder-b.sortOrder)) {
          if (!included.has(t.id)) continue;
          result.push({ id: t.id, project: p, task: t, depth, completed: isTaskComplete(p,t), bounds: t.kind === 'group' ? taskBounds(p,t.id) : t });
          if (!collapsed.includes(t.id)) visit(t.id,depth+1);
        }
      };
      visit(null,1);
    }
    return result;
  }, [projects, statusFilter, worker, collapsed]);
  const savedScroll = useRef({left:0,top:0}), hadRows = useRef(false);
  useLayoutEffect(() => {
    if (rows.length && !hadRows.current && chart.current && pendingScroll.current === null) {
      chart.current.scrollLeft = savedScroll.current.left;
      chart.current.scrollTop = savedScroll.current.top;
    }
    hadRows.current = rows.length > 0;
  }, [rows.length]);
  const stopZoom = useCallback(() => { cancelAnimationFrame(zoomFrame.current); zoomFrame.current = 0; goal.current = widthRef.current; }, []);
  const zoomTo = useCallback((target: number, x: number) => {
    goal.current = Math.max(12,Math.min(480,target)); pointer.current = x;
    const tick = () => {
      const el = chart.current; if (!el) return;
      const old = widthRef.current, next = matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(goal.current-old)<.08 ? goal.current : old+(goal.current-old)*.22;
      const scroll = zoomScroll(old,next,el.scrollLeft,pointer.current,leftWidth);
      widthRef.current=next;setWidth(next);el.style.setProperty('--gantt-day',`${next}px`);el.scrollLeft=scroll;
      if (next !== goal.current) zoomFrame.current=requestAnimationFrame(tick);else zoomFrame.current=0;
    };
    if (!zoomFrame.current) zoomFrame.current=requestAnimationFrame(tick);
  },[leftWidth]);
  useEffect(() => {
    const el = chart.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (dragRef.current) return;
      const x=e.clientX-el.getBoundingClientRect().left;if(x<leftWidth)return;
      e.preventDefault();setHover(null);
      const unit=e.deltaMode===1?16:e.deltaMode===2?el.clientHeight:1;
      if(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY)){stopZoom();el.scrollLeft+=(e.deltaX||e.deltaY)*unit;return;}
      zoomTo(goal.current*Math.exp(-Math.max(-180,Math.min(180,e.deltaY*unit))*.002),x);
    };
    el.addEventListener('wheel',wheel,{passive:false});return()=>{el.removeEventListener('wheel',wheel);stopZoom();};
  },[leftWidth,stopZoom,zoomTo]);
  useEffect(() => () => cancelAnimationFrame(zoomFrame.current), []);
  const cancelGesture = useCallback((pointerId?: number) => {
    const gesture = dragRef.current;
    if (!gesture || (pointerId !== undefined && gesture.pointer !== pointerId)) return;
    dragRef.current = null;
    suppressClick.current = gesture.moved;
    setDrag(null); setCreating(null); setPanning(false); setRowDragging(null);
    if (gesture.target.hasPointerCapture(gesture.pointer)) gesture.target.releasePointerCapture(gesture.pointer);
  }, []);
  const gestureRevision = projects.map(p=>`${p.id}:${p.revision}:${p.completed}`).join('|');
  const visibleRowOrder = rows.map(r=>`${r.project.id}:${r.id}:${r.depth}`).join('|');
  // Polling may replace equal objects while the pointer is held. Only an actual
  // revision or visible hierarchy change invalidates the in-flight gesture.
  useEffect(() => { cancelGesture(); setHover(null); }, [gestureRevision, visibleRowOrder, statusFilter, worker, mode, layout, cancelGesture]);
  useEffect(() => {
    const clearSpace = () => { spaceRef.current = false; setSpaceHeld(false); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current) { event.preventDefault(); cancelGesture(); clearSpace(); return; }
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], dialog')) return;
      if (target?.closest('button, summary, [role="button"], [role="menuitem"]') && !target.closest('.gantt-bar')) return;
      if (!pointerOver.current && !chart.current?.contains(document.activeElement)) return;
      event.preventDefault(); spaceRef.current = true; setSpaceHeld(true); setHover(null);
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') clearSpace(); };
    const blur = () => { clearSpace(); cancelGesture(); pointerOver.current = false; };
    window.addEventListener('keydown', keyboard); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keyboard); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); cancelGesture(); };
  }, [cancelGesture]);
  const fit = () => {
    const el=chart.current;if(!el)return;
    stopZoom();const next=Math.max(12,Math.min(160,(el.clientWidth-leftWidth-300)/(dayDiff(firstDate,lastDate)+2)));
    widthRef.current=goal.current=next;setWidth(next);el.style.setProperty('--gantt-day',`${next}px`);el.scrollLeft=Math.max(0,dayDiff(base,firstDate)*next-240);
  };
  const showHover = (r: ChartRow, x: number, y: number) => {
    if (dragRef.current || !r.bounds) return;
    const task=r.task || ({id:r.id,title:r.project.name,memo:r.project.memo,workers:[],...r.bounds} as unknown as GanttTask);
    const conflict = conflicts.get(r.id);
    setHover({task:{...task,...r.bounds,memo:[conflict,task.memo].filter(Boolean).join('\n')},x,y,workers:task.workers.map(id=>names[id]||id).join(', ')});
  };
  function startDrag(e: React.PointerEvent, row: ChartRow, edge?: string, create=false) {
    if(e.button!==0||dragRef.current||spaceRef.current||!props.canEdit(row.project)||row.project.completed||row.completed||statusFilter==='completed')return;
    if(create&&mode!=='create')return;
    if(!create&&(!row.task||row.task.kind==='group'))return;
    const target=e.currentTarget as HTMLElement;
    const first=create?Math.max(0,Math.floor((e.clientX-target.getBoundingClientRect().left)/widthRef.current)):0;
    dragRef.current={kind:create?'create':'edit',row,target,x:e.clientX,y:e.clientY,moved:false,edge,delta:0,pointer:e.pointerId,first};
    target.setPointerCapture(e.pointerId);setHover(null);stopZoom();e.preventDefault();
  }
  function startRowDrag(e: React.PointerEvent, row: ChartRow) {
    if(e.button!==0||e.ctrlKey||e.metaKey||dragRef.current||spaceRef.current||!row.task||row.project.completed||!props.onRelocate||!props.canEdit(row.project))return;
    if((e.target as HTMLElement).closest('button, input, select, textarea'))return;
    const target=e.currentTarget as HTMLElement;
    dragRef.current={kind:'row',row,drop:null,target,pointer:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};
    target.setPointerCapture(e.pointerId);stopZoom();setHover(null);e.preventDefault();
  }
  function findRowDrop(gesture: Extract<Gesture,{kind:'row'}>, x: number, y: number): RowDrop | null {
    const el=chart.current;if(!el)return null;
    const bounds=el.getBoundingClientRect();
    if(x<bounds.left||x>bounds.left+el.clientWidth||y<bounds.top+RULER||y>bounds.top+el.clientHeight)return null;
    for(const node of el.querySelectorAll<HTMLElement>('.gantt-row')){
      const rect=node.getBoundingClientRect();if(y<rect.top||y>=rect.bottom)continue;
      const target=rows.find(r=>r.id===node.dataset.rowId&&r.project.id===node.dataset.projectId);if(!target)return null;
      const ratio=(y-rect.top)/rect.height;
      const position:RowDropPosition=!target.task?'inside':target.task.kind==='group'&&ratio>=.25&&ratio<=.75?'inside':ratio<.5?'before':'after';
      return rowDrop(gesture.row.project,gesture.row.task!,target.project,target.task,position,props.canEdit(gesture.row.project)&&props.canEdit(target.project));
    }
    return null;
  }
  function startPointer(e: React.PointerEvent<HTMLDivElement>) {
    if(e.button!==0)return;
    if(dragRef.current){e.preventDefault();e.stopPropagation();return;}
    suppressClick.current=false;
    const target=e.target as HTMLElement;
    if(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))return;
    const bar=target.closest('.gantt-bar');
    if(target.closest('button')&&!bar)return;
    const blank=target===e.currentTarget||target.classList.contains('gantt-track')||target.classList.contains('gantt-grid')||!!target.closest('.gantt-dates');
    if(!spaceRef.current&&!(mode==='pan'&&blank))return;
    const el=e.currentTarget;
    dragRef.current={kind:'pan',target:el,pointer:e.pointerId,x:e.clientX,y:e.clientY,left:el.scrollLeft,top:el.scrollTop,moved:false};
    el.setPointerCapture(e.pointerId);stopZoom();setHover(null);
    e.preventDefault();e.stopPropagation();
  }
  function moveDrag(e: React.PointerEvent) {
    const d=dragRef.current;if(!d||d.pointer!==e.pointerId)return;
    const dx=e.clientX-d.x,dy=e.clientY-d.y;
    if(!d.moved&&Math.hypot(dx,dy)<4)return;
    d.moved=true;
    if(d.kind==='pan'){d.target.scrollLeft=Math.max(0,d.left-dx);d.target.scrollTop=Math.max(0,d.top-dy);setPanning(true);return;}
    if(d.kind==='row'){d.lastX=e.clientX;d.lastY=e.clientY;d.drop=findRowDrop(d,e.clientX,e.clientY);setRowDragging({row:d.row,drop:d.drop,x:e.clientX,y:e.clientY});return;}
    d.delta=Math.round(dx/widthRef.current);
    if(d.kind==='create'){setCreating({id:d.row.id,first:d.first,last:Math.max(0,d.first+d.delta)});return;}
    setDrag({id:d.row.id,delta:d.delta,edge:d.edge});
  }
  function endDrag(e: React.PointerEvent) {
    const d=dragRef.current;if(!d||d.pointer!==e.pointerId)return;
    cancelGesture(e.pointerId);
    if(d.kind==='row'){
      const destination=findRowDrop(d,d.lastX,d.lastY),current=projects.find(p=>p.id===d.row.project.id),target=projects.find(p=>p.id===destination?.project.id);
      const task=current?.tasks.find(t=>t.id===d.row.task?.id);
      if(!d.moved||!destination?.allowed||!current||!target||!task||current.revision!==d.row.project.revision||target.revision!==destination.project.revision)return;
      const anchor=destination.taskId?target.tasks.find(t=>t.id===destination.taskId):null;
      if(destination.taskId&&!anchor)return;
      if(!rowDrop(current,task,target,anchor??null,destination.position,props.canEdit(current)&&props.canEdit(target)).allowed)return;
      props.onRelocate?.(current,task,target,destination.taskId,destination.position);return;
    }
    if(d.kind==='pan'||!d.delta)return;
    const current=projects.find(p=>p.id===d.row.project.id),task=current?.tasks.find(t=>t.id===d.row.task?.id);
    if(!current||current.revision!==d.row.project.revision||current.completed||!props.canEdit(current)||statusFilter==='completed'||(d.row.task&&(!task||isTaskComplete(current,task))))return;
    if(d.kind==='create'){const first=Math.min(d.first,d.first+d.delta),last=Math.max(d.first,d.first+d.delta);props.onAdd(d.row.project,d.row.task?.kind==='group'?d.row.id:d.row.task?.parentId||null,moveDate(base,Math.max(0,first)),moveDate(base,Math.max(0,last)));return;}
    const t=d.row.task!;const patch=d.edge==='start'?{startDate:moveDate(t.startDate,d.delta)}:d.edge==='end'?{endDate:moveDate(t.endDate,d.delta)}:{startDate:moveDate(t.startDate,d.delta),endDate:moveDate(t.endDate,d.delta)};
    if((patch.startDate||t.startDate)<=(patch.endDate||t.endDate))props.onPatch(d.row.project,t,patch);
  }
  function suppressPointerClick(e: React.MouseEvent) {
    if(suppressClick.current&&e.detail!==0){e.preventDefault();e.stopPropagation();}
  }
  const index=new Map(rows.map((r,i)=>[r.id,i]));
  const drop=rowDragging?.drop?.allowed?rowDragging.drop:null;
  let dropIndicatorId=drop?.taskId??drop?.project.id;
  if(drop?.position==='after'&&drop.taskId){const descendants=descendantIds(drop.project,drop.taskId);dropIndicatorId=rows.filter(r=>r.project.id===drop.project.id&&descendants.has(r.id)).at(-1)?.id??drop.taskId;}
  const conflicts = new Map(projects.flatMap(project => taskConflicts(project).map(c => [c.id, c.message] as const)));
  return <div className="gantt-canvas-wrap">
    <div className="gantt-caption"><strong>{base.slice(0,4)}년 {Number(firstDate.slice(5,7))}월</strong><span>{Math.round(width/48*100)}%</span>
      <div className="gantt-pointer-tools" role="group" aria-label="차트 조작">
        <button aria-label="화면 이동" aria-pressed={mode==='pan'} title="빈 곳을 잡고 화면 이동 · 작업 막대는 날짜 이동" onClick={()=>setMode('pan')}><Hand size={14}/> 화면 이동</button>
        <button aria-label="작업 만들기" aria-pressed={mode==='create'} title="빈 날짜 영역을 드래그해 작업 만들기" onClick={()=>setMode('create')}><Plus size={14}/> 작업 만들기</button>
      </div>
      <button onClick={()=>setLayout(v=>{const n=v==='beside'?'list':'beside';localStorage.setItem('bflow-gantt-name-layout',n);return n;})}>작업명 · {layout==='beside'?'막대 옆':'목록'}</button>
      <small>이름 드래그: 소속·순서 · 막대: 날짜 · Space: 화면 이동</small><button aria-label="축소" onClick={()=>zoomTo(width*.8,(chart.current?.clientWidth||800)/2)}><Minus size={14}/></button><button aria-label="확대" onClick={()=>zoomTo(width*1.25,(chart.current?.clientWidth||800)/2)}><Plus size={14}/></button><button onClick={fit}><Scan size={14}/> 전체 맞춤</button>
    </div>
    <div ref={chart} className={`gantt-canvas ${layout} mode-${mode} ${spaceHeld?'space-pan':''} ${panning?'panning':''} ${rowDragging?'moving-row':''}`} tabIndex={0} aria-label="프로젝트 간트" style={{'--gantt-day':`${width}px`,'--gantt-label':`${leftWidth}px`} as React.CSSProperties}
      onScroll={e=>{setHover(null);if(rows.length)savedScroll.current={left:e.currentTarget.scrollLeft,top:e.currentTarget.scrollTop};const d=dragRef.current;if(d?.kind==='row'&&d.moved){d.drop=findRowDrop(d,d.lastX,d.lastY);setRowDragging({row:d.row,drop:d.drop,x:d.lastX,y:d.lastY});}}}
      onPointerEnter={()=>{pointerOver.current=true;}} onPointerLeave={()=>{pointerOver.current=false;}}
      onPointerDownCapture={startPointer} onPointerMove={moveDrag} onPointerUp={endDrag}
      onPointerCancel={e=>cancelGesture(e.pointerId)} onLostPointerCapture={e=>cancelGesture(e.pointerId)}
      onClickCapture={suppressPointerClick} onDoubleClickCapture={suppressPointerClick}>
      {!rows.length?<div className="gantt-empty"><strong>{statusFilter==='completed'?'완료한 일정이 없습니다':statusFilter==='active'?'진행 중인 일정이 없습니다':'표시 중인 프로젝트가 없습니다'}</strong><p>{statusFilter==='completed'?'완료한 작업과 프로젝트를 삭제하지 않고 모아 봅니다.':'전체 보기에서 완료한 작업도 함께 보거나 새 프로젝트를 만드세요.'}</p></div>:<div className="gantt-grid" style={{width:leftWidth+days*width}}>
        <div className="gantt-ruler">{layout==='list'&&<div className="gantt-list-label">프로젝트 / 작업</div>}<div className="gantt-dates">{Array.from({length:days},(_,i)=>{const date=moveDate(base,i),week=new Date(dateMs(date)).getUTCDay();return <div key={date} className={`gantt-date ${week===0||week===6?'weekend':''}`} style={{width}}>{width>26||i%Math.ceil(38/width)===0?date.slice(5).replace('-','/'):''}{width>38&&<small>{'일월화수목금토'[week]}</small>}{width>=240&&<div className="gantt-hours">00　06　12　18</div>}</div>;})}</div></div>
        {rows.map((r,rowIndex)=>{
          const group=!r.task||r.task.kind==='group',t=r.task,b=r.bounds;
          const movable=!!t&&!group&&!r.completed&&!r.project.completed&&statusFilter!=='completed'&&props.canEdit(r.project);
          const relocatable=!!t&&!r.project.completed&&props.canEdit(r.project)&&!!props.onRelocate;
          const creatable=!r.completed&&!r.project.completed&&statusFilter!=='completed'&&props.canEdit(r.project);
          const progress=t?taskProgress(r.project,t):projectProgress(r.project);
          const parent=t?.parentId?r.project.tasks.find(task=>task.id===t.parentId):null;
          const parentContext=t?parent?.title??'프로젝트 바로 아래':'프로젝트 전체';
          const returning=!!t&&rowIndex>0&&rows[rowIndex-1].project.id===r.project.id&&rows[rowIndex-1].depth>r.depth;
          const geometry=b?barGeometry(b,t?.kind||'project',base,width):{left:0,width:0};
          let x=geometry.left,barWidth=geometry.width;
          if(drag?.id===r.id){if(drag.edge==='start'){x+=drag.delta*width;barWidth-=drag.delta*width}else if(drag.edge==='end')barWidth+=drag.delta*width;else x+=drag.delta*width;}
          const color=t?resolveTaskColor(r.project,t):r.project.color;
          const title=t?.title||r.project.name;
          const typeLabel=!t?'프로젝트':t.kind==='group'?'그룹':t.kind==='milestone'?'마일스톤':'작업';
          const label=<>{relocatable&&<GripVertical size={12} className="gantt-row-grip" aria-hidden="true"/>}<small className="gantt-row-kind">{typeLabel}</small><span className="gantt-name-copy"><span className="gantt-row-title">{title}</span><small className="gantt-parent-context" title={parentContext}>{parentContext}</small></span><span className="gantt-row-progress" role="progressbar" aria-label={`${title} 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><strong>{progress}%</strong><span className="gantt-row-progress-track"><span style={{width:`${progress}%`}}/></span></span>{r.completed&&<small className="gantt-completed-badge"><Check size={11}/> 완료</small>}{group&&<button aria-label={`${title} ${collapsed.includes(r.id)?'펼치기':'접기'}`} onClick={e=>{e.stopPropagation();onCollapse(r.id);}}>{collapsed.includes(r.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>}<button className="gantt-row-menu" aria-label={`${title} 메뉴`} title="상세 · 완료 · 삭제" onClick={e=>{e.stopPropagation();const bounds=e.currentTarget.getBoundingClientRect();setHover(null);props.onMenu(r.project,t,bounds.left,bounds.bottom);}}><MoreHorizontal size={15}/></button></>;
          return <div key={r.id} data-row-id={r.id} data-project-id={r.project.id} data-parent-id={t?.parentId??''} className={`gantt-row ${!t?'project':t.kind==='group'?'group-row':''} ${returning?'returns-to-parent':''} ${r.completed?'completed':''} ${selected.includes(r.id)?'selected':''} ${rowDragging?.row.id===r.id?'row-drag-source':''} ${dropIndicatorId===r.id?`drop-${drop?.position}`:''}`} style={{'--gantt-color':color,'--gantt-depth':r.depth} as React.CSSProperties} onClick={e=>props.onSelect(r.project.id,t?.id||null,e.ctrlKey||e.metaKey)} onContextMenu={e=>{e.preventDefault();setHover(null);props.onMenu(r.project,t,e.clientX,e.clientY);}}>
            {layout==='list'&&<div className={`gantt-list-label gantt-name ${relocatable?'relocatable':''}`} style={{paddingLeft:10+r.depth*16}} title={relocatable?'이름을 잡고 순서나 소속을 바꾸세요':undefined} onPointerDown={e=>startRowDrag(e,r)} onPointerMove={e=>showHover(r,e.clientX,e.clientY)} onPointerLeave={()=>setHover(null)}><span className="gantt-tree-guides" aria-hidden="true">{Array.from({length:r.depth},(_,level)=><i key={level} style={{left:10+level*16}}/>)}</span>{label}</div>}
            <div className={`gantt-track ${creatable?'creatable':''}`} onPointerDown={e=>{if(e.target===e.currentTarget)startDrag(e,r,undefined,true);}} onDoubleClick={e=>{if(e.target!==e.currentTarget||!creatable||mode!=='create'||spaceRef.current)return;const day=Math.floor((e.clientX-e.currentTarget.getBoundingClientRect().left)/width);const date=moveDate(base,day);props.onAdd(r.project,t?.kind==='group'?t.id:t?.parentId||null,date,date);}}>
              {b&&<div className={`gantt-bar-position ${conflicts.has(r.id)?'conflict':''}`} style={{left:x,width:Math.max(6,barWidth)}}>
                {layout==='beside'&&<div className={`gantt-inline-name gantt-name ${relocatable?'relocatable':''} ${x<Math.min(420,title.length*8+210+(r.completed?45:0))?'after':''}`} title={relocatable?'이름을 잡고 순서나 소속을 바꾸세요':undefined} onPointerDown={e=>startRowDrag(e,r)} onPointerMove={e=>showHover(r,e.clientX,e.clientY)} onPointerLeave={()=>setHover(null)}>{label}</div>}
                <button className={`gantt-bar ${group?'group':t?.kind||''} ${movable?'movable':''}`} aria-label={`${title}, ${durationLabel({...t,...b,kind:t?.kind||'group'} as GanttTask)}${r.completed?', 완료':''}`} aria-describedby={hover?.task.id===r.id?'gantt-hover':undefined} onPointerDown={e=>startDrag(e,r,(e.target as HTMLElement).dataset.edge)} onPointerMove={e=>showHover(r,e.clientX,e.clientY)} onPointerLeave={()=>setHover(null)} onFocus={e=>{const rect=e.currentTarget.getBoundingClientRect();showHover(r,(rect.left+rect.right)/2,rect.top);}} onBlur={()=>setHover(null)} onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();const q=e.currentTarget.getBoundingClientRect();props.onMenu(r.project,t,q.left,q.bottom);}if(e.key==='Enter')props.onSelect(r.project.id,t?.id||null);}}>
                  {t?.kind!=='milestone'&&<><span className="gantt-progress" style={{width:`${progress}%`}}/>{movable&&<><span data-edge="start" className="gantt-resize start"/><span data-edge="end" className="gantt-resize end"/></>}</>}
                </button>
                <span className="gantt-duration">{durationLabel({...t,...b,kind:t?.kind||'group'} as GanttTask)}{conflicts.has(r.id)&&<span aria-label={conflicts.get(r.id)}> · !</span>}</span>
              </div>}
              {!b&&layout==='beside'&&<div className={`gantt-empty-project gantt-name ${relocatable?'relocatable':''}`} onPointerDown={e=>startRowDrag(e,r)}>{label}{!r.completed&&<small>{t?.kind==='group'?'하위 작업을 추가하세요':'작업 만들기를 선택해 첫 일정을 그리세요'}</small>}</div>}
              {creating?.id===r.id&&<div className="gantt-creation" style={{left:Math.min(creating.first,creating.last)*width,width:(Math.abs(creating.last-creating.first)+1)*width}}/>}
            </div>
          </div>;
        })}
        <svg className="gantt-dependencies" width="100%" height={RULER+rows.length*ROW} aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1">{rows.flatMap((r,i)=>{if(!r.task?.predecessorId||!index.has(r.task.predecessorId)||!r.bounds)return[];const p=rows[index.get(r.task.predecessorId)!];if(!p.bounds)return[];const source=barGeometry(p.bounds,p.task?.kind||'project',base,width),target=barGeometry(r.bounds,r.task.kind,base,width);const x1=leftWidth+source.left+source.width,x2=leftWidth+target.left,y1=RULER+index.get(p.id)!*ROW+20,y2=RULER+i*ROW+20;return <path key={r.id} d={`M${x1},${y1} H${x1+9} V${y2} H${x2}`}/>;})}</g></svg>
      </div>}
    </div><GanttTooltip hover={hover}/>
    {rowDragging&&createPortal(<div className={`gantt-row-drag-preview ${rowDragging.drop?.allowed?'allowed':'unavailable'}`} role="status" style={{left:Math.max(8,Math.min(rowDragging.x+16,(window.innerWidth||1200)-300)),top:Math.max(8,Math.min(rowDragging.y+16,(window.innerHeight||800)-110))}}><strong><GripVertical size={14}/>{rowDragging.row.task?.title}</strong>{rowDragging.row.task?.kind==='group'&&<small>하위 작업과 함께 이동</small>}<p>{rowDragging.drop?.label??'옮길 작업이나 프로젝트 행 위로 드래그하세요.'}</p></div>,document.body)}
  </div>;
}
