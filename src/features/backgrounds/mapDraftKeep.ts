import type { BackgroundMap, BackgroundSnapshot } from './types.ts';
import type { KeptMapEdit } from '../../shared/backgroundKeptEdits.ts';
import { validateBackgroundEntity } from './domain.ts';
import { mapDraftChanged, mapDraftSteps } from './mapDocument.ts';
import type { MapDraft, MapRestoredDraft } from './mapDocument.ts';
import { mapSaveWasApplied } from './mapWorkflow.ts';

// The unsaved map edits this PC keeps, as rules and words: what is written of a draft, what comes back after a restart, how a
// draft stands against the library, and the new map that takes the edits of this PC beside a map saved or deleted elsewhere.
// Pure: nothing here writes, sends or reads anything but what it is handed.

/** A settled edit of a map is written within this time, and once in each such time while the edits go on. */
export const MAP_KEEP_DELAY_MS = 300;

/** What is written of a draft: the map as given (the settled one), the revision it was opened on and its count. A data: underlay is left out. */
export function keptEntryOf(draft: MapDraft, value: BackgroundMap, keptAt: number): KeptMapEdit {
  const inline = value.imageUrl.startsWith('data:');
  return { baseRevision: draft.baseRevision, steps: mapDraftSteps(draft), keptAt, value: inline ? { ...value, imageUrl: '' } : value, ...(inline ? { imageOmitted: true as const } : {}) };
}

/** What a restore does with each entry this PC kept, by the first row that fits it, in the order listed. */
export type MapKeptRestorePlan = {
  restore: MapRestoredDraft[];                                    // for restore-drafts
  equal: string[];                                                // removed without a word
  skipped: { mapId: string; reason: 'drafted' | 'invalid' }[];    // left in the file, not shown
  newest: string | null;                                          // the restored map kept last
};
export function planKeptRestore(listed: Readonly<Record<string, KeptMapEdit>>, snapshot: BackgroundSnapshot, drafts: Readonly<Record<string, MapDraft>>): MapKeptRestorePlan {
  const plan: MapKeptRestorePlan = { restore: [], equal: [], skipped: [], newest: null };
  let newestAt = -Infinity;
  for (const [mapId, entry] of Object.entries(listed)) {
    // Unsaved edits of this run on that map win: the session writes them over the entry soon.
    if (mapDraftChanged(Object.prototype.hasOwnProperty.call(drafts, mapId) ? drafts[mapId] : undefined)) { plan.skipped.push({ mapId, reason: 'drafted' }); continue; }
    const saved = snapshot.maps.find(map => map.id === mapId);
    let value: BackgroundMap;
    // A map a draft can hold, and that very map. A left-out underlay is the library's again first (none without the map). A
    // draft holds any name (the name field takes any length, or none): what is checked is a copy with each name that is a
    // string read as a name. Made and checked in one go, so that a broken value (no list of nodes, a node that is no object)
    // is left out and never thrown.
    try {
      value = (entry.imageOmitted ? { ...(entry.value as BackgroundMap), imageUrl: saved?.imageUrl ?? '' } : entry.value) as BackgroundMap;
      validateBackgroundEntity('map', { ...value, name: typeof value.name === 'string' ? '이름' : value.name,
        nodes: Array.isArray(value.nodes) ? value.nodes.map(node => node !== null && typeof node === 'object' && typeof node.name === 'string' ? { ...node, name: '이름' } : node) : value.nodes });
    } catch {
      plan.skipped.push({ mapId, reason: 'invalid' });
      continue;
    }
    if (value.id !== mapId) { plan.skipped.push({ mapId, reason: 'invalid' }); continue; }
    // The library holds what was kept, on whichever revision: a save whose removal of the entry never came.
    if (saved && mapSaveWasApplied(snapshot, { type: 'save-maps', maps: [{ entity: value, expectedRevision: saved.revision - 1 }] })) { plan.equal.push(mapId); continue; }
    // Anything else comes back: on the revision the library has, on another one, or with the map gone from it.
    plan.restore.push({ value, baseRevision: entry.baseRevision, steps: entry.steps });
    if (entry.keptAt > newestAt) { newestAt = entry.keptAt; plan.newest = mapId; }
  }
  return plan;
}

export type MapDraftStanding = 'current' | 'moved' | 'gone';
/**
 * The library holds what the draft holds, on another revision: a save of this PC whose answer the screen never saw (it was
 * left while the save ran), or the same edits saved elsewhere. Nothing is lost by putting the draft back on that map.
 */
export function mapDraftSavedAlready(draft: MapDraft, snapshot: BackgroundSnapshot): boolean {
  const saved = snapshot.maps.find(map => map.id === draft.value.id);
  return !!saved && mapDraftChanged(draft) && saved.revision !== draft.baseRevision
    && mapSaveWasApplied(snapshot, { type: 'save-maps', maps: [{ entity: draft.value, expectedRevision: saved.revision - 1 }] });
}
/** Against the library itself (never the list the drafts shadow). A clean draft follows the library and is always current. */
export function mapDraftStanding(draft: MapDraft | undefined, snapshot: BackgroundSnapshot): MapDraftStanding {
  if (!draft || !mapDraftChanged(draft) || draft.baseRevision === null) return 'current';
  const saved = snapshot.maps.find(map => map.id === draft.value.id);
  if (!saved) return 'gone';
  return saved.revision === draft.baseRevision || mapDraftSavedAlready(draft, snapshot) ? 'current' : 'moved';
}

const COPY_SUFFIX = ' (내 편집)';
/** The name of the copy: the name, cut by whole characters so that with the suffix it fits the 160 the library counts (UTF-16 units). */
export function rescueMapName(name: string): string {
  let kept = '';
  for (const char of name.trim()) { if (kept.length + char.length > 160 - COPY_SUFFIX.length) break; kept += char; }
  return `${kept.trimEnd()}${COPY_SUFFIX}`;
}
/** A new map of the edits of this PC, to save beside a map that was saved or deleted elsewhere. What it cannot carry is left out. */
export function rescueMapCopy(snapshot: BackgroundSnapshot, value: BackgroundMap, id: string): BackgroundMap {
  const places = new Set(snapshot.places.map(place => place.id)), views = new Set(snapshot.views.map(view => view.id));
  const place = (placeId: string | null) => placeId !== null && places.has(placeId) ? placeId : null;
  return {
    id, revision: 0, name: rescueMapName(value.name), imageUrl: value.imageUrl,
    parentId: value.parentId !== null && snapshot.maps.some(map => map.id === value.parentId) ? value.parentId : null,
    placeId: place(value.placeId),
    nodes: value.nodes.map(node => node.type === 'space' ? { ...node, childMapId: null, placeId: place(node.placeId) }
      : node.type === 'camera' ? { ...node, viewIds: node.viewIds.filter(viewId => views.has(viewId)) } : node),
  };
}

/** The words of the screen about the edits kept on this PC: the notice after a restart, the update notice, the dot of a collapsed row, the editor that could not be drawn. */
export const MAP_KEEP_TEXT = {
  restored: (n: number) => `지난번에 저장하지 않은 편집이 있던 도면 ${n}개를 다시 열었어요. 필요 없으면 '편집 끝내기'에서 버릴 수 있어요.`,
  update: (n: number) => `이 PC에 저장 안 한 편집이 있는 도면 ${n}개가 그대로 보관돼 있어요. 업데이트한 뒤 배경 화면을 열면 이어서 고칠 수 있어요.`,
  below: '접어 둔 하위 도면에 저장 안 한 변경이 있어요',
  broken: '도면 화면을 그리지 못했어요. 저장하지 않은 도면 편집 때문일 수 있어요.',
  brokenDiscard: '저장하지 않은 편집을 버리고 다시 열기',
  /** The account may no longer edit (taken off the editor list, v1.142.0): its drafts cannot be saved, and the band that ends them is gone. */
  noRight: (n: number) => `배경을 고칠 권한이 없어져서, 이 PC에서 저장하지 않은 도면 편집 ${n}개를 저장할 수 없어요. 권한을 다시 받으면 이어서 고칠 수 있어요.`,
  noRightDiscard: '고치던 내용 버리기',
} as const;
/** The words of the choice about a map saved or deleted elsewhere first. */
export const MAP_STALE_TEXT = {
  moved: { title: '다른 곳에서 이 도면이 먼저 저장됐어요', lead: '이 PC에서 고친 내용과 다른 곳에서 저장한 내용은 하나로 합칠 수 없어요.', drop: '내 편집 버리고 최신 내용 받기' },
  gone: { title: '다른 곳에서 이 도면이 지워졌어요', lead: '지워진 도면에는 이 PC에서 고친 내용을 저장할 수 없어요.', drop: '내 편집 버리기' },
  kept: '고르기 전까지 이 PC의 편집은 그대로 보관돼요.',
  unkept: '이 PC에 보관하지 못한 편집이에요. 고르기 전에 앱을 끄면 사라질 수 있어요.',
  copy: (name: string) => `새 도면은 ‘${name}’이라는 이름으로 생기고, 하위 도면으로 들어가는 연결과 다른 도면에서 들어오는 입구는 따라오지 않아요.`,
  save: '내 편집을 새 도면으로 저장',
} as const;
