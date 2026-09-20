import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const bundle=build({entryPoints:['src/mocks/devElectronAPI.ts'],bundle:true,format:'cjs',platform:'node',write:false,external:['@/features/gantt/previewGateway']});
async function harness(){
 const storage=new Map<string,string>(),localStorage={getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)};
 const window:any={localStorage,dispatchEvent(){},addEventListener(){},removeEventListener(){}},document={documentElement:{dataset:{}}};
 let gate:Promise<void>|undefined;
 const module={exports:{} as any};
 new Function('require','module','exports','window','document','localStorage','navigator',(await bundle).outputFiles[0].text)((id:string)=>{
  if(id==='@/features/gantt/previewGateway')return {createPreviewGateway:()=>({read:async()=>({spaces:[],projects:[]}),execute:async()=>({spaces:[],projects:[]})}),listCalendarEvents:async()=>{await gate;return [];},subscribePreviewGantt:()=>()=>{}};
  return require(id);
 },module,module.exports,window,document,localStorage,{locks:{request:async(_name:string,fn:any)=>fn()}});
 module.exports.installDevElectronAPI();const api=window.electronAPI;
 const login=async(name='배한솔')=>{assert.equal((await api.loginCanonicalSession({name,password:'1234',rememberMe:false})).ok,true);};await login();
 const calendar=await api.calendarCreate({name:'반복 검증',color:'#6C5CE7',visibility:'members',members:[]});
 const patch={calendar_id:calendar.id,title:'회의',memo:'',all_day:false,start_date:'2026-09-01',end_date:'2026-09-01',start_time:'10:00',end_time:'11:00',tag_ids:[],recurrence_rule:{frequency:'daily',interval:1,count:5}};
 const create=async(extra:any={})=>(await api.calendarRecurrenceExecute({action:'create',scope:'all',expectedRevision:0,patch:{...patch,...extra}})).event;
 return {api,calendar,create,login,defer:(value:Promise<void>)=>{gate=value;}};
}
test('preview recurrence read rejects stale-session completion',async()=>{
 const h=await harness();let release!:()=>void;h.defer(new Promise<void>(resolve=>release=resolve));const pending=h.api.calendarRecurrenceList();await h.login('장삐쭈');release();await assert.rejects(pending,/로그인|변경/);
});
test('preview recurrence boundary rejects malformed title, dates, times, URL and unknown tags without storing rows',async()=>{
 const h=await harness();for(const patch of [{title:''},{title:4},{start_date:'2026-02-30'},{start_date:'2026-09-05',end_date:'2026-09-01'},{start_time:'24:00'},{end_time:'09:00'},{meeting_url:'https://'},{tag_ids:['00000000-0000-4000-8000-000000000099']},{all_day:null}])await assert.rejects(h.create(patch),JSON.stringify(patch));
 assert.equal((await h.api.calendarRecurrenceList()).filter((row:any)=>row.calendar_id===h.calendar.id).length,0);
});
test('preview occurrence writes enforce owner/editor ACL, revision, tag validity and forbid single-instance calendar moves',async()=>{
 const h=await harness(),event=await h.create();
 const mutate=(patch:any,expectedRevision=0)=>h.api.calendarRecurrenceExecute({action:'update',eventId:event.id,occurrenceDate:'2026-09-02',scope:'this',expectedRevision,patch:{expected_calendar_id:h.calendar.id,...patch}});
 const second=await h.api.calendarCreate({name:'다른 캘린더',color:'#6C5CE7',visibility:'members',members:[]});
 await assert.rejects(mutate({calendar_id:second.id}));await assert.rejects(mutate({tag_ids:['00000000-0000-4000-8000-000000000099']}));await assert.rejects(mutate({title:'stale'},99));
 await h.api.calendarSetMembers(h.calendar.id,[{user_id:'2',can_edit:false}]);await h.login('장삐쭈');await assert.rejects(mutate({title:'forbidden'}),/권한/);
 await h.login();assert.equal((await h.api.calendarRecurrenceList()).find((row:any)=>row.id===event.id).recurrence_revision,0);
});

test('invalid inherited exception times abort the whole following split and preserve the original series',async()=>{
 const h=await harness(),event=await h.create({end_time:'17:00'});
 await h.api.calendarRecurrenceExecute({action:'update',eventId:event.id,occurrenceDate:'2026-09-04',scope:'this',expectedRevision:0,patch:{expected_calendar_id:h.calendar.id,start_time:'16:00'}});
 const before=(await h.api.calendarRecurrenceList()).filter((row:any)=>row.calendar_id===h.calendar.id);
 await assert.rejects(h.api.calendarRecurrenceExecute({action:'update',eventId:event.id,occurrenceDate:'2026-09-03',scope:'following',expectedRevision:1,patch:{expected_calendar_id:h.calendar.id,end_time:'12:00'}}),/날짜|시간/);
 assert.deepEqual((await h.api.calendarRecurrenceList()).filter((row:any)=>row.calendar_id===h.calendar.id),before);
});
