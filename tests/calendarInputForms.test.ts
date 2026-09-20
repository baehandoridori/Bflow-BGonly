import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, nodes } from './helpers/calendarFormHarness.ts';

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
