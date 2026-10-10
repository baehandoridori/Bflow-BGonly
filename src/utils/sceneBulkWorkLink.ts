import type { Episode, Part, Scene, SceneWorkLink, SceneWorkLinkDepartment } from '../types/index.ts';
import { findPartById } from './partId.ts';
import { namesOtherScenes, refKey, sceneFamily, sceneListForScene, sceneRefKey, workFileName } from './sceneFileNameList.ts';
import { normalizeSceneIdKey } from './sceneIdKey.ts';
import { compareScenesByNumberThenSuffix } from './sceneSort.ts';
import { getWorkLinkSlotKey } from './sceneWorkLinks.ts';

/** 창의 기본값. 값은 BULK_LINK_DEFAULTS 한 곳에서 바꾼다(15.1). */
export interface BulkLinkDefaults {
  /** P2: 파일 이름에 적힌 씬이 다른 파일을 들고 있으면 처음부터 체크해 둔다. */
  checkNamedReplace: boolean;
  /** P3: 파일 이름에 없고 레이아웃만 같은 씬도 창에 올린다. */
  offerLayoutOnly: boolean;
  /** P3: 그 씬들을 처음부터 체크해 둔다. */
  checkLayoutOnly: boolean;
}

export const BULK_LINK_DEFAULTS: Readonly<BulkLinkDefaults> = {
  checkNamedReplace: true,
  offerLayoutOnly: true,
  checkLayoutOnly: false,
};

export type BulkLinkGroup = 'named' | 'layout';
/** empty = 칸이 비었다 / replace = 다른 파일이 있다 / same = 이미 이 파일 / unavailable = uuid가 없어 연결할 수 없다 */
export type BulkLinkState = 'empty' | 'replace' | 'same' | 'unavailable';

export interface BulkLinkCandidate {
  /** 줄의 열쇠. uuid가 있으면 uuid, 없으면 `no:${scene.no}:${scene.sceneId}`. */
  key: string;
  sceneUuid: string | null;
  /** 저장된 그대로의 씬 번호(화면에 보이는 글자). */
  sceneId: string;
  group: BulkLinkGroup;
  state: BulkLinkState;
  /** 창을 열 때 그 칸에 있던 경로. 비었으면 null. */
  currentPath: string | null;
  /** 처음 체크 상태. */
  checked: boolean;
}

export interface SceneLocation { episode: Episode; part: Part; scene: Scene }

export interface BulkLinkScope extends SceneLocation {
  named: Scene[];
  layout: Scene[];
  /** 이름에 직접 적혔지만 이 파트에 없는 번호의 표시 글자('a011'). */
  notFound: string[];
  /** 연결한 씬의 유효 레이아웃. 없으면 ''. */
  layoutValue: string;
}

export interface BulkLinkOffer {
  path: string;
  fileName: string;
  department: SceneWorkLinkDepartment;
  /** 연결한 씬의 uuid. 누르는 순간 그 씬의 칸을 다시 볼 때 쓴다(7.2). */
  linkedSceneUuid: string;
  linkedSceneId: string;
  layout: string;
  /** 이름 묶음 먼저, 그다음 레이아웃 묶음. 묶음 안은 번호 순. */
  candidates: BulkLinkCandidate[];
  notFound: string[];
}

export interface BulkLinkWrite { sceneUuid: string; sceneId: string; before: string | null }
export interface BulkLinkPlan {
  writes: BulkLinkWrite[];
  /** 고른 씬 가운데 그 사이 이미 이 파일이 된 것(씬 번호). 조용히 건너뛴다. */
  same: string[];
  /** 고른 씬 가운데 창을 연 뒤 달라진 것(씬 번호) — 칸의 파일이 달라졌거나, 씬 번호·레이아웃이 바뀌어 더는 그 묶음이 아니다. 건너뛰고 알린다. */
  changed: string[];
}

export type BulkUndoStep =
  | { kind: 'delete'; sceneUuid: string; sceneId: string }
  | { kind: 'restore'; sceneUuid: string; sceneId: string; path: string };
export interface BulkUndoPlan {
  steps: BulkUndoStep[];
  /** 그 뒤에 칸이 달라져 손대지 않는 것(씬 번호). */
  kept: string[];
}

export const BULK_LINK_TEXT = {
  title: '이 파일을 다른 씬에도 연결할까요?',
  named: '파일 이름에 적힌 씬',
  only: '이 씬만',
  pick: '연결할 씬을 골라 주세요',
  empty: '비어 있음',
  same: '이미 이 파일',
  unavailable: '아직 저장 중인 씬이라 연결할 수 없어요',
  /** replace 줄이 체크돼 있을 때의 표시. */
  replaceMark: '→ 이 파일로 바뀜',
  /** replace 줄의 체크가 풀려 있을 때의 표시. */
  replaceMarkOff: '체크하면 이 파일로 바뀜',
  /** 되돌리는 순간의 다시 읽기를 마치지 못했을 때. 이 글과 함께 '되돌리기'를 다시 건다(7.4). */
  undoRecheckFailed: '연결 상태를 확인하지 못해서 아직 되돌리지 않았어요',
} as const;

/** 줄 하나의 글자 조각. 창은 이것을 따로따로 그린다(6.1) — "바뀜" 표시가 긴 파일 이름에 밀려 잘리지 않게. */
export interface BulkLinkRowParts {
  /** 상태 글자. replace면 '지금: 〈지금 파일 이름〉'. */
  text: string;
  /** replace일 때만: 잘리지 않고 늘 다 보이는 표시. 체크돼 있으면 replaceMark, 풀려 있으면 replaceMarkOff. */
  mark: string | null;
  /** replace일 때만: 지금 걸린 경로 전체(이름만으로 된 경로면 null). */
  path: string | null;
}

export function sameWorkPath(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalize = (value: string | null | undefined) => (value ?? '').trim().replace(/\//g, '\\').toLowerCase();
  const left = normalize(a);
  return left !== '' && left === normalize(b);
}

export function findSceneLocation(episodes: readonly Episode[], sceneUuid: string): SceneLocation | null {
  if (!sceneUuid) return null;
  for (const episode of episodes) {
    for (const part of episode.parts) {
      const scene = part.scenes.find((item) => item.id === sceneUuid);
      if (scene) return { episode, part, scene };
    }
  }
  return null;
}

export function effectiveLayout(scene: Scene, part: Part, twinPart: Part | undefined): string {
  const own = (scene.layoutId || '').trim();
  if (own || !twinPart) return own;
  const key = normalizeSceneIdKey(scene.sceneId, part.partId);
  if (!key) return '';
  const twin = twinPart.scenes.find((item) => normalizeSceneIdKey(item.sceneId, twinPart.partId) === key);
  return (twin?.layoutId || '').trim();
}

export function findBulkLinkScope(
  episodes: readonly Episode[],
  sceneUuid: string,
  department: SceneWorkLinkDepartment,
  path: string,
  defaults: BulkLinkDefaults = BULK_LINK_DEFAULTS,
): BulkLinkScope | null {
  const location = findSceneLocation(episodes, sceneUuid);
  if (!location || location.part.department !== department) return null;
  const { episode, part, scene } = location;
  const linked = { sceneId: scene.sceneId, partId: part.partId };
  // 이름이 다른 씬들을 가리키면(다른 파트의 목록) 레이아웃 묶음까지 묻지 않는다.
  if (namesOtherScenes(path, linked)) return null;
  const others = part.scenes.filter((item) => item !== scene).sort(compareScenesByNumberThenSuffix);

  const named: Scene[] = [];
  const notFound: string[] = [];
  const list = sceneListForScene(path, linked);
  const family = sceneFamily(scene.sceneId, part.partId);
  if (list && family !== null) {
    const self = sceneRefKey(scene.sceneId, family);
    const wanted = new Set(list.refs.map(refKey));
    const found = new Set<string>();
    for (const item of others) {
      const key = sceneRefKey(item.sceneId, family);
      if (key === null || key === self || !wanted.has(key)) continue;
      named.push(item);
      found.add(key);
    }
    const shown = /^[A-Za-z]*/.exec(scene.sceneId.trim())?.[0] || family;
    for (const ref of list.refs) {
      const key = refKey(ref);
      if (ref.ranged || key === self || found.has(key)) continue;
      // 숫자는 파일 이름에 적힌 자릿수대로 채운다('a011', 0 없이 쓰는 파트면 'a5').
      notFound.push(`${shown}${String(ref.number).padStart(list.width, '0')}${ref.suffix}`);
    }
  }

  const twinPart = findPartById(episode.parts, part.partId, department === 'bg' ? 'acting' : 'bg');
  const layoutValue = effectiveLayout(scene, part, twinPart);
  const layout = defaults.offerLayoutOnly && layoutValue
    ? others.filter((item) => !named.includes(item) && effectiveLayout(item, part, twinPart) === layoutValue)
    : [];

  if (named.length === 0 && layout.length === 0) return null;
  return { episode, part, scene, named, layout, notFound, layoutValue };
}

export function buildBulkLinkOffer(
  scope: BulkLinkScope,
  path: string,
  department: SceneWorkLinkDepartment,
  linkMap: ReadonlyMap<string, SceneWorkLink>,
  defaults: BulkLinkDefaults = BULK_LINK_DEFAULTS,
): BulkLinkOffer | null {
  const linkedSceneUuid = scope.scene.id;
  if (!linkedSceneUuid) return null;
  const candidate = (scene: Scene, group: BulkLinkGroup): BulkLinkCandidate => {
    const currentPath = scene.id
      ? linkMap.get(getWorkLinkSlotKey(scene.id, department, 'primary_file'))?.path || null
      : null;
    const state: BulkLinkState = !scene.id
      ? 'unavailable'
      : !currentPath ? 'empty' : sameWorkPath(currentPath, path) ? 'same' : 'replace';
    const checked = state === 'empty'
      ? group === 'named' || defaults.checkLayoutOnly
      : state === 'replace'
        ? (group === 'named' ? defaults.checkNamedReplace : defaults.checkLayoutOnly)
        : false;
    return {
      key: scene.id ?? `no:${scene.no}:${scene.sceneId}`,
      sceneUuid: scene.id ?? null,
      sceneId: scene.sceneId,
      group,
      state,
      currentPath,
      checked,
    };
  };
  const candidates = [
    ...scope.named.map((scene) => candidate(scene, 'named')),
    ...scope.layout.map((scene) => candidate(scene, 'layout')),
  ];
  if (!candidates.some((item) => item.state === 'empty' || item.state === 'replace')) return null;
  return {
    path,
    fileName: workFileName(path),
    department,
    linkedSceneUuid,
    linkedSceneId: scope.scene.sceneId,
    layout: scope.layoutValue,
    candidates,
    notFound: scope.notFound,
  };
}

export function planBulkLink(
  offer: BulkLinkOffer,
  selectedKeys: readonly string[],
  linkMap: ReadonlyMap<string, SceneWorkLink>,
  scope: BulkLinkScope | null,
): BulkLinkPlan {
  const plan: BulkLinkPlan = { writes: [], same: [], changed: [] };
  const selected = new Set(selectedKeys);
  for (const item of offer.candidates) {
    if (!selected.has(item.key) || !item.sceneUuid || (item.state !== 'empty' && item.state !== 'replace')) continue;
    // 창이 떠 있는 사이 그 씬의 번호나 레이아웃이 바뀌어 더는 같은 묶음의 같은 씬이 아니면 쓰지 않는다.
    const group = item.group === 'named' ? scope?.named : scope?.layout;
    const still = group?.some((scene) => scene.id === item.sceneUuid && scene.sceneId === item.sceneId) ?? false;
    const now = linkMap.get(getWorkLinkSlotKey(item.sceneUuid, offer.department, 'primary_file'))?.path || null;
    if (!still) plan.changed.push(item.sceneId);
    else if (sameWorkPath(now, offer.path)) plan.same.push(item.sceneId);
    else if ((now ?? '') !== (item.currentPath ?? '')) plan.changed.push(item.sceneId);
    else plan.writes.push({ sceneUuid: item.sceneUuid, sceneId: item.sceneId, before: now });
  }
  return plan;
}

export function planBulkUndo(
  writes: readonly BulkLinkWrite[],
  path: string,
  department: SceneWorkLinkDepartment,
  linkMap: ReadonlyMap<string, SceneWorkLink>,
  userId: string | null,
): BulkUndoPlan {
  const plan: BulkUndoPlan = { steps: [], kept: [] };
  for (const write of writes) {
    const link = linkMap.get(getWorkLinkSlotKey(write.sceneUuid, department, 'primary_file'));
    // 이 동작이 쓴 것으로 치는 조건 둘: 경로가 그대로이고, 마지막으로 고친 사람도 나다.
    const mine = sameWorkPath(link?.path, path) && (link?.updatedBy ?? null) === (userId ?? null);
    if (!mine) plan.kept.push(write.sceneId);
    else if (write.before === null) plan.steps.push({ kind: 'delete', sceneUuid: write.sceneUuid, sceneId: write.sceneId });
    else plan.steps.push({ kind: 'restore', sceneUuid: write.sceneUuid, sceneId: write.sceneId, path: write.before });
  }
  return plan;
}

const DEPARTMENT_LABEL: Record<SceneWorkLinkDepartment, string> = { bg: '배경', acting: '액팅' };

export function bulkLinkLead(offer: Pick<BulkLinkOffer, 'linkedSceneId' | 'department'>): string {
  const slot = `${DEPARTMENT_LABEL[offer.department]} 대표 파일`;
  return `방금 ${offer.linkedSceneId}의 ${slot}로 연결했어요. 아래에서 고른 씬에도 ${slot}로 연결해요.`;
}

export function bulkLinkLayoutHeading(layout: string): string {
  return `같은 레이아웃(#${layout})인 씬`;
}

export function bulkLinkRowParts(
  candidate: Pick<BulkLinkCandidate, 'state' | 'currentPath'>,
  checked: boolean,
): BulkLinkRowParts {
  if (candidate.state === 'empty') return { text: BULK_LINK_TEXT.empty, mark: null, path: null };
  if (candidate.state === 'same') return { text: BULK_LINK_TEXT.same, mark: null, path: null };
  if (candidate.state === 'unavailable') return { text: BULK_LINK_TEXT.unavailable, mark: null, path: null };
  const current = (candidate.currentPath ?? '').trim();
  const name = workFileName(current) || current;
  return {
    text: `지금: ${name}`,
    mark: checked ? BULK_LINK_TEXT.replaceMark : BULK_LINK_TEXT.replaceMarkOff,
    path: name === current ? null : current,
  };
}

export function bulkLinkNotFoundText(ids: readonly string[]): string {
  return `파일 이름에는 있지만 이 파트에 없는 씬: ${ids.join(', ')}`;
}

export function bulkLinkConfirmLabel(count: number): string {
  return count > 0 ? `선택한 ${count}개에 연결` : BULK_LINK_TEXT.pick;
}

export function bulkLinkReplaceNote(replaceCount: number): string {
  return replaceCount > 0 ? `이 중 ${replaceCount}개는 지금 연결된 파일이 바뀌어요` : '';
}

export function sceneIdList(ids: readonly string[], max = 3): string {
  return ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} 외 ${ids.length - max}개`;
}

export function bulkLinkResultText(result: {
  linked: readonly string[];
  failed: readonly string[];
  changed: readonly string[];
}): string {
  const parts: string[] = [];
  if (result.linked.length > 0) parts.push(`씬 ${result.linked.length}개에 연결했어요`);
  if (result.failed.length > 0) parts.push(`${result.failed.length}개는 연결하지 못했어요(${sceneIdList(result.failed)})`);
  if (result.changed.length > 0) parts.push(`${result.changed.length}개는 그 사이 바뀌어서 그대로 뒀어요(${sceneIdList(result.changed)})`);
  return parts.join(' · ') || '이미 모두 이 파일에 연결돼 있어요';
}

export function bulkLinkSourceChangedText(linkedSceneId: string): string {
  return `그 사이 ${linkedSceneId}의 파일이 바뀌어서 다른 씬에는 연결하지 않았어요`;
}

export function bulkLinkRecheckFailedText(linkedSceneId: string): string {
  return `연결 상태를 확인하지 못해서 다른 씬에는 연결하지 않았어요. ${linkedSceneId}의 상세 창에서 대표 파일의 연필(수정) 버튼으로 같은 파일을 다시 저장하면 다시 물어봐요`;
}

export function bulkUndoResultText(result: {
  undone: readonly string[];
  failed: readonly string[];
  kept: readonly string[];
}): string {
  const parts: string[] = [];
  if (result.undone.length > 0) parts.push(`씬 ${result.undone.length}개를 되돌렸어요`);
  if (result.failed.length > 0) parts.push(`${result.failed.length}개는 되돌리지 못했어요(${sceneIdList(result.failed)})`);
  if (result.kept.length > 0) parts.push(`${result.kept.length}개는 그 뒤에 바뀌어서 그대로 뒀어요(${sceneIdList(result.kept)})`);
  return parts.join(' · ') || '되돌릴 것이 없어요';
}
