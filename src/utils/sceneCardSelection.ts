export interface SceneCardSelectionRow {
  key: string;
  selectionIds: readonly string[];
}

/** Rows must follow the filtered, sorted card order, including layout groups. */
export function selectSceneCard(
  current: ReadonlySet<string>, rows: readonly SceneCardSelectionRow[],
  anchorKey: string | null, targetKey: string, mode: 'replace' | 'toggle' | 'range',
): Set<string> {
  const targetIndex = rows.findIndex(row => row.key === targetKey);
  if (targetIndex < 0) return new Set(current);
  const target = rows[targetIndex];
  if (mode === 'replace') return new Set(target.selectionIds);
  const next = new Set(current);
  if (mode === 'toggle') {
    const remove = target.selectionIds.every(id => current.has(id));
    for (const id of target.selectionIds) { if (remove) next.delete(id); else next.add(id); }
    return next;
  }
  const anchorIndex = rows.findIndex(row => row.key === anchorKey);
  // A missing/filtered-out anchor never refers to an unrelated row by old index.
  const start = anchorIndex < 0 ? targetIndex : Math.min(anchorIndex, targetIndex);
  const end = anchorIndex < 0 ? targetIndex : Math.max(anchorIndex, targetIndex);
  for (let index = start; index <= end; index++) for (const id of rows[index].selectionIds) next.add(id);
  return next;
}
