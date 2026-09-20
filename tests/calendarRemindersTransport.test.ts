import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),now=Date.parse('2026-09-20T00:45:00Z');
const bundle=build({entryPoints:['electron/calendarReminders.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['electron','node:fs','node:path','./calendarStore']});
const row=(id:string,calendar='team')=>({id,calendar_id:calendar,title:id,memo:'',all_day:false,start_date:'2026-09-20',end_date:'2026-09-20',start_time:'10:00',end_time:'11:00',created_by:'owner',created_at:'2026-09-01',reminder_minutes:15});
async function harness(rows:any[]){
 let origin={userId:'viewer',epoch:1},handler:any,gate:Promise<void>|undefined;
 const shown:any[]=[],files=new Map<string,string>();
 const calendars=[{id:'team',owner_id:'owner',visibility:'team',is_personal:false},{id:'private',owner_id:'owner',visibility:'private',is_personal:true}];
 const module={exports:{} as any};
 class Clock extends Date {static now(){return now;}}
 class Notification {options:any;static isSupported(){return true;}constructor(options:any){this.options=options;}on(){}show(){shown.push(this.options);}}
 new Function('require','module','exports','Date',(await bundle).outputFiles[0].text)((id:string)=>{
  if(id==='electron')return {app:{getPath:()=>'/test'},ipcMain:{handle:(_name:string,fn:any)=>handler=fn},Notification};
  if(id==='node:fs')return {readFileSync:(name:string)=>files.get(name)??'{}',writeFileSync:(name:string,text:string)=>files.set(name,text),renameSync:(from:string,to:string)=>{files.set(to,files.get(from)!);files.delete(from);}};
  if(id==='./calendarStore')return {listRecurrenceEvents:async()=>{await gate;return rows;},listCalendarsWithMembers:async()=>({calendars,members:[]})};
  return require(id);
 },module,module.exports,Clock);
 const register=()=>module.exports.registerCalendarReminders(()=>origin,()=>{});register();
 return {shown,files,poll:(muted:string[]=[])=>handler({},muted),restart:register,defer:(value:Promise<void>)=>{gate=value;},switchSession:()=>{origin={userId:'other',epoch:2};}};
}
test('main reminder transport excludes private overview and muted calendars and persists dedupe before delivery',async()=>{
 const h=await harness([row('shared'),row('private-event','private')]);
 const due=await h.poll();assert.equal(due.length,1);assert.equal(h.shown.length,1);assert.match(h.shown[0].title,/shared/);assert.ok(h.files.size);
 h.restart();assert.equal((await h.poll()).length,0,'persisted claims survive handler restart');assert.equal(h.shown.length,1);
 const muted=await harness([row('shared')]);assert.equal((await muted.poll(['team'])).length,0);assert.equal(muted.shown.length,0);
});
test('main reminder transport discards a read that completes after the canonical session changes',async()=>{
 const h=await harness([row('shared')]);let release!:()=>void;h.defer(new Promise<void>(resolve=>release=resolve));
 const pending=h.poll();h.switchSession();release();assert.deepEqual(await pending,[]);assert.equal(h.shown.length,0);assert.equal(h.files.size,0);
});
test('an occurrence may enable its own reminder even when its recurring master has reminders disabled',async()=>{
 const source={...row('series'),reminder_minutes:null,recurrence_rule:{frequency:'daily',interval:1,count:2},recurrence_exceptions:[{occurrence_date:'2026-09-20',cancelled:false,patch:{reminder_minutes:15}}]};
 const h=await harness([source]);assert.equal((await h.poll()).length,1);assert.equal(h.shown.length,1);
});
