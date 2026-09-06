import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { isValidElement, type ReactNode } from 'react';
import { createProject, createTask } from '../src/features/gantt/domain.ts';

const bundle=build({entryPoints:['src/features/gantt/GanttInspector.tsx'],bundle:true,format:'cjs',platform:'node',write:false,loader:{'.css':'empty'},external:['react','react/jsx-runtime','lucide-react','./GanttSelect']});
function elements(node:any,type:string):any[]{if(Array.isArray(node))return node.flatMap(child=>elements(child,type));if(!isValidElement(node))return [];return [...(node.type===type||typeof node.type==='function'&&node.type.name===type?[node]:[]),...elements((node.props as any).children,type)];}
function text(node:any):string{if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join('');return isValidElement(node)?text((node.props as any).children):'';}
async function harness(){
 const require=createRequire(import.meta.url),react=require('react');const states:any[]=[],refs:any[]=[],effects:any[]=[];let state=0,ref=0,effect=0,pendingEffects:(()=>void)[]=[];
 const useEffect=(fn:()=>any,deps?:any[])=>{const slot=effect++,old=effects[slot];if(old&&deps&&old.deps?.length===deps.length&&deps.every((v,i)=>Object.is(v,old.deps[i])))return;pendingEffects.push(()=>{old?.cleanup?.();effects[slot]={deps,cleanup:fn()};});};
 const module={exports:{} as any};new Function('require','module','exports',(await bundle).outputFiles[0].text)((id:string)=>id==='react'?{...react,useState:(initial:any)=>{const slot=state++;if(!(slot in states))states[slot]=typeof initial==='function'?initial():initial;return [states[slot],(next:any)=>{states[slot]=typeof next==='function'?next(states[slot]):next;}];},useRef:(initial:any)=>refs[ref++]??(refs[ref-1]={current:initial}),useEffect,useLayoutEffect:useEffect,useMemo:(fn:any)=>fn(),useCallback:(fn:any)=>fn}:id==='./GanttSelect'?{GanttSelect:()=>null}:require(id),module,module.exports);
 const task=createTask('원래 제목','2026-09-06'),project=createProject('프로젝트',crypto.randomUUID(),'owner');project.tasks=[task];const writes:any[]=[];let guard:(()=>Promise<boolean>)|null=null;
 const props:any={project,task,users:[],calendars:[],episodes:[],canEdit:true,canManage:true,pending:false,onSaveTask:async(patch:any,revision:number)=>{writes.push({patch,revision});props.project={...props.project,revision:revision+1,tasks:[{...props.task,...patch}]};props.task=props.project.tasks[0];return props.project;},onSaveProject:async(patch:any,revision:number)=>{writes.push({patch,revision});props.project={...props.project,...patch,revision:revision+1};return props.project;},onClose(){},onComplete(){},onDelete(){},onAddChild(){},onMove(){},onRegisterCloseGuard:(value:any)=>{guard=value;}};
 return {writes,props,render(){state=ref=effect=0;pendingEffects=[];const tree=module.exports.GanttInspector(props);pendingEffects.forEach(fn=>fn());return tree;},async flush(){return guard?guard():false;},dispose(){effects.forEach(e=>e?.cleanup?.());}};
}

test('inspector title edits save on blur without a bottom save button',async()=>{
 const h=await harness();let tree=h.render();tree=h.render();const input=elements(tree,'textarea').find(e=>e.props.name==='title');assert.ok(input);
 input.props.onChange({target:{value:'바로 저장한 제목'}});tree=h.render();const title=elements(tree,'textarea').find(e=>e.props.name==='title');
 assert.equal(typeof title.props.onBlur,'function');title.props.onBlur();await h.flush();
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].patch.title,'바로 저장한 제목');assert.equal(elements(h.render(),'button').some(button=>text(button)==='변경 저장'),false);h.dispose();
});

test('wrapping title editor preserves a long Korean title and saves with Enter after composition',async()=>{
 const h=await harness();let tree=h.render();tree=h.render();const title='긴 한글 작업 제목을 좁은 상세창에서도 끝까지 확인하고 편집할 수 있어야 합니다. '.repeat(3).trim();
 const editor=()=>elements(tree,'textarea').find(e=>e.props.name==='title');
 editor().props.onChange({target:{value:title}});tree=h.render();assert.equal(editor().props.value,title);
 let prevented=0;editor().props.onKeyDown({key:'Enter',nativeEvent:{isComposing:true},preventDefault(){prevented++;}});
 assert.equal(prevented,0);assert.equal(h.writes.length,0,'IME confirmation must not submit the unfinished title');
 editor().props.onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault(){prevented++;}});
 assert.equal(prevented,1);assert.equal(await h.flush(),true);assert.equal(h.writes[0].patch.title,title);h.dispose();
});

test('title editor outside the scrolling form keeps read-only access and empty-draft close protection',async()=>{
 const h=await harness();h.props.canEdit=false;let tree=h.render();tree=h.render();let title=elements(tree,'textarea').find(e=>e.props.name==='title');
 assert.equal(title.props.disabled,true);title.props.onChange({target:{value:'수정 시도'}});assert.equal(await h.flush(),true);assert.equal(h.writes.length,0);
 h.props.canEdit=true;tree=h.render();title=elements(tree,'textarea').find(e=>e.props.name==='title');assert.equal(title.props.disabled,false);
 title.props.onChange({target:{value:''}});tree=h.render();assert.equal(await h.flush(),false);tree=h.render();
 assert.equal(elements(tree,'textarea').find(e=>e.props.name==='title').props.value,'');assert.equal(h.writes.length,0);
 assert.ok(text(tree).includes('제목을 입력하면 자동으로 저장합니다.'));h.dispose();
});

test('project title editor saves project names and reflects a later canonical rename',async()=>{
 const h=await harness();h.props.task=null;let tree=h.render();tree=h.render();let editor=elements(tree,'textarea').find(e=>e.props.name==='name');
 editor.props.onChange({target:{value:'프로젝트의 긴 이름도 전체가 보이고 편집됩니다'}});h.render();assert.equal(await h.flush(),true);
 assert.deepEqual(h.writes[0].patch,{name:'프로젝트의 긴 이름도 전체가 보이고 편집됩니다'});
 h.props.project={...h.props.project,name:'다른 창에서 변경한 프로젝트 이름',revision:h.props.project.revision+1};h.render();tree=h.render();
 editor=elements(tree,'textarea').find(e=>e.props.name==='name');assert.equal(editor.props.value,'다른 창에서 변경한 프로젝트 이름');h.dispose();
});

test('progress has numeric entry near the title and saves on field exit',async()=>{
 const h=await harness();let tree=h.render();tree=h.render();const numeric=elements(tree,'input').find(e=>e.props.type==='number'&&e.props['aria-label']==='진행률');assert.ok(numeric,'direct progress entry must be visible');
 numeric.props.onChange({target:{value:'67'}});tree=h.render();elements(tree,'input').find(e=>e.props.type==='number').props.onBlur();await h.flush();
 assert.equal(h.writes[0].patch.progress,67);assert.ok(text(h.render()).includes('저장 완료'));h.dispose();
});

test('progress increases pulse once without replacing the input or saving each keystroke',async()=>{
 const h=await harness();let tree=h.render();tree=h.render();
 const ring=elements(tree,'span').find(e=>e.props.className==='gantt-progress-pulse');assert.ok(ring);
 const animations:Array<{frames:any;options:any;cancelled:boolean}>=[];
 ring.ref.current={ownerDocument:{defaultView:{matchMedia:()=>({matches:false})}},animate(frames:any,options:any){const record={frames,options,cancelled:false};animations.push(record);return {cancel(){record.cancelled=true;}};}};
 const editor=()=>elements(tree,'input').find(e=>e.props.type==='number');
 const editorKey=editor().key;
 editor().props.onChange({target:{value:'6'}});tree=h.render();
 assert.equal(animations.length,1);assert.equal(editor().key,editorKey);assert.equal(h.writes.length,0);
 editor().props.onChange({target:{value:'67'}});tree=h.render();
 assert.equal(animations.length,2);assert.equal(animations[0].cancelled,true);assert.equal(editor().props.value,67);assert.equal(editor().key,editorKey);
 assert.ok(animations[1].options.duration>0&&animations[1].options.duration<=600);
 assert.equal(animations[1].options.iterations??1,1);
 assert.equal(animations[1].frames.at(-1).opacity,0);
 editor().props.onChange({target:{value:'20'}});tree=h.render();
 assert.equal(animations.length,2,'decreasing progress must not start another pulse');assert.equal(animations[1].cancelled,true);
 editor().props.onBlur();await h.flush();assert.equal(h.writes.length,1);assert.equal(h.writes[0].patch.progress,20);h.dispose();
});

test('progress pulses respect reduced motion and do not play when switching tasks',async()=>{
 const h=await harness();let tree=h.render();tree=h.render();
 const ring=elements(tree,'span').find(e=>e.props.className==='gantt-progress-pulse');assert.ok(ring);
 let calls=0,reduced=true;
 ring.ref.current={ownerDocument:{defaultView:{matchMedia:()=>({matches:reduced})}},animate(){calls++;return {cancel(){}};}};
 elements(tree,'input').find(e=>e.props.type==='number').props.onChange({target:{value:'30'}});tree=h.render();assert.equal(calls,0);
 await h.flush();reduced=false;
 h.props.task={...createTask('다른 작업','2026-09-06'),progress:90};h.props.project={...h.props.project,tasks:[h.props.task]};tree=h.render();tree=h.render();
 assert.equal(calls,0,'a newly selected task is not a progress increase');h.dispose();
});

test('completion button exposes its saved state and keeps completion and reopen actions',async()=>{
 const h=await harness();let calls=0;h.props.onComplete=()=>calls++;let tree=h.render();tree=h.render();
 const completion=()=>elements(tree,'button').find(e=>e.props.className?.includes('gantt-inspector-complete'));
 assert.ok(completion());assert.equal(completion().props['aria-pressed'],false);assert.equal(text(completion()),'완료 표시');
 completion().props.onClick();assert.equal(calls,1);
 h.props.completed=true;tree=h.render();assert.equal(completion().props['aria-pressed'],true);assert.ok(text(completion()).includes('완료됨'));assert.ok(text(completion()).includes('다시 열기'));
 completion().props.onClick();assert.equal(calls,2);
 h.props.pending=true;tree=h.render();assert.equal(completion().props.disabled,true);h.dispose();
});

test('calendar selection stays local until its actual sharing confirmation is checked',async()=>{
 const h=await harness(),calendarId=crypto.randomUUID();h.props.calendars=[{id:calendarId,name:'공유 확인 캘린더',ownerId:'owner',visibility:'private',members:[],canEdit:true}];
 let tree=h.render();tree=h.render();elements(tree,'GanttSelect').find(e=>e.props.label==='표시할 캘린더').props.onChange(calendarId);tree=h.render();
 assert.equal(await h.flush(),false);assert.equal(h.writes.length,0);
 const consent=elements(tree,'label').find(e=>text(e).includes('공유 대상과 내용을 확인했습니다.'));assert.ok(consent);
 elements(consent,'input')[0].props.onChange({target:{checked:true}});assert.equal(await h.flush(),true);assert.equal(h.writes[0].patch.calendarId,calendarId);h.dispose();
});

test('invalid intermediate dates block close until both dates form a valid saved range',async()=>{
 const h=await harness();let tree=h.render();tree=h.render();let dates=elements(tree,'input').filter(e=>e.props.type==='date');dates[0].props.onChange({target:{value:'2026-09-08'}});tree=h.render();
 assert.equal(await h.flush(),false);assert.equal(h.writes.length,0);dates=elements(tree,'input').filter(e=>e.props.type==='date');dates[1].props.onChange({target:{value:'2026-09-10'}});h.render();
 assert.equal(await h.flush(),true);assert.deepEqual(h.writes[0].patch,{startDate:'2026-09-08',endDate:'2026-09-10'});h.dispose();
});

test('scene-derived mode with no selected scenes cannot silently replace the stored progress mode',async()=>{
 const h=await harness();let tree=h.render();tree=h.render();elements(tree,'GanttSelect').find(e=>e.props.label==='진행률 계산 방식').props.onChange('scenes');tree=h.render();
 assert.equal(await h.flush(),false);assert.equal(h.writes.length,0);assert.equal(h.props.task.progressMode,'manual');
 elements(tree,'GanttSelect').find(e=>e.props.label==='진행률 계산 방식').props.onChange('manual');h.render();assert.equal(await h.flush(),true);assert.equal(h.writes.length,0);h.dispose();
});
