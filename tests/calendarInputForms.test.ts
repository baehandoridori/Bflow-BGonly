import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { createElement, isValidElement } from 'react';

const require=createRequire(import.meta.url);
type Surface='EventCreateModal'|'EventQuickEdit'|'EventSidePanel';
type Node=any;
const source={id:'native-event',title:'회의',memo:'메모',type:'custom',color:'#6C5CE7',startDate:'2026-09-20',endDate:'2026-09-20',allDay:false,startTime:'09:00',endTime:'10:00',calendarId:'calendar',source:'bflow',sourceCalendarId:'bflow:calendar',createdBy:'소유자',createdAt:'2026-09-20',canEdit:true};
let bundle:Promise<string>|undefined;
function bundled(){return bundle??=build({stdin:{contents:"export {EventCreateModal} from './src/components/calendar/EventCreateModal'; export {EventQuickEdit} from './src/components/calendar/EventQuickEdit'; export {EventSidePanel} from './src/components/calendar/EventSidePanel';",resolveDir:process.cwd()},bundle:true,format:'cjs',platform:'node',write:false,loader:{'.css':'empty'},external:['react','react/jsx-runtime','react-dom','framer-motion','lucide-react','@/stores/*','@/components/common/*','./EventTagManagerButton','./EventTagBadges','./useEventTagTooltip']}).then(result=>result.outputFiles[0].text);}

/** Component-instance hook harness: forms AND actual shared input components run.
 * Host inputs retain onChange/onBlur/onKeyDown; only unrelated stores/visuals are mocked.
 */
async function harness(surface:Surface,eventOverrides:Record<string,unknown>={}){
 const stores=new Map<string,any>();let active:any,dirty=false,tree:Node;
 const effects:Array<()=>void>=[],saved:Array<any>=[],listeners=new Map<string,Set<(e:any)=>void>>();
 const changed=(a:any[]|undefined,b:any[]|undefined)=>!a||!b||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
 const effect=(fn:()=>void,deps:any[])=>{const slot=active.cursor++,instance=active,prev=instance.slots[slot];if(!prev||changed(prev.deps,deps)){instance.slots[slot]={deps};effects.push(()=>{prev?.cleanup?.();instance.slots[slot].cleanup=fn();});}};
 const react={...require('react'),useState(initial:any){const instance=active,slot=instance.cursor++;if(!(slot in instance.slots))instance.slots[slot]={value:typeof initial==='function'?initial():initial};const state=instance.slots[slot];state.set??=(value:any)=>{const next=typeof value==='function'?value(state.value):value;if(!Object.is(next,state.value)){state.value=next;dirty=true;}};return[state.value,state.set];},useRef(initial:any){const slot=active.cursor++;return active.slots[slot]??=( {current:initial});},useId(){const slot=active.cursor++;return`${active.id}-${slot}`;},useEffect:effect,useLayoutEffect:effect,useMemo(fn:any,deps:any[]){const slot=active.cursor++,prev=active.slots[slot];if(!prev||changed(prev.deps,deps))active.slots[slot]={deps,value:fn()};return active.slots[slot].value;},useCallback(fn:any,deps:any[]){return react.useMemo(()=>fn,deps);}};
 const calendar={id:'calendar',name:'팀 일정',ownerId:'actor',visibility:'team',color:'#6C5CE7',members:[],canEdit:true,canManage:true,isPersonal:false};
 const state={calendars:[calendar],tags:[],optimisticDeletedTagIds:[],users:[{id:'actor',name:'소유자'}],currentUser:{id:'actor',name:'소유자',role:'user'},episodeTitles:{},colorMode:'dark',setView(){}};
 const select=(selector:any)=>selector(state);
 const module={exports:{} as any};
 new Function('require','module','exports',await bundled())((id:string)=>{
  if(id==='react')return react;
  if(id==='react-dom')return{createPortal:(children:any)=>children};
  if(id==='framer-motion')return{motion:new Proxy({},{get:(_t,key)=>key}),AnimatePresence:({children}:any)=>children,useIsPresent:()=>true};
  if(id==='lucide-react')return new Proxy({},{get:()=>()=>null});
  if(id.startsWith('@/stores/'))return{useAuthStore:select,useAppStore:select,useDataStore:select,useCalendarStore:select,getTagCanonicalSnapshot:()=>({tags:[]}),isOptimisticCalendarTagId:()=>false};
  if(id==='./EventTagManagerButton')return{EventTagManagerButton:()=>null};
  if(id==='./EventTagBadges')return{EventTagBadges:()=>null};
  if(id==='./useEventTagTooltip')return{useEventTagTooltip:()=>({bind:()=>({}),tooltip:null})};
  if(id==='@/components/common/GlassDropdown')return{GlassDropdown:({label,value,options,onChange}:any)=>createElement('select',{'aria-label':label,value,onChange:(e:any)=>onChange(e.target.value)},options.map((o:any)=>createElement('option',{key:o.value,value:o.value},o.label)))};
  if(id==='@/components/common/EntityAwareInput')return{EntityAwareInput:({onChange,...props}:any)=>createElement('textarea',{...props,onChange:(e:any)=>onChange(e.target.value)})};
  if(id==='@/components/common/EntityText')return{EntityText:({text}:any)=>text};
  return require(id);
 },module,module.exports);
 const event={...source,...eventOverrides};
 const props=surface==='EventCreateModal'?{initialDate:event.startDate,initialEndDate:event.endDate,initialStartTime:event.startTime,initialEndTime:event.endTime,episodes:[],googleAuthenticated:false,onClose(){},onSave:(e:any)=>{saved.push(e);}}:{event,position:{x:10,y:10},onClose(){},onUpdate:(_id:string,patch:any)=>{saved.push(patch);},onDelete(){},onDuplicate(){},onNavigate(){}};
 const Component=module.exports[surface];
 const globalKeys=['document','window'],previous=new Map(globalKeys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const dom={body:{},addEventListener:(type:string,fn:any)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type)!.add(fn);},removeEventListener:(type:string,fn:any)=>listeners.get(type)?.delete(fn),querySelector:(selector:string)=>selector==='[data-calendar-input-popover]'?nodes(tree).find(n=>'data-calendar-input-popover'in n.props):null};
 Object.defineProperty(globalThis,'document',{configurable:true,value:dom});Object.defineProperty(globalThis,'window',{configurable:true,value:{innerWidth:1200,innerHeight:900,addEventListener(){},removeEventListener(){}}});
 const visit=(node:Node,path:string):Node=>{
  if(Array.isArray(node))return node.map((child,index)=>visit(child,`${path}/${child?.key??index}`));
  if(!isValidElement(node))return node;
  if(typeof node.type==='function'){
   const id=`${path}:${node.type.name}:${node.key??''}`;let instance=stores.get(id);if(!instance){instance={id,slots:[],cursor:0};stores.set(id,instance);}instance.cursor=0;const old=active;active=instance;
   const child=(node.type as any)(node.props);active=old;return visit(child,`${id}/render`);
  }
  const props=node.props as any,ref=(node as any).ref;
  if(ref&&typeof ref==='object')ref.current??={contains:()=>true,getBoundingClientRect:()=>({top:10,left:10,bottom:30,right:220,width:210,height:20}),closest:()=>null,querySelector:()=>null,focus(){},scrollIntoView(){}};
  return{...node,props:{...props,children:visit(props.children,`${path}/${String(node.type)}`)}};
 };
 const render=()=>{for(let pass=0;pass<25;pass++){dirty=false;tree=visit(createElement(Component,props),'root');while(effects.length)effects.shift()!();if(!dirty)return tree;}throw new Error('hook render did not settle');};
 const input=(label:string)=>{const all=nodes(render());const node=all.find(n=>n.type==='input'&&(n.props['aria-label']===label||all.some(l=>l.type==='label'&&l.props.htmlFor===n.props.id&&text(l)===label)));assert.ok(node,`${surface}: input ${label}`);return node;};
 const button=(label:string)=>{const node=nodes(render()).find(n=>n.type==='button'&&text(n).trim()===label);assert.ok(node,`${surface}: button ${label}`);return node;};
 const type=(label:string,value:string,blur=true)=>{input(label).props.onChange({target:{value}});if(blur)input(label).props.onBlur?.({target:{value}});render();};
 const click=(label:string)=>{const b=button(label);if(!b.props.disabled)b.props.onClick?.({preventDefault(){},stopPropagation(){}});render();};
 const dispose=()=>{for(const instance of stores.values())for(const slot of instance.slots)slot?.cleanup?.();for(const key of globalKeys){const descriptor=previous.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}};
 render();if(surface==='EventCreateModal')input('제목').props.onChange({target:{value:'숫자 입력 회의'}});else if(event.canEdit!==false&&!event.isReadOnly)click(surface==='EventQuickEdit'?'일정 편집':'편집');render();
 return{render,input,button,type,click,saved,dispose,updateEvent:(patch:Record<string,unknown>)=>{(props as any).event={...(props as any).event,...patch};render();},saveLabel:surface==='EventCreateModal'?'만들기':'저장',fire:(type:string,event:any)=>{listeners.get(type)?.forEach(fn=>fn(event));render();}};
}
function nodes(tree:Node):any[]{if(Array.isArray(tree))return tree.flatMap(nodes);return isValidElement(tree)?[tree,...nodes((tree.props as any).children)]:[];}
function text(tree:Node):string{if(typeof tree==='string'||typeof tree==='number')return String(tree);if(Array.isArray(tree))return tree.map(text).join('');return isValidElement(tree)?text((tree.props as any).children):'';}

for(const surface of ['EventCreateModal','EventQuickEdit','EventSidePanel'] as const){
 test(`${surface}: actual numeric time blur, arbitrary minutes and invalid drafts gate parent save`,async()=>{
  const h=await harness(surface);try{
   h.type('시작 시각','930');h.type('종료 시각','1437');
   assert.equal(h.input('시작 시각').props.value,'09:30');assert.equal(h.input('종료 시각').props.value,'14:37');
   h.type('종료 시각','9999');assert.equal(h.button(h.saveLabel).props.disabled,true);
   h.button(h.saveLabel).props.onClick();assert.equal(h.saved.length,0,'even stale/manual save handler cannot commit previous canonical time');
   h.type('종료 시각','1430');h.click(h.saveLabel);
   assert.equal(h.saved.length,1);assert.equal(h.saved[0].startTime,'09:30');assert.equal(h.saved[0].endTime,'14:30');
   assert.equal(nodes(h.render()).some(n=>n.type==='input'&&['date','time'].includes(n.props.type)),false);
  }finally{h.dispose();}
 });
 test(`${surface}: invalid date draft blocks save and duration crosses midnight without clearing source fields`,async()=>{
  const h=await harness(surface);try{
   h.type('시작일','2026-02-30');assert.equal(h.button(h.saveLabel).props.disabled,true);h.button(h.saveLabel).props.onClick();assert.equal(h.saved.length,0);
   h.type('시작일','2026-09-20');h.type('시작 시각','2330');h.click('2시간');
   assert.equal(h.input('종료일').props.value,'2026-09-21');assert.equal(h.input('종료 시각').props.value,'01:30');
   h.click(h.saveLabel);assert.equal(h.saved.length,1);assert.equal(h.saved[0].endDate,'2026-09-21');assert.equal(h.saved[0].endTime,'01:30');
   assert.equal(h.saved[0].calendarId,surface==='EventCreateModal'?'calendar':undefined,'editing never silently moves the source');
  }finally{h.dispose();}
 });
 test(`${surface}: same-value duration repairs invalid end draft and all-day keeps inclusive dates`,async()=>{
  const h=await harness(surface);try{
   h.type('종료 시각','invalid');assert.equal(h.button(h.saveLabel).props.disabled,true);h.click('1시간');
   assert.equal(h.input('종료 시각').props.value,'10:00');assert.equal(h.button(h.saveLabel).props.disabled,false);
   h.input('종일 일정').props.onChange({target:{checked:true}});h.render();h.click(h.saveLabel);
   assert.equal(h.saved[0].allDay,true);assert.equal(h.saved[0].startTime,undefined);assert.equal(h.saved[0].endTime,undefined);
   if(surface==='EventCreateModal')assert.equal(h.saved[0].endDate,'2026-09-20');
  }finally{h.dispose();}
 });
}
test('linked source side panel keeps read-only protection and Gantt milestone has no duration/end editing',async()=>{
 for(const surface of ['EventQuickEdit','EventSidePanel'] as const){
  const readonly=await harness(surface,{canEdit:false,isReadOnly:true});try{assert.equal(nodes(readonly.render()).some(n=>n.type==='input'&&n.props['aria-label']==='시작일'),false);}finally{readonly.dispose();}
  const milestone=await harness(surface,{id:'gantt:project:task',linkedGanttProjectId:'project',linkedGanttTaskId:'task',linkedGanttTaskKind:'milestone',endTime:'09:00'});try{
   assert.equal(milestone.input('종료일').props.disabled,true);assert.equal(milestone.input('종료 시각').props.disabled,true);
   assert.equal(nodes(milestone.render()).some(n=>n.props['aria-label']==='일정 길이'),false);
   milestone.type('시작 시각','1430');milestone.click(milestone.saveLabel);
   assert.equal(milestone.saved[0].startTime,'14:30');assert.equal(milestone.saved[0].endTime,'14:30');
  }finally{milestone.dispose();}
 }
});

 test('QuickEdit replaces an invalid local date draft when a newer canonical event arrives',async()=>{
  const h=await harness('EventQuickEdit');try{
   h.type('시작일','2026-0',false);assert.equal(h.button('저장').props.disabled,true);
   h.updateEvent({startDate:'2026-09-22',endDate:'2026-09-22',title:'동료가 변경한 일정'});
   assert.equal(h.input('시작일').props.value,'2026-09-22');assert.equal(h.button('저장').props.disabled,false);
  }finally{h.dispose();}
 });
