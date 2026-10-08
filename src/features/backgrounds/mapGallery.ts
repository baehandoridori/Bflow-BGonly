import { filterBackgroundViews } from './domain.ts';
import type { BackgroundMap, BackgroundNode, BackgroundSnapshot, BackgroundSpace, BackgroundView } from './types.ts';

/** Resolve the map's image scope without treating an unlinked place as all backgrounds. */
export function selectMapBackgroundViews(
  snapshot: BackgroundSnapshot,
  maps: BackgroundMap[],
  current: BackgroundMap,
  selected?: BackgroundNode,
): BackgroundView[] {
  // The caller may have an unsaved current map that is newer than the maps list.
  const byId = new Map(maps.map(map => [map.id, map]));
  byId.set(current.id, current);
  const children = new Map<string, BackgroundMap[]>();
  for (const map of byId.values()) {
    if (!map.parentId) continue;
    const siblings = children.get(map.parentId) ?? [];
    siblings.push(map);
    children.set(map.parentId, siblings);
  }

  const viewIds = new Set<string>();
  const visitedMaps = new Set<string>();
  const visitedPlaces = new Set<string>();
  function collectPlace(placeId: string | null): void {
    if (!placeId || visitedPlaces.has(placeId)) return;
    visitedPlaces.add(placeId);
    for (const view of filterBackgroundViews(snapshot, { placeId, relation: 'related' })) viewIds.add(view.id);
  }
  function collectMapTree(mapId: string): void {
    const pending = [mapId];
    while (pending.length) {
      const nextId = pending.pop()!;
      if (visitedMaps.has(nextId)) continue;
      visitedMaps.add(nextId);
      const map = byId.get(nextId);
      if (!map) continue;
      collectPlace(map.placeId);
      for (const node of map.nodes) {
        if (node.type === 'space') collectPlace(node.placeId);
        else if (node.type === 'camera') node.viewIds.forEach(id => viewIds.add(id));
      }
      for (const child of children.get(map.id) ?? []) pending.push(child.id);
    }
  }
  function collectSpace(space: BackgroundSpace): void {
    collectPlace(space.placeId);
    for (const node of current.nodes) {
      if (node.type === 'camera' && node.spaceId === space.id) node.viewIds.forEach(id => viewIds.add(id));
    }
    if (space.childMapId) collectMapTree(space.childMapId);
  }

  if (selected?.type === 'camera') {
    selected.viewIds.forEach(id => viewIds.add(id));
  } else if (selected?.type === 'space') {
    collectSpace(selected);
  } else if (selected?.type === 'symbol') {
    const space = current.nodes.find((node): node is BackgroundSpace => node.type === 'space' && node.id === selected.spaceId);
    if (space) collectSpace(space);
    else collectMapTree(current.id);
  } else {
    collectMapTree(current.id);
  }
  return snapshot.views.filter(view => viewIds.has(view.id));
}
