import type { BackgroundCommand, BackgroundMap, BackgroundSnapshot } from './types.ts';
import { validateBackgroundEntity } from './domain.ts';
import { mapDraftChanged } from './mapDocument.ts';
import type { MapDraft } from './mapDocument.ts';
import type { MapSaveCommand } from './mapWorkflow.ts';
import { cleanIpcErrorMessage } from '../../utils/ipcErrorMessage.ts';
export type MapDeleteMode = 'keep-children' | 'with-children';
export type MapDeleteCommand = Extract<BackgroundCommand, { type: 'delete' }>;
export type MapDeletePlan = {
  /** The map to delete, as the library holds it. Null: the library has no such map (any more); every list below is empty, and nothing is refused. */
  target: BackgroundMap | null; parent: BackgroundMap | null;
  /** Names of the parent's spaces that open the target. */
  entrances: string[];
  /** The maps right under the target; how many of them have maps under them; every map under the target, children before their parent. */
  children: BackgroundMap[]; nested: number; descendants: BackgroundMap[];
  /** The one save that comes first (null: nothing has to be saved). */
  save: MapSaveCommand | null;
  /** How many spaces open a map of `removed`: the save takes every one of them off. Not the spaces of the target that open children it keeps. */
  links: number;
  /** Ids of the maps that are deleted, in the order of deletion: the target last. */
  removed: string[];
  /** The commands, in order: `save` when there is one, then one delete for each id of `removed`. */
  steps: Array<MapSaveCommand | MapDeleteCommand>;
  /** Names of the maps that stay and whose unsaved edits the save step saves along, in the order of the save step. Not those of `unsavable`. */
  savedAlong: string[];
  /** Unsaved edits that go with a deleted map: the target's own, and the names of the maps under it that have some, in the order of `removed`. */
  lostEdits: { own: boolean; below: string[] };
  /** Names of the maps of the save step whose unsaved edits stand on a revision the library has left, in the order of the save step. */
  outdated: string[];
  /** Names of the maps of the save step whose unsaved edits the library would refuse to save (an emptied name of an object), in the order of the save step. */
  unsavable: string[];
  /** Why the plan must not be carried out. Null: it may. The plan is built in full either way, `save` and `steps` included. */
  refusal: 'rights' | 'outdated' | 'unsavable' | 'too-many' | null;
};
export const MAP_DELETE_SAVE_LIMIT = 100;

/** The spaces of a map that open one of these maps. */
const opening = (map: BackgroundMap, ids: ReadonlySet<string>) => map.nodes.filter(node => node.type === 'space' && node.childMapId !== null && ids.has(node.childMapId));
/** Would the library take this map as it is? Asked of its own check of a map, before anything is sent. */
function savable(map: BackgroundMap): boolean {
  try { validateBackgroundEntity('map', map); return true; } catch { return false; }
}
/** Names as the dialog says them: `‘가’, ‘나’`, however many, inside one sentence. */
const quoted = (names: readonly string[]) => names.map(name => `‘${name}’`).join(', ');

/**
 * The delete of a map as the commands it takes, in the order they are sent: at most one save, then one delete for each map
 * that goes. Not atomic: a run that stops part-way leaves a whole library, and the next press plans anew from that one.
 */
export function planMapDelete(snapshot: BackgroundSnapshot, drafts: Readonly<Record<string, MapDraft>>, mapId: string, mode: MapDeleteMode): MapDeletePlan {
  const maps = snapshot.maps, target = maps.find(map => map.id === mapId) ?? null;
  if (!target) return { target: null, parent: null, entrances: [], children: [], nested: 0, descendants: [], save: null, links: 0, removed: [], steps: [], savedAlong: [], lostEdits: { own: false, below: [] }, outdated: [], unsavable: [], refusal: null };
  // The structure is the library's alone: who hangs under whom, and which space opens which map. That is all the two checks
  // every command has to pass look at, so no `parentId` and no `childMapId` of a draft decides who is written or deleted.
  const under = new Map<string, BackgroundMap[]>();
  for (const map of maps) {
    if (map.parentId === null) continue;
    const beside = under.get(map.parentId);
    if (beside) beside.push(map); else under.set(map.parentId, [map]);
  }
  const parent = maps.find(map => map.id === target.parentId) ?? null, children = under.get(target.id) ?? [];
  // Depth first, each map after the maps under it: deleted in this order, no map goes while one still hangs under it.
  const descendants: BackgroundMap[] = [], seen = new Set([target.id]);
  const collect = (id: string) => { for (const map of under.get(id) ?? []) if (!seen.has(map.id)) { seen.add(map.id); collect(map.id); descendants.push(map); } };
  collect(target.id);
  const keep = mode === 'keep-children', doomed = keep ? [target] : [...descendants, target], removed = doomed.map(map => map.id), gone = new Set(removed);
  // Children that are kept move to where the target hung (or to the top). No space may open them from there on, nor a map that goes.
  const moved = new Set(keep ? children.map(map => map.id) : []), loose = new Set([...removed, ...moved]);
  // The save: the parent, the target, then the rest in the order of the library. Each only when what the library holds of it
  // has to change: a link to take off, or (a kept child) another parent. A target that merely has maps under it is not written.
  const rest = keep ? moved : new Set(descendants.map(map => map.id));
  const written = [parent, target, ...maps.filter(map => rest.has(map.id))].filter((map): map is BackgroundMap => map !== null && (moved.has(map.id) || opening(map, loose).length > 0));
  const entries: MapSaveCommand['maps'] = [], savedAlong: string[] = [], outdated: string[] = [], unsavable: string[] = [];
  for (const map of written) {
    // A draft with nothing unsaved in it counts as none: its value is the library's, or merely old. Unsaved edits are written
    // along when they stand on the revision of the library. On one the library has left they cannot be: the plan is refused.
    const draft = mapDraftChanged(drafts[map.id]) ? drafts[map.id] : null, taken = draft !== null && draft.baseRevision === map.revision ? draft.value : null;
    if (draft && !taken) outdated.push(map.name);
    const value = taken ?? map;
    // The links are taken off the value that is written, in whatever space of it holds one: a draft may have deleted the space the library knows.
    const entity: BackgroundMap = { ...value, parentId: moved.has(map.id) ? target.parentId : value.parentId,
      nodes: value.nodes.map(node => node.type === 'space' && node.childMapId !== null && loose.has(node.childMapId) ? { ...node, childMapId: null } : node) };
    // What the library holds passed this check when it was saved. A draft may hold what no save takes (the name box puts an emptied name into it).
    if (taken && !savable(entity)) unsavable.push(map.name);
    else if (taken && !gone.has(map.id)) savedAlong.push(map.name);
    // Always the revision of the library, never that of a draft: a draft with nothing unsaved may stand on an older one, unnoticed.
    entries.push({ entity, expectedRevision: map.revision });
  }
  const save: MapSaveCommand | null = entries.length ? { type: 'save-maps', maps: entries } : null, saved = new Set(written.map(map => map.id));
  // The save gives every map it writes its next revision: a map it wrote is deleted on that one.
  const deletes = doomed.map((map): MapDeleteCommand => ({ type: 'delete', kind: 'map', id: map.id, expectedRevision: map.revision + (saved.has(map.id) ? 1 : 0) }));
  return {
    target, parent, entrances: parent ? opening(parent, new Set([target.id])).map(node => node.name) : [],
    children, nested: children.filter(map => under.has(map.id)).length, descendants,
    save, links: maps.reduce((count, map) => count + opening(map, gone).length, 0), removed, steps: save ? [save, ...deletes] : deletes, savedAlong,
    lostEdits: { own: mapDraftChanged(drafts[target.id]), below: doomed.filter(map => map !== target && mapDraftChanged(drafts[map.id])).map(map => map.name) },
    outdated, unsavable,
    refusal: !snapshot.canManage ? 'rights' : outdated.length ? 'outdated' : unsavable.length ? 'unsavable' : entries.length > MAP_DELETE_SAVE_LIMIT ? 'too-many' : null,
  };
}
export type MapDeleteText = { lead: string[]; keep: [string, string] | null; all: [string, string] | null; notes: string[]; refusal: string | null; confirm: string };
/** The words of the dialog for a plan. Null when the map is gone. */
export function mapDeleteText(plan: MapDeletePlan, mode: MapDeleteMode): MapDeleteText | null {
  const { target, parent, children } = plan, below = plan.descendants.length;
  if (!target) return null;
  const lead = [`‘${target.name}’ 도면을 지워요. 지운 도면은 되돌릴 수 없어요.`,
    // The picture under a map goes with the map: it must not read as one of the images that stay.
    target.imageUrl ? '도면에 놓은 공간·카메라·기호와 도면 밑그림이 함께 없어져요. 장소와 배경 이미지, 에피소드별 사용 기록은 그대로 남아요.' : '도면에 놓은 공간·카메라·기호가 함께 없어져요. 장소와 배경 이미지, 에피소드별 사용 기록은 그대로 남아요.'];
  if (parent && plan.entrances.length) lead.push(`‘${parent.name}’ 도면의 ${quoted(plan.entrances)} 공간에서 이 도면을 열던 연결은 함께 풀려요.`);
  if (children.length) lead.push(plan.nested
    ? `이 도면 아래에 하위 도면이 ${children.length}개 있어요. 그중 ${plan.nested}개는 그 아래에 도면이 더 있어서, 아래 도면은 모두 ${below}개예요.`
    : `이 도면 아래에 하위 도면이 ${children.length}개 있어요.`);
  // The link from the target to a child is spoken of only where there is one: a child made by ＋ 하위 도면 만들기 hangs there without.
  const opens = opening(target, new Set(children.map(map => map.id))).length > 0;
  const kept = `${parent ? `하위 도면 ${children.length}개가 ‘${parent.name}’ 바로 아래로 올라가요.` : `하위 도면 ${children.length}개가 최상위 도면이 돼요.`}${plan.nested ? ' 그 아래 도면들은 그대로 따라가요.' : ''}${opens ? ' 이 도면의 공간에서 하위 도면을 열던 연결은 없어져요.' : ''}`;
  const notes: string[] = [];
  if (plan.savedAlong.length) notes.push(`${quoted(plan.savedAlong)} 도면의 저장 안 한 변경은 이번에 함께 저장돼요.`);
  if (plan.lostEdits.own) notes.push('이 도면의 저장 안 한 변경은 함께 사라져요.');
  // 아래 도면, however deep: 하위 도면 is the word for the one level right under a map.
  if (plan.lostEdits.below.length) notes.push(`아래 도면 ${quoted(plan.lostEdits.below)}의 저장 안 한 변경도 함께 사라져요.`);
  const refusal = plan.refusal === 'rights' ? '이 계정으로는 도면을 지울 수 없어요.'
    : plan.refusal === 'outdated' ? `${quoted(plan.outdated)} 도면이 다른 곳에서 먼저 바뀌었어요. 그 도면의 편집을 끝낸 뒤 다시 삭제해 주세요.`
    : plan.refusal === 'unsavable' ? `${quoted(plan.unsavable)} 도면에 저장할 수 없는 변경이 있어요. 그 도면에서 고치거나 편집을 끝낸 뒤 다시 삭제해 주세요.`
    : plan.refusal === 'too-many' ? `함께 저장해야 하는 도면이 ${MAP_DELETE_SAVE_LIMIT}개를 넘어서 한 번에 처리할 수 없어요. 하위 도면을 먼저 나누어 정리해 주세요.` : null;
  return {
    lead, keep: children.length ? ['하위 도면은 남기기', kept] : null, all: children.length ? ['하위 도면도 함께 삭제', `이 도면과 아래 도면 ${below}개를 모두 지워요.`] : null, notes, refusal,
    confirm: !children.length ? '도면 삭제' : mode === 'keep-children' ? '이 도면 1개만 삭제' : `도면 ${below + 1}개 모두 삭제`,
  };
}
/** What a run that stopped has done, read from the library as it is now. */
export function mapDeleteStopText(pressed: MapDeletePlan, snapshot: BackgroundSnapshot): string {
  const now = new Map(snapshot.maps.map(map => [map.id, map])), gone = new Set(pressed.removed), done: string[] = [];
  if (pressed.links > 0 && !snapshot.maps.some(map => opening(map, gone).length > 0)) done.push('지울 도면을 열던 공간의 연결은 풀었어요.');
  // 남기기 deletes one map. A child of it counts once the library shows it under another map: one deleted elsewhere since is not there to count.
  const moved = pressed.removed.length === 1 ? pressed.children.filter(child => { const map = now.get(child.id); return !!map && map.parentId !== pressed.removed[0]; }).length : 0;
  if (moved) done.push(`하위 도면 ${moved}개는 위로 옮겼어요.`);
  const deleted = pressed.removed.filter(id => !now.has(id)).length;
  if (deleted) done.push(`도면 ${pressed.removed.length}개 가운데 ${deleted}개를 지웠어요.`);
  // Nothing seen is not nothing done: the reply and the read after it may both be lost. So this says what to do, and claims nothing.
  if (!done.length) return '아직 바뀐 것이 보이지 않아요. 다시 눌러도 돼요. 인터넷이 끊겼던 거라면 잠시 뒤 이 창이 알아서 바뀔 수 있어요.';
  return `${done.join(' ')} 남은 것은 아래에 다시 적었어요. 다시 누르면 남은 것만 이어서 처리해요.`;
}
/** Why a run stopped, as the dialog says it: never the wrapper Electron puts round what the main process throws, never an English sentence of the network. */
export function mapDeleteCauseText(cause: unknown): string {
  const said = cleanIpcErrorMessage(cause, '');
  // What the store, the main process or the server wrote is Korean. Anything else is a lost connection, or nothing at all.
  return /[가-힣]/.test(said) ? said : '서버에서 답을 받지 못했어요. 인터넷 연결을 확인해 주세요.';
}
