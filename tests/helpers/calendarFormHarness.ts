import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
export async function harness(surface:Surface,eventOverrides:Record<string,unknown>={}, options:{openEdit?:boolean;onUpdate?:(id:string,patch:any,scope:any)=>any}={}){
 const stores=new Map<string,any>();let active:any,dirty=false,tree:Node;
 const effects:Array<()=>void>=[],saved:Array<any>=[],calls:Array<any>=[],deleted:Array<any>=[],listeners=new Map<string,Set<(e:any)=>void>>();
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
 const props=surface==='EventCreateModal'?{initialDate:event.startDate,initialEndDate:event.endDate,initialStartTime:event.startTime,initialEndTime:event.endTime,episodes:[],googleAuthenticated:false,onClose(){},onSave:(e:any)=>{saved.push(e);}}:{event,position:{x:10,y:10},onClose(){},onUpdate:(id:string,patch:any,scope:any)=>{saved.push(patch);calls.push({id,patch,scope});return options.onUpdate?.(id,patch,scope);},onDelete:(id:string,scope:any)=>{deleted.push({id,scope});},onDuplicate(){},onNavigate(){}};
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
 const input=(label:string)=>{const all=nodes(render());const node=all.find(n=>n.type==='input'&&(n.props['aria-label']===label||all.some(l=>l.type==='label'&&l.props.htmlFor&&l.props.htmlFor===n.props.id&&text(l)===label)));assert.ok(node,`${surface}: input ${label}`);return node;};
 const button=(label:string)=>{const node=nodes(render()).find(n=>n.type==='button'&&text(n).trim()===label);assert.ok(node,`${surface}: button ${label}`);return node;};
 const type=(label:string,value:string,blur=true)=>{input(label).props.onChange({target:{value}});if(blur)input(label).props.onBlur?.({target:{value}});render();};
 const click=(label:string)=>{const b=button(label);if(!b.props.disabled)b.props.onClick?.({preventDefault(){},stopPropagation(){}});render();};
 const dispose=()=>{for(const instance of stores.values())for(const slot of instance.slots)slot?.cleanup?.();for(const key of globalKeys){const descriptor=previous.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}};
 render();if(surface==='EventCreateModal')input('제목').props.onChange({target:{value:'숫자 입력 회의'}});else if(options.openEdit!==false&&event.canEdit!==false&&!event.isReadOnly)click(surface==='EventQuickEdit'?'일정 편집':'편집');render();
 return{render,input,button,type,click,saved,calls,deleted,dispose,settle:async()=>{for(let i=0;i<6;i++){await Promise.resolve();render();}},setActor:(id:string)=>{state.currentUser={...state.currentUser,id};render();},setCalendars:(rows:any[])=>{state.calendars=rows;render();},setTags:(rows:any[])=>{state.tags=rows as never[];render();},updateEvent:(patch:Record<string,unknown>)=>{(props as any).event={...(props as any).event,...patch};render();},saveLabel:surface==='EventCreateModal'?'만들기':'저장',fire:(type:string,event:any)=>{listeners.get(type)?.forEach(fn=>fn(event));render();}};
}
export function nodes(tree:Node):any[]{if(Array.isArray(tree))return tree.flatMap(nodes);return isValidElement(tree)?[tree,...nodes((tree.props as any).children)]:[];}
export function text(tree:Node):string{if(typeof tree==='string'||typeof tree==='number')return String(tree);if(Array.isArray(tree))return tree.map(text).join('');return isValidElement(tree)?text((tree.props as any).children):'';}

