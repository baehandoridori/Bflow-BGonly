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
 const props:any={project,task,users:[],calendars:[],episodes:[],canEdit:true,canManage:true,pending:false,onSaveTask:async(patch:any,revision:number)=>{writes.push({patch,revision});props.project={...props.project,revision:revision+1,tasks:[{...props.task,...patch}]};props.task=props.project.tasks[0];return props.project;},onSaveProject:async()=>{},onClose(){},onComplete(){},onDelete(){},onAddChild(){},onMove(){},onRegisterCloseGuard:(value:any)=>{guard=value;}};
 return {writes,props,render(){state=ref=effect=0;pendingEffects=[];const tree=module.exports.GanttInspector(props);pendingEffects.forEach(fn=>fn());return tree;},async flush(){return guard?guard():false;},dispose(){effects.forEach(e=>e?.cleanup?.());}};
}

test('inspector title edits save on blur without a bottom save button',async()=>{
 const h=await harness();let tree=h.render();tree=h.render();const input=elements(tree,'input').find(e=>e.props.name==='title');assert.ok(input);
 input.props.onChange({target:{value:'바로 저장한 제목'}});tree=h.render();const title=elements(tree,'input').find(e=>e.props.name==='title');
 assert.equal(typeof title.props.onBlur,'function');title.props.onBlur();await h.flush();
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].patch.title,'바로 저장한 제목');assert.equal(elements(h.render(),'button').some(button=>text(button)==='변경 저장'),false);h.dispose();
});

test('progress has numeric entry near the title and saves on field exit',async()=>{
 const h=await harness();let tree=h.render();tree=h.render();const numeric=elements(tree,'input').find(e=>e.props.type==='number'&&e.props['aria-label']==='진행률');assert.ok(numeric,'direct progress entry must be visible');
 numeric.props.onChange({target:{value:'67'}});tree=h.render();elements(tree,'input').find(e=>e.props.type==='number').props.onBlur();await h.flush();
 assert.equal(h.writes[0].patch.progress,67);assert.ok(text(h.render()).includes('저장 완료'));h.dispose();
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
