// src/utils/guideFolderSuggestBuild.ts — 가이드 그림 작업 폴더 제안 만들기(설계 4.2·4.3·4.5·4.6).
// 폴더 목록·링크 읽기는 주입받는다(테스트는 가짜, 앱은 IPC·스토어). 런타임 '@/' import 를 두지 않는다.
import { isSharedDrivePath } from '../shared/sharedDrivePath.ts';
import {
  findPartFolderName,
  joinPath,
  matchSceneFolders,
  pickBackgroundRoot,
  pickClipFile,
  pickPartFolder,
  resolveFolderFromImagePath,
  samePath,
  type GuideImageMethod,
  type GuideSceneRef,
} from './guideFolderSuggest.ts';

export interface GuideFolderCandidate {
  folder: string;
  /** 대표 파일로 제안할 .clip 의 전체 경로. 없으면 null. */
  clip: string | null;
}

export interface GuideFolderSuggestion {
  sceneUuid: string;
  /** 표시·경고용 씬 번호(예: d054). */
  sceneId: string;
  method: GuideImageMethod;
  fileName: string | null;
  /** 그림 경로 없이 같은 파트 다른 씬들을 보고 짐작했나. */
  guessed: boolean;
  /** 1개 이상, 이름에 든 씬 수가 적은 순. */
  candidates: GuideFolderCandidate[];
  /** 경로 길에서 폴더 이름에 이 씬 번호가 없다. */
  mismatch: boolean;
  /** 지금 저장된 작업 폴더. 있으면 '바꾸기' 모양. */
  currentFolder: string | null;
  /** 만들 때 대표 파일 칸이 비어 있었나 — 비었을 때만 '대표 파일로도 연결'을 보인다. */
  offerClip: boolean;
}

export interface GuideFolderRequest {
  sceneUuid: string;
  scene: GuideSceneRef;
  method: GuideImageMethod;
  /** 그림 파일 경로. 모르면 ''. */
  imagePath: string;
  fileName: string | null;
  /** 같은 파트의 다른 씬(자기 제외). */
  partSceneUuids: string[];
  /** 같은 화의 다른 배경 파트 씬. */
  otherBgPartSceneUuids: string[];
}

export interface GuideFolderDeps {
  /** 공유 드라이브 폴더의 한 단계 하위 이름들. 못 읽으면 null. */
  listDir(dir: string, kind: 'dirs' | 'files'): Promise<string[] | null>;
  /** 그 씬들의 작업 링크를 읽는다. 제때 읽었으면 true. */
  loadLinks(sceneUuids: string[]): Promise<boolean>;
  /** 지금 알고 있는 배경 작업 폴더·대표 파일. */
  bgSlots(sceneUuid: string): { folder: string | null; primaryFile: string | null };
}

/** 같은 파트 저장 경로로 파트 폴더를, 없으면 다른 배경 파트로 배경 폴더를 찾아 그 안의 '{파트}파트'를 고른다(설계 4.3-1). */
async function findPartFolder(req: GuideFolderRequest, deps: GuideFolderDeps): Promise<string | null> {
  const folderOf = (uuid: string) => deps.bgSlots(uuid).folder;
  const sameFolders = req.partSceneUuids.map(folderOf).filter((path): path is string => !!path);
  const fromSame = pickPartFolder(sameFolders, req.scene.partId);
  if (fromSame) return fromSame;
  const otherFolders = req.otherBgPartSceneUuids.map(folderOf).filter((path): path is string => !!path);
  const root = pickBackgroundRoot(otherFolders);
  if (!root) return null;
  const names = await deps.listDir(root, 'dirs');
  const partName = names ? findPartFolderName(names, req.scene.partId) : null;
  return partName ? joinPath(root, partName) : null;
}

export async function buildGuideFolderSuggestion(
  req: GuideFolderRequest,
  deps: GuideFolderDeps,
): Promise<GuideFolderSuggestion | null> {
  // 이 씬 칸을 최신으로 — 결과는 따지지 않는다. 창이 저장하는 순간 다시 확인한다(설계 4.5).
  await deps.loadLinks([req.sceneUuid]);

  let folders: string[];
  let mismatch = false;
  const guessed = req.imagePath.trim() === '';
  if (!guessed) {
    if (!isSharedDrivePath(req.imagePath)) return null;
    const resolved = resolveFolderFromImagePath(req.imagePath, req.scene);
    if (!resolved) return null;
    folders = [resolved.folder];
    mismatch = resolved.mismatch;
  } else {
    const refs = [...req.partSceneUuids, ...req.otherBgPartSceneUuids];
    if (refs.length === 0) return null;
    if (!(await deps.loadLinks(refs))) return null;
    const partFolder = await findPartFolder(req, deps);
    if (!partFolder) return null;
    const names = await deps.listDir(partFolder, 'dirs');
    if (!names) return null;
    folders = matchSceneFolders(names, req.scene).map((name) => joinPath(partFolder, name));
    if (folders.length === 0) return null;
  }

  const current = deps.bgSlots(req.sceneUuid);
  if (current.folder && folders.some((folder) => samePath(folder, current.folder))) return null;

  const offerClip = !current.primaryFile;
  const candidates: GuideFolderCandidate[] = [];
  for (const folder of folders) {
    let clip: string | null = null;
    if (offerClip) {
      const files = await deps.listDir(folder, 'files');
      const name = files ? pickClipFile(files, req.scene) : null;
      clip = name ? joinPath(folder, name) : null;
    }
    candidates.push({ folder, clip });
  }

  return {
    sceneUuid: req.sceneUuid,
    sceneId: req.scene.sceneId,
    method: req.method,
    fileName: req.fileName,
    guessed,
    candidates,
    mismatch,
    currentFolder: current.folder || null,
    offerClip,
  };
}

export function suggestionMode(suggestion: Pick<GuideFolderSuggestion, 'currentFolder'>): 'new' | 'change' {
  return suggestion.currentFolder ? 'change' : 'new';
}

/** 실시간으로 바뀐 지금 작업 폴더를 반영한다. 후보 중 하나와 같아지면 null — 창을 조용히 닫는다(설계 4.5). */
export function reconcileCurrentFolder(
  suggestion: GuideFolderSuggestion,
  current: string | null,
): GuideFolderSuggestion | null {
  if (current && suggestion.candidates.some((candidate) => samePath(candidate.folder, current))) return null;
  const next = current || null;
  if (samePath(next, suggestion.currentFolder) || (next === null && suggestion.currentFolder === null)) return suggestion;
  return { ...suggestion, currentFolder: next };
}
