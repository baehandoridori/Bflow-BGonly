import { isTaskComplete } from './domain.ts';
import type { GanttProject, GanttTask } from './types.ts';

export function visibleTreeTasks(project: GanttProject, filter: 'all'|'active'|'completed', search = '', worker = ''): Set<string> {
  const query = search.trim().toLocaleLowerCase();
  const projectMatch = project.name.toLocaleLowerCase().includes(query);
  const included = new Set(project.tasks.filter(task =>
    (filter === 'all' || (filter === 'completed' ? isTaskComplete(project, task) : !isTaskComplete(project, task))) &&
    (!query || projectMatch || task.title.toLocaleLowerCase().includes(query)) && (!worker || task.workers.includes(worker))
  ).map(task => task.id));
  for (const task of project.tasks.filter(task => included.has(task.id))) {
    let parent = task.parentId;
    while (parent && !included.has(parent)) {included.add(parent);parent = project.tasks.find(row => row.id === parent)?.parentId ?? null;}
  }
  return included;
}

export function orderedChildren(project: GanttProject, parentId: string|null): GanttTask[] {
  return project.tasks.filter(task => task.parentId === parentId).sort((a,b) => a.sortOrder - b.sortOrder);
}
