import { singleViewId } from './mapDocument.ts';
import type { MapSelection } from './mapDocument.ts';
import { isRoadSpace } from './mapSpatial.ts';
import type { BackgroundMap } from './types.ts';

/** How one map is shown on this PC: nodes that are not drawn, and rooms that 3D draws as closed boxes. Never part of the map. */
export type MapViewPrefs = { readonly hidden: ReadonlySet<string>; readonly solid: ReadonlySet<string> };
/** By map id, the map whose settings changed longest ago first. */
export type MapViewPrefsByMap = ReadonlyMap<string, MapViewPrefs>;
export type MapViewStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const MAP_VIEW_PREFS_KEY = 'bflow.background-map.view.v1';          // one entry per account: `${KEY}:${viewerId}`
export const MAP_VIEW_PREFS_LIMITS = { maps: 100, ids: 1000, idLength: 64 } as const;

const NO_IDS: ReadonlySet<string> = new Set();
export const NO_MAP_VIEW_PREFS: MapViewPrefs = { hidden: NO_IDS, solid: NO_IDS };
const NOTHING: MapViewPrefsByMap = new Map();
function idList(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return NO_IDS;
  const ids = new Set<string>();
  for (const item of value) {
    if (ids.size >= MAP_VIEW_PREFS_LIMITS.ids) break;
    if (typeof item === 'string' && item.length > 0 && item.length <= MAP_VIEW_PREFS_LIMITS.idLength) ids.add(item);
  }
  return ids.size ? ids : NO_IDS;
}
/** The newest maps only: the oldest entries go. */
function trim(prefs: Map<string, MapViewPrefs>): Map<string, MapViewPrefs> {
  for (const id of [...prefs.keys()].slice(0, Math.max(0, prefs.size - MAP_VIEW_PREFS_LIMITS.maps))) prefs.delete(id);
  return prefs;
}
/** What a stored text holds. Anything of another shape reads as nothing, entry by entry. Never throws. */
export function parseMapViewPrefs(text: string | null | undefined): MapViewPrefsByMap {
  if (!text) return NOTHING;
  let stored: unknown;
  try { stored = JSON.parse(text); } catch { return NOTHING; }
  const maps = (stored as { maps?: unknown } | null)?.maps;
  if (!Array.isArray(maps)) return NOTHING;
  const prefs = new Map<string, MapViewPrefs>();
  for (const entry of maps) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, hidden, solid } = entry as { id?: unknown; hidden?: unknown; solid?: unknown };
    if (typeof id !== 'string' || !id || id.length > MAP_VIEW_PREFS_LIMITS.idLength) continue;
    const value = { hidden: idList(hidden), solid: idList(solid) };
    prefs.delete(id);                                   // listed twice: the later one, in the later place
    if (value.hidden.size || value.solid.size) prefs.set(id, value);
  }
  return prefs.size ? trim(prefs) : NOTHING;
}
export function serializeMapViewPrefs(prefs: MapViewPrefsByMap): string {
  return JSON.stringify({ maps: [...prefs].map(([id, { hidden, solid }]) => ({ id, hidden: [...hidden], solid: [...solid] })) });
}
function deviceStorage(): MapViewStorage | null { try { return localStorage; } catch { return null; } }
export function readMapViewPrefs(viewerId: string, storage: MapViewStorage | null = deviceStorage()): MapViewPrefsByMap {
  if (!viewerId || !storage) return NOTHING;
  try { return parseMapViewPrefs(storage.getItem(mapViewPrefsKey(viewerId))); } catch { return NOTHING; }
}
export function storeMapViewPrefs(viewerId: string, prefs: MapViewPrefsByMap, storage: MapViewStorage | null = deviceStorage()): void {
  if (!viewerId || !storage) return;
  try { storage.setItem(mapViewPrefsKey(viewerId), serializeMapViewPrefs(prefs)); } catch { /* A view setting must not block the editor: it then lasts while the screen is open. */ }
}
export function mapViewPrefsOf(prefs: MapViewPrefsByMap, mapId: string | null | undefined): MapViewPrefs {
  return (mapId != null && prefs.get(mapId)) || NO_MAP_VIEW_PREFS;
}
export function mapViewPrefsKey(viewerId: string): string { return `${MAP_VIEW_PREFS_KEY}:${viewerId}`; }

/**
 * `ids` put into or taken out of one list of a map. The other list is not touched. The id of a node that is gone stays
 * listed, so a node that comes back (a redo) is shown as it was. Such ids go only to make room in a list that is full.
 */
function withIds(prefs: MapViewPrefsByMap, map: BackgroundMap, key: keyof MapViewPrefs, ids: readonly string[], on: boolean): MapViewPrefsByMap {
  const before = mapViewPrefsOf(prefs, map.id), list = before[key], next = new Set(list);
  const alive = new Set(map.nodes.filter(node => key === 'hidden' || node.type === 'space').map(node => node.id));
  for (const id of ids) {
    if (!on) next.delete(id);
    else if (alive.has(id) && !next.has(id)) {
      if (next.size >= MAP_VIEW_PREFS_LIMITS.ids) for (const listed of list) if (!alive.has(listed)) next.delete(listed);
      if (next.size < MAP_VIEW_PREFS_LIMITS.ids) next.add(id);
    }
  }
  // The same settings back when the list did not change: what reads them by identity is not woken.
  if (next.size === list.size && [...next].every(id => list.has(id))) return prefs;
  const changed: ReadonlySet<string> = next.size ? next : NO_IDS;
  const hidden = key === 'hidden' ? changed : before.hidden, solid = key === 'solid' ? changed : before.solid;
  const result = new Map(prefs);
  result.delete(map.id);                                  // written last: it is the newest
  if (hidden.size || solid.size) result.set(map.id, { hidden, solid });
  return trim(result);
}
export function shownMap(map: BackgroundMap, hidden: ReadonlySet<string> | undefined): BackgroundMap {
  return hidden?.size && map.nodes.some(node => hidden.has(node.id)) ? { ...map, nodes: map.nodes.filter(node => !hidden.has(node.id)) } : map;
}
export function withHiddenNodes(prefs: MapViewPrefsByMap, map: BackgroundMap, ids: readonly string[], hidden: boolean): MapViewPrefsByMap { return withIds(prefs, map, 'hidden', ids, hidden); }
export function withSolidSpaces(prefs: MapViewPrefsByMap, map: BackgroundMap, ids: readonly string[], solid: boolean): MapViewPrefsByMap { return withIds(prefs, map, 'solid', ids, solid); }
export function hiddenNodeCount(map: BackgroundMap | undefined, hidden: ReadonlySet<string>): number { return map && hidden.size ? map.nodes.filter(node => hidden.has(node.id)).length : 0; }
export function mapRoomIds(map: BackgroundMap): string[] { return map.nodes.filter(node => node.type === 'space' && !isRoadSpace(node)).map(node => node.id); }
/**
 * The selection once `gone` are hidden: what is hidden is never selected. `picked` is the stored pick of the views that
 * show one node (MapViewport.selectedId). It counts while it is not in hand too (one node or none selected): the group
 * can grow again, and it would be in hand. `ids`: the selection to write: the group without the hidden ones (the same
 * array when none was in it). One case apart, in the 3D view (`plan` false): the group shrinks to one node or none while
 * a node outside it is in hand. That node stays in hand, as the selection, and the last node of the group is let go.
 * `inHand`: the node in hand, kept while two or more stay selected (null: let go). `changed`: something has to be
 * written. `moved`: what the properties show changes (`plan`: a group is shown as one there), so the list under them moves.
 */
export function selectionWithout(map: BackgroundMap, selection: MapSelection, picked: string | null, gone: readonly string[], plan: boolean): { ids: readonly string[]; inHand: string | null; changed: boolean; moved: boolean } {
  const left = selection.ids.filter(id => !gone.includes(id)), kept = left.length === selection.ids.length;
  const before = singleViewId(map, selection, picked), inHand = before !== null && gone.includes(before) ? null : before;
  const ids = kept ? selection.ids : !plan && left.length <= 1 && inHand !== null && !left.includes(inHand) ? [inHand] : left;
  const shown = (count: number, node: string | null) => count > 1 ? (plan ? 'group' : `group:${node}`) : `one:${node}`;
  return { ids, inHand, changed: !kept || (picked !== null && gone.includes(picked)),
    moved: shown(selection.ids.length, before) !== shown(ids.length, ids.length > 1 ? inHand : ids[0] ?? null) };
}
