import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tooltipGlassStyle } from '@/utils/glassStyles';
import { animateEl, EASE_CSS, MOTION_MS, prefersReducedMotion } from '@/utils/motion';
import { createTooltipWarmth, placeAnchoredTooltip, placeFollowTooltip } from '@/utils/tooltipPosition';
import type { GanttTask } from './types';

export interface GanttHover {
  /** anchorBottom 이 있으면 (x, y) 는 막대 위 끝의 기준점이고, 없으면 커서 자리다. */
  task: GanttTask; x: number; y: number; anchorBottom?: number; workers: string;
  typeLabel: string; context: string; duration: string; hasDates: boolean;
  progress: number; completed: boolean; conflict?: string; focusMemo?: boolean;
}

/*
 * 타임라인 막대 설명 카드 (움직임 폴리싱 2번 tooltip-anchor)
 * - 막대에 들어온 순간의 막대 위 가운데(막대 위 6px)에 고정한다. 예전에는 마우스가 움직일 때마다 따라오며
 *   차트 전체를 다시 그렸다.
 * - 처음 뜰 때 투명도 + 6px 아래에서 떠오르기 140ms. 웜업(카드가 떠 있거나 숨긴 지 300ms 안)이면
 *   기다리지 않고 옆 막대 위로 120ms 미끄러져 옮겨 간다.
 * - 동작 줄이기: 투명도만 100ms, 위치 이동은 즉시.
 */
const CARD_GAP = 6;
const ENTER_MS = 140;
const REDUCED_FADE_MS = 100;

export function GanttTooltip({ hover, resetKey = '' }: { hover: GanttHover | null; resetKey?: string }) {
  const [shown, setShown] = useState<GanttHover | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const shownId = useRef(''), dismissedId = useRef('');
  const latest = useRef(hover);
  const inside = useRef({pointer:false,focus:false});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const lastReset = useRef(resetKey);
  const [warmth] = useState(createTooltipWarmth);
  /** 다음에 보일 카드가 웜업으로 뜨는지(등장 효과 없이 직전 자리에서 미끄러져 옴). */
  const warmNext = useRef(false);
  /** 마지막으로 카드를 놓은 자리(숨긴 뒤에도 남겨 웜업 때 여기서 미끄러져 온다). */
  const lastSpot = useRef<{ left: number; top: number } | null>(null);
  /** 지금 떠 있는 카드의 할 일 id(숨기면 비운다 — 다음에 같은 막대로 와도 새로 뜬다). */
  const placedId = useRef('');
  latest.current = hover;
  const hide = useCallback(() => {
    clearTimeout(timer.current);shownId.current='';placedId.current='';inside.current={pointer:false,focus:false};setShown(null);
  }, []);
  // 막대에서 벗어나 저절로 숨을 때만 웜업을 남긴다(스크롤·클릭·Esc·데이터 변경으로 닫으면 끊는다).
  const hideSoft = useCallback(() => {
    if(shownId.current)warmth.markHidden(performance.now());
    hide();
  }, [hide, warmth]);
  const leave = () => {
    if(latest.current||inside.current.pointer||inside.current.focus)return;
    clearTimeout(timer.current);timer.current=setTimeout(hideSoft,60);
  };
  useEffect(()=>{
    if(lastReset.current===resetKey)return;
    lastReset.current=resetKey;dismissedId.current=latest.current?.task.id||shownId.current;warmth.reset();hide();
  },[resetKey,hide,warmth]);
  useEffect(() => {
    clearTimeout(timer.current);
    if(!hover){
      dismissedId.current='';
      // Allow the pointer to cross the gap into a long, scrollable memo.
      if(!inside.current.pointer&&!inside.current.focus)timer.current=setTimeout(hideSoft,160);
    }else if(hover.focusMemo){
      dismissedId.current='';shownId.current=hover.task.id;warmNext.current=false;setShown(hover);
    }else{
      if(dismissedId.current!==hover.task.id)dismissedId.current='';
      if(!dismissedId.current){
        // 웜업: 카드가 떠 있거나(옆 막대로 옮김) 방금 숨겼으면 기다리지 않는다.
        if(shownId.current||warmth.isWarm(performance.now())){warmNext.current=true;shownId.current=hover.task.id;setShown(hover);}
        else timer.current=setTimeout(()=>{warmNext.current=false;shownId.current=latest.current?.task.id||'';setShown(latest.current);},120);
      }
    }
    return () => clearTimeout(timer.current);
  }, [hover?.task.id,hover?.focusMemo,hide,hideSoft,warmth]);
  useEffect(() => {if(hover&&shownId.current===hover.task.id&&dismissedId.current!==hover.task.id)setShown(hover);},[hover]);
  useEffect(() => {
    const dismiss=()=>{dismissedId.current=latest.current?.task.id||shownId.current;warmth.reset();hide();};
    const outside=(event:Event)=>{const target=event.target as Node|null;if(target&&box.current?.contains(target))return;dismiss();};
    const key=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||!shownId.current)return;
      // The memo owns the first Escape. Do not let the workspace close its
      // inspector or selection before the popup has returned focus.
      event.preventDefault();event.stopPropagation();
      if(box.current?.contains(document.activeElement)){
        const id=shownId.current;dismiss();
        document.querySelector<HTMLElement>(`button.gantt-bar[data-gantt-hover-anchor="${id}"]`)?.focus();
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
  },[hide,warmth]);
  useLayoutEffect(() => {
    if (!shown || !box.current) return;
    const el = box.current;
    if(shown.focusMemo)el.focus();
    const { width, height } = el.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const placement = shown.anchorBottom === undefined
      ? placeFollowTooltip({ x: shown.x, y: shown.y }, { width, height }, viewport)
      : placeAnchoredTooltip({ x: shown.x, top: shown.y, bottom: shown.anchorBottom }, { width, height }, viewport, { gapAbove: CARD_GAP });
    const next = { left: placement.left, top: placement.top };
    const previous = lastSpot.current;
    const isNewCard = placedId.current !== shown.task.id;
    lastSpot.current = next;
    placedId.current = shown.task.id;
    setPosition(next);
    if (!isNewCard) return; // 같은 카드의 내용·자리만 바뀜
    const reduce = prefersReducedMotion();
    if (warmNext.current && previous) {
      // 직전 자리에서 새 자리로 미끄러진다(left/top 은 한 번에 바꾸고 translate 로 거꾸로 당겼다 푼다).
      if (!reduce && (previous.left !== next.left || previous.top !== next.top)) {
        animateEl(el, [
          { translate: `${previous.left - next.left}px ${previous.top - next.top}px` },
          { translate: '0px 0px' },
        ], { duration: MOTION_MS.fast, easing: EASE_CSS.snap }, false);
      }
      return;
    }
    const from = placement.below ? 'translateY(-6px)' : 'translateY(6px)';
    animateEl(el, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }],
      { duration: reduce ? REDUCED_FADE_MS : ENTER_MS, easing: EASE_CSS.out }, reduce);
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
