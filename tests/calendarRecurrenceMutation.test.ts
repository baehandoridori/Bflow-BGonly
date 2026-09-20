import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle=await build({entryPoints:['src/shared/calendarRecurrenceMutation.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {mutateRecurringMaster}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const master={id:'master',calendarId:'cal',title:'회의',startDate:'2026-09-01',endDate:'2026-09-01',recurrenceRule:{frequency:'daily',interval:1,count:10},recurrenceRevision:4};
test('this exception preserves series and adds original occurrence key',()=>{
 const [next]=mutateRecurringMaster(master,'update','this','2026-09-03',{startDate:'2026-09-07',endDate:'2026-09-07'},'split');
 assert.equal(next.startDate,master.startDate);assert.equal(next.recurrenceRevision,5);assert.equal(next.recurrenceExceptions[0].occurrenceDate,'2026-09-03');assert.equal(master.recurrenceRevision,4);
 assert.throws(()=>mutateRecurringMaster(master,'update','this','2026-10-01',{title:'bad'},'split'));
});
test('following split consumes count only before boundary and transfers later exceptions',()=>{
 const source={...master,recurrenceExceptions:[{occurrenceDate:'2026-09-02',cancelled:true},{occurrenceDate:'2026-09-05',cancelled:true}]};
 const [before,after]=mutateRecurringMaster(source,'update','following','2026-09-04',{title:'새 회의'},'split');
 assert.equal(before.recurrenceRule.until,'2026-09-03');assert.equal(before.recurrenceRule.count,undefined);
 assert.equal(after.id,'split');assert.equal(after.startDate,'2026-09-04');assert.equal(after.recurrenceRule.count,7);
 assert.equal(before.recurrenceExceptions.length,1);assert.equal(after.recurrenceExceptions[0].occurrenceDate,'2026-09-05');
 assert.equal(mutateRecurringMaster(source,'delete','following','2026-09-04',{},'split').length,1);
});
test('all edits preserve exceptions for content and clear them when dates change',()=>{
 const source={...master,recurrenceExceptions:[{occurrenceDate:'2026-09-02',cancelled:true}]};
 assert.equal(mutateRecurringMaster(source,'update','all',undefined,{title:'이름'},'split')[0].recurrenceExceptions.length,1);
 assert.deepEqual(mutateRecurringMaster(source,'update','all',undefined,{startDate:'2026-10-01'},'split')[0].recurrenceExceptions,[]);
 assert.deepEqual(mutateRecurringMaster(source,'delete','all',undefined,{},'split'),[]);
});

test('following end-only changes retain only exceptions still within the new rule and unchanged full drafts preserve them',()=>{
 const source={...master,recurrenceExceptions:[{occurrenceDate:'2026-09-05',cancelled:true},{occurrenceDate:'2026-09-08',cancelled:true}]};
 const [,after]=mutateRecurringMaster(source,'update','following','2026-09-04',{recurrenceRule:{frequency:'daily',interval:1,count:3}},'split');
 assert.equal(after.recurrenceExceptions.length,1);assert.equal(after.recurrenceExceptions[0].occurrenceDate,'2026-09-05');
 const [,unchanged]=mutateRecurringMaster(source,'update','following','2026-09-04',{recurrenceRule:{...master.recurrenceRule}},'split');assert.equal(unchanged.recurrenceRule.count,7);assert.equal(unchanged.recurrenceExceptions.length,2);
 assert.equal(mutateRecurringMaster(source,'update','all',undefined,{startDate:master.startDate,recurrenceRule:{...master.recurrenceRule}},'split')[0].recurrenceExceptions.length,2);
});
test('one occurrence cannot move to a different calendar or modify linked series fields',()=>{
 for(const patch of [{calendarId:'another'},{linkedTodoId:'todo'},{recurrenceRule:null}])assert.throws(()=>mutateRecurringMaster(master,'update','this','2026-09-03',patch,'split'));
});
