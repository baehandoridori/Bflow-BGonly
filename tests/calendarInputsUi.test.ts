import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement, type ReactNode } from 'react';
const require = createRequire(import.meta.url);
function nodes(tree: ReactNode): any[] { if (Array.isArray(tree)) return tree.flatMap(nodes);if (!isValidElement(tree)) return [];return [tree,...nodes((tree.props as any).children)]; }
async function harness(file:string, name:string, initial:Record<string,any>) {
 const states:any[]=[],refs:any[]=[],deps:any[][]=[],cleanups:any[]=[];let state=0,ref=0,effect=0;const effects:Array<()=>void>=[];
 const props={...initial},calls:any[]=[];const listeners=new Map<string,any>(),anchor={getBoundingClientRect:()=>({left:740,top:520,bottom:560,width:150}),closest:()=>dialog,contains:()=>false},dialog={kind:'native-dialog'},owner={contains:()=>false},body={kind:'body'};
 let portal:any;
 props.onChange=(value:any)=>{calls.push(['change',value]);if(typeof value==='string')props.value=value;else Object.assign(props,value);};props.onValidityChange=(value:boolean)=>calls.push(['valid',value]);
 const result=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false,external:['react','react/jsx-runtime','react-dom','lucide-react','./CalendarInputPopover'],loader:{'.css':'empty'}});
 const module={exports:{} as any};new Function('require','module','exports','document','window',result.outputFiles[0].text)((id:string)=>{
  if(id==='react')return {...require('react'),useId:()=> 'input-test',useState:(initial:any)=>{const index=state++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return [states[index],(next:any)=>{states[index]=typeof next==='function'?next(states[index]):next;}];},useRef:(initial:any)=>refs[ref++]??={current:initial},useEffect:(fn:any,next:any[])=>{const index=effect++;if(!deps[index]||next.some((item:any,i:number)=>!Object.is(item,deps[index][i])))effects.push(()=>{cleanups[index]?.();cleanups[index]=fn();});deps[index]=next;},useLayoutEffect:(fn:any,next:any[])=>{const index=effect++;if(!deps[index]||next.some((item:any,i:number)=>!Object.is(item,deps[index][i])))effects.push(()=>{cleanups[index]?.();cleanups[index]=fn();});deps[index]=next;}};
  if(id==='react-dom')return {createPortal:(node:any,target:any)=>{portal=target;return node;}};
  if(id==='lucide-react')return new Proxy({},{get:()=>()=>null});
  if(id==='./CalendarInputPopover')return {CalendarInputPopover:'Popover'};
  return require(id);
 },module,module.exports,{body,addEventListener:(type:string,fn:any)=>listeners.set(type,fn),removeEventListener:(type:string)=>listeners.delete(type)},{innerWidth:800,innerHeight:600,addEventListener(){},removeEventListener(){}});
 const render=()=>{state=ref=effect=0;const tree=module.exports[name](props);while(effects.length)effects.shift()!();return tree;};
 return {render,props,calls,anchor,owner,dialog,portal:()=>portal,dispatch:(type:string,event:any)=>listeners.get(type)?.(event),cleanup:()=>cleanups.forEach(fn=>fn?.())};
}
const findInput=(tree:ReactNode)=>nodes(tree).find(node=>node.type==='input');
const key=(value:string)=>({key:value,preventDefault(){},stopPropagation(){},shiftKey:false});

test('incomplete time input becomes invalid immediately and never saves its previous canonical value',async()=>{
 const h=await harness('src/components/calendar/inputs/CalendarTimeInput.tsx','CalendarTimeInput',{label:'시작 시간',value:'09:00'});let tree=h.render();h.calls.length=0;
 findInput(tree).props.onChange({target:{value:'12:'}});tree=h.render();assert.equal(findInput(tree).props.value,'12:');assert.equal(findInput(tree).props['aria-invalid'],true);
 findInput(tree).props.onBlur({target:{value:'12:'}});h.render();assert.equal(h.calls.some(call=>call[0]==='change'),false);assert.equal(h.calls.at(-1)[1],false);
 findInput(h.render()).props.onChange({target:{value:'1430'}});tree=h.render();assert.deepEqual(h.calls.filter(call=>call[0]==='change').at(-1),['change','14:30']);assert.equal(h.calls.at(-1)[1],true);
 findInput(tree).props.onBlur({target:{value:'1430'}});assert.equal(findInput(h.render()).props.value,'14:30');
});
test('time dropdown keyboard selects quarter hours while preserving arbitrary typed minutes',async()=>{
 const h=await harness('src/components/calendar/inputs/CalendarTimeInput.tsx','CalendarTimeInput',{label:'시작 시간',value:'09:07'});let tree=h.render();assert.equal(findInput(tree).props.type,'text');
 tree.props.onKeyDown(key('ArrowDown'));tree=h.render();assert.equal(nodes(tree).filter(node=>node.props.role==='option').length,96);
 tree.props.onKeyDown(key('ArrowDown'));tree=h.render();tree.props.onKeyDown(key('Enter'));tree=h.render();assert.equal(findInput(tree).props.value,'09:15');assert.equal(findInput(tree).props['aria-expanded'],false);
 findInput(tree).props.onChange({target:{value:'09:17'}});h.render();assert.deepEqual(h.calls.filter(call=>call[0]==='change').at(-1),['change','09:17']);
});
test('date draft stays invalid through blur and range errors are not silently clamped',async()=>{
 const h=await harness('src/components/calendar/inputs/CalendarDateRangePicker.tsx','CalendarDateRangePicker',{startDate:'2026-09-20',endDate:'2026-09-21'});let tree=h.render();h.calls.length=0;
 nodes(tree).find(node=>node.props['aria-label']==='시작일').props.onChange({target:{value:'2026-09-'}});tree=h.render();assert.equal(h.calls.at(-1)[1],false);
 nodes(tree).find(node=>node.props['aria-label']==='시작일').props.onBlur({target:{value:'2026-09-'}});h.render();assert.equal(h.calls.some(call=>call[0]==='change'),false);
 nodes(h.render()).find(node=>node.props['aria-label']==='시작일').props.onChange({target:{value:'2026-09-25'}});h.render();assert.equal(h.calls.at(-1)[1],false);assert.equal(h.props.startDate,'2026-09-25');assert.equal(h.props.endDate,'2026-09-21');
});
test('one calendar selects an inclusive date range and keyboard can cross a year',async()=>{
 const h=await harness('src/components/calendar/inputs/CalendarDateRangePicker.tsx','CalendarDateRangePicker',{startDate:'2026-12-30',endDate:'2026-12-30'});let tree=h.render();
 nodes(tree).find(node=>node.props['aria-label']==='시작일 달력 열기').props.onClick();tree=h.render();assert.equal(nodes(tree).filter(node=>node.props['data-date']).length,42);
 nodes(tree).find(node=>node.props['data-date']==='2026-12-30').props.onClick();tree=h.render();nodes(tree).find(node=>node.props.role==='grid').props.onKeyDown(key('ArrowRight'));tree=h.render();nodes(tree).find(node=>node.props.role==='grid').props.onKeyDown(key('ArrowRight'));tree=h.render();
 assert.equal(nodes(tree).find(node=>node.props['data-date']==='2027-01-01').props.tabIndex,0);
 nodes(tree).find(node=>node.props['data-date']==='2027-01-01').props.onClick();tree=h.render();assert.deepEqual(h.calls.filter(call=>call[0]==='change').at(-1),['change',{startDate:'2026-12-30',endDate:'2027-01-01'}]);
 nodes(tree).find(node=>node.props['aria-label']==='종료일 달력 열기').props.onClick();tree=h.render();assert.equal(nodes(tree).filter(node=>node.props.role==='gridcell'&&node.props['aria-selected']).length,3);
});
test('milestone range picker keeps start and end equal and disables the second input',async()=>{
 const h=await harness('src/components/calendar/inputs/CalendarDateRangePicker.tsx','CalendarDateRangePicker',{startDate:'2026-09-20',endDate:'2026-09-20',endDisabled:true});let tree=h.render();
 assert.equal(nodes(tree).find(node=>node.props['aria-label']==='종료일').props.disabled,true);
 nodes(tree).find(node=>node.props['aria-label']==='시작일').props.onChange({target:{value:'20260922'}});h.render();assert.deepEqual(h.calls.filter(call=>call[0]==='change').at(-1),['change',{startDate:'2026-09-22',endDate:'2026-09-22'}]);
});
test('popup stays in native dialog top layer, contains the viewport and isolates Escape',async()=>{
 const closes:any[]=[];const h=await harness('src/components/calendar/inputs/CalendarInputPopover.tsx','CalendarInputPopover',{anchor:{current:null},owner:{current:null},label:'날짜',onClose:(restore:boolean)=>closes.push(restore)});
 h.props.anchor.current=h.anchor;h.props.owner.current=h.owner;h.render();const tree=h.render();assert.equal(h.portal(),h.dialog);assert.ok(tree.props.style.left+tree.props.style.width<=792);assert.ok(tree.props.style.top+tree.props.style.maxHeight<=592);
 let prevented=false,immediate=false;h.dispatch('keydown',{key:'Escape',preventDefault(){prevented=true;},stopPropagation(){},stopImmediatePropagation(){immediate=true;}});assert.deepEqual(closes,[true]);assert.ok(prevented&&immediate);
 h.dispatch('mousedown',{target:{}});assert.deepEqual(closes,[true,false]);h.cleanup();
});
