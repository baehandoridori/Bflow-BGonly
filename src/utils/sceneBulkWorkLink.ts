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
