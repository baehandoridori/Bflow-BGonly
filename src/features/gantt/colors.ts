import type { GanttProject } from './types.ts';

// Existing inspector swatches, ordered to keep neighboring defaults distinct.
const DEFAULT_COLORS = ['#6C5CE7', '#74B9FF', '#65BCA7', '#E6BB68', '#DE879A', '#E88C70', '#A0A6B5', '#A29BFE'] as const;

function leastUsedColor(colors: string[], excludedColor?: string): string {
  const usage = new Map<string, number>();
  for (const color of colors) {
    const key = color.toLowerCase();
    usage.set(key, (usage.get(key) ?? 0) + 1);
  }
  const candidates = DEFAULT_COLORS.filter(color => color.toLowerCase() !== excludedColor?.toLowerCase());
  return candidates.reduce((selected, color) =>
    (usage.get(color.toLowerCase()) ?? 0) < (usage.get(selected.toLowerCase()) ?? 0) ? color : selected,
  );
}

export function nextProjectColor(projects: Pick<GanttProject, 'color'>[]): string {
  return leastUsedColor(projects.map(project => project.color));
}

export function newGroupColor(project: GanttProject, parentId: string | null): string | null {
  if (parentId !== null) return null;
  const siblingColors = project.tasks
    .filter(task => task.kind === 'group' && task.parentId === null)
    .map(task => task.color || project.color);
  return leastUsedColor(siblingColors, project.color);
}
