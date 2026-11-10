// src/utils/guideFolderSuggest.ts — 가이드 그림 작업 폴더 제안의 순수 규칙과 문구.
// 설계: docs/superpowers/specs/2026-11-10-guide-image-work-folder-suggest-design.md (4.2·4.3·4.4·4.6·5.2)
// 테스트가 직접 import 한다 — 런타임 '@/' import 를 두지 않는다.
import { SHARED_DRIVE_ROOT, isSharedDrivePath, normalizeWinPath } from '../shared/sharedDrivePath.ts';
import { readSceneNameLists, refKey, sceneFamily, sceneListForScene, sceneRefKey } from './sceneFileNameList.ts';

export type GuideImageMethod = 'drop' | 'pick' | 'paste';

export interface GuideSceneRef { sceneId: string; partId: string }

/** 같은 경로인가 — 대소문자·'/'와 '\'·끝 '\' 차이는 무시한다. 빈 값끼리는 다르다. */
export function samePath(a?: string | null, b?: string | null): boolean {
  const left = normalizeWinPath(a ?? '').toLowerCase();
  return left !== '' && left === normalizeWinPath(b ?? '').toLowerCase();
}

/** 바로 위 폴더. 더 올라갈 데가 없으면 null. */
export function parentPath(path: string): string | null {
  const normalized = normalizeWinPath(path);
  const cut = normalized.lastIndexOf('\\');
  if (cut <= 0) return null;
  const parent = normalized.slice(0, cut);
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent;
}

/** 경로의 마지막 이름. */
export function leafName(path: string): string {
  const normalized = normalizeWinPath(path);
  return normalized.slice(normalized.lastIndexOf('\\') + 1);
}

/** 폴더 경로 뒤에 이름 하나를 붙인다. */
export function joinPath(dir: string, name: string): string {
  const base = normalizeWinPath(dir);
  return base.endsWith('\\') ? `${base}${name}` : `${base}\\${name}`;
}

function selfKey(scene: GuideSceneRef): string | null {
  const family = sceneFamily(scene.sceneId, scene.partId);
  return family === null ? null : sceneRefKey(scene.sceneId, family);
}

/**
 * 폴더 이름에서 이 씬 가족 글자(예: d)로 시작하는 씬 번호 목록을 읽어 열쇠('54', '24A')로 돌려준다. 없으면 null.
 * 폴더 이름엔 확장자가 없으니 '.'도 나눔표다(d050.052). 글자 없는 숫자(241_…)·다른 글자(png_052)는 씬 번호로 보지 않는다.
 */
export function folderSceneKeys(folderName: string, scene: GuideSceneRef): string[] | null {
  const family = sceneFamily(scene.sceneId, scene.partId);
  if (!family) return null;
  const lists = readSceneNameLists(folderName.replace(/\./g, ','))
    .filter((list) => list.prefix !== '' && (list.prefix === family || list.prefix === family.slice(0, 1)));
  if (lists.length === 0) return null;
  return [...new Set(lists.flatMap((list) => list.refs.map(refKey)))];
}

/**
 * 그림 경로에서 제안할 작업 폴더. 바로 위 폴더부터 최대 두 단계 더 올라가며 씬 번호가 든 첫 폴더를 고른다(설계 4.2-3).
 * 공유 드라이브 밖이거나 세 폴더 안에 없으면 null. mismatch = 그 폴더 이름에 이 씬 번호가 없다(설계 4.2-4).
 */
export function resolveFolderFromImagePath(
  imagePath: string,
  scene: GuideSceneRef,
): { folder: string; mismatch: boolean } | null {
  const self = selfKey(scene);
  let folder = parentPath(imagePath);
  for (let climb = 0; climb <= 2 && folder && isSharedDrivePath(folder); climb += 1) {
    const keys = folderSceneKeys(leafName(folder), scene);
    if (keys) return { folder, mismatch: self === null || !keys.includes(self) };
    folder = parentPath(folder);
  }
  return null;
}

/** 경로들을 같은 경로끼리 묶어 가장 많이 나온 것(같으면 정규화한 글자가 작은 것)의 처음 글자 그대로를 고른다. */
function mostCommon(paths: string[]): string | null {
  const groups = new Map<string, { first: string; count: number }>();
  for (const path of paths) {
    const key = normalizeWinPath(path).toLowerCase();
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { first: normalizeWinPath(path), count: 1 });
  }
  let best: { key: string; first: string; count: number } | null = null;
  for (const [key, group] of groups) {
    if (!best || group.count > best.count || (group.count === best.count && key < best.key)) best = { key, ...group };
  }
  return best?.first ?? null;
}

const isPartFolderName = (name: string, partId: string) => name.toLowerCase() === `${partId.trim().toLowerCase()}파트`;

/** 같은 파트 씬들의 작업 폴더에서 파트 폴더(…\d파트)를 고른다. 위 폴더 이름이 '{파트}파트'인 것만 믿는다(설계 4.3-1). */
export function pickPartFolder(folders: string[], partId: string): string | null {
  const parents = folders
    .map((folder) => parentPath(folder))
    .filter((parent): parent is string => parent !== null && isPartFolderName(leafName(parent), partId));
  return mostCommon(parents);
}

/** 다른 배경 파트 씬들의 작업 폴더에서 배경 폴더(…\배경_싱크홀) — '?파트' 폴더의 위 — 를 고른다. */
export function pickBackgroundRoot(folders: string[]): string | null {
  const roots: string[] = [];
  for (const folder of folders) {
    const parent = parentPath(folder);
    if (!parent || !/^[a-z]파트$/i.test(leafName(parent))) continue;
    const root = parentPath(parent);
    if (root) roots.push(root);
  }
  return mostCommon(roots);
}

/** 하위 폴더 이름들에서 '{파트}파트'(대소문자 무시)를 찾는다. */
export function findPartFolderName(names: string[], partId: string): string | null {
  return names.find((name) => isPartFolderName(name, partId)) ?? null;
}

/** 이 씬 번호가 든 폴더 이름들. 이름에 든 씬 수가 적은 것 먼저, 같으면 이름순(설계 4.3-2). */
export function matchSceneFolders(names: string[], scene: GuideSceneRef): string[] {
  const self = selfKey(scene);
  if (self === null) return [];
  return names
    .map((name) => ({ name, keys: folderSceneKeys(name, scene) }))
    .filter((row): row is { name: string; keys: string[] } => row.keys !== null && row.keys.includes(self))
    .sort((a, b) => a.keys.length - b.keys.length || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0))
    .map((row) => row.name);
}

/**
 * 대표 파일로 제안할 .clip. 하나뿐이면 그것, 여럿이면 이름에 이 씬 번호가 든 것이 딱 하나일 때 그것(설계 4.6).
 * 파일 이름은 기존 규칙 그대로 읽는다 — 이어서 뜨는 '한꺼번에 연결'과 같은 목록이 되게.
 */
export function pickClipFile(names: string[], scene: GuideSceneRef): string | null {
  const clips = names.filter((name) => /\.clip$/i.test(name));
  if (clips.length === 1) return clips[0];
  const self = selfKey(scene);
  if (self === null) return null;
  const matches = clips.filter((name) => sceneListForScene(name, scene)?.refs.some((ref) => refKey(ref) === self) ?? false);
  return matches.length === 1 ? matches[0] : null;
}

/** 표시용 경로 조각 — 공유 드라이브 루트를 빼고 마지막 폴더를 따로. */
export function displayPathParts(path: string): { head: string[]; leaf: string } {
  const normalized = normalizeWinPath(path);
  const rest = normalized.toLowerCase().startsWith(SHARED_DRIVE_ROOT.toLowerCase())
    ? normalized.slice(SHARED_DRIVE_ROOT.length)
    : normalized;
  const parts = rest.split('\\').filter(Boolean);
  return { head: parts.slice(0, -1), leaf: parts[parts.length - 1] ?? '' };
}

/** 제안 창 문구 — 설계 5.2 표 그대로. */
export const GUIDE_FOLDER_TEXT = {
  titleNew: '이 그림이 있는 폴더를 작업 폴더로 넣을까요?',
  titleChange: '작업 폴더를 이 폴더로 바꿀까요?',
  titleFound: '이 씬의 작업 폴더를 찾았어요',
  sourcePrefix: { drop: '끌어다 놓은 그림', pick: '고른 그림', paste: '붙여넣은 그림' } as Record<GuideImageMethod, string>,
  guessedPaste: '붙여넣은 그림이라 경로가 없어서, 같은 파트 다른 씬들을 보고 찾았어요.',
  guessedDrop: '끌어다 놓은 그림에 경로가 없어서, 같은 파트 다른 씬들을 보고 찾았어요.',
  candidatesNote: '이름에 이 씬만 든 폴더를 먼저 골라 뒀어요',
  clipLabel: '대표 파일로도 연결',
  current: '지금',
  next: '새 폴더',
  addNew: '작업 폴더에 넣기',
  addChange: '바꾸기',
  skipNew: '건너뛰기',
  skipChange: '그대로 두기',
  openFolder: '폴더 열어 보기',
  saving: '저장 중',
  retry: '다시 시도',
  saveFailed: '저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.',
  savedNew: '작업 폴더를 넣었어요',
  savedChange: '작업 폴더를 바꿨어요',
  openFailed: '이 PC에서 폴더를 찾을 수 없음',
} as const;

/** 제목 — 바꾸기가 먼저, 아니고 짐작이면 '찾았어요', 그 밖은 새로 넣기. */
export function guideFolderTitle(mode: 'new' | 'change', guessed: boolean): string {
  if (mode === 'change') return GUIDE_FOLDER_TEXT.titleChange;
  return guessed ? GUIDE_FOLDER_TEXT.titleFound : GUIDE_FOLDER_TEXT.titleNew;
}

/** 머리 아래 회색 한 줄 — 어떤 그림에서 왔는지. */
export function guideFolderSourceLine(input: { method: GuideImageMethod; fileName: string | null; guessed: boolean }): string {
  if (input.guessed) return input.method === 'drop' ? GUIDE_FOLDER_TEXT.guessedDrop : GUIDE_FOLDER_TEXT.guessedPaste;
  const prefix = GUIDE_FOLDER_TEXT.sourcePrefix[input.method];
  return input.fileName ? `${prefix} · ${input.fileName}` : prefix;
}

export function guideFolderMismatchText(sceneId: string): string {
  return `폴더 이름에 이 씬 번호(${sceneId})가 없어요. 같은 배경을 같이 쓰는 씬이면 그대로 넣어도 돼요.`;
}
