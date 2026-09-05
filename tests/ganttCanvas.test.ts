import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { createProject, createTask } from '../src/features/gantt/domain.ts';
import type { GanttTask } from '../src/features/gantt/types.ts';

type Element = ReactElement<Record<string, any>>;
function elements(node:ReactNode):Element[] {
  if(Array.isArray(node))return node.flatMap(elements);
  if(!isValidElement(node))return [];
  const el=node as Element;return [el,...elements(el.props.children)];
}
function find(tree:ReactNode,predicate:(element:Element)=>boolean):Element {const result=elements(tree).find(predicate);assert.ok(result,'expected event-bearing element');return result;}
const bundle=build({entryPoints:['src/features/gantt/GanttCanvas.tsx'],bundle:true,format:'cjs',platform:'node',target:'node22',write:false,external:['react','react/jsx-runtime','react-dom','lucide-react']});

// This harness invokes real React event handlers. Geometry values are explicit
// doubles; these tests do not claim browser layout, hit testing, or mouse E2E.
async function harness(editable=true,done=false) {
  const task=createTask('검증 작업','2026-09-05');task.endDate='2026-09-07';task.completed=done;
  const project=createProject('검증 프로젝트',crypto.randomUUID(),'owner');project.tasks=[task];
  const states:unknown[]=[],refs:any[]=[],effects:Array<()=>unknown>=[];let stateCursor=0,refCursor=0;
  const saved:Array<Partial<GanttTask>>=[],created:Array<{parentId:string|null;start:string;end:string}>=[],captured:number[]=[];
  const listeners=new Map<string,(event:any)=>void>(),frames=new Map<number,()=>void>();let frameId=0;
  const chart={scrollLeft:0,scrollTop:0,clientWidth:1200,clientHeight:600,style:{setProperty(){}},getBoundingClientRect:()=>({left:100,top:0,width:1200}),addEventListener:(name:string,fn:(event:any)=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)};
  const nodeRequire=createRequire(import.meta.url),react=nodeRequire('react');
  const module={exports:{} as {GanttCanvas:(props:any)=>ReactNode;localDate:()=>string;moveDate:(date:string,days:number)=>string}};
  new Function('require','module','exports','localStorage','requestAnimationFrame','cancelAnimationFrame','matchMedia',(await bundle).outputFiles[0].text)(
    (id:string)=>{
      if(id==='react')return {...react,
        useState(initial:unknown){const slot=stateCursor++;if(!(slot in states))states[slot]=typeof initial==='function'?(initial as ()=>unknown)():initial;return [states[slot],(next:unknown)=>{states[slot]=typeof next==='function'?(next as (x:unknown)=>unknown)(states[slot]):next;}];},
        useRef(initial:unknown){return refs[refCursor++]??=( {current:initial} );},
        useMemo(fn:()=>unknown){return fn();},useCallback(fn:unknown){return fn;},useEffect(fn:()=>unknown){effects.push(fn);},useLayoutEffect(fn:()=>unknown){effects.push(fn);},
      };
      if(id==='react-dom')return {createPortal:(node:ReactNode)=>node};
      if(id==='lucide-react')return new Proxy({},{get:()=>()=>null});
      return nodeRequire(id);
    },module,module.exports,{getItem:()=>null,setItem(){}},(fn:()=>void)=>{frames.set(++frameId,fn);return frameId;},(id:number)=>frames.delete(id),()=>({matches:true}),
  );
  const props={projects:[project],selected:[],done,worker:'',collapsed:[],names:{},canEdit:()=>editable,onCollapse(){},onSelect(){},onMenu(){},onPatch(_p:unknown,_t:unknown,patch:Partial<GanttTask>){saved.push(patch);},onAdd(_p:unknown,parentId:string|null,start:string,end:string){created.push({parentId,start,end});}};
  function render(){stateCursor=0;refCursor=0;return module.exports.GanttCanvas(props);}
  const tree=render(),canvas=find(tree,e=>e.props['aria-label']==='프로젝트 간트');
  const chartRef=(canvas as unknown as {ref:{current:unknown}}).ref;chartRef.current=chart;
  const cleanup=effects.splice(0).map(fn=>fn()).filter((fn):fn is ()=>void=>typeof fn==='function');
  const bar=find(tree,e=>e.type==='button'&&e.props['aria-label']?.startsWith('검증 작업,'));
  const row=find(tree,e=>e.props.className?.split(' ').includes('gantt-row')&&elements(e).includes(bar));
  const track=find(row,e=>e.props.className==='gantt-track');
  function pointer(x:number,edge?:string,blank=false){const target={dataset:{edge},getBoundingClientRect:()=>({left:100}),setPointerCapture:(id:number)=>captured.push(id)};return {button:0,pointerId:7,clientX:x,currentTarget:target,target:blank?target:{dataset:{edge}},preventDefault(){}};}
  return {saved,created,captured,canvas,bar,track,chart,task,
    down(x=400,edge?:string){bar.props.onPointerDown(pointer(x,edge));},
    blankDown(x:number){track.props.onPointerDown(pointer(x,undefined,true));},
    move(x:number){canvas.props.onPointerMove({clientX:x,pointerId:7});},
    up(){canvas.props.onPointerUp();},cancel(){canvas.props.onPointerCancel();},
    wheel(event:Record<string,unknown>){let prevented=false;listeners.get('wheel')!({clientX:600,deltaX:0,deltaY:-100,deltaMode:0,shiftKey:false,preventDefault(){prevented=true;},...event});return prevented;},
    frames(){for(const [id,fn]of [...frames]){frames.delete(id);fn();}},width:()=>states[0] as number,
    base:module.exports.moveDate(task.startDate<module.exports.localDate()?task.startDate:module.exports.localDate(),-6),
    moveDate:module.exports.moveDate,dispose(){cleanup.forEach(fn=>fn());},
  };
}

test('manual bar drag invokes date patch once on release and preserves duration',async()=>{
 const h=await harness();try{h.down();h.move(496);assert.deepEqual(h.saved,[]);h.up();assert.deepEqual(h.saved,[{startDate:'2026-09-07',endDate:'2026-09-09'}]);assert.deepEqual(h.captured,[7]);h.up();assert.equal(h.saved.length,1);}finally{h.dispose();}
});
test('start and end resize handlers patch only the selected edge and reject inversion',async()=>{
 for(const [edge,x,expected]of [['start',448,{startDate:'2026-09-06'}],['end',544,{endDate:'2026-09-10'}]] as const){const h=await harness();try{h.down(400,edge);h.move(x);h.up();assert.deepEqual(h.saved,[expected]);}finally{h.dispose();}}
 const h=await harness();try{h.down(400,'start');h.move(592);h.up();assert.deepEqual(h.saved,[]);}finally{h.dispose();}
});
test('blank-track drag creates a date range in both directions',async()=>{
 for(const [from,to,first,last]of [[340,484,5,8],[484,340,5,8]]){const h=await harness();try{h.blankDown(from);h.move(to);assert.deepEqual(h.created,[]);h.up();assert.deepEqual(h.created,[{parentId:null,start:h.moveDate(h.base,first),end:h.moveDate(h.base,last)}]);assert.deepEqual(h.saved,[]);}finally{h.dispose();}}
});
test('cancelled, stationary, read-only and completed-view gestures do not mutate',async()=>{
 const cancelled=await harness();try{cancelled.down();cancelled.move(496);cancelled.cancel();cancelled.up();assert.deepEqual(cancelled.saved,[]);cancelled.blankDown(340);cancelled.move(484);cancelled.cancel();cancelled.up();assert.deepEqual(cancelled.created,[]);}finally{cancelled.dispose();}
 for(const [editable,done]of [[true,false],[false,false],[true,true]]){const h=await harness(editable,done);try{h.down();if(!editable||done)h.move(496);h.up();h.blankDown(340);if(!editable||done)h.move(484);h.up();assert.deepEqual(h.saved,[]);assert.deepEqual(h.created,[]);}finally{h.dispose();}}
});
test('wheel handler preserves cursor date anchor and Shift pans without zoom',async()=>{
 const h=await harness();try{h.chart.scrollLeft=320;const cursor=500,before=(h.chart.scrollLeft+cursor)/h.width();assert.equal(h.wheel({}),true);h.frames();assert.ok(h.width()>48);assert.ok(Math.abs((h.chart.scrollLeft+cursor)/h.width()-before)<1e-9);
 const width=h.width(),scroll=h.chart.scrollLeft;h.wheel({shiftKey:true,deltaY:40});h.frames();assert.equal(h.width(),width);assert.equal(h.chart.scrollLeft,scroll+40);
 h.down();const held=h.chart.scrollLeft;assert.equal(h.wheel({}),false);h.frames();assert.equal(h.chart.scrollLeft,held);h.cancel();}finally{h.dispose();}
});
