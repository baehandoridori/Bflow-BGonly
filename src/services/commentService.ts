/**
 * 씬별 댓글/의견 서비스
 *
 * Phase 0-3: Google Sheets _COMMENTS 탭 동기화
 * - 시트 연결 시: _COMMENTS 탭에서 파트별 지연 로딩
 * - 미연결 시: %APPDATA%/Bflow-BGonly/comments.json 로컬 폴백
 *
 * sceneKey 형식: "sheetName:sceneNo" (예: "EP01_A_BG:3")
 */

const COMMENTS_FILE = 'comments.json';

export interface SceneComment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];   // 태그된 사용자 이름 목록
  createdAt: string;    // ISO 8601
  editedAt?: string;
}

type CommentsStore = Record<string, SceneComment[]>;

// ─── 모드 관리 ──────────────────────────────────

let sheetsMode = false;

export function setCommentsSheetsMode(enabled: boolean): void {
  sheetsMode = enabled;
  if (!enabled) sheetPartCache.clear();
}

// ─── 로컬 파일 ──────────────────────────────────

let localCache: CommentsStore | null = null;

async function loadLocalAll(): Promise<CommentsStore> {
  if (localCache) return localCache;
  try {
    const data = await window.electronAPI.readSettings(COMMENTS_FILE);
    if (data && typeof data === 'object') {
      localCache = data as CommentsStore;
      return localCache;
    }
  } catch { /* 파일 없음 */ }
  localCache = {};
  return localCache;
}

async function saveLocal(all: CommentsStore): Promise<void> {
  localCache = all;
  await window.electronAPI.writeSettings(COMMENTS_FILE, all);
}

// ─── 시트 캐시 (파트별 지연 로딩) ───────────────

// sheetName → { sceneKey → SceneComment[] }
const sheetPartCache = new Map<string, CommentsStore>();

function parseSceneKey(sceneKey: string): { sheetName: string; sceneId: string } {
  const idx = sceneKey.lastIndexOf(':');
  return { sheetName: sceneKey.substring(0, idx), sceneId: sceneKey.substring(idx + 1) };
}

/**
 * 특정 파트의 댓글을 시트에서 로드 (캐시).
 */
export async function loadPartComments(sheetName: string): Promise<CommentsStore> {
  if (sheetPartCache.has(sheetName)) return sheetPartCache.get(sheetName)!;

  const result = await window.electronAPI.sheetsReadComments(sheetName);
  if (!result.ok) {
    console.warn('[댓글] 시트 로드 실패:', result.error);
    return {};
  }

  const store: CommentsStore = {};
  for (const c of result.data ?? []) {
    const key = `${c.sheetName}:${c.sceneId}`;
    if (!store[key]) store[key] = [];
    store[key].push({
      id: c.commentId,
      userId: c.userId,
      userName: c.userName,
      text: c.text,
      mentions: c.mentions ?? [],
      createdAt: c.createdAt,
      editedAt: c.editedAt || undefined,
    });
  }

  sheetPartCache.set(sheetName, store);
  return store;
}

/** 파트 캐시 무효화 */
export function invalidatePartCache(sheetName?: string): void {
  if (sheetName) sheetPartCache.delete(sheetName);
  else sheetPartCache.clear();
}

// ─── 통합 API ───────────────────────────────────

export async function getComments(sceneKey: string): Promise<SceneComment[]> {
  if (sheetsMode) {
    const { sheetName } = parseSceneKey(sceneKey);
    const store = await loadPartComments(sheetName);
    return [...(store[sceneKey] ?? [])];
  }
  const all = await loadLocalAll();
  return [...(all[sceneKey] ?? [])];
}

export async function addComment(sceneKey: string, comment: SceneComment): Promise<void> {
  if (sheetsMode) {
    const { sheetName, sceneId } = parseSceneKey(sceneKey);
    await window.electronAPI.sheetsAddComment(
      comment.id, sheetName, sceneId,
      comment.userId, comment.userName, comment.text,
      comment.mentions, comment.createdAt,
    );
    // 캐시 업데이트
    const store = sheetPartCache.get(sheetName);
    if (store) {
      if (!store[sceneKey]) store[sceneKey] = [];
      store[sceneKey].push(comment);
    }
    return;
  }
  const all = await loadLocalAll();
  if (!all[sceneKey]) all[sceneKey] = [];
  all[sceneKey].push(comment);
  await saveLocal(all);
}

export async function updateComment(
  sceneKey: string, commentId: string, text: string, mentions: string[],
): Promise<void> {
  const editedAt = new Date().toISOString();

  if (sheetsMode) {
    await window.electronAPI.sheetsEditComment(commentId, text, mentions);
    // 캐시 업데이트
    sheetPartCache.forEach((store) => {
      const list = store[sceneKey];
      if (list) {
        const idx = list.findIndex(c => c.id === commentId);
        if (idx >= 0) list[idx] = { ...list[idx], text, mentions, editedAt };
      }
    });
    return;
  }

  const all = await loadLocalAll();
  const list = all[sceneKey];
  if (!list) return;
  const idx = list.findIndex(c => c.id === commentId);
  if (idx >= 0) list[idx] = { ...list[idx], text, mentions, editedAt };
  await saveLocal(all);
}

export async function deleteComment(sceneKey: string, commentId: string): Promise<void> {
  if (sheetsMode) {
    await window.electronAPI.sheetsDeleteComment(commentId);
    // 캐시에서 제거
    sheetPartCache.forEach((store) => {
      const list = store[sceneKey];
      if (list) {
        store[sceneKey] = list.filter(c => c.id !== commentId);
        if (store[sceneKey].length === 0) delete store[sceneKey];
      }
    });
    return;
  }

  const all = await loadLocalAll();
  const list = all[sceneKey];
  if (!list) return;
  all[sceneKey] = list.filter(c => c.id !== commentId);
  if (all[sceneKey].length === 0) delete all[sceneKey];
  await saveLocal(all);
}

/** 텍스트에서 @멘션 추출 */
export function extractMentions(text: string, userNames: string[]): string[] {
  const mentions: string[] = [];
  const regex = /@(\S+)/g;
  let match;
  while ((match = regex.exec(text))) {
    const name = match[1];
    if (userNames.includes(name) && !mentions.includes(name)) {
      mentions.push(name);
    }
  }
  return mentions;
}
