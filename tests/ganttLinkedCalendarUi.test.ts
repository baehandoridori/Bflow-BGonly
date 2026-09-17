import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement, type ReactNode } from 'react';

const require = createRequire(import.meta.url);
function nodes(tree: ReactNode): any[] { if (Array.isArray(tree)) return tree.flatMap(nodes); if (!isValidElement(tree)) return []; return [tree, ...nodes((tree.props as any).children)]; }
const settle = async () => { for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve)); };
async function harness(canEdit = true) {
  const states: any[] = [], refs: any[] = [], deps: any[][] = [], cleanups: any[] = [];
  let stateIndex=0,refIndex=0,effectIndex=0; const effects:Array<()=>void>=[], subscribers=new Set<any>();
  let user={id:'me'}, closed=0, refreshes=0, fresh=true, gate:Promise<void>|undefined;
  const source={id:'native-event',source:'bflow',sourceCalendarId:'bflow:calendar',calendarId:'calendar',title:'원본 일정',memo:'메모',startDate:'2026-09-17',endDate:'2026-09-17',color:'#74B9FF',allDay:true,canEdit:true};
  const calendar={id:'calendar',name:'공유 캘린더',ownerId:'owner',visibility:'members',members:[{userId:'me',canEdit}],canEdit,canManage:false};
  let project:any={id:'project',name:'공유 캘린더',calendarLink:{calendarId:'calendar',canUnlink:false},tasks:[{id:'native-event',sourceCalendarEventId:'native-event'}]};
  const calls:any[]=[], gantt={actorId:'me',refresh:async()=>{refreshes++;return true;}};
  const auth=Object.assign((fn:any)=>fn({currentUser:user,users:[]}),{getState:()=>({currentUser:user}),subscribe:(fn:any)=>{subscribers.add(fn);return()=>subscribers.delete(fn);}});
  const result=await build({entryPoints:['src/features/gantt/LinkedCalendarPanel.tsx'],bundle:true,format:'cjs',platform:'node',write:false,external:['react','react/jsx-runtime','lucide-react','@/components/calendar/EventSidePanel','@/components/calendar/CalendarSettingsModal','@/services/calendarService','@/stores/useAuthStore','@/stores/useAppStore','@/stores/useCalendarStore','./useGanttStore']});
  const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)((id:string)=>{
    if(id==='react')return {...require('react'),useState:(initial:any)=>{const slot=stateIndex++;if(!(slot in states))states[slot]=initial;return [states[slot],(value:any)=>{states[slot]=typeof value==='function'?value(states[slot]):value;}];},useRef:(initial:any)=>refs[refIndex++]??={current:initial},useMemo:(fn:any,next:any[])=>{const slot=refIndex++;const previous=refs[slot];if(!previous||next.some((value,index)=>value!==previous.deps[index]))refs[slot]={deps:next,value:fn()};return refs[slot].value;},useEffect:(fn:any,next:any[])=>{const slot=effectIndex++;if(!deps[slot]||next.some((value,index)=>value!==deps[slot][index]))effects.push(()=>{cleanups[slot]?.();cleanups[slot]=fn();});deps[slot]=next;}};
    if(id==='lucide-react')return new Proxy({},{get:()=>()=>null});
    if(id==='@/components/calendar/EventSidePanel')return {EventSidePanel:'EventSidePanel'};
    if(id==='@/components/calendar/CalendarSettingsModal')return {CalendarSettingsModal:'CalendarSettingsModal'};
    if(id==='@/stores/useAuthStore')return {useAuthStore:auth};
    if(id==='@/stores/useAppStore')return {useAppStore:{getState:()=>({navigateToScheduleDate(){}})}};
    if(id==='@/stores/useCalendarStore')return {useCalendarStore:Object.assign((fn:any)=>fn({calendars:[calendar]}),{getState:()=>({calendars:[calendar]})})};
    if(id==='./useGanttStore')return {useGanttStore:{getState:()=>gantt}};
    if(id==='@/services/calendarService')return {loadBflowEvents:async()=>{await gate;return fresh;},getEvents:async()=>[{...source}],updateEvent:async(...args:any[])=>{calls.push(['update',...args]);Object.assign(source,args[1]);},deleteEvent:async(...args:any[])=>calls.push(['delete',...args])};
    return require(id);
  },module,module.exports);
  const render=()=>{stateIndex=refIndex=effectIndex=0;const tree=module.exports.LinkedCalendarPanel({project,taskId:'native-event',actorId:'me',onClose:()=>{closed++;},onUnlink:async()=>{}});while(effects.length)effects.shift()!();return tree;};
  return {render,calls,calendar,unmountOnRefresh:()=>{gantt.refresh=async()=>{refreshes++;cleanups.forEach(cleanup=>cleanup?.());return true;};},setFresh:(value:boolean)=>{fresh=value;},closed:()=>closed,refreshes:()=>refreshes,gate:(value:Promise<void>)=>{gate=value;},updateProject:()=>{project={...project};},switchUser:()=>{const previous={currentUser:user};user={id:'other'};subscribers.forEach(fn=>fn({currentUser:user},previous));},panel:(tree:ReactNode)=>nodes(tree).find(node=>node.type==='EventSidePanel')};
}

test('linked event detail reuses calendar editor and writes the native calendar identity',async()=>{
 const h=await harness();h.render();await settle();const panel=h.panel(h.render());assert.ok(panel);
 await panel.props.onUpdate('native-event',{title:'수정한 원본'});
 assert.deepEqual(h.calls,[['update','native-event',{title:'수정한 원본'},{id:'native-event',source:'bflow',sourceCalendarId:'bflow:calendar'}]]);
 assert.equal(h.refreshes(),1);
});

test('read-only linked source cannot edit through a stale event editor callback',async()=>{
 const h=await harness(false);h.render();await settle();const panel=h.panel(h.render());assert.equal(panel.props.event.isReadOnly,true);
 await assert.rejects(panel.props.onUpdate('native-event',{title:'금지'}),/편집 권한/);assert.equal(h.calls.length,0);
});

test('session change hides linked source detail and refuses late editor writes',async()=>{
 const h=await harness();h.render();await settle();const panel=h.panel(h.render());h.switchUser();
 assert.equal(h.closed(),1);assert.equal(h.panel(h.render()),undefined);
 await assert.rejects(panel.props.onUpdate('native-event',{title:'금지'}),/로그인 정보/);assert.equal(h.calls.length,0);
});

test('a periodic linked project refresh keeps the event editor mounted while loading',async()=>{
 const h=await harness();h.render();await settle();assert.ok(h.panel(h.render()));let release!:()=>void;
 h.gate(new Promise<void>(resolve=>{release=resolve;}));h.updateProject();assert.ok(h.panel(h.render()));
 release();await settle();assert.ok(h.panel(h.render()));
});


test('unchanged project and source refresh preserve editor event identity so unsaved drafts do not rehydrate',async()=>{
 const h=await harness();h.render();await settle();const original=h.panel(h.render()).props.event;
 assert.equal(h.panel(h.render()).props.event,original,'unrelated parent render must not reset calendar editor');
 h.updateProject();h.render();await settle();
 assert.equal(h.panel(h.render()).props.event,original,'identical refreshed calendar object must not reset calendar editor');
 h.calendar.canEdit=false;
 assert.notEqual(h.panel(h.render()).props.event,original,'permission changes must propagate immediately');
});


test('a failed periodic source refresh displays its error alongside the existing editor',async()=>{
 const h=await harness();h.render();await settle();const original=h.panel(h.render()).props.event;
 h.setFresh(false);h.updateProject();h.render();await settle();const tree=h.render();
 assert.equal(h.panel(tree).props.event,original,'keep unsaved editor state through a transient read failure');
 assert.ok(nodes(tree).some(node=>node.props.role==='alert'),'the retained event must not conceal a failed refresh');
});


test('successful source delete or move resolves when the resulting Gantt refresh unmounts the panel',async()=>{
 for(const kind of ['delete','move']) {
  const h=await harness();h.render();await settle();const panel=h.panel(h.render());h.unmountOnRefresh();
  await assert.doesNotReject(kind==='delete'?panel.props.onDelete():panel.props.onUpdate('native-event',{calendarId:'another-calendar'}));
  assert.equal(h.calls.length,1);assert.equal(h.refreshes(),1);assert.equal(h.closed(),0,'unmounted panels must not invoke a late close callback');
 }
});
