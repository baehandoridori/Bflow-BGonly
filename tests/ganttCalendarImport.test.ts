import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createSpace, validateProject } from '../src/features/gantt/domain.ts';
import { importCalendarEvents, getCalendarImportSourceKey, isCalendarEventImported } from '../src/features/gantt/calendarImport.ts';
import { createPreviewGateway, listCalendarEvents } from '../src/features/gantt/previewGateway.ts';
import type { CalendarEvent } from '../src/types/calendar.ts';
const sourceCalendar = crypto.randomUUID();
const event = (updates: Partial<CalendarEvent> = {}): CalendarEvent => ({
 id:crypto.randomUUID(),title:'공유 일정',memo:'메모\n둘째 줄',color:'#E17055',type:'custom',startDate:'2026-09-16',endDate:'2026-09-18',
 createdBy:'다른 사람',createdAt:'2026-09-16T00:00:00Z',source:'bflow',sourceCalendarId:`bflow:${sourceCalendar}`,calendarId:sourceCalendar,allDay:true,canEdit:false,isReadOnly:true,...updates,
});
const project = () => createProject('가져오기 대상',crypto.randomUUID(),'owner');
test('imports accessible read-only events as independent tasks without modifying source or calendar links',()=>{
 const p=project(),e=event(),before=structuredClone({p,e});
 const result=importCalendarEvents(p,[e]);const task=result.project.tasks[0];
 assert.deepEqual({p,e},before);assert.equal(result.importedCount,1);assert.equal(result.skippedCount,0);
 assert.match(task.id,/^[0-9a-f-]{36}$/);assert.equal(task.title,e.title);assert.equal(task.memo,e.memo);assert.equal(task.color,e.color);
 assert.equal(task.startDate,e.startDate);assert.equal(task.endDate,e.endDate);assert.equal(task.calendarId,null);assert.equal(task.calendarEventId,null);
 assert.equal(task.mode,'manual');assert.equal(task.parentId,null);validateProject(result.project);
});
test('keeps normalized inclusive all-day end dates and cross-midnight clock times',()=>{
 const e=event({allDay:false,startDate:'2026-09-16',endDate:'2026-09-17',startTime:'23:30',endTime:'01:15'});
 const t=importCalendarEvents(project(),[e]).project.tasks[0];
 assert.deepEqual([t.startDate,t.endDate,t.startTime,t.endTime,t.allDay],['2026-09-16','2026-09-17','23:30','01:15',false]);
});
test('deduplicates within a batch and after persisted JSON reload, even when source event changes calendars',()=>{
 const e=event(),first=importCalendarEvents(project(),[e,e]);assert.equal(first.importedCount,1);assert.equal(first.skippedCount,1);
 const p=JSON.parse(JSON.stringify(first.project));const moved=event({...e,calendarId:'another',sourceCalendarId:'bflow:another'});
 assert.equal(isCalendarEventImported(p,moved),true);assert.equal(importCalendarEvents(p,[moved]).importedCount,0);
 assert.equal(importCalendarEvents(project(),[e]).importedCount,1,'a separate destination can import independently');
});
test('provider and external calendar namespaces distinguish equal event ids',()=>{
 const e=event({id:'same-id'}),g1=event({id:'same-id',source:'google',sourceCalendarId:'primary'}),g2=event({id:'same-id',source:'google',sourceCalendarId:'shared'});
 assert.equal(importCalendarEvents(project(),[e,g1,g2]).importedCount,3);
});
test('excludes projected Gantt events even with incomplete projection metadata',()=>{
 const e=event({id:'gantt:project:task'});assert.equal(getCalendarImportSourceKey(e),null);
 const p=project();const result=importCalendarEvents(p,[e]);assert.equal(result.importedCount,0);assert.equal(result.skippedCount,1);assert.deepEqual(result.project,p);
});
test('rejects overlong notes and malformed intervals atomically instead of truncating data',()=>{
 const p=project();assert.throws(()=>importCalendarEvents(p,[event(),event({memo:'x'.repeat(20001)})]),/메모/);assert.equal(p.tasks.length,0);
 assert.throws(()=>importCalendarEvents(p,[event({allDay:false,startTime:'23:00',endTime:'01:00',endDate:'2026-09-16'})]),/날짜|시간/);
});
test('main and preview project validation reject malformed provenance and duplicate source references',()=>{
 const p=importCalendarEvents(project(),[event()]).project;
 const bad=structuredClone(p);(bad.tasks[0] as unknown as {importedCalendarEvent:unknown}).importedCalendarEvent={source:'admin',calendarId:'x',eventId:'y'};
 assert.throws(()=>validateProject(bad),/가져오기/);
 p.tasks.push({...structuredClone(p.tasks[0]),id:crypto.randomUUID()});assert.throws(()=>validateProject(p),/중복/);
});
test('preview CAS saves provenance across reload, rejects concurrent import, creates no reverse calendar projection',async()=>{
 const values=new Map<string,string>();const options={seed:false,storage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}},locks:{request:async<T>(_key:string,run:()=>Promise<T>)=>run()}};
 const gateway=createPreviewGateway('owner',options),s=createSpace('폴더','owner'),p=createProject('대상',s.id,'owner');
 await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveSpace',space:s,expectedRevision:null}});
 await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:p,expectedRevision:null}});
 const original=(await gateway.read()).projects[0],source=event();const copied=importCalendarEvents(original,[source]).project;
 await gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:copied,expectedRevision:original.revision}});
 await assert.rejects(gateway.execute({requestId:crypto.randomUUID(),command:{type:'saveProject',project:copied,expectedRevision:original.revision}}),/변경|최신|버전/);
 const reloaded=(await createPreviewGateway('owner',options).read()).projects[0];assert.equal(isCalendarEventImported(reloaded,source),true);
 assert.equal(importCalendarEvents(reloaded,[source]).importedCount,0);assert.deepEqual(await listCalendarEvents('owner',options),[]);
});
