import { create } from 'zustand';
import type { GanttCommand, GanttGateway, GanttProject, GanttSnapshot, GanttSpace } from './types.ts';
import { applyCommand } from './domain.ts';

type Entity = GanttProject | GanttSpace;
type EntityKey = {kind:'project'|'space';id:string};
interface HistoryEntry { keys:EntityKey[]; before:Array<Entity|null>; after:Array<Entity|null>; expected:string }
export interface GanttState {
  snapshot:GanttSnapshot; actorId:string|null; loading:boolean; pending:boolean; error:string|null;
  canUndo:boolean; canRedo:boolean;
  initialize(actorId:string|null,gateway?:GanttGateway):Promise<void>;
  refresh():Promise<void>; execute(command:GanttCommand):Promise<void>; undo():Promise<void>; redo():Promise<void>;
}
const empty=():GanttSnapshot=>({spaces:[],projects:[]});
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
function stableJson(value:unknown):string {return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);}
function defaultGateway():GanttGateway {
  const api=typeof window==='undefined'?undefined:window.electronAPI;
  if(!api?.ganttRead||!api?.ganttExecute)throw new Error('간트 저장 기능이 준비되지 않았습니다. 앱을 다시 실행해 주세요.');
  return {read:()=>api.ganttRead(),execute:request=>api.ganttExecute(request),subscribe:listener=>api.onGanttChanged?.(listener)??(()=>{})};
}
function entity(snapshot:GanttSnapshot,key:EntityKey):Entity|null {return (key.kind==='project'?snapshot.projects:snapshot.spaces).find(x=>x.id===key.id)??null;}
function entities(snapshot:GanttSnapshot,entry:Pick<HistoryEntry,'keys'>):Array<Entity|null>{return entry.keys.map(key=>entity(snapshot,key));}
function fingerprint(snapshot:GanttSnapshot,entry:Pick<HistoryEntry,'keys'>):string {
  const found=entities(snapshot,entry);
  return stableJson([found,entry.keys.map(key=>key.kind==='space'?snapshot.projects.filter(p=>p.spaceId===key.id).map(p=>[p.id,p.revision]).sort():null),entry.keys.length===2?[...new Set(found.filter(Boolean).map(p=>(p as GanttProject).spaceId))].sort().map(id=>snapshot.spaces.find(s=>s.id===id)??null):null]);
}
function replaceEntities(snapshot:GanttSnapshot,entry:HistoryEntry,targets:Array<Entity|null>):GanttSnapshot {
  const result=structuredClone(snapshot);
  entry.keys.forEach((key,index)=>{const rows=key.kind==='project'?result.projects:result.spaces,at=rows.findIndex(row=>row.id===key.id),target=targets[index];if(at>=0)rows.splice(at,1);if(target)(rows as Entity[]).push(structuredClone(target));});
  return result;
}
function restoreCommand(snapshot:GanttSnapshot,entry:HistoryEntry,targets:Array<Entity|null>):GanttCommand {
  if(entry.keys.length===2){
    const projects=entry.keys.map((key,index)=>({project:targets[index] as GanttProject,expectedRevision:entity(snapshot,key)!.revision})) as Extract<GanttCommand,{type:'saveProjectPair'}>['projects'];
    return {type:'saveProjectPair',projects,expectedSpaces:[...new Set(projects.map(item=>item.project.spaceId))].map(spaceId=>({spaceId,expectedRevision:snapshot.spaces.find(s=>s.id===spaceId)!.revision}))};
  }
  const key=entry.keys[0],target=targets[0],current=entity(snapshot,key);
  if(key.kind==='project')return target?{type:'saveProject',project:target as GanttProject,expectedRevision:current?.revision??null}:{type:'deleteProject',projectId:key.id,expectedRevision:current!.revision};
  return target?{type:'saveSpace',space:target as GanttSpace,expectedRevision:current?.revision??null}:{type:'deleteSpace',spaceId:key.id,expectedRevision:current!.revision,requireEmpty:true};
}
export function createGanttStore() {
  let gateway:GanttGateway|null=null,generation=0,refreshVersion=0,unsubscribe:(()=>void)|null=null;
  let undoStack:HistoryEntry[]=[],redoStack:HistoryEntry[]=[];
  return create<GanttState>((set,get)=>{
    const publishHistory=()=>set({canUndo:undoStack.length>0,canRedo:redoStack.length>0});
    const run=async(command:GanttCommand,historyMode:'record'|'undo'|'redo'='record',entry?:HistoryEntry)=>{
      const state=get();if(!gateway||!state.actorId)throw new Error('로그인이 필요합니다.');if(state.pending)throw new Error('이전 변경을 저장하고 있습니다.');
      const currentGeneration=generation,activeGateway=gateway,before=structuredClone(state.snapshot);
      let optimistic:GanttSnapshot;
      try{optimistic=applyCommand(before,state.actorId,command);}catch(error){set({error:errorText(error)});throw error;}
      // In-flight refreshes may not overwrite this optimistic command.
      refreshVersion++;set({snapshot:optimistic,pending:true,error:null});
      try {
        const canonical=await activeGateway.execute({requestId:crypto.randomUUID(),command});
        if(currentGeneration!==generation)return;
        // Restoring a deleted ID gets an authority-owned revision above its tombstone.
        // Accept only that field: concurrent task/ACL edits or sibling changes remain conflicts.
        if((command.type==='saveProject'||command.type==='saveSpace')&&command.expectedRevision===null){
          const key={kind:command.type==='saveProject'?'project':'space',id:command.type==='saveProject'?command.project.id:command.space.id} as const;
          const predicted=entity(optimistic,key),saved=entity(canonical,key);
          if(predicted&&saved&&Number.isSafeInteger(saved.revision)&&saved.revision>=predicted.revision&&stableJson({...saved,revision:predicted.revision})===stableJson(predicted)){
            optimistic=structuredClone(optimistic);const created=entity(optimistic,key)!;created.revision=saved.revision;
          }
        }
        set({snapshot:canonical,pending:false,error:null});
        if(command.type==='saveProject'||command.type==='deleteProject'||command.type==='saveProjectPair'){
          // Rebase only our own child-project changes. A sibling/space commit
          // arriving in the same response must remain a conflict for folder undo.
          for(const item of [...undoStack,...redoStack])if(item.keys[0].kind==='space'&&item.expected===fingerprint(before,item)&&fingerprint(canonical,item)===fingerprint(optimistic,item))item.expected=fingerprint(canonical,item);
        }
        if(historyMode==='record'){
          const keys:EntityKey[]=command.type==='saveProjectPair'?command.projects.map(item=>({kind:'project',id:item.project.id})):[{kind:command.type==='saveProject'||command.type==='deleteProject'?'project':'space',id:command.type==='saveProject'?command.project.id:command.type==='saveSpace'?command.space.id:command.type==='deleteProject'?command.projectId:command.spaceId}];
          const id=keys[0].id,key={keys};
          // Folder deletion and access cleanup have no atomic inverse in the
          // command contract; do not offer a partial restore of their children.
          const cascade=(command.type==='deleteSpace'&&before.projects.some(p=>p.spaceId===id))||(command.type==='saveSpace'&&before.projects.some(p=>p.spaceId===id&&JSON.stringify(p)!==JSON.stringify(optimistic.projects.find(next=>next.id===p.id))));
          if(!cascade)undoStack.push({...key,before:entities(before,key),after:entities(optimistic,key),expected:fingerprint(optimistic,key)});
          else undoStack=[];
          if(undoStack.length>50)undoStack.shift();redoStack=[];
        }else if(entry){
          // A later commit returned alongside ours must invalidate both travel
          // directions, rather than becoming the baseline for another restore.
          const expected=fingerprint(optimistic,entry);
          const restoredTarget=historyMode==='undo'?entry.before:entry.after;
          const previousSnapshot=replaceEntities(before,entry,restoredTarget);
          // Keep the actual revisions at both endpoints of our own travel. This
          // lets later replays match exactly without ignoring a remote revision.
          const source=entities(before,entry),destination=entities(optimistic,entry);
          const updated={...entry,before:historyMode==='undo'?destination:source,after:historyMode==='undo'?source:destination,expected};
          const rebasePrevious=(stack:HistoryEntry[])=>{
            // A pair may overlap an earlier single-project edit (or vice versa).
            // Rebase only matching pre-travel content, never an unrelated remote edit.
            for(const previous of stack)if(previous.expected===fingerprint(previousSnapshot,previous)&&fingerprint(canonical,previous)===fingerprint(optimistic,previous))previous.expected=fingerprint(optimistic,previous);
          };
          if(historyMode==='undo'){
            undoStack.pop();redoStack.push(updated);
            rebasePrevious(undoStack);
          }else {
            redoStack.pop();undoStack.push(updated);
            rebasePrevious(redoStack);
          }
        }
        publishHistory();
        // Read again to include commits that raced the response / invalidation.
        await get().refresh();
      }catch(error){
        if(currentGeneration!==generation)return;
        // Recovery belongs to the failed mutation. Keep its write lock until the
        // canonical read finishes so a later optimistic edit cannot be overwritten.
        set({error:errorText(error)});
        try{const canonical=await activeGateway.read();if(currentGeneration===generation)set({snapshot:canonical,pending:false,error:errorText(error)});}catch{if(currentGeneration===generation)set({snapshot:before,pending:false,error:`${errorText(error)} 최신 내용을 불러오지 못했습니다. 새로고침해 주세요.`});}
        throw error;
      }
    };
    const travel=async(direction:'undo'|'redo')=>{
      if(get().pending)return;const stack=direction==='undo'?undoStack:redoStack,entry=stack.at(-1);if(!entry||!gateway)return;
      const currentGeneration=generation,activeGateway=gateway;
      refreshVersion++;set({pending:true,error:null});
      try {
        const latest=await activeGateway.read();if(currentGeneration!==generation)return;
        set({snapshot:latest,pending:false});
        if(fingerprint(latest,entry)!==entry.expected){undoStack=[];redoStack=[];publishHistory();throw new Error('다른 변경이 반영되어 실행 취소·다시 실행을 할 수 없습니다.');}
        await run(restoreCommand(latest,entry,direction==='undo'?entry.before:entry.after),direction,entry);
      }catch(error){if(currentGeneration===generation)set({pending:false,error:errorText(error)});throw error;}
    };
    return {
      snapshot:empty(),actorId:null,loading:false,pending:false,error:null,canUndo:false,canRedo:false,
      async initialize(actorId,provided){
        generation++;refreshVersion++;unsubscribe?.();unsubscribe=null;gateway=null;undoStack=[];redoStack=[];
        set({snapshot:empty(),actorId,loading:Boolean(actorId),pending:false,error:null,canUndo:false,canRedo:false});
        if(!actorId)return;const current=generation;
        try {gateway=provided??defaultGateway();const selected=gateway;unsubscribe=selected.subscribe?.(()=>{if(generation===current&&!get().pending)void get().refresh();})??null;
          const snapshot=await selected.read();if(generation===current)set({snapshot,loading:false});
        }catch(error){if(generation===current)set({loading:false,error:errorText(error)});}
      },
      async refresh(){
        if(!gateway||get().pending)return;const current=generation,version=++refreshVersion,selected=gateway;
        try{const snapshot=await selected.read();if(generation===current&&version===refreshVersion&&!get().pending)set({snapshot,loading:false,error:null});}
        catch(error){if(generation===current&&version===refreshVersion)set({loading:false,error:errorText(error)});}
      },
      execute:command=>run(command),undo:()=>travel('undo'),redo:()=>travel('redo'),
    };
  });
}
export const useGanttStore=createGanttStore();
