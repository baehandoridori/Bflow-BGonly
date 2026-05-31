/**
 * 씬별 댓글/의견 서비스
 *
 * Phase 0-3: Google Sheets _COMMENTS 탭 동기화
 * - 시트 연결 시: _COMMENTS 탭에서 파트별 지연 로딩
 * - 미연결 시: %APPDATA%/Bflow-BGonly/comments.json 로컬 폴백
 *
 * sceneKey 형식: "sheetName:sceneNo" (예: "EP01_A_BG:3")
 */

import type { Part } from '../types';
import { normalizeSceneIdKey } from '../utils/sceneIdKey';

const COMMENTS_FILE = 'comments.json';

export interface SceneComment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];   // 태그된 사용자 이름 목록
  images?: string[];    // Supabase Storage CDN URL — v1.15.12+ (이미지 첨부)
  createdAt: string;    // ISO 8601
  editedAt?: string;
  /**
   * v1.18.0: 리비전 맥락 댓글이면 해당 리비전 id, 일반 씬 댓글이면 null/undefined.
   * 리비전 ↔ 댓글 단일 흐름 통합 — 리비전 패널에서 작성된 댓글은 이 필드로 연결.
   */
  revisionId?: string | null;
  /**
   * v1.24.0: 1단계 대댓글(slack/linear 스타일)이면 부모 댓글 id, 일반 댓글이면 null/undefined.
   * 부모 댓글 삭제 시 SET NULL → 답글이 일반 댓글로 떨어진다 (Slack 동작과 일치).
   */
  parentCommentId?: string | null;
  /**
   * v1.24.0 코덱스 P1: 댓글이 *실제로 저장된* sheetName:sceneNo (storage origin).
   * 답글 저장 시 부모와 같은 sheet 에 쓰기 위해 사용 — UI dedup 의 _sourceKey 보다 신뢰할 수 있는
   * persisted source. raw row 의 partId + scene_id 로부터 도출.
   */
  storageKey?: string;
}

export type CommentsStore = Record<string, SceneComment[]>;

export function hydrateLocalCommentsForPreview(store: CommentsStore): void {
  localCache = store;
  void window.electronAPI?.writeSettings?.(COMMENTS_FILE, store);
  window.dispatchEvent(new CustomEvent('bflow:comments-invalidated'));
}

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

function dispatchLocalCommentInvalidated(sceneKey: string, commentAction?: 'add' | 'edit' | 'delete'): void {
  const { sheetName, sceneId } = parseSceneKey(sceneKey);
  window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', {
    detail: { sheetName, sceneId, commentAction },
  }));
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
 *
 * Codex P1(2026-04-23): 상대 부서 댓글을 요청된 sheet 키로 재매핑할 때 단순히
 * `${sheetName}:${c.sceneId}`로 작성하면 BG·ACT scene.no 가 비대칭(삭제/추가로 어긋난 경우)
 * 일 때 엉뚱한 카드에 매핑된다. 댓글이 달린 "장면"의 scene_number 를 정규화하여 요청 파트에서
 * 같은 정규화 값을 가진 씬의 scene.no 로 키를 재구성한다. 매칭 씬이 없으면 안전하게 skip.
 */
export async function loadPartComments(sheetName: string): Promise<CommentsStore> {
  if (sheetPartCache.has(sheetName)) return sheetPartCache.get(sheetName)!;

  const related = getRelatedSheetNames(sheetName);
  let requestedPart: Part | undefined;
  const partByUuid = new Map<string, Part>();
  const partUuids: string[] = [];
  try {
    const { useDataStore } = await import('../stores/useDataStore');
    const allParts: Part[] = useDataStore.getState().episodes.flatMap((ep) => ep.parts);
    requestedPart = allParts.find((p) => p.sheetName === sheetName);
    for (const sn of related) {
      const p = allParts.find((pp) => pp.sheetName === sn);
      if (p?.id) {
        partUuids.push(p.id);
        partByUuid.set(p.id, p);
      }
    }
  } catch { /* 무시 */ }

  let rawComments: { id: string; partId: string; sceneId: string; userId: string; userName: string; text: string; mentions: string[]; images?: string[]; createdAt: string; editedAt: string | null; revisionId?: string | null; parentCommentId?: string | null }[] = [];

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
          mentions: c.mentions ?? [],
          // Codex P1(2026-04-29): images 를 undefined 로 둔다. Sheets fallback 은 attachment 정보를 모름 →
          // 빈 배열로 채우면 그 댓글을 수정할 때 supabaseEditComment 가 실 이미지 URL 들을 빈 배열로 덮어쓰는 사고 발생.
          createdAt: c.createdAt, editedAt: c.editedAt || null,
        }));
      }
    } catch { /* fallback도 실패 */ }
  }

  /**
   * 댓글 row를 요청된 sheet 기준 scene.no 문자열로 변환. 매칭 씬이 없으면 null 반환(skip).
   *
   * Codex P1 3차(2026-04-23): 정규화만으로 매칭하면 alias-collision (예: `a001`·`ac001` 이
   * 같은 키로 정규화) 상황에서 상대 부서 댓글이 다른 물리 씬에 붙을 수 있다. 순서:
   *   1) 원본 scene_number(lowercase) 정확 매칭 — collision 영향 없음, 일반 케이스 대부분 해결
   *   2) 정규화 매칭 — 단 requested part 에 같은 정규화 씬이 "유일"할 때만. 2개 이상이면 skip.
   */
  const mapToRequestedSceneNo = (row: typeof rawComments[number]): string | null => {
    // 요청 파트 메타를 못 얻었거나 fallback 경로 등은 원본 scene_id 를 그대로 사용(이전 동작과 호환).
    if (!requestedPart) return row.sceneId;
    const sourcePart = row.partId ? partByUuid.get(row.partId) : undefined;

    // 자기 파트 댓글이면 그대로
    if (!sourcePart || sourcePart.id === requestedPart.id) return row.sceneId;

    const sourceScene = sourcePart.scenes.find((s) => String(s.no) === String(row.sceneId));
    if (!sourceScene) return null;

    // 1차: 원본 scene_number 정확 매칭 (lowercase + trim). collision 안전.
    const sourceSceneNumber = (sourceScene.sceneId || '').trim().toLowerCase();
    if (sourceSceneNumber) {
      const exactMatch = requestedPart.scenes.find(
        (s) => (s.sceneId || '').trim().toLowerCase() === sourceSceneNumber,
      );
      if (exactMatch) return String(exactMatch.no);
    }

    // 2차: 정규화 매칭 — 유일한 매칭일 때만 허용. 2개 이상이면 alias-collision 이므로 skip.
    const normalizedSource = normalizeSceneIdKey(sourceScene.sceneId, sourcePart.partId);
    if (!normalizedSource) return null;
    const normalizedMatches = requestedPart.scenes.filter(
      (s) => normalizeSceneIdKey(s.sceneId, requestedPart!.partId) === normalizedSource,
    );
    if (normalizedMatches.length === 1) return String(normalizedMatches[0].no);
    return null;
  };

  const store: CommentsStore = {};
  const seenIds = new Set<string>();
  for (const c of rawComments) {
    // 통합 조회 중복 제거 (안전장치)
    if (seenIds.has(c.id)) continue;
    seenIds.add(c.id);

    const targetSceneNo = mapToRequestedSceneNo(c);
    if (targetSceneNo == null) continue; // 비대칭으로 대응 씬이 없으면 안전하게 skip

    const key = `${sheetName}:${targetSceneNo}`;
    if (!store[key]) store[key] = [];
    // v1.24.0 코덱스 P1: 답글 저장 시 부모와 같은 sheet 에 쓰기 위해 storage origin 도 함께 stamp.
    //   raw row 의 partId(UUID) → sourcePart.sheetName, scene_id (sort_order) 그대로 사용.
    //   Sheets fallback 은 partId 가 비어있어 storageKey undefined → 호출자 fallback to sceneKey.
    const sourcePart = c.partId ? partByUuid.get(c.partId) : undefined;
    const storageKey = sourcePart?.sheetName
      ? `${sourcePart.sheetName}:${c.sceneId}`
      : undefined;
    store[key].push({
      id: c.id,
      userId: c.userId,
      userName: c.userName,
      text: c.text,
      mentions: c.mentions ?? [],
      // images: c.images 가 undefined 면 그대로 undefined (Sheets fallback) — 수정 시 덮어쓰지 않게.
      images: c.images,
      createdAt: c.createdAt,
      editedAt: c.editedAt || undefined,
      // v1.18.0: 리비전 맥락 댓글 식별용 — Supabase 경로만 채워지고 Sheets fallback 은 undefined.
      revisionId: c.revisionId ?? null,
      // v1.24.0: 1단계 대댓글 부모 참조 — Supabase 만 채워짐.
      parentCommentId: c.parentCommentId ?? null,
      // v1.24.0 코덱스 P1: 실제 storage origin (UI dedup 의 _sourceKey 보다 신뢰).
      storageKey,
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

export async function getCommentStoreForPart(sheetName: string): Promise<CommentsStore> {
  if (sheetsMode) return loadPartComments(sheetName);

  const all = await loadLocalAll();
  const prefix = `${sheetName}:`;
  const partStore: CommentsStore = {};
  for (const [key, list] of Object.entries(all)) {
    if (key.startsWith(prefix)) partStore[key] = [...list];
  }
  return partStore;
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
      comment.mentions, comment.createdAt, comment.images ?? [],
      // v1.18.0: revisionId 정식 전달 — null 이면 일반 씬 댓글, 값 있으면 리비전 맥락 댓글.
      comment.revisionId ?? null,
      // v1.24.0: 1단계 대댓글 부모 id 정식 전달.
      comment.parentCommentId ?? null,
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
  dispatchLocalCommentInvalidated(sceneKey, 'add');
}

export async function updateComment(
  sceneKey: string, commentId: string, text: string, mentions: string[], images?: string[],
): Promise<void> {
  const editedAt = new Date().toISOString();
  // Codex P1(2026-04-29): images 를 옵셔널로 둔다. undefined 면 supabase update 에서 images 컬럼 자체를 빼고
  // 캐시도 덮어쓰지 않는다 — Sheets fallback 댓글의 실 이미지 URL 들이 silently 삭제되는 사고 방지.
  const imagesPatch: Pick<SceneComment, 'images'> | Record<string, never> =
    images !== undefined ? { images } : {};

  if (sheetsMode) {
    const { sheetName, sceneId } = parseSceneKey(sceneKey);
    await window.electronAPI.supabaseEditComment(commentId, text, mentions, images);
    sheetPartCache.forEach((store) => {
      for (const list of Object.values(store)) {
        const idx = list.findIndex(c => c.id === commentId);
        if (idx >= 0) list[idx] = { ...list[idx], text, mentions, ...imagesPatch, editedAt };
      }
    });
    window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail: { sheetName } }));
    window.electronAPI?.dataNotifyChange?.({
      type: 'comment', sheetName, sceneId, commentAction: 'edit',
    });
    return;
  }

  const all = await loadLocalAll();
  const list = all[sceneKey];
  if (!list) return;
  const idx = list.findIndex(c => c.id === commentId);
  if (idx >= 0) list[idx] = { ...list[idx], text, mentions, ...imagesPatch, editedAt };
  await saveLocal(all);
  dispatchLocalCommentInvalidated(sceneKey, 'edit');
}

export async function deleteComment(sceneKey: string, commentId: string): Promise<void> {
  if (sheetsMode) {
    const { sheetName, sceneId } = parseSceneKey(sceneKey);
    await window.electronAPI.supabaseDeleteComment(commentId);
    // 캐시에서 제거 — commentId 기준으로 모든 캐시/리스트 순회 (BG·ACT 양쪽 반영)
    // v1.24.0 P1 #5: 부모 삭제 시 답글의 parentCommentId 도 NULL 갱신 (DB ON DELETE SET NULL 과 일관).
    //   안 그러면 답글이 stale 한 parentCommentId 를 들고 있어 "원답글이 삭제된 답글" orphan 배지가 잘못 노출됨.
    sheetPartCache.forEach((store) => {
      for (const key of Object.keys(store)) {
        const list = store[key];
        const filtered = list.filter(c => c.id !== commentId).map((c) =>
          c.parentCommentId === commentId ? { ...c, parentCommentId: null } : c,
        );
        if (filtered.length !== list.length || filtered.some((c, i) => c !== list[i])) {
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

  // local fallback (오프라인/테스트). 코덱스 P2 fix (2026-05-10): 답글 parentCommentId 도 NULL 갱신 →
  //   sheetsMode 분기와 일관된 ON DELETE SET NULL 동작 (orphan 답글 잘못된 표기 방지).
  const all = await loadLocalAll();
  const list = all[sceneKey];
  if (!list) return;
  all[sceneKey] = list
    .filter(c => c.id !== commentId)
    .map(c => (c.parentCommentId === commentId ? { ...c, parentCommentId: null } : c));
  if (all[sceneKey].length === 0) delete all[sceneKey];
  await saveLocal(all);
  dispatchLocalCommentInvalidated(sceneKey, 'delete');
}

/**
 * v1.24.0: 캐시에서 동기적으로 댓글 목록 조회 (없으면 null).
 * 비동기 로드 트리거 X — 알림 핸들러 같은 hot path 에서 false-negative safe 한 빠른 조회용.
 */
export function peekCachedComments(sceneKey: string): SceneComment[] | null {
  if (sheetsMode) {
    const { sheetName } = parseSceneKey(sceneKey);
    const store = sheetPartCache.get(sheetName);
    if (!store) return null;
    return store[sceneKey] ? [...store[sceneKey]] : [];
  }
  if (!localCache) return null;
  return localCache[sceneKey] ? [...localCache[sceneKey]] : [];
}

/**
 * v1.24.0: 캐시에서 commentId 로 댓글 단건 동기 조회. sheetName 모를 때 모든 캐시 순회 (소량이라 부담 X).
 */
export function findCommentInCache(commentId: string): SceneComment | null {
  if (sheetsMode) {
    for (const store of sheetPartCache.values()) {
      for (const list of Object.values(store)) {
        const found = list.find((c) => c.id === commentId);
        if (found) return found;
      }
    }
    return null;
  }
  if (!localCache) return null;
  for (const list of Object.values(localCache)) {
    const found = list.find((c) => c.id === commentId);
    if (found) return found;
  }
  return null;
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

// ─── v1.26.0: 댓글 이모지 리액션 ───

import type { CommentReaction } from '../types';

export async function addReaction(
  commentId: string,
  emoji: string,
  userId: string,
  userName: string,
): Promise<void> {
  await window.electronAPI.supabaseAddCommentReaction(commentId, emoji, userId, userName);
}

export async function removeReaction(
  commentId: string,
  emoji: string,
  userId: string,
): Promise<void> {
  await window.electronAPI.supabaseRemoveCommentReaction(commentId, emoji, userId);
}

/**
 * 여러 댓글 id 에 대한 리액션 일괄 조회.
 * 반환: Map<commentId, CommentReaction[]>
 */
export async function fetchReactionsBulk(commentIds: string[]): Promise<Map<string, CommentReaction[]>> {
  if (commentIds.length === 0) return new Map();
  try {
    const raw = await window.electronAPI.supabaseGetCommentReactionsBulk(commentIds);
    const map = new Map<string, CommentReaction[]>();
    for (const [cid, list] of Object.entries(raw)) {
      map.set(cid, list as CommentReaction[]);
    }
    return map;
  } catch (err) {
    console.error('[commentService] fetchReactionsBulk 실패', err);
    return new Map();
  }
}
