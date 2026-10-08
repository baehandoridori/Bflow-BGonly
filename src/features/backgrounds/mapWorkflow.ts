import type { BackgroundMap, BackgroundSnapshot } from './types.ts';

export type MapDraftSources = Record<string, { value: BackgroundMap; baseRevision: number | null }>;
export type MapSaveCommand = { type: 'save-maps'; maps: { entity: BackgroundMap; expectedRevision: number | null }[] };

/** Recognize a committed batch after its reply was lost, without accepting later conflicting edits. */
export function mapSaveWasApplied(snapshot: BackgroundSnapshot, command: MapSaveCommand): boolean {
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  return command.maps.every(({ entity, expectedRevision }) => {
    const actual = snapshot.maps.find(map => map.id === entity.id);
    return actual && canonical(actual) === canonical({ ...entity, revision: (expectedRevision ?? 0) + 1 });
  });
}

export function effectiveMaps(snapshot: BackgroundSnapshot, drafts: MapDraftSources): BackgroundMap[] {
  const maps = new Map(snapshot.maps.map(map => [map.id, map]));
  for (const draft of Object.values(drafts)) maps.set(draft.value.id, draft.value);
  return [...maps.values()];
}

/** Include unsaved dependencies, preserving the revision on which each draft was started. */
export function saveMapChanges(snapshot: BackgroundSnapshot, drafts: MapDraftSources, changes: BackgroundMap[]): MapSaveCommand {
  const available = new Map(effectiveMaps(snapshot, drafts).map(map => [map.id, map]));
  for (const map of changes) available.set(map.id, map);
  const savedIds = new Set(snapshot.maps.map(map => map.id));
  const pending = new Map<string, BackgroundMap>();
  function include(map: BackgroundMap) {
    if (pending.has(map.id)) return;
    pending.set(map.id, map);
    const dependencies = [map.parentId, ...map.nodes.flatMap(node => node.type === 'space' ? [node.childMapId] : [])];
    for (const id of dependencies) {
      if (!id || savedIds.has(id)) continue;
      const dependency = available.get(id);
      if (!dependency) throw new Error('연결할 도면을 찾을 수 없습니다. 다시 불러와 주세요.');
      include(dependency);
    }
  }
  changes.forEach(include);
  return { type: 'save-maps', maps: [...pending.values()].map(entity => ({
    entity,
    expectedRevision: drafts[entity.id] ? drafts[entity.id].baseRevision : snapshot.maps.find(map => map.id === entity.id)?.revision ?? null,
  })) };
}

export function mapCanNest(maps: BackgroundMap[], mapId: string, parentId: string | null): boolean {
  const seen = new Set<string>([mapId]);
  let cursor = parentId;
  while (cursor) {
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    const parent = maps.find(map => map.id === cursor);
    if (!parent) return false;
    cursor = parent.parentId;
  }
  return true;
}

/** Moving a map also releases the old parent's entrances; descendants remain untouched. */
export function moveMapChanges(maps: BackgroundMap[], map: BackgroundMap): BackgroundMap[] {
  if (!mapCanNest(maps, map.id, map.parentId)) throw new Error('자신이나 자신의 하위 도면 안으로 옮길 수 없습니다.');
  const changes = [map];
  for (const other of maps) {
    if (other.id === map.id || other.id === map.parentId) continue;
    if (!other.nodes.some(node => node.type === 'space' && node.childMapId === map.id)) continue;
    changes.push({ ...other, nodes: other.nodes.map(node => node.type === 'space' && node.childMapId === map.id ? { ...node, childMapId: null } : node) });
  }
  return changes;
}

export function connectMap(snapshot: BackgroundSnapshot, drafts: MapDraftSources, parentId: string, spaceId: string, childId: string | null): MapSaveCommand {
  const maps = effectiveMaps(snapshot, drafts);
  const parent = maps.find(map => map.id === parentId);
  const space = parent?.nodes.find(node => node.id === spaceId && node.type === 'space');
  if (!parent || !space || space.locked) throw new Error('연결할 공간을 선택하고 잠금을 해제해 주세요.');
  const changes: BackgroundMap[] = [];
  if (childId) {
    const child = maps.find(map => map.id === childId);
    if (!child) throw new Error('연결할 도면을 찾을 수 없습니다.');
    if (child.parentId !== parentId) changes.push(...moveMapChanges(maps, { ...child, parentId }));
  }
  changes.push({ ...parent, nodes: parent.nodes.map(node => node.id === spaceId && node.type === 'space' ? { ...node, childMapId: childId } : node) });
  return saveMapChanges(snapshot, drafts, changes);
}

export function createMapAndConnect(snapshot: BackgroundSnapshot, drafts: MapDraftSources, map: BackgroundMap, spaceId: string | null): MapSaveCommand {
  const changes = [map];
  if (spaceId) {
    const parent = effectiveMaps(snapshot, drafts).find(item => item.id === map.parentId);
    const space = parent?.nodes.find(node => node.type === 'space' && node.id === spaceId);
    if (!parent || !space || space.locked) throw new Error('연결할 공간을 선택하고 잠금을 해제해 주세요.');
    changes.push({ ...parent, nodes: parent.nodes.map(node => node.type === 'space' && node.id === spaceId ? { ...node, childMapId: map.id } : node) });
  }
  return saveMapChanges(snapshot, drafts, changes);
}
