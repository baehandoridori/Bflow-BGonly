import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Minus, Plus, Scan } from 'lucide-react';
import { durationLabel, resolveTaskColor, taskBounds, taskConflicts } from './domain';
import { barGeometry, rebaseScroll, zoomScroll } from './geometry';
import { GanttTooltip, type GanttHover } from './GanttTooltip';
import type { GanttProject, GanttTask } from './types';

const DAY = 86400000, ROW = 40, RULER = 48;
const dateMs = (d: string) => Date.parse(d + 'T00:00:00Z');
const dayDiff = (a: string, b: string) => Math.round((dateMs(b) - dateMs(a)) / DAY);
export const moveDate = (date: string, days: number) => new Date(dateMs(date) + days * DAY).toISOString().slice(0, 10);
export const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
interface ChartRow { id: string; project: GanttProject; task: GanttTask | null; depth: number; bounds: ReturnType<typeof taskBounds> }
interface Props {
  projects: GanttProject[]; selected: string[]; done: boolean; worker: string;
  collapsed: string[]; onCollapse: (id: string) => void; names: Record<string, string>;
  canEdit: (p: GanttProject) => boolean;
  onSelect: (projectId: string, taskId: string | null, multiple?: boolean) => void;
  onPatch: (p: GanttProject, task: GanttTask, patch: Partial<GanttTask>) => void;
  onMenu: (p: GanttProject, task: GanttTask | null, x: number, y: number) => void;
  onAdd: (p: GanttProject, parentId: string | null, start: string, end: string) => void;
}
export function GanttCanvas(props: Props) {
  const { projects, selected, done, worker, collapsed, onCollapse, names } = props;
  const chart = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(48), widthRef = useRef(48);
  const [layout, setLayout] = useState<'beside' | 'list'>(() => localStorage.getItem('bflow-gantt-name-layout') === 'list' ? 'list' : 'beside');
  const [hover, setHover] = useState<GanttHover | null>(null);
  const [drag, setDrag] = useState<{ id: string; delta: number; edge?: string } | null>(null);
  const [creating, setCreating] = useState<{ id: string; first: number; last: number } | null>(null);
  const dragRef = useRef<{ row: ChartRow; x: number; edge?: string; delta: number; pointer: number; create?: boolean; first?: number } | null>(null);
  const suppressClick = useRef(false), zoomFrame = useRef(0), goal = useRef(48), pointer = useRef(0);
  const leftWidth = layout === 'list' ? 280 : 0;
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
      const leaves = p.tasks.filter(t => t.kind !== 'group');
      const wanted = (t: GanttTask) => done ? t.completed || t.progress === 100 : !t.completed && t.progress !== 100;
      if (done ? !p.completed && !leaves.some(wanted) : p.completed) continue;
      result.push({ id: p.id, project: p, task: null, depth: 0, bounds: taskBounds(p) });
      if (collapsed.includes(p.id)) continue;
      const descendants = (id: string): GanttTask[] => p.tasks.filter(t => t.parentId === id).flatMap(t => [t, ...descendants(t.id)]);
      const visit = (parent: string | null, depth: number) => {
        for (const t of p.tasks.filter(t => t.parentId === parent).sort((a,b) => a.sortOrder-b.sortOrder)) {
          const children = t.kind === 'group' ? descendants(t.id).filter(c => c.kind !== 'group') : [];
          if (t.kind === 'group' ? children.length ? !children.some(wanted) : done : !wanted(t)) continue;
          if (worker && !t.workers.includes(worker) && !children.some(c => c.workers.includes(worker) && wanted(c))) continue;
          result.push({ id: t.id, project: p, task: t, depth, bounds: t.kind === 'group' ? taskBounds(p,t.id) : t });
          if (!collapsed.includes(t.id)) visit(t.id,depth+1);
        }
      };
      visit(null,1);
    }
    return result;
  }, [projects, done, worker, collapsed]);
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
  useEffect(() => { setHover(null); }, [projects, done, collapsed]);
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
    if(e.button!==0||!props.canEdit(row.project)||done)return;
    if(!create&&(!row.task||row.task.kind==='group'))return;
    const target=e.currentTarget as HTMLElement;
    const first=create?Math.max(0,Math.floor((e.clientX-target.getBoundingClientRect().left)/widthRef.current)):0;
    dragRef.current={row,x:e.clientX,edge,delta:0,pointer:e.pointerId,create,first};suppressClick.current=false;
    target.setPointerCapture(e.pointerId);setHover(null);stopZoom();if(!create)e.preventDefault();
  }
  function moveDrag(e: React.PointerEvent) {
    const d=dragRef.current;if(!d)return;d.delta=Math.round((e.clientX-d.x)/widthRef.current);
    if(d.create){setCreating({id:d.row.id,first:d.first!,last:Math.max(0,d.first!+d.delta)});return;}
    setDrag({id:d.row.id,delta:d.delta,edge:d.edge});
  }
  function endDrag() {
    const d=dragRef.current;dragRef.current=null;setDrag(null);setCreating(null);if(!d||!d.delta)return;
    suppressClick.current=true;
    if(d.create){const first=Math.min(d.first!,d.first!+d.delta),last=Math.max(d.first!,d.first!+d.delta);props.onAdd(d.row.project,d.row.task?.kind==='group'?d.row.id:d.row.task?.parentId||null,moveDate(base,Math.max(0,first)),moveDate(base,Math.max(0,last)));return;}
    const t=d.row.task!;const patch=d.edge==='start'?{startDate:moveDate(t.startDate,d.delta)}:d.edge==='end'?{endDate:moveDate(t.endDate,d.delta)}:{startDate:moveDate(t.startDate,d.delta),endDate:moveDate(t.endDate,d.delta)};
    if((patch.startDate||t.startDate)<=(patch.endDate||t.endDate))props.onPatch(d.row.project,t,patch);
  }
  const index=new Map(rows.map((r,i)=>[r.id,i]));
  const conflicts = new Map(projects.flatMap(project => taskConflicts(project).map(c => [c.id, c.message] as const)));
  return <div className="gantt-canvas-wrap">
    <div className="gantt-caption"><strong>{base.slice(0,4)}년 {Number(firstDate.slice(5,7))}월</strong><span>{Math.round(width/48*100)}%</span>
      <button onClick={()=>setLayout(v=>{const n=v==='beside'?'list':'beside';localStorage.setItem('bflow-gantt-name-layout',n);return n;})}>작업명 · {layout==='beside'?'막대 옆':'목록'}</button>
      <small>휠 확대·축소 · Shift+휠 이동</small><button aria-label="축소" onClick={()=>zoomTo(width*.8,(chart.current?.clientWidth||800)/2)}><Minus size={14}/></button><button aria-label="확대" onClick={()=>zoomTo(width*1.25,(chart.current?.clientWidth||800)/2)}><Plus size={14}/></button><button onClick={fit}><Scan size={14}/> 전체 맞춤</button>
    </div>
    <div ref={chart} className={`gantt-canvas ${layout}`} tabIndex={0} aria-label="프로젝트 간트" style={{'--gantt-day':`${width}px`,'--gantt-label':`${leftWidth}px`} as React.CSSProperties} onScroll={e=>{setHover(null);if(rows.length)savedScroll.current={left:e.currentTarget.scrollLeft,top:e.currentTarget.scrollTop};}} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={()=>{dragRef.current=null;setDrag(null);setCreating(null);}}>
      {!rows.length?<div className="gantt-empty"><strong>{done?'완료한 일정이 없습니다':'표시 중인 프로젝트가 없습니다'}</strong><p>{done?'작업이나 프로젝트를 완료하면 이곳에 모입니다.':'폴더에서 프로젝트를 켜거나 새 프로젝트를 만드세요.'}</p></div>:<div className="gantt-grid" style={{width:leftWidth+days*width}}>
        <div className="gantt-ruler">{layout==='list'&&<div className="gantt-list-label">프로젝트 / 작업</div>}<div className="gantt-dates">{Array.from({length:days},(_,i)=>{const date=moveDate(base,i),week=new Date(dateMs(date)).getUTCDay();return <div key={date} className={`gantt-date ${week===0||week===6?'weekend':''}`} style={{width}}>{width>26||i%Math.ceil(38/width)===0?date.slice(5).replace('-','/'):''}{width>38&&<small>{'일월화수목금토'[week]}</small>}{width>=240&&<div className="gantt-hours">00　06　12　18</div>}</div>;})}</div></div>
        {rows.map(r=>{
          const group=!r.task||r.task.kind==='group',t=r.task,b=r.bounds;
          const geometry=b?barGeometry(b,t?.kind||'project',base,width):{left:0,width:0};
          let x=geometry.left,barWidth=geometry.width;
          if(drag?.id===r.id){if(drag.edge==='start'){x+=drag.delta*width;barWidth-=drag.delta*width}else if(drag.edge==='end')barWidth+=drag.delta*width;else x+=drag.delta*width;}
          const color=t?resolveTaskColor(r.project,t):r.project.color;
          const title=t?.title||r.project.name;
          const label=<><span>{title}</span>{group&&<button aria-label={`${title} ${collapsed.includes(r.id)?'펼치기':'접기'}`} onClick={e=>{e.stopPropagation();onCollapse(r.id);}}>{collapsed.includes(r.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>}</>;
          return <div key={r.id} className={`gantt-row ${!t?'project':''} ${selected.includes(r.id)?'selected':''}`} style={{'--gantt-color':color} as React.CSSProperties} onClick={e=>{if(suppressClick.current){suppressClick.current=false;return;}props.onSelect(r.project.id,t?.id||null,e.ctrlKey||e.metaKey);}} onContextMenu={e=>{e.preventDefault();setHover(null);props.onMenu(r.project,t,e.clientX,e.clientY);}}>
            {layout==='list'&&<div className="gantt-list-label" style={{paddingLeft:10+r.depth*13}} onPointerMove={e=>showHover(r,e.clientX,e.clientY)} onPointerLeave={()=>setHover(null)}>{label}</div>}
            <div className="gantt-track" onPointerDown={e=>{if(e.target===e.currentTarget)startDrag(e,r,undefined,true);}} onDoubleClick={e=>{if(e.target!==e.currentTarget||!props.canEdit(r.project)||done)return;const day=Math.floor((e.clientX-e.currentTarget.getBoundingClientRect().left)/width);const date=moveDate(base,day);props.onAdd(r.project,t?.kind==='group'?t.id:t?.parentId||null,date,date);}}>
              {b&&<div className={`gantt-bar-position ${conflicts.has(r.id)?'conflict':''}`} style={{left:x,width:Math.max(6,barWidth)}}>
                {layout==='beside'&&<div className={`gantt-inline-name ${x<Math.min(270,title.length*8+34)?'after':''}`} onPointerMove={e=>showHover(r,e.clientX,e.clientY)} onPointerLeave={()=>setHover(null)}>{label}</div>}
                <button className={`gantt-bar ${group?'group':t?.kind||''}`} aria-label={`${title}, ${durationLabel({...t,...b,kind:t?.kind||'group'} as GanttTask)}`} aria-describedby={hover?.task.id===r.id?'gantt-hover':undefined} onPointerDown={e=>startDrag(e,r,(e.target as HTMLElement).dataset.edge)} onPointerMove={e=>showHover(r,e.clientX,e.clientY)} onPointerLeave={()=>setHover(null)} onFocus={e=>{const rect=e.currentTarget.getBoundingClientRect();showHover(r,(rect.left+rect.right)/2,rect.top);}} onBlur={()=>setHover(null)} onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();const q=e.currentTarget.getBoundingClientRect();props.onMenu(r.project,t,q.left,q.bottom);}if(e.key==='Enter')props.onSelect(r.project.id,t?.id||null);}}>
                  {!group&&t?.kind!=='milestone'&&<><span className="gantt-progress" style={{width:`${t?.progress||0}%`}}/>{props.canEdit(r.project)&&<><span data-edge="start" className="gantt-resize start"/><span data-edge="end" className="gantt-resize end"/></>}</>}
                </button>
                <span className="gantt-duration">{durationLabel({...t,...b,kind:t?.kind||'group'} as GanttTask)}{conflicts.has(r.id)&&<span aria-label={conflicts.get(r.id)}> · !</span>}</span>
              </div>}
              {!b&&layout==='beside'&&<div className="gantt-empty-project">{label}<small>{t?.kind==='group'?'하위 작업을 추가하세요':'날짜 영역을 드래그해 첫 작업을 만드세요'}</small></div>}
              {creating?.id===r.id&&<div className="gantt-creation" style={{left:Math.min(creating.first,creating.last)*width,width:(Math.abs(creating.last-creating.first)+1)*width}}/>}
            </div>
          </div>;
        })}
        <svg className="gantt-dependencies" width="100%" height={RULER+rows.length*ROW} aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1">{rows.flatMap((r,i)=>{if(!r.task?.predecessorId||!index.has(r.task.predecessorId)||!r.bounds)return[];const p=rows[index.get(r.task.predecessorId)!];if(!p.bounds)return[];const source=barGeometry(p.bounds,p.task?.kind||'project',base,width),target=barGeometry(r.bounds,r.task.kind,base,width);const x1=leftWidth+source.left+source.width,x2=leftWidth+target.left,y1=RULER+index.get(p.id)!*ROW+20,y2=RULER+i*ROW+20;return <path key={r.id} d={`M${x1},${y1} H${x1+9} V${y2} H${x2}`}/>;})}</g></svg>
      </div>}
    </div><GanttTooltip hover={hover}/>
  </div>;
}
