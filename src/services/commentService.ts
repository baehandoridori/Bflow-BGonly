/**
 * 씬별 댓글/의견 서비스
 * %APPDATA%/Bflow-BGonly/comments.json 에 저장
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

let cache: CommentsStore | null = null;

export async function loadAllComments(): Promise<CommentsStore> {
  if (cache) return cache;
  try {
    const data = await window.electronAPI.readSettings(COMMENTS_FILE);
    if (data && typeof data === 'object') {
      cache = data as CommentsStore;
      return cache;
    }
  } catch {
    // 파일 없으면 빈 객체
  }
  cache = {};
  return cache;
}

export async function getComments(sceneKey: string): Promise<SceneComment[]> {
  const all = await loadAllComments();
  return all[sceneKey] ?? [];
}

export async function addComment(sceneKey: string, comment: SceneComment): Promise<void> {
  const all = await loadAllComments();
  if (!all[sceneKey]) all[sceneKey] = [];
  all[sceneKey].push(comment);
  cache = all;
  await window.electronAPI.writeSettings(COMMENTS_FILE, all);
}

export async function updateComment(
  sceneKey: string, commentId: string, text: string, mentions: string[],
): Promise<void> {
  const all = await loadAllComments();
  const list = all[sceneKey];
  if (!list) return;
  const idx = list.findIndex(c => c.id === commentId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], text, mentions, editedAt: new Date().toISOString() };
  }
  cache = all;
  await window.electronAPI.writeSettings(COMMENTS_FILE, all);
}

export async function deleteComment(sceneKey: string, commentId: string): Promise<void> {
  const all = await loadAllComments();
  const list = all[sceneKey];
  if (!list) return;
  all[sceneKey] = list.filter(c => c.id !== commentId);
  if (all[sceneKey].length === 0) delete all[sceneKey];
  cache = all;
  await window.electronAPI.writeSettings(COMMENTS_FILE, all);
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
