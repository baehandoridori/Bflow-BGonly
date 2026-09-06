import { descendantIds } from './domain.ts';
import type { GanttProject, GanttTask } from './types.ts';

export type RowDropPosition = 'before' | 'after' | 'inside';
export interface RowDrop {
  project: GanttProject;
  taskId: string | null;
  position: RowDropPosition;
  parentId: string | null;
  allowed: boolean;
  label: string;
}

/** Preview only. The command/domain layer must revalidate the final move. */
export function rowDrop(source: GanttProject, task: GanttTask, target: GanttProject, anchor: GanttTask | null, position: RowDropPosition, canEdit: boolean): RowDrop {
  if (!anchor) position = 'inside';
  const parentId = position === 'inside' ? anchor?.id ?? null : anchor?.parentId ?? null;
  const parent = target.tasks.find(t => t.id === parentId);
  const destination = parent ? `${target.name} › ${parent.title}` : target.name;
  const suffix = position === 'inside' ? '마지막에 넣기' : `‘${anchor?.title}’ ${position === 'before' ? '앞' : '뒤'}로 이동`;
  const result: RowDrop = {project: target, taskId: anchor?.id ?? null, position, parentId, allowed: true, label: `${destination} · ${suffix}`};
  const reject = (label: string): RowDrop => ({...result, allowed: false, label});
  if (!canEdit || source.completed || target.completed) return reject('편집할 수 있는 진행 중 프로젝트로 이동하세요.');
  if (anchor && position === 'inside' && anchor.kind !== 'group') return reject('작업 안에는 넣을 수 없습니다. 그룹이나 프로젝트를 선택하세요.');
  if (source.id === target.id && anchor && descendantIds(source, task.id).has(anchor.id)) return reject('자기 자신이나 하위 작업으로 이동할 수 없습니다.');
  if (source.id === target.id && task.parentId === parentId) {
    const original = source.tasks.filter(t => t.parentId === parentId).sort((a,b) => a.sortOrder - b.sortOrder).map(t => t.id);
    const reordered = original.filter(id => id !== task.id);
    const at = position === 'inside' ? reordered.length : reordered.indexOf(anchor!.id) + (position === 'after' ? 1 : 0);
    reordered.splice(at, 0, task.id);
    if (original.every((id,index) => id === reordered[index])) return reject('현재 위치입니다.');
  }
  return result;
}
