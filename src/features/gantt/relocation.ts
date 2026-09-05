import {descendantIds,scheduleProject} from './domain.ts';
import type {GanttProject} from './types.ts';

export type RelocationPosition='before'|'after'|'inside';
export class CrossingPredecessorError extends Error {
  count:number;
  constructor(count:number){super(`프로젝트 밖으로 이어진 선행 관계 ${count}개를 해제해야 이동할 수 있습니다.`);this.name='CrossingPredecessorError';this.count=count;}
}
/** Move an entire subtree. Membership is represented by parentId, never visual row order. */
export function relocateTask(source:GanttProject,taskId:string,target:GanttProject,targetTaskId:string|null,position:RelocationPosition,options:{clearCrossingPredecessors?:boolean}={}) {
  if(source.completed||target.completed)throw new Error('완료된 프로젝트를 다시 연 뒤 이동해 주세요.');
  const root=source.tasks.find(t=>t.id===taskId),destination=targetTaskId?target.tasks.find(t=>t.id===targetTaskId):null;
  if(!root)throw new Error('이동할 작업을 찾을 수 없습니다.');
  if(targetTaskId&&!destination)throw new Error('이동 대상을 찾을 수 없습니다.');
  if(!['before','after','inside'].includes(position)||(!destination&&position!=='inside')||(position==='inside'&&destination&&destination.kind!=='group'))throw new Error('프로젝트 또는 그룹 안으로 이동해 주세요.');
  const same=source.id===target.id,moving=descendantIds(source,taskId);
  if(same&&destination&&moving.has(destination.id))throw new Error('자신이나 하위 작업으로 이동할 수 없습니다.');
  if(!same&&target.tasks.some(t=>moving.has(t.id)))throw new Error('이동할 작업 ID가 대상 프로젝트에 중복됩니다.');
  const crossing=!same?source.tasks.filter(t=>t.predecessorId&&moving.has(t.id)!==moving.has(t.predecessorId)):[];
  if(crossing.length&&!options.clearCrossingPredecessors)throw new CrossingPredecessorError(crossing.length);
  const nextSource=structuredClone(source),nextTarget=same?nextSource:structuredClone(target);
  const crossed=new Set(crossing.map(t=>t.id));
  for(const task of nextSource.tasks)if(crossed.has(task.id))task.predecessorId=null;
  const moved=nextSource.tasks.filter(t=>moving.has(t.id));
  nextSource.tasks=nextSource.tasks.filter(t=>!moving.has(t.id));
  const parentId=position==='inside'?destination?.id??null:destination!.parentId;
  moved.find(t=>t.id===taskId)!.parentId=parentId;
  const siblings=nextTarget.tasks.filter(t=>t.parentId===parentId).sort((a,b)=>a.sortOrder-b.sortOrder);
  const index=position==='inside'?siblings.length:siblings.findIndex(t=>t.id===targetTaskId)+(position==='after'?1:0);
  siblings.splice(index,0,moved.find(t=>t.id===taskId)!);
  siblings.forEach((task,index)=>{task.sortOrder=index;});
  nextTarget.tasks.push(...moved);
  if(same){const project=scheduleProject(nextSource);return {sourceProject:project,targetProject:project,crossingPredecessorCount:0};}
  return {sourceProject:scheduleProject(nextSource),targetProject:scheduleProject(nextTarget),crossingPredecessorCount:crossing.length};
}
