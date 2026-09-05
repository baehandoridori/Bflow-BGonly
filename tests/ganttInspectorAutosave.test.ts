import test from 'node:test';
import assert from 'node:assert/strict';
import { InspectorAutosave } from '../src/features/gantt/inspectorAutosave.ts';

const source = (key='task-a',revision=1,values:Record<string,unknown>={title:'원본',progress:0,memo:''})=>({key,revision,values});
const load = async()=>InspectorAutosave;
const deferred=()=>{let resolve!:(value:any)=>void;let reject!:(error:Error)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('rapid edits serialize against the acknowledged revision without replacing the later draft',async()=>{
 const Autosave=await load(),first=deferred(),writes:any[]=[];
 const queue=new Autosave(()=>{});queue.receive(source(),{fields:['title','progress','memo'],prepare:(values:any)=>({values}),save:async(patch:any,revision:number)=>{writes.push({patch,revision});if(writes.length===1)return first.promise;return source('task-a',revision+1,{title:'두 번째',progress:0,memo:''});}});
 queue.change({title:'첫 번째'},false);const saving=queue.flush();queue.change({title:'두 번째'},false);
 assert.equal(queue.snapshot().values.title,'두 번째');assert.equal(writes.length,1);
 first.resolve(source('task-a',2,{title:'첫 번째',progress:0,memo:''}));assert.equal(await saving,true);
 assert.deepEqual(writes,[{patch:{title:'첫 번째'},revision:1},{patch:{title:'두 번째'},revision:2}]);assert.equal(queue.snapshot().status,'saved');queue.dispose();
});

test('failed writes keep the draft, clear its preview and retry only when requested',async()=>{
 const Autosave=await load();let fail=true,writes=0;const preview:any[]=[];
 const queue=new Autosave(()=>{},value=>preview.push(value));queue.receive(source(),{fields:['title','progress','memo'],prepare:(values:any)=>({values}),save:async(patch:any,revision:number)=>{writes++;if(fail)throw new Error('연결 실패');return source('task-a',revision+1,{...source().values,...patch});}});
 queue.change({progress:70},false);assert.equal(await queue.flush(),false);assert.equal(queue.snapshot().values.progress,70);assert.equal(queue.snapshot().status,'error');assert.equal(preview.at(-1),null);
 assert.equal(await queue.flush(),false);assert.equal(writes,1);fail=false;assert.equal(await queue.retry(),true);assert.equal(queue.snapshot().status,'saved');queue.dispose();
});

test('remote revision changes fence a dirty draft instead of saving it over newer work',async()=>{
 const Autosave=await load();let writes=0;const queue=new Autosave(()=>{}),config={fields:['title','progress','memo'],prepare:(values:any)=>({values}),save:async()=>{writes++;return source();}};
 queue.receive(source(),config);queue.change({title:'내 입력'},false);queue.receive(source('task-a',2,{title:'다른 사람',progress:0,memo:''}),config);
 assert.equal(queue.snapshot().status,'conflict');assert.equal(await queue.flush(),false);assert.equal(writes,0);assert.equal(queue.snapshot().values.title,'내 입력');queue.reload();assert.equal(queue.snapshot().values.title,'다른 사람');queue.dispose();
});

test('invalid intermediate forms stay local until confirmation makes them valid',async()=>{
 const Autosave=await load();let accepted=false,writes=0;const queue=new Autosave(()=>{});
 queue.receive(source(),{fields:['title','progress','memo'],prepare:(values:any)=>({values,error:accepted?undefined:'공유 확인 필요'}),save:async(patch:any,revision:number)=>{writes++;return source('task-a',revision+1,{...source().values,...patch});}});
 queue.change({title:'공유할 제목'},false);assert.equal(await queue.flush(),false);assert.equal(writes,0);assert.equal(queue.snapshot().status,'blocked');accepted=true;assert.equal(await queue.flush(),true);assert.equal(writes,1);queue.dispose();
});

test('a late response for the previous selection never overwrites the current draft',async()=>{
 const Autosave=await load(),first=deferred();const queue=new Autosave(()=>{}),config={fields:['title','progress','memo'],prepare:(values:any)=>({values}),save:async()=>first.promise};
 queue.receive(source(),config);queue.change({title:'A 저장'},false);const saving=queue.flush();queue.receive(source('task-b',1,{title:'B 원본',progress:0,memo:''}),config);queue.change({memo:'B 입력'},false);
 first.resolve(source('task-a',2,{title:'A 저장',progress:0,memo:''}));await saving;assert.equal(queue.snapshot().values.title,'B 원본');assert.equal(queue.snapshot().values.memo,'B 입력');queue.dispose();
});

test('external pending waits without sending a second write or discarding queued edits',async()=>{
 const Autosave=await load();let writes=0;const queue=new Autosave(()=>{});
 queue.receive(source(),{fields:['title','progress','memo'],prepare:(values:any)=>({values}),save:async(patch:any,revision:number)=>{writes++;return source('task-a',revision+1,{...source().values,...patch});}});
 queue.setPaused(true);queue.change({title:'대기 입력'},false);assert.equal(await queue.flush(),false);assert.equal(writes,0);assert.equal(queue.snapshot().values.title,'대기 입력');queue.setPaused(false);assert.equal(await queue.flush(),true);assert.equal(writes,1);queue.dispose();
});

test('a delayed canonical rollback makes a failed optimistic write retryable without discarding the draft',async()=>{
 const Autosave=await load(),response=deferred();const queue=new Autosave(()=>{});
 const config={fields:['title','progress','memo'],prepare:(values:any)=>({values}),save:async()=>response.promise};
 queue.receive(source(),config);queue.change({title:'실패해도 보관'},false);const saving=queue.flush();queue.receive(source('task-a',2,{title:'실패해도 보관',progress:0,memo:''}),config);
 response.reject(new Error('연결 실패'));assert.equal(await saving,false);queue.receive(source(),config);
 assert.equal(queue.snapshot().status,'error');assert.equal(queue.snapshot().values.title,'실패해도 보관');queue.dispose();
});

test('an acknowledgement containing a newer concurrent revision must require a reload before any retry',async()=>{
 const Autosave=await load();let writes=0;const queue=new Autosave(()=>{});
 queue.receive(source(),{fields:['title','progress','memo'],prepare:(values:any)=>({values}),save:async()=>{writes++;return source('task-a',3,{title:'새 원격 내용',progress:0,memo:''});}});
 queue.change({title:'내 입력'},false);assert.equal(await queue.flush(),false);assert.equal(queue.snapshot().status,'conflict');assert.equal(await queue.retry(),false);assert.equal(writes,1);assert.equal(queue.snapshot().values.title,'내 입력');queue.dispose();
});

test('invalid or failed progress drafts never remain as a successful chart preview',async()=>{
 const Autosave=await load(),preview:any[]=[];const queue=new Autosave(()=>{},value=>preview.push(value));
 queue.receive(source(),{fields:['title','progress','memo'],prepare:(values:any)=>({values}),save:async()=>{throw new Error('오프라인');}});
 queue.change({progress:30},false);await queue.flush();queue.change({progress:70},false);assert.equal(preview.at(-1),null);queue.reload();queue.change({progress:101},false);assert.equal(preview.at(-1),null);queue.dispose();
});

test('an acknowledged save becomes the rollback baseline before a renderer refresh arrives',async()=>{
 const Autosave=await load();let writes=0;const queue=new Autosave(()=>{});
 queue.receive(source(),{fields:['title','progress','memo'],prepare:(values:any)=>({values}),save:async(patch:any,revision:number)=>{writes++;if(writes===2)throw new Error('연결 실패');return source('task-a',revision+1,{...source().values,...patch});}});
 queue.change({title:'저장 완료 제목'},false);assert.equal(await queue.flush(),true);queue.change({memo:'다음 변경'},false);assert.equal(await queue.flush(),false);assert.equal(queue.snapshot().status,'error');
 queue.reload();assert.equal(queue.snapshot().values.title,'저장 완료 제목');assert.equal(queue.snapshot().values.memo,'');queue.dispose();
});

test('typing coalesces automatically while discrete changes start on the next event turn',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const writes:any[]=[];const queue=new InspectorAutosave(()=>{});
 queue.receive(source(),{fields:['title','progress','memo'],prepare:values=>({values}),save:async(patch,revision)=>{writes.push(patch);return source('task-a',revision+1,{...source().values,...patch});}});
 queue.change({title:'첫 입력'});t.mock.timers.tick(300);queue.change({title:'마지막 입력'});t.mock.timers.tick(449);assert.equal(writes.length,0);t.mock.timers.tick(1);assert.deepEqual(writes,[{title:'마지막 입력'}]);await queue.flush();
 queue.change({progress:50},true);t.mock.timers.tick(0);assert.equal(writes.length,2);assert.deepEqual(writes[1],{progress:50});await queue.flush();queue.dispose();t.mock.timers.reset();
});
