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

/** BG↔ACT 상대 sheetName. 같은 장면의 댓글을 양쪽 탭에서 공유하기 위해 사용. */
function getCounterpartSheetName(sheetName: string): string | null {
  if (sheetName.endsWith('_BG')) return sheetName.slice(0, -3) + '_ACT';
  if (sheetName.endsWith('_ACT')) return sheetName.slice(0, -4) + '_BG';
  return null;
}

function getRelatedSheetNames(sheetName: string): string[] {
  const cp = getCounterpartSheetName(sheetName);
  return cp ? [sheetName, cp] : [sheetName];
}

/**
 * 특정 파트의 댓글을 시트에서 로드 (캐시).
 * 이슈 F-2(2026-04-23): 같은 장면의 BG·ACT 댓글을 함께 조회해 한쪽에서 작성한 댓글이
 * 반대 부서 탭·카드 뷰 뱃지에서도 보이게 함. 저장은 그대로 원본 파트에만 한다.
 */
export async function loadPartComments(sheetName: string): Promise<CommentsStore> {
  if (sheetPartCache.has(sheetName)) return sheetPartCache.get(sheetName)!;

  const related = getRelatedSheetNames(sheetName);
  const partUuids: string[] = [];
  try {
    const { useDataStore } = await import('../stores/useDataStore');
    const allParts = useDataStore.getState().episodes.flatMap((ep) => ep.parts);
    for (const sn of related) {
      const p = allParts.find((pp) => pp.sheetName === sn);
      if (p?.id) partUuids.push(p.id);
    }
  } catch { /* 무시 */ }

  let rawComments: { id: string; partId: string; sceneId: string; userId: string; userName: string; text: string; mentions: string[]; createdAt: string; editedAt: string | null }[] = [];

  let supabaseFailed = false;
  if (partUuids.length > 0) {
    // Supabase 경로 — 관련 파트(BG·ACT) UUID 모두에서 조회
    try {
      const results = await Promise.all(
        partUuids.map((uuid) => window.electronAPI.supabaseReadComments(uuid) as Promise<typeof rawComments>),
      );
      rawComments = results.flat();
    } catch (err) {
      console.warn('[댓글] Supabase 로드 실패, Sheets fallback:', err);
      supabaseFailed = true;
    }
  }

  // Supabase 실패 또는 partUuid 없을 때 Sheets fallback
  if (rawComments.length === 0 && (partUuids.length === 0 || supabaseFailed)) {
    try {
      const result = await window.electronAPI.sheetsReadComments(sheetName);
      if (result.ok) {
        rawComments = (result.data ?? []).map((c) => ({
          id: c.commentId, partId: '', sceneId: c.sceneId,
          userId: c.userId, userName: c.userName, text: c.text,
          mentions: c.mentions ?? [], createdAt: c.createdAt, editedAt: c.editedAt || null,
        }));
      }
    } catch { /* fallback도 실패 */ }
  }

  const store: CommentsStore = {};
  const seenIds = new Set<string>();
  for (const c of rawComments) {
    // 통합 조회 중복 제거 (안전장치)
    if (seenIds.has(c.id)) continue;
    seenIds.add(c.id);
    // 키는 요청된 sheetName 기준 — 호출자(카드 뷰 뱃지)가 같은 키로 조회할 수 있게.
    const key = `${sheetName}:${c.sceneId}`;
    if (!store[key]) store[key] = [];
    store[key].push({
      id: c.id,
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

/**
 * 파트 캐시 무효화 + 컴포넌트에 리로드 신호 전달.
 * BG↔ACT 양쪽 캐시를 함께 비워 한쪽 갱신이 다른 쪽 뷰에도 반영되게 함.
 */
export function invalidatePartCache(sheetName?: string): void {
  if (sheetName) {
    sheetPartCache.delete(sheetName);
    const cp = getCounterpartSheetName(sheetName);
    if (cp) sheetPartCache.delete(cp);
  } else {
    sheetPartCache.clear();
  }
  window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail: { sheetName } }));
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
    // Supabase: sheetName → part UUID 해석
    let partUuid = '';
    try {
      const { useDataStore } = await import('../stores/useDataStore');
      const part = useDataStore.getState().episodes
        .flatMap((ep) => ep.parts)
        .find((p) => p.sheetName === sheetName);
      partUuid = part?.id || '';
    } catch { /* 무시 */ }

    await window.electronAPI.supabaseAddComment(
      comment.id, partUuid, sceneId,
      comment.userId, comment.userName, comment.text,
      comment.mentions, comment.createdAt,
    );
    // 캐시 업데이트 — 원본 sheet 캐시에만 낙관적 반영.
    // 반대 부서 sheet 캐시는 invalidate해서 다음 조회 시 통합 재조회로 반영 (중복 삽입 방지).
    const ownStore = sheetPartCache.get(sheetName);
    if (ownStore) {
      if (!ownStore[sceneKey]) ownStore[sceneKey] = [];
      ownStore[sceneKey].push(comment);
    }
    const counterpart = getCounterpartSheetName(sheetName);
    if (counterpart) sheetPartCache.delete(counterpart);
    // 자기 창 카드 뷰 뱃지 즉시 갱신 (ScenesView 리스너 트리거).
    // 주의: 이벤트만 발화. 캐시 비우기는 이미 위에서 처리했음 (invalidatePartCache 호출 금지 — 무한 루프 방지).
    window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail: { sheetName } }));
    // 다른 창에 댓글 변경 알림
    window.electronAPI?.dataNotifyChange?.({
      type: 'comment', sheetName, sceneId, commentAction: 'add',
    });
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
    const { sheetName, sceneId } = parseSceneKey(sceneKey);
    await window.electronAPI.supabaseEditComment(commentId, text, mentions);
    // 캐시 업데이트 — commentId 기준으로 모든 캐시/리스트를 순회 (BG·ACT 양쪽 매핑 반영)
    sheetPartCache.forEach((store) => {
      for (const list of Object.values(store)) {
        const idx = list.findIndex(c => c.id === commentId);
        if (idx >= 0) list[idx] = { ...list[idx], text, mentions, editedAt };
      }
    });
    // 자기 창 뱃지/패널 즉시 갱신
    window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail: { sheetName } }));
    // 다른 창에 댓글 변경 알림
    window.electronAPI?.dataNotifyChange?.({
      type: 'comment', sheetName, sceneId, commentAction: 'edit',
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
    const { sheetName, sceneId } = parseSceneKey(sceneKey);
    await window.electronAPI.supabaseDeleteComment(commentId);
    // 캐시에서 제거 — commentId 기준으로 모든 캐시/리스트 순회 (BG·ACT 양쪽 반영)
    sheetPartCache.forEach((store) => {
      for (const key of Object.keys(store)) {
        const list = store[key];
        const filtered = list.filter(c => c.id !== commentId);
        if (filtered.length !== list.length) {
          if (filtered.length === 0) delete store[key];
          else store[key] = filtered;
        }
      }
    });
    // 자기 창 뱃지/패널 즉시 갱신
    window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail: { sheetName } }));
    // 다른 창에 댓글 변경 알림
    window.electronAPI?.dataNotifyChange?.({
      type: 'comment', sheetName, sceneId, commentAction: 'delete',
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
