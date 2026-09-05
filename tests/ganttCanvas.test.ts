import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { createProject, createTask } from '../src/features/gantt/domain.ts';
import type { GanttProject, GanttTask } from '../src/features/gantt/types.ts';

type Element = ReactElement<Record<string, any>>;
function elements(node:ReactNode):Element[] {if(Array.isArray(node))return node.flatMap(elements);if(!isValidElement(node))return [];const el=node as Element;return [el,...elements(el.props.children)];}
function text(node:ReactNode):string {if(Array.isArray(node))return node.map(text).join('');if(isValidElement(node))return text((node as Element).props.children);return typeof node==='string'||typeof node==='number'?String(node):'';}
function find(tree:ReactNode,predicate:(element:Element)=>boolean):Element {const result=elements(tree).find(predicate);assert.ok(result,'expected event-bearing element');return result;}
const hasClass=(element:Element,value:string)=>element.props.className?.split(' ').includes(value);
const bundle=build({entryPoints:['src/features/gantt/GanttCanvas.tsx'],bundle:true,format:'cjs',platform:'node',target:'node22',write:false,loader:{'.css':'empty'},external:['react','react/jsx-runtime','react-dom','lucide-react']});

// Real component/event handlers; DOM geometry/capture are doubles. Browser hit
// testing and actual pointer behavior require a separate UI verification.
async function harness(options:{editable?:boolean;completed?:boolean;clampScroll?:boolean;statusFilter?:'all'|'active'|'completed';configure?:(project:GanttProject)=>void}={}) {
  const task=createTask('검증 작업','2026-09-05');task.endDate='2026-09-07';task.completed=options.completed??false;
  const project=createProject('검증 프로젝트',crypto.randomUUID(),'owner');project.tasks=[task];options.configure?.(project);
  const states:unknown[]=[],refs:any[]=[],effectSlots:Array<{deps?:unknown[];cleanup?:()=>void}>=[],callbackSlots:Array<{deps:unknown[];fn:unknown}>=[];
  let stateCursor=0,refCursor=0,effectCursor=0,callbackCursor=0;
  const pendingEffects:Array<()=>void>=[];
  const saved:Array<Partial<GanttTask>>=[],created:Array<{parentId:string|null;start:string;end:string}>=[],captured:number[]=[],released:number[]=[],selections:string[]=[],menus:string[]=[],relocations:Array<{source:string;task:string;target:string;targetTask:string|null;position:string}>=[];
  const listeners=new Map<string,(event:any)=>void>(),windowListeners=new Map<string,(event:any)=>void>(),frames=new Map<number,()=>void>();let frameId=0,capturedPointer:number|null=null;
  function dom(classes='',parent:any=null,tag='DIV'):any {return {parentElement:parent,tagName:tag,dataset:{},classList:{contains:(value:string)=>classes.split(' ').includes(value)},
    closest(selector:string){for(const item of selector.split(',').map(value=>value.trim()))if(item.startsWith('.')?classes.split(' ').includes(item.slice(1)):item.toUpperCase()===tag)return this;return parent?.closest(selector)??null;},
    getBoundingClientRect:()=>({left:100,top:0,width:1200,bottom:40}),setPointerCapture(id:number){capturedPointer=id;captured.push(id);},hasPointerCapture:(id:number)=>capturedPointer===id,releasePointerCapture(id:number){capturedPointer=null;released.push(id);}};}
  const rulerHeight=()=>Number.parseFloat(canvas?.props.style?.['--gantt-ruler-height'])||48;
  const chart={...dom('gantt-canvas'),scrollLeft:0,scrollTop:0,clientWidth:1200,clientHeight:600,style:{setProperty(){}},addEventListener:(name:string,fn:(event:any)=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name),contains(target:any){for(let node=target;node;node=node.parentElement)if(node===chart)return true;return false;},querySelectorAll(){return elements(tree).filter(e=>hasClass(e,'gantt-row')).map((e,i)=>({dataset:{rowId:e.props['data-row-id'],projectId:e.props['data-project-id']},getBoundingClientRect:()=>({left:100,right:1300,top:rulerHeight()+i*40-chart.scrollTop,bottom:rulerHeight()+(i+1)*40-chart.scrollTop,height:40})}));},focus(){}};
  const trackNode=dom('gantt-track',chart),barNode=dom('gantt-bar',trackNode,'BUTTON'),document={activeElement:chart};
  const window={addEventListener:(name:string,fn:(event:any)=>void)=>windowListeners.set(name,fn),removeEventListener:(name:string)=>windowListeners.delete(name)};
  const nodeRequire=createRequire(import.meta.url),react=nodeRequire('react');
  const module={exports:{} as {GanttCanvas:(props:any)=>ReactNode;localDate:()=>string;moveDate:(date:string,days:number)=>string}};
  const sameDeps=(a?:unknown[],b?:unknown[])=>!!a&&!!b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  function effect(fn:()=>unknown,deps?:unknown[]){const slot=effectCursor++,previous=effectSlots[slot];if(!previous||!sameDeps(previous.deps,deps))pendingEffects.push(()=>{previous?.cleanup?.();const cleanup=fn();effectSlots[slot]={deps,cleanup:typeof cleanup==='function'?cleanup as ()=>void:undefined};});}
  new Function('require','module','exports','localStorage','requestAnimationFrame','cancelAnimationFrame','matchMedia','window','document',(await bundle).outputFiles[0].text)(
    (id:string)=>{if(id==='react')return {...react,useState(initial:unknown){const slot=stateCursor++;if(!(slot in states))states[slot]=typeof initial==='function'?(initial as ()=>unknown)():initial;return [states[slot],(next:unknown)=>{states[slot]=typeof next==='function'?(next as (x:unknown)=>unknown)(states[slot]):next;}];},useRef(initial:unknown){return refs[refCursor++]??={current:initial};},useMemo(fn:()=>unknown){return fn();},useCallback(fn:unknown,deps:unknown[]){const slot=callbackCursor++;if(!callbackSlots[slot]||!sameDeps(callbackSlots[slot].deps,deps))callbackSlots[slot]={fn,deps};return callbackSlots[slot].fn;},useEffect:effect,useLayoutEffect:effect};if(id==='react-dom')return {createPortal:(node:ReactNode)=>node};if(id==='lucide-react')return new Proxy({},{get:()=>()=>null});return nodeRequire(id);},
    module,module.exports,{getItem:()=>null,setItem(){}},(fn:()=>void)=>{frames.set(++frameId,fn);return frameId;},(id:number)=>frames.delete(id),()=>({matches:true}),window,document);
  const props={projects:[project],selected:[],statusFilter:options.statusFilter??'all',worker:'',collapsed:[] as string[],names:{},canEdit:(_p?:GanttProject)=>options.editable??true,onCollapse(){},onSelect(_projectId:string,taskId:string|null){selections.push(taskId??project.id);},onMenu(_project:GanttProject,selected:GanttTask|null){menus.push(selected?.id??project.id);},onPatch(_p:unknown,_t:unknown,patch:Partial<GanttTask>){saved.push(patch);},onAdd(_p:unknown,parentId:string|null,start:string,end:string){created.push({parentId,start,end});},onRelocate(source:GanttProject,task:GanttTask,target:GanttProject,targetTask:string|null,position:string){relocations.push({source:source.id,task:task.id,target:target.id,targetTask,position});}};
  let tree:ReactNode,canvas:Element;
  if(options.clampScroll){let left=0;Object.defineProperty(chart,'scrollLeft',{get:()=>left,set(value:number){const grid=elements(tree).find(e=>hasClass(e,'gantt-grid'));left=Math.max(0,Math.min(value,Math.max(0,(grid?.props.style.width??0)-chart.clientWidth)));}});}
  function render(){stateCursor=refCursor=effectCursor=callbackCursor=0;tree=module.exports.GanttCanvas(props);canvas=find(tree,e=>e.props['aria-label']==='프로젝트 간트');(canvas as unknown as {ref:{current:unknown}}).ref.current=chart;if(options.clampScroll)chart.scrollLeft=chart.scrollLeft;pendingEffects.splice(0).forEach(fn=>fn());return tree;}
  render();
  const row=(title=task.title)=>find(tree,e=>hasClass(e,'gantt-row')&&elements(e).some(child=>hasClass(child,'gantt-row-title')&&text(child)===title)),bar=()=>find(row(),e=>hasClass(e,'gantt-bar')),track=()=>find(row(),e=>hasClass(e,'gantt-track'));
  function pointer(x:number,y=100,pointerId=7,target=chart):any {return {button:0,pointerId,clientX:x,clientY:y,currentTarget:chart,target,stopped:false,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};}
  function down(blank:boolean,x=400,y=100,edge?:string,pointerId=7){render();const node=blank?trackNode:barNode,target=edge?{...dom('gantt-resize',barNode,'SPAN'),dataset:{edge}}:node,event=pointer(x,y,pointerId,target);canvas.props.onPointerDownCapture?.(event);if(!event.stopped){event.currentTarget=node;(blank?track():bar()).props.onPointerDown?.(event);}return event;}
  return {saved,created,captured,released,selections,menus,relocations,chart,task,project,props,render,
    labelDown(title=task.title,pointerId=7){render();const label=find(row(title),e=>hasClass(e,'gantt-name')),node=dom('gantt-name',trackNode),event=pointer(150,108,pointerId,node);canvas.props.onPointerDownCapture?.(event);if(!event.stopped){event.currentTarget=node;label.props.onPointerDown?.(event);}},
    rowMove(title:string,part:'before'|'after'|'inside'='inside',pointerId=7){const list=elements(tree).filter(e=>hasClass(e,'gantt-row')),index=list.indexOf(row(title));canvas.props.onPointerMove(pointer(160,rulerHeight()+index*40+(part==='before'?4:part==='after'?36:20)-chart.scrollTop,pointerId));render();},
    progress(title:string){return find(row(title),e=>e.props.role==='progressbar').props['aria-valuenow'];},preview(){return text(find(render(),e=>hasClass(e,'gantt-row-drag-preview')));},
    down(x=400,edge?:string,y=100,pointerId=7){return down(false,x,y,edge,pointerId);},blankDown(x:number,y=100,pointerId=7){return down(true,x,y,undefined,pointerId);},move(x:number,y=100,pointerId=7){canvas.props.onPointerMove(pointer(x,y,pointerId));},up(pointerId=7){canvas.props.onPointerUp(pointer(400,100,pointerId));},cancel(pointerId=7){canvas.props.onPointerCancel(pointer(400,100,pointerId));},lost(pointerId=7){canvas.props.onLostPointerCapture?.(pointer(400,100,pointerId));},
    click(detail=1){const event={...pointer(400),detail};canvas.props.onClickCapture?.(event);if(!event.stopped)row().props.onClick(event);return event;},doubleClick(x=340){const event=pointer(x,100,7,trackNode);event.currentTarget=trackNode;canvas.props.onDoubleClickCapture?.(event);if(!event.stopped)track().props.onDoubleClick(event);},
    mode(label:'화면 이동'|'작업 만들기'){find(render(),e=>e.type==='button'&&e.props['aria-label']===label).props.onClick();render();},
    key(key:string,down=true,input:boolean|'button'=false){const target=input?dom('',chart,input==='button'?'BUTTON':'INPUT'):chart,event={...pointer(0,0,7,target),key,code:key===' '?'Space':key,repeat:false};windowListeners.get(down?'keydown':'keyup')?.(event);render();return event;},blur(){windowListeners.get('blur')?.({});render();},
    menu(title:string){find(render(),e=>e.props['aria-label']===`${title} 메뉴`).props.onClick({...pointer(0),currentTarget:barNode});},rows(){return elements(render()).filter(e=>hasClass(e,'gantt-row')).map(e=>text(e));},rowCompleted(title:string){return text(find(render(),e=>hasClass(e,'gantt-row')&&text(e).includes(title))).includes('완료');},
    wheel(event:Record<string,unknown>){let prevented=false;listeners.get('wheel')!({clientX:600,deltaX:0,deltaY:-100,deltaMode:0,shiftKey:false,preventDefault(){prevented=true;},...event});return prevented;},frames(){for(const [id,fn]of [...frames]){frames.delete(id);fn();}},width:()=>states[0] as number,
    navigate(label:string){find(render(),e=>e.type==='button'&&e.props['aria-label']===label).props.onClick();render();render();},
    weekDown(){render();const target=dom('gantt-week',dom('gantt-weeks',dom('gantt-date-axis',chart)));canvas.props.onPointerDownCapture(pointer(600,15,7,target));},
    caption(){return text(find(render(),e=>e.props['aria-label']==='현재 표시 월'));},
    axisStart(){return find(render(),e=>hasClass(e,'gantt-date')).props['data-date'] as string;},
    labelWidth(){return Number.parseFloat(canvas.props.style['--gantt-label']);},rulerHeight,
    scrollToDate(date:string){const start=find(render(),e=>hasClass(e,'gantt-date')).props['data-date'];chart.scrollLeft=(Date.parse(date)-Date.parse(start))/86400000*(states[0] as number);canvas.props.onScroll({currentTarget:chart});render();},
    resize(size:number){chart.clientWidth=size;windowListeners.get('resize')?.({});render();render();},
    base:module.exports.moveDate(task.startDate<module.exports.localDate()?task.startDate:module.exports.localDate(),-6),today:module.exports.localDate,moveDate:module.exports.moveDate,dispose(){effectSlots.forEach(slot=>slot.cleanup?.());},
  };
}

test('manual bar drag invokes date patch once on release and preserves duration',async()=>{const h=await harness();try{h.down();h.move(496);assert.deepEqual(h.saved,[]);h.up();assert.deepEqual(h.saved,[{startDate:'2026-09-07',endDate:'2026-09-09'}]);assert.deepEqual(h.captured,[7]);h.up();assert.equal(h.saved.length,1);}finally{h.dispose();}});
test('start and end resize patch only selected edge and reject inversion',async()=>{for(const [edge,x,expected]of [['start',448,{startDate:'2026-09-06'}],['end',544,{endDate:'2026-09-10'}]] as const){const h=await harness();try{h.down(400,edge);h.move(x);h.up();assert.deepEqual(h.saved,[expected]);}finally{h.dispose();}}const h=await harness();try{h.down(400,'start');h.move(592);h.up();assert.deepEqual(h.saved,[]);}finally{h.dispose();}});
test('default blank drag pans both axes without creating or editing an item',async()=>{const h=await harness();try{h.chart.scrollLeft=300;h.chart.scrollTop=200;h.blankDown(400,100);h.move(460,130);h.up();assert.equal(h.chart.scrollLeft,240);assert.equal(h.chart.scrollTop,170);assert.deepEqual(h.saved,[]);assert.deepEqual(h.created,[]);h.click();assert.deepEqual(h.selections,[]);}finally{h.dispose();}});
test('create mode makes ranges both ways while pan mode never double-click creates',async()=>{for(const [from,to,first,last]of [[340,484,5,8],[484,340,5,8]]){const h=await harness();try{h.doubleClick();assert.deepEqual(h.created,[]);h.mode('작업 만들기');h.blankDown(from);h.move(to);assert.deepEqual(h.created,[]);h.up();assert.deepEqual(h.created,[{parentId:null,start:h.moveDate(h.base,first),end:h.moveDate(h.base,last)}]);assert.deepEqual(h.saved,[]);}finally{h.dispose();}}});
test('Space temporarily pans over bars and release restores date editing',async()=>{const h=await harness();try{h.chart.scrollLeft=300;assert.equal(h.key(' ').defaultPrevented,true);h.down();h.move(448,140);h.up();assert.equal(h.chart.scrollLeft,252);assert.deepEqual(h.saved,[]);h.key(' ',false);h.down();h.move(448);h.up();assert.deepEqual(h.saved,[{startDate:'2026-09-06',endDate:'2026-09-08'}]);}finally{h.dispose();}});
test('Space in text input neither arms pan nor prevents typing',async()=>{const h=await harness();try{assert.equal(h.key(' ',true,true).defaultPrevented,false);h.down();h.move(448);h.up();assert.equal(h.saved.length,1);}finally{h.dispose();}});
test('Space leaves menu and collapse button keyboard activation available',async()=>{const h=await harness();try{assert.equal(h.key(' ',true,'button').defaultPrevented,false);h.down();h.move(448);h.up();assert.equal(h.saved.length,1);}finally{h.dispose();}});
test('foreign pointer move release and lost capture cannot finish active gesture',async()=>{const h=await harness();try{h.down();h.move(544,100,8);h.up(8);h.lost(8);assert.deepEqual(h.saved,[]);h.move(448);h.up();assert.deepEqual(h.saved,[{startDate:'2026-09-06',endDate:'2026-09-08'}]);}finally{h.dispose();}});
test('cancel lost capture Escape and blur discard drafts and release captures',async()=>{for(const abort of ['cancel','lost','escape','blur'] as const){const h=await harness();try{h.down();h.move(496);if(abort==='escape')h.key('Escape');else h[abort]();h.up();assert.deepEqual(h.saved,[]);if(abort!=='lost')assert.deepEqual(h.released,[7]);h.down();h.move(448);h.up();assert.equal(h.saved.length,1);}finally{h.dispose();}}});
test('blur clears Space and a later click is not eaten after cancellation',async()=>{const h=await harness();try{h.key(' ');h.down();h.move(450);h.blur();h.up();h.down();h.up();h.click();assert.equal(h.selections.length,1);h.down();h.move(448);h.up();assert.equal(h.saved.length,1);}finally{h.dispose();}});
test('tiny motion remains a click and real pan suppresses click and double-click',async()=>{const h=await harness();try{h.blankDown(400);h.move(402,101);h.up();h.click();assert.equal(h.selections.length,1);h.mode('작업 만들기');h.key(' ');h.blankDown(400);h.move(480);h.up();h.key(' ',false);h.click();h.doubleClick();assert.equal(h.selections.length,1);assert.deepEqual(h.created,[]);}finally{h.dispose();}});
test('completed and read-only charts retain navigation but never mutate dates',async()=>{for(const options of [{editable:false},{completed:true},{configure:(p:GanttProject)=>{p.completed=true;}}]){const h=await harness(options);try{h.chart.scrollLeft=300;h.blankDown(400);h.move(448);h.up();assert.equal(h.chart.scrollLeft,252);h.down();h.move(496);h.up();h.mode('작업 만들기');h.blankDown(340);h.move(484);h.up();assert.deepEqual(h.saved,[]);assert.deepEqual(h.created,[]);}finally{h.dispose();}}});
test('all view keeps completed work visible with completion badge and row menu',async()=>{const h=await harness({completed:true});try{assert.ok(h.rows().some(row=>row.includes('검증 작업')));assert.equal(h.rowCompleted('검증 작업'),true);h.menu('검증 작업');assert.deepEqual(h.menus,[h.task.id]);assert.deepEqual(h.created,[]);assert.deepEqual(h.saved,[]);}finally{h.dispose();}});
test('active and completed filters keep mixed ancestors and empty completed groups',async()=>{const configure=(p:GanttProject)=>{const group=createTask('혼합 그룹');group.kind='group';const empty=createTask('빈 완료 그룹');empty.kind='group';empty.completed=true;const finished=createTask('끝난 작업');finished.completed=true;finished.parentId=group.id;p.tasks[0].parentId=group.id;p.tasks=[group,...p.tasks,finished,empty];};const h=await harness({configure});try{assert.equal(h.rows().length,5);assert.equal(h.rowCompleted('혼합 그룹'),false);assert.equal(h.rowCompleted('빈 완료 그룹'),true);h.props.statusFilter='active';const active=h.rows();assert.equal(active.length,3);assert.ok(active.some(row=>row.includes('혼합 그룹')));assert.ok(active.some(row=>row.includes('검증 작업')));assert.ok(!active.some(row=>row.includes('끝난 작업')));h.props.statusFilter='completed';const completed=h.rows();assert.equal(completed.length,4);assert.ok(completed.some(row=>row.includes('혼합 그룹')));assert.ok(completed.some(row=>row.includes('끝난 작업')));assert.ok(completed.some(row=>row.includes('빈 완료 그룹')));assert.ok(!completed.some(row=>row.includes('검증 작업')));}finally{h.dispose();}});
test('completed nested empty group keeps every ancestor in completed filter',async()=>{const h=await harness({statusFilter:'completed',configure(p){const parent=createTask('상위 그룹');parent.kind='group';const empty=createTask('하위 빈 그룹');empty.kind='group';empty.completed=true;empty.parentId=parent.id;p.tasks=[parent,empty];}});try{const rows=h.rows();assert.equal(rows.length,3);assert.ok(rows.some(row=>row.includes('상위 그룹')));assert.ok(rows.some(row=>row.includes('하위 빈 그룹')));}finally{h.dispose();}});
test('wheel keeps cursor anchor and Shift scrolls without zoom',async()=>{const h=await harness();try{h.chart.scrollLeft=320;const cursor=120,before=(h.chart.scrollLeft+cursor)/h.width();assert.equal(h.wheel({}),true);h.frames();assert.ok(h.width()>48);assert.ok(Math.abs((h.chart.scrollLeft+cursor)/h.width()-before)<1e-9);const width=h.width(),scroll=h.chart.scrollLeft;h.wheel({shiftKey:true,deltaY:40});h.frames();assert.equal(h.width(),width);assert.equal(h.chart.scrollLeft,scroll+40);h.down();const held=h.chart.scrollLeft;assert.equal(h.wheel({}),false);h.frames();assert.equal(h.chart.scrollLeft,held);h.cancel();}finally{h.dispose();}});

test('dragging the name changes sibling order while keeping date gestures separate',async()=>{const h=await harness({configure(p){p.tasks.push(createTask('다른 작업','2026-09-08'));}});try{const other=h.project.tasks[1];h.labelDown();h.rowMove(other.title,'after');assert.deepEqual(h.relocations,[]);assert.match(h.preview(),/다른 작업/);h.up();assert.deepEqual(h.relocations,[{source:h.project.id,task:h.task.id,target:h.project.id,targetTask:other.id,position:'after'}]);assert.deepEqual(h.saved,[]);assert.deepEqual(h.created,[]);}finally{h.dispose();}});
test('group center accepts children and project row brings them back to the root',async()=>{const h=await harness({configure(p){const group=createTask('새 묶음');group.kind='group';p.tasks.push(group);}});try{h.labelDown();h.rowMove('새 묶음','inside');h.up();assert.equal(h.relocations[0]?.position,'inside');assert.equal(h.relocations[0]?.targetTask,h.project.tasks[1].id);h.project.tasks[0].parentId=h.project.tasks[1].id;h.render();h.labelDown();h.rowMove('검증 프로젝트','inside');h.up();assert.equal(h.relocations[1]?.targetTask,null);}finally{h.dispose();}});
test('name drag can target an editable other project but blocks read-only targets',async()=>{const h=await harness();try{const other=createProject('다른 프로젝트',crypto.randomUUID(),'owner');h.props.projects=[h.project,other];h.render();h.labelDown();h.rowMove(other.name);h.up();assert.equal(h.relocations[0]?.target,other.id);h.props.canEdit=p=>p?.id!==other.id;h.labelDown();h.rowMove(other.name);h.up();assert.equal(h.relocations.length,1);}finally{h.dispose();}});
test('self descendant targets and unchanged sibling positions never relocate',async()=>{const h=await harness({configure(p){const group=createTask('상위 묶음');group.kind='group';p.tasks[0].parentId=group.id;p.tasks.unshift(group);p.tasks.push(createTask('다음 작업'));}});try{h.labelDown('상위 묶음');h.rowMove('검증 작업','after');h.up();assert.deepEqual(h.relocations,[]);h.labelDown('상위 묶음');h.rowMove('다음 작업','before');h.up();assert.deepEqual(h.relocations,[]);}finally{h.dispose();}});
test('relocation cancel foreign pointers and replaced project revisions cannot save',async()=>{for(const end of ['cancel','blur','escape','revision','foreign'] as const){const h=await harness({configure(p){p.tasks.push(createTask('다른 작업'));}});try{h.labelDown();h.rowMove('다른 작업','after');if(end==='escape')h.key('Escape');else if(end==='revision'){h.props.projects=[{...h.project,revision:h.project.revision+1}];h.render();}else if(end==='foreign'){h.up(8);assert.equal(h.relocations.length,0);h.cancel();}else h[end]();h.up();assert.equal(h.relocations.length,0);}finally{h.dispose();}}});
test('main rows display progress for leaf group and project and retain parent context',async()=>{const h=await harness({configure(p){const group=createTask('진행 그룹');group.kind='group';p.tasks[0].progress=20;p.tasks[0].parentId=group.id;const other=createTask('완료 작업');other.completed=true;other.progress=100;other.parentId=group.id;const root=createTask('프로젝트 바로 아래');root.progress=60;p.tasks=[group,...p.tasks,other,root];}});try{assert.equal(h.progress('검증 작업'),20);assert.equal(h.progress('진행 그룹'),60);assert.equal(h.progress('검증 프로젝트'),60);const all=h.rows();assert.match(all.find(r=>r.includes('프로젝트 바로 아래'))||'',/프로젝트 바로 아래/);assert.match(all.find(r=>r.includes('검증 작업'))||'',/진행 그룹/);}finally{h.dispose();}});
test('completed work can be reorganized while a completed project remains locked',async()=>{const h=await harness({completed:true,statusFilter:'completed'});try{const other=createProject('보관 프로젝트',crypto.randomUUID(),'owner');h.props.projects=[h.project,other];h.props.statusFilter='all';h.render();h.labelDown();h.rowMove(other.name);h.up();assert.equal(h.relocations.length,1);other.completed=true;h.props.projects=[h.project,{...other}];h.render();h.labelDown();h.rowMove(other.name);h.up();assert.equal(h.relocations.length,1);}finally{h.dispose();}});
test('unchanged server refresh keeps an in-flight row preview and valid drop',async()=>{const h=await harness({configure(p){p.tasks.push(createTask('다른 작업'));}});try{h.labelDown();h.rowMove('다른 작업','after');h.props.projects=[{...h.project,tasks:h.project.tasks.map(t=>({...t}))}];h.render();h.up();assert.equal(h.relocations.length,1);}finally{h.dispose();}});

test('month caption follows the viewport and month navigation crosses years without changing zoom or rows',async()=>{
  const h=await harness({clampScroll:true,configure(p){p.tasks.push(createTask('내년 작업','2027-06-01'));}});
  try{
    h.scrollToDate('2026-12-31');assert.equal(h.caption(),'2026년 12월');
    h.chart.scrollTop=120;h.navigate('다음 달');assert.equal(h.caption(),'2027년 1월');
    assert.equal(h.moveDate(h.axisStart(),Math.floor(h.chart.scrollLeft/h.width())),'2027-01-01');
    h.navigate('이전 달');assert.equal(h.caption(),'2026년 12월');
    for(let i=0;i<13;i++)h.navigate('이전 달');
    assert.equal(h.caption(),'2025년 11월');assert.equal(h.chart.scrollTop,120);assert.equal(h.width(),48);
    assert.deepEqual(h.saved,[]);assert.deepEqual(h.created,[]);assert.deepEqual(h.relocations,[]);
  }finally{h.dispose();}
});

test('today navigation extends an old project axis and centers the local date while retaining zoom',async()=>{
  const h=await harness({clampScroll:true,configure(p){p.tasks[0].startDate='2020-01-01';p.tasks[0].endDate='2020-01-03';}});
  try{
    h.wheel({deltaY:100});h.frames();h.render();const width=h.width();h.chart.scrollTop=60;
    h.navigate('오늘로 이동');
    const midpoint=(h.chart.scrollLeft+(h.chart.clientWidth-h.labelWidth())/2)/width;
    const todayIndex=(Date.parse(h.today())-Date.parse(h.axisStart()))/86400000;
    assert.ok(Math.abs(midpoint-todayIndex-.5)<1e-8);assert.equal(h.width(),width);assert.equal(h.chart.scrollTop,60);
    const last=elements(h.render()).filter(e=>hasClass(e,'gantt-date')).at(-1)!;
    assert.ok(last.props['data-date']>h.today());assert.deepEqual(h.saved,[]);assert.deepEqual(h.created,[]);
  }finally{h.dispose();}
});

test('navigation cancels pending bar and row drags before changing the date origin',async()=>{
  const h=await harness({configure(p){p.tasks.push(createTask('다른 작업'));}});
  try{
    h.down();h.move(496);h.navigate('이전 달');h.up();assert.deepEqual(h.saved,[]);
    h.labelDown();h.rowMove('다른 작업','after');h.navigate('오늘로 이동');h.up();assert.deepEqual(h.relocations,[]);
    assert.deepEqual(h.released,[7,7]);
  }finally{h.dispose();}
});

test('ISO week ruler and dependency endpoints share row offsets after the extra header band',async()=>{
  const h=await harness({configure(p){p.tasks[0].startDate='2024-12-30';p.tasks[0].endDate='2025-01-02';const next=createTask('연결 작업','2025-01-03');next.predecessorId=p.tasks[0].id;p.tasks.push(next);}});
  try{
    const tree=h.render(),week=find(tree,e=>e.props['data-week']==='2025-W01');assert.match(text(week),/2025년 1주/);
    const svg=find(tree,e=>hasClass(e,'gantt-dependencies'));
    assert.equal(svg.props.height,h.rulerHeight()+h.rows().length*40);
    const path=find(svg,e=>e.type==='path');assert.match(path.props.d,new RegExp(`,${h.rulerHeight()+60} H.* V${h.rulerHeight()+100} H`));
    assert.equal(h.rulerHeight(),72);
    h.labelDown();h.rowMove('연결 작업','after');h.up();assert.equal(h.relocations.length,1);
  }finally{h.dispose();}
});

test('narrow canvas keeps a usable date area and zoom uses the measured name column',async()=>{
  const h=await harness();try{
    h.resize(600);assert.ok(h.labelWidth()<=300);assert.ok(h.labelWidth()>=240);
    h.chart.scrollLeft=320;const anchor=500-h.labelWidth(),before=(h.chart.scrollLeft+anchor)/h.width();
    h.wheel({});h.frames();assert.ok(Math.abs((h.chart.scrollLeft+anchor)/h.width()-before)<1e-9);
  }finally{h.dispose();}
});

test('week band drag pans just like the date row without changing tasks',async()=>{
  const h=await harness();try{
    h.chart.scrollLeft=320;h.weekDown();h.move(650,15);h.up();assert.equal(h.chart.scrollLeft,270);
    assert.deepEqual(h.saved,[]);assert.deepEqual(h.created,[]);assert.deepEqual(h.relocations,[]);
  }finally{h.dispose();}
});

test('zoom at the right edge reapplies the anchor after the browser receives the wider grid',async()=>{
  const h=await harness({clampScroll:true});try{
    h.chart.scrollLeft=Number.MAX_SAFE_INTEGER;const anchor=120,before=(h.chart.scrollLeft+anchor)/h.width();
    h.wheel({});h.frames();h.render();
    assert.ok(Math.abs((h.chart.scrollLeft+anchor)/h.width()-before)<1e-8);
  }finally{h.dispose();}
});

test('enabling an older project preserves the viewport date while extending the axis',async()=>{
  const h=await harness({clampScroll:true});try{
    h.scrollToDate('2026-09-05');
    const earlier=createProject('이전 프로젝트',crypto.randomUUID(),'owner');earlier.tasks=[createTask('이전 작업','2025-12-01')];
    h.props.projects=[earlier,h.project];h.render();h.render();
    assert.equal(h.moveDate(h.axisStart(),Math.floor(h.chart.scrollLeft/h.width())),'2026-09-05');
    assert.equal(h.caption(),'2026년 9월');
  }finally{h.dispose();}
});

test('fit uses the available date viewport and preserves vertical position',async()=>{
  const h=await harness({clampScroll:true,configure(p){p.tasks[0].endDate='2026-09-24';}});try{
    h.resize(600);h.chart.scrollTop=120;h.navigate('전체 일정 맞춤');
    const start=(Date.parse(h.task.startDate)-Date.parse(h.axisStart()))/86400000*h.width()-h.chart.scrollLeft;
    assert.ok(start>=0);assert.ok(start+20*h.width()<=h.chart.clientWidth-h.labelWidth());
    assert.equal(h.chart.scrollTop,120);assert.deepEqual(h.saved,[]);
  }finally{h.dispose();}
});
