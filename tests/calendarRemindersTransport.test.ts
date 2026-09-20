import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),now=Date.parse('2026-09-20T00:45:00Z');
const bundle=build({entryPoints:['electron/calendarReminders.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['electron','node:fs','node:path','./calendarStore']});
const row=(id:string,calendar='team')=>({id,calendar_id:calendar,title:id,memo:'',all_day:false,start_date:'2026-09-20',end_date:'2026-09-20',start_time:'10:00',end_time:'11:00',created_by:'owner',created_at:'2026-09-01',reminder_minutes:15});
async function harness(rows:any[]){
 let origin:{userId:string;epoch:number}|null={userId:'viewer',epoch:1},handler:any,gate:Promise<void>|undefined,currentNow=now,readCount=0,unrefs=0;
 const shown:any[]=[],files=new Map<string,string>(),timers=new Map<any,()=>Promise<unknown>>(),quitCallbacks:Array<()=>void>=[];
 const calendars=[{id:'team',owner_id:'owner',visibility:'team',is_personal:false},{id:'private',owner_id:'owner',visibility:'private',is_personal:true}];
 const module={exports:{} as any};
 class Clock extends Date {static now(){return currentNow;}}
 class Notification {options:any;static isSupported(){return true;}constructor(options:any){this.options=options;}on(){}show(){shown.push(this.options);}}
 new Function('require','module','exports','Date',(await bundle).outputFiles[0].text)((id:string)=>{
  if(id==='electron')return {app:{getPath:()=>'/test',once:(_name:string,fn:()=>void)=>quitCallbacks.push(fn)},ipcMain:{handle:(_name:string,fn:any)=>handler=fn},Notification};
  if(id==='node:fs')return {readFileSync:(name:string)=>files.get(name)??'{}',writeFileSync:(name:string,text:string)=>files.set(name,text),renameSync:(from:string,to:string)=>{files.set(to,files.get(from)!);files.delete(from);}};
  if(id==='./calendarStore')return {listRecurrenceEvents:async()=>{readCount++;await gate;return rows;},listCalendarsWithMembers:async()=>({calendars,members:[]})};
  return require(id);
 },module,module.exports,Clock);
 const timerApi={setInterval:(callback:()=>Promise<unknown>,ms:number)=>{assert.equal(ms,30000);const timer={unref:()=>{unrefs++;}};timers.set(timer,callback);return timer;},clearInterval:(timer:any)=>timers.delete(timer)};
 const quit=()=>{quitCallbacks.splice(0).forEach(fn=>fn());};
 const register=()=>module.exports.registerCalendarReminders(()=>{if(!origin)throw new Error('로그인 필요');return origin;},()=>{},timerApi);register();
 return {shown,files,poll:(muted:string[]=[])=>handler({},muted),restart:()=>{quit();register();},defer:(value:Promise<void>)=>{gate=value;},switchSession:(userId='other',epoch=2)=>{origin={userId,epoch};},logout:()=>{origin=null;},time:(value:number)=>{currentNow=value;},tick:async()=>{currentNow+=30000;await Promise.all([...timers.values()].map(fn=>fn()));},reads:()=>readCount,unrefs:()=>unrefs,timers:()=>timers.size,quit};
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

test('main timer stays idle until preferences arrive and delivers while renderer makes no more requests',async()=>{
 const h=await harness([row('background')]);h.time(now-60000);await h.tick();assert.equal(h.reads(),0);
 assert.equal((await h.poll()).length,0);await h.tick();assert.equal(h.shown.length,1);assert.match(h.shown[0].title,/background/);
 const inApp=await h.poll();assert.equal(inApp.length,1,'background delivery is returned once to the resumed renderer');assert.equal((await h.poll()).length,0);assert.equal(h.shown.length,1);
 assert.equal(h.unrefs(),1);h.quit();assert.equal(h.timers(),0);
});
test('background timer uses latest mute preferences and requires registration after a same-user relogin',async()=>{
 const h=await harness([row('background')]);h.time(now-30000);await h.poll(['team']);await h.tick();assert.equal(h.shown.length,0);
 await h.poll([]);await h.tick();assert.equal(h.shown.length,1);
 const next=await harness([row('new-session')]);next.time(now-30000);await next.poll();next.logout();await next.tick();assert.equal(next.shown.length,0);
 next.switchSession('viewer',2);await next.tick();assert.equal(next.shown.length,0,'previous epoch preferences cannot enable a new login');
 assert.equal((await next.poll()).length,1);assert.equal(next.shown.length,1);
});
test('a background read discards results after session changes and receives mute changes before it finishes',async()=>{
 for(const change of ['session','mute']){
  const h=await harness([row('background')]);h.time(now-30000);await h.poll();let release!:()=>void;h.defer(new Promise<void>(resolve=>release=resolve));
  const pending=h.tick();await Promise.resolve();if(change==='session')h.switchSession();else await h.poll(['team']);release();await pending;assert.equal(h.shown.length,0);assert.equal(h.files.size,0);
 }
});

test('main timer survives a failed read and stops pending delivery when the app quits',async()=>{
 const h=await harness([row('retry')]);h.time(now-30000);await h.poll();
 const failure=Promise.reject(new Error('offline'));h.defer(failure);await h.tick();assert.equal(h.shown.length,0);
 h.defer(Promise.resolve());await h.tick();assert.equal(h.shown.length,1,'failed background reads retry without a renderer request');
 const quitting=await harness([row('quit')]);quitting.time(now-30000);await quitting.poll();let release!:()=>void;
 quitting.defer(new Promise<void>(resolve=>release=resolve));const pending=quitting.tick();quitting.quit();release();await pending;
 assert.equal(quitting.shown.length,0);assert.equal(quitting.files.size,0);assert.equal(quitting.timers(),0);
});

test('same-user epoch change requires fresh preferences even if no timer observed the logout',async()=>{
 const h=await harness([row('relogin')]);h.time(now-30000);await h.poll();h.switchSession('viewer',2);await h.tick();assert.equal(h.shown.length,0);
 await h.poll(['team']);await h.tick();assert.equal(h.shown.length,0);await h.poll([]);await h.tick();assert.equal(h.shown.length,1);
 assert.equal((await h.poll(['team'])).length,0,'new mute also suppresses a queued in-app toast');
});
