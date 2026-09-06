import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tooltipGlassStyle } from '@/utils/glassStyles';
import type { GanttTask } from './types';

export interface GanttHover {
  task: GanttTask; x: number; y: number; workers: string;
  typeLabel: string; context: string; duration: string; hasDates: boolean;
  progress: number; completed: boolean; conflict?: string;
}
export function GanttTooltip({ hover, resetKey = '' }: { hover: GanttHover | null; resetKey?: string }) {
  const [shown, setShown] = useState<GanttHover | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const shownId = useRef(''), dismissedId = useRef('');
  const latest = useRef(hover);
  const inside = useRef({pointer:false,focus:false});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const lastReset = useRef(resetKey);
  latest.current = hover;
  const hide = useCallback(() => {
    clearTimeout(timer.current);shownId.current='';inside.current={pointer:false,focus:false};setShown(null);
  }, []);
  const leave = () => {
    if(latest.current||inside.current.pointer||inside.current.focus)return;
    clearTimeout(timer.current);timer.current=setTimeout(hide,60);
  };
  useEffect(()=>{
    if(lastReset.current===resetKey)return;
    lastReset.current=resetKey;dismissedId.current=latest.current?.task.id||shownId.current;hide();
  },[resetKey,hide]);
  useEffect(() => {
    clearTimeout(timer.current);
    if(!hover){
      dismissedId.current='';
      // Allow the pointer to cross the gap into a long, scrollable memo.
      if(!inside.current.pointer&&!inside.current.focus)timer.current=setTimeout(hide,160);
    }else{
      if(dismissedId.current!==hover.task.id)dismissedId.current='';
      if(!dismissedId.current)timer.current=setTimeout(()=>{shownId.current=latest.current?.task.id||'';setShown(latest.current);},120);
    }
    return () => clearTimeout(timer.current);
  }, [hover?.task.id,hide]);
  useEffect(() => {if(hover&&shownId.current===hover.task.id&&dismissedId.current!==hover.task.id)setShown(hover);},[hover]);
  useEffect(() => {
    const dismiss=()=>{dismissedId.current=latest.current?.task.id||shownId.current;hide();};
    const outside=(event:Event)=>{const target=event.target as Node|null;if(target&&box.current?.contains(target))return;dismiss();};
    const key=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||!shownId.current)return;
      // The memo owns the first Escape. Do not let the workspace close its
      // inspector or selection before the popup has returned focus.
      event.preventDefault();event.stopPropagation();
      if(box.current?.contains(document.activeElement)){
        const id=shownId.current;dismiss();
        document.querySelector<HTMLElement>(`[data-gantt-hover-anchor="${id}"]`)?.focus();
      }else dismiss();
    };
    window.addEventListener('scroll',outside,true);window.addEventListener('pointerdown',outside,true);
    window.addEventListener('wheel',outside,{passive:true});window.addEventListener('blur',dismiss);
    window.addEventListener('keydown',key,true);window.addEventListener('resize',dismiss);
    return()=>{
      clearTimeout(timer.current);
      window.removeEventListener('scroll',outside,true);window.removeEventListener('pointerdown',outside,true);
      window.removeEventListener('wheel',outside);window.removeEventListener('blur',dismiss);
      window.removeEventListener('keydown',key,true);window.removeEventListener('resize',dismiss);
    };
  },[hide]);
  useLayoutEffect(() => {
    if (!shown || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    setPosition({left:Math.max(8,Math.min(shown.x-width/2,window.innerWidth-width-8)),top:Math.max(8,Math.min(shown.y-height-12<8?shown.y+16:shown.y-height-12,window.innerHeight-height-8))});
  }, [shown]);
  if (!shown) return null;
  const t = shown.task;
  return createPortal(<div ref={box} role="tooltip" id="gantt-hover" tabIndex={0} aria-label={`${t.title} 세부정보`} className="gantt-hover gantt-detail-hover" style={{...tooltipGlassStyle,...position}}
    onPointerEnter={()=>{inside.current.pointer=true;clearTimeout(timer.current);}}
    onPointerLeave={()=>{inside.current.pointer=false;leave();}}
    onFocus={()=>{inside.current.focus=true;clearTimeout(timer.current);}}
    onBlur={()=>{inside.current.focus=false;leave();}}>
    <strong>{t.title}</strong>
    <div className="gantt-hover-summary">{shown.typeLabel} · {shown.completed?'완료':`${shown.progress}%`}{shown.duration&&` · ${shown.duration}`}</div>
    {shown.context&&<div>{shown.context}</div>}
    {shown.hasDates?<div>{t.startDate} {t.allDay?'':t.startTime} — {t.endDate} {t.allDay?'· 하루 종일':t.endTime}</div>:<div>등록된 하위 일정이 없습니다.</div>}
    {shown.workers&&<div>작업자 · {shown.workers}</div>}
    {shown.conflict&&<p className="gantt-hover-conflict">{shown.conflict}</p>}
    {t.memo&&<p className="gantt-hover-memo">{t.memo}</p>}
    {t.memo&&<small className="gantt-hover-shortcut">F2로 메모 스크롤 · Esc로 닫기</small>}
  </div>,document.body);
}
