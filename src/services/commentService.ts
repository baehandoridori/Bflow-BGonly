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
import { useDataStore } from '../stores/useDataStore';
import {
  buildSheetCommentStore,
  createCommentRowCache,
  getRelatedSheetNames,
  normalizeCommentBroadcastChange,
  normalizeRealtimeCommentChange,
  type CommentRow,
  type CommentRowOp,
  type CommentsInvalidatedDetail,
  type RemoteCommentChange,
} from '../utils/commentRowCache';

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
   * v1.18.0: 리테이크 맥락 댓글이면 해당 리테이크 id, 일반 씬 댓글이면 null/undefined.
   * 리테이크 ↔ 댓글 단일 흐름 통합 — 리테이크 패널에서 작성된 댓글은 이 필드로 연결.
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

/**
 * 댓글 조회 옵션. throwOnError 를 켠 호출자(댓글 패널)만 '불러오지 못함'을 예외로 받는다.
 * 기본(배지·개수 등)은 예전처럼 빈 목록으로 조용히 넘어간다.
 */
export interface CommentReadOptions {
  throwOnError?: boolean;
}

/** 서버 조회가 실패해 '댓글 없음'과 구분해야 할 때 던지는 오류. */
export class CommentLoadError extends Error {
  constructor(message = '댓글을 불러오지 못했어요') {
    super(message);
    this.name = 'CommentLoadError';
  }
}

export function hydrateLocalCommentsForPreview(store: CommentsStore): void {
  localCache = store;
  void window.electronAPI?.writeSettings?.(COMMENTS_FILE, store);
  window.dispatchEvent(new CustomEvent('bflow:comments-invalidated'));
}

// ─── 모드 관리 ──────────────────────────────────

let sheetsMode = false;

export function setCommentsSheetsMode(enabled: boolean): void {
  sheetsMode = enabled;
  if (!enabled) {
    sheetPartCache.clear();
    rowBackedSheets.clear();
    rowCache.invalidate();
  }
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
//
// 씬 댓글 B안 §7(2026-11-04): 서버에서 받은 행은 파트(UUID)마다 한 벌만 들고(rowCache), 시트별 묶음은 그 행으로
// 만든다. 같은 장면의 BG·ACT 두 시트가 같은 두 파트를 읽으므로 '통합' 화면에서도 파트마다 한 번만 읽는다.
// 실시간·방송으로 받은 댓글 변경은 행 캐시를 고치고(재조회 없음) 그 파트로 만든 시트 묶음만 버린다.

const rowCache = createCommentRowCache({
  read: async (partUuid) => {
    const rows = await window.electronAPI.supabaseReadComments(partUuid);
    return (Array.isArray(rows) ? rows : []) as CommentRow[];
  },
});

// sheetName → { sceneKey → SceneComment[] }
const sheetPartCache = new Map<string, CommentsStore>();
/** 행 캐시로 만든 시트 묶음. 나머지(예전 시트 대체 경로 결과)는 댓글이 바뀌면 그냥 버린다. */
const rowBackedSheets = new Set<string>();

function parseSceneKey(sceneKey: string): { sheetName: string; sceneId: string } {
  const idx = sceneKey.lastIndexOf(':');
  return { sheetName: sceneKey.substring(0, idx), sceneId: sceneKey.substring(idx + 1) };
}

function allLoadedParts(): Part[] {
  try {
    return useDataStore.getState().episodes.flatMap((ep) => ep.parts);
  } catch {
    return [];
  }
}

/** 시트가 읽어야 할 파트들(BG·ACT 같은 장면). 데이터가 아직 없으면 빈 목록. */
function resolveSheetParts(sheetName: string): { requestedPart?: Part; partByUuid: Map<string, Part>; partUuids: string[] } {
  const parts = allLoadedParts();
  const partByUuid = new Map<string, Part>();
  const partUuids: string[] = [];
  for (const sn of getRelatedSheetNames(sheetName)) {
    const part = parts.find((p) => p.sheetName === sn);
    if (part?.id) {
      partUuids.push(part.id);
      partByUuid.set(part.id, part);
    }
  }
  return { requestedPart: parts.find((p) => p.sheetName === sheetName), partByUuid, partUuids };
}

// 상대 부서 댓글을 어느 씬에 붙일지는 만들 때의 씬 구성으로 정해진다. 씬이 추가·삭제·번호 변경되면
// 행 캐시로 만든 시트 묶음을 버려 다음에 볼 때 다시 만든다(서버 요청 없음 — 행 캐시는 그대로).
let lastEpisodesRef: unknown = null;
try {
  useDataStore.subscribe((state) => {
    if (state.episodes === lastEpisodesRef) return;
    lastEpisodesRef = state.episodes;
    for (const sn of [...rowBackedSheets]) sheetPartCache.delete(sn);
    rowBackedSheets.clear();
  });
} catch { /* 스토어가 없는 환경 */ }

/** 이 파트의 행으로 만든 시트 묶음들(자기 시트 + 상대 부서 시트). */
function sheetNamesForPart(partUuid: string): string[] {
  const part = allLoadedParts().find((p) => p.id === partUuid);
  return part?.sheetName ? getRelatedSheetNames(part.sheetName) : [];
}

/** 관련 파트 행이 모두 캐시에 있으면 그 자리에서 시트 묶음을 만든다(서버 요청 없음). */
function buildSheetStoreFromCachedRows(sheetName: string): CommentsStore | null {
  const { requestedPart, partByUuid, partUuids } = resolveSheetParts(sheetName);
  if (partUuids.length === 0) return null;
  const rowLists = partUuids.map((uuid) => rowCache.peek(uuid));
  if (rowLists.some((rows) => !rows)) return null;
  const store = buildSheetCommentStore(sheetName, rowLists as CommentRow[][], requestedPart, partByUuid) as CommentsStore;
  sheetPartCache.set(sheetName, store);
  rowBackedSheets.add(sheetName);
  return store;
}

/**
 * 댓글 변경 하나를 캐시에 적용하고, 바뀐 시트를 알린다. 캐시에 아무 변화가 없으면 알리지 않는다
 * (실시간과 방송이 같은 변경을 두 번 줘도 듣는 쪽은 한 번만 다시 그린다).
 */
function applyCommentOpToCaches(
  op: CommentRowOp,
  meta: { commentId: string; action: 'add' | 'edit' | 'delete'; sceneId?: string; alsoSheet?: string },
): CommentsInvalidatedDetail | null {
  const changedParts = rowCache.apply(op);
  const sheets = new Set<string>();
  for (const partUuid of changedParts) for (const sn of sheetNamesForPart(partUuid)) sheets.add(sn);
  // 예전 시트 대체 경로로 만든 묶음은 고칠 수 없으니 버린다(드묾 — 파트 정보를 못 얻었을 때만 생긴다).
  for (const sn of [...sheetPartCache.keys()]) {
    if (!rowBackedSheets.has(sn)) sheets.add(sn);
  }
  // 이 창에서 바꾼 댓글이면(alsoSheet) 캐시에 없던 시트라도 알린다 — 보고 있는 화면이 다시 읽게.
  if (meta.alsoSheet) for (const sn of getRelatedSheetNames(meta.alsoSheet)) sheets.add(sn);
  if (sheets.size === 0) return null;
  for (const sn of sheets) {
    sheetPartCache.delete(sn);
    rowBackedSheets.delete(sn);
  }
  const sheetNames = [...sheets];
  const detail: CommentsInvalidatedDetail = {
    sheetName: meta.alsoSheet ?? sheetNames[0],
    sheetNames,
    partIds: changedParts,
    commentId: meta.commentId,
    commentAction: meta.action,
    patched: true,
    ...(meta.sceneId ? { sceneId: meta.sceneId } : {}),
  };
  window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail }));
  return detail;
}

/**
 * 특정 파트의 댓글을 로드 (캐시).
 * 이슈 F-2(2026-04-23): 같은 장면의 BG·ACT 댓글을 함께 조회해 한쪽에서 작성한 댓글이
 * 반대 부서 탭·카드 뷰 뱃지에서도 보이게 함. 저장은 그대로 원본 파트에만 한다.
 * 상대 부서 댓글을 요청 시트의 씬 번호로 옮기는 규칙은 utils/commentRowCache.ts mapCommentRowToRequestedSceneNo.
 */
export async function loadPartComments(sheetName: string, options: CommentReadOptions = {}): Promise<CommentsStore> {
  const cachedStore = sheetPartCache.get(sheetName);
  if (cachedStore) return cachedStore;

  const { requestedPart, partByUuid, partUuids } = resolveSheetParts(sheetName);

  let supabaseFailed = false;
  if (partUuids.length > 0) {
    // Supabase 경로 — 관련 파트(BG·ACT) UUID 모두에서 조회. 같은 파트를 이미 누가 읽는 중이면 그 요청을 같이 기다린다.
    let fetched: (readonly CommentRow[])[] | null = null;
    try {
      fetched = await Promise.all(partUuids.map((uuid) => rowCache.load(uuid)));
    } catch (err) {
      console.warn('[댓글] Supabase 로드 실패, Sheets fallback:', err);
      supabaseFailed = true;
    }
    if (fetched) {
      const raced = sheetPartCache.get(sheetName);
      if (raced) return raced;
      // 기다리는 사이 들어온 변경까지 반영된 캐시 행을 쓴다. 그 사이 누가 캐시를 버렸으면 받은 결과로 만들되 저장하지 않는다.
      const current = partUuids.map((uuid, index) => rowCache.peek(uuid) ?? fetched![index]);
      const allCached = partUuids.every((uuid) => !!rowCache.peek(uuid));
      const store = buildSheetCommentStore(sheetName, current, requestedPart, partByUuid) as CommentsStore;
      if (allCached) {
        sheetPartCache.set(sheetName, store);
        rowBackedSheets.add(sheetName);
      }
      return store;
    }
  }

  // Supabase 실패 또는 partUuid 없을 때 Sheets fallback
  let fallbackRows: CommentRow[] | null = null;
  try {
    const result = await window.electronAPI.sheetsReadComments(sheetName);
    if (result.ok) {
      fallbackRows = (result.data ?? []).map((c) => ({
        id: c.commentId, partId: '', sceneId: c.sceneId,
        userId: c.userId, userName: c.userName, text: c.text,
        mentions: c.mentions ?? [],
        // Codex P1(2026-04-29): images 를 undefined 로 둔다. Sheets fallback 은 attachment 정보를 모름 →
        // 빈 배열로 채우면 그 댓글을 수정할 때 supabaseEditComment 가 실 이미지 URL 들을 빈 배열로 덮어쓰는 사고 발생.
        images: undefined,
        createdAt: c.createdAt, editedAt: c.editedAt || null,
      }));
    }
  } catch { /* fallback도 실패 */ }

  // 서버 조회가 실패했고 대체 경로도 못 읽었으면 '댓글 없음'이 아니라 '불러오지 못함'이다.
  // 빈 결과를 캐시하지 않아야 '다시 불러오기'가 서버를 다시 본다(배지 등 기본 호출자는 예전처럼 빈 목록).
  if (supabaseFailed && !fallbackRows) {
    if (options.throwOnError) throw new CommentLoadError();
    return {};
  }

  const store = buildSheetCommentStore(sheetName, [fallbackRows ?? []], requestedPart, partByUuid) as CommentsStore;
  sheetPartCache.set(sheetName, store);
  rowBackedSheets.delete(sheetName);
  return store;
}

/**
 * 파트 캐시 무효화 + 컴포넌트에 리로드 신호 전달.
 * BG↔ACT 양쪽 캐시를 함께 비워 한쪽 갱신이 다른 쪽 뷰에도 반영되게 함.
 * 시트를 주지 않으면 전부 비운다 — 댓글 변경 하나로는 부르지 않는다(받은 변경은 applyRemoteCommentChange 로 끼워 넣는다).
 */
export function invalidatePartCache(sheetName?: string): void {
  if (sheetName) {
    const related = getRelatedSheetNames(sheetName);
    for (const sn of related) {
      sheetPartCache.delete(sn);
      rowBackedSheets.delete(sn);
    }
    for (const partUuid of resolveSheetParts(sheetName).partUuids) rowCache.invalidate(partUuid);
    window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', {
      detail: { sheetName, sheetNames: related } satisfies CommentsInvalidatedDetail,
    }));
    return;
  }
  sheetPartCache.clear();
  rowBackedSheets.clear();
  rowCache.invalidate();
  window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail: { sheetName } }));
}

/** 파트 UUID 로 무효화(받은 변경의 내용이 모자랄 때). 파트를 모르면 전체. */
function invalidateCommentsForPart(partUuid: string | null): void {
  if (!partUuid) {
    invalidatePartCache();
    return;
  }
  const sheets = sheetNamesForPart(partUuid);
  rowCache.invalidate(partUuid);
  if (sheets.length === 0) {
    // 아직 모르는 파트 — 행만 버린다. 그 파트를 보여 주는 화면이 없으니 알릴 곳도 없다.
    return;
  }
  invalidatePartCache(sheets[0]);
}

/**
 * 다른 PC·창에서 온 댓글 변경(실시간 comments 이벤트 / comment-added·updated·deleted 방송)을 캐시에 반영한다.
 * 끼워 넣을 만큼 내용을 알면 캐시만 고친다(서버 재조회 없음). 모자라면 그 파트만 다시 읽게 한다.
 */
export function applyRemoteCommentChange(change: RemoteCommentChange): CommentsInvalidatedDetail | null {
  if (change.kind === 'ignore') return null;
  if (change.kind === 'character') {
    const detail: CommentsInvalidatedDetail = {
      characterId: change.characterId,
      commentAction: change.action,
      ...(change.commentId ? { commentId: change.commentId } : {}),
    };
    window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail }));
    return detail;
  }
  if (change.kind === 'invalidate') {
    // 예전 버전이 보낸 추가 방송(이미지·시각 없음)이라도 실시간 이벤트가 이미 그 행을 넣었으면 다시 읽지 않는다.
    if (change.action === 'add' && change.commentId && rowCache.findById(change.commentId)) return null;
    invalidateCommentsForPart(change.partId);
    return { partIds: change.partId ? [change.partId] : [], commentAction: change.action };
  }
  const detail = applyCommentOpToCaches(change.op, { commentId: change.commentId, action: change.action });
  if (!detail && change.op.kind === 'delete' && !change.partId) {
    // 실시간 DELETE 는 id 만 싣는다 — 씬 캐시에 없던 댓글이면 캐릭터 댓글일 수 있다(예전 버전이 지웠거나 방송이 빠졌을 때).
    //   그 댓글을 보여 주는 화면과 캐릭터 배지만 다시 본다.
    const unresolved: CommentsInvalidatedDetail = {
      commentId: change.commentId, commentAction: 'delete', unresolvedDelete: true,
    };
    window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail: unresolved }));
    return unresolved;
  }
  return detail;
}

/** Supabase 실시간 comments 이벤트(payload = postgres_changes) → 캐시. */
export function applyRealtimeCommentPayload(payload: unknown): CommentsInvalidatedDetail | null {
  return applyRemoteCommentChange(normalizeRealtimeCommentChange(payload));
}

/** 댓글 방송(comment-added / comment-updated / comment-deleted) → 캐시. */
export function applyCommentBroadcast(event: string, payload: unknown): CommentsInvalidatedDetail | null {
  return applyRemoteCommentChange(normalizeCommentBroadcastChange(event, payload));
}

/** 컴포지팅 카드 배지 — 파트 행(캐시 → 진행 중 요청 → 새 요청). */
export function loadPartCommentRows(partUuid: string): Promise<readonly CommentRow[]> {
  return rowCache.load(partUuid);
}

/** 컴포지팅 카드 배지 — 캐시에 있는 파트 행만(없으면 undefined, 요청하지 않음). */
export function peekPartCommentRows(partUuid: string): readonly CommentRow[] | undefined {
  return rowCache.peek(partUuid);
}

/**
 * 저장 요청이 실패로 끝났지만 서버엔 저장돼 있던 댓글을 저장된 것으로 받아들일 때(움직임 폴리싱 19번 '다시 보내기').
 * 그 키의 캐시에는 이 댓글이 없으니 비워서 다음 조회가 서버 목록을 쓰게 하고, 열려 있는 패널에 다시 불러오라고 알린다.
 */
export function invalidateCommentsForKey(sceneKey: string): void {
  const characterId = parseCharacterCommentKey(sceneKey);
  if (characterId) {
    window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail: { characterId } }));
    return;
  }
  invalidatePartCache(parseSceneKey(sceneKey).sheetName);
}

// ─── 통합 API ───────────────────────────────────

export async function getComments(sceneKey: string, options: CommentReadOptions = {}): Promise<SceneComment[]> {
  if (sheetsMode) {
    const { sheetName } = parseSceneKey(sceneKey);
    const store = await loadPartComments(sheetName, options);
    return [...(store[sceneKey] ?? [])];
  }
  const all = await loadLocalAll();
  return [...(all[sceneKey] ?? [])];
}

// ─── 캐릭터 현황판 댓글 (캐릭터 단위 스레드) ─────────────────
//
// 씬 댓글(part_id+scene_id)과 같은 comments 테이블/같은 SceneComment 모양을 재사용하되,
// character_id 로만 묶인다. 씬 경로(parseSceneKey/loadPartComments/getComments)는 일절 건드리지 않는다.
// CommentPanel 의 _sourceKey 플러밍과 호환되도록 캐릭터 스레드는 `char:{characterId}` sentinel 키를 쓴다.

const CHARACTER_KEY_PREFIX = 'char:';

export function buildCharacterCommentKey(characterId: string): string {
  return `${CHARACTER_KEY_PREFIX}${characterId}`;
}

export function isCharacterCommentKey(key: string): boolean {
  return key.startsWith(CHARACTER_KEY_PREFIX);
}

function parseCharacterCommentKey(key: string): string | null {
  return key.startsWith(CHARACTER_KEY_PREFIX) ? key.slice(CHARACTER_KEY_PREFIX.length) : null;
}

interface RawCharacterCommentRow {
  id: string;
  userId: string;
  userName: string;
  text: string;
  mentions?: string[];
  images?: string[];
  createdAt: string;
  editedAt?: string | null;
  revisionId?: string | null;
  parentCommentId?: string | null;
}

/** 캐릭터별 댓글 조회 — Supabase(IPC) 경로. mock/preview 도 같은 IPC 핸들을 구현한다. */
export async function getCommentsForCharacter(characterId: string, options: CommentReadOptions = {}): Promise<SceneComment[]> {
  if (!characterId) return [];
  const reader = window.electronAPI?.supabaseReadCommentsForCharacter;
  if (!reader) return [];
  try {
    const rows = (await reader(characterId)) as RawCharacterCommentRow[];
    const storageKey = buildCharacterCommentKey(characterId);
    return (rows ?? []).map((c) => ({
      id: c.id,
      userId: c.userId,
      userName: c.userName,
      text: c.text,
      mentions: c.mentions ?? [],
      images: c.images,
      createdAt: c.createdAt,
      editedAt: c.editedAt || undefined,
      revisionId: c.revisionId ?? null,
      parentCommentId: c.parentCommentId ?? null,
      storageKey,
    }));
  } catch (err) {
    console.warn('[댓글] 캐릭터 댓글 로드 실패:', err);
    if (options.throwOnError) throw new CommentLoadError();
    return [];
  }
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
  // 캐릭터 스레드 — char:{characterId} sentinel 키면 character_id 경로로 저장.
  // 씬 분기(parseSceneKey/sheetsMode/local)는 아래 그대로 두고 여기서 일찍 분기한다.
  const characterId = parseCharacterCommentKey(sceneKey);
  if (characterId) {
    await window.electronAPI.supabaseAddComment(
      comment.id, '', '',
      comment.userId, comment.userName, comment.text,
      comment.mentions, comment.createdAt, comment.images ?? [],
      comment.revisionId ?? null,
      comment.parentCommentId ?? null,
      characterId,
      null,
    );
    window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail: { characterId } }));
    return;
  }
  if (sheetsMode) {
    const { sheetName, sceneId } = parseSceneKey(sceneKey);
    // Supabase: sheetName → part UUID 해석
    const partUuid = allLoadedParts().find((p) => p.sheetName === sheetName)?.id || '';

    await window.electronAPI.supabaseAddComment(
      comment.id, partUuid, sceneId,
      comment.userId, comment.userName, comment.text,
      comment.mentions, comment.createdAt, comment.images ?? [],
      // v1.18.0: revisionId 정식 전달 — null 이면 일반 씬 댓글, 값 있으면 리테이크 맥락 댓글.
      comment.revisionId ?? null,
      // v1.24.0: 1단계 대댓글 부모 id 정식 전달.
      comment.parentCommentId ?? null,
    );
    // 캐시 업데이트 — 파트 행 캐시에 끼워 넣는다(BG·ACT 양쪽 시트 묶음이 같은 행에서 다시 만들어진다, 재조회 없음).
    // 자기 창 카드 뷰 뱃지·패널은 이 신호로 캐시를 다시 본다(invalidatePartCache 호출 금지 — 캐시를 버리면 다시 읽는다).
    // 다른 창·다른 PC 는 실시간 comments 이벤트와 comment-added 방송으로 같은 행을 받는다.
    applyCommentOpToCaches(
      { kind: 'upsert', row: {
        id: comment.id, partId: partUuid, sceneId,
        userId: comment.userId, userName: comment.userName, text: comment.text,
        mentions: comment.mentions ?? [], images: comment.images ?? [],
        createdAt: comment.createdAt, editedAt: null,
        revisionId: comment.revisionId ?? null, parentCommentId: comment.parentCommentId ?? null,
      } },
      { commentId: comment.id, action: 'add', sceneId, alsoSheet: sheetName },
    );
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

  // 캐릭터 스레드 댓글 — commentId 기준 Supabase 수정. 패널은 invalidation 으로 리로드.
  const editCharacterId = parseCharacterCommentKey(sceneKey);
  if (editCharacterId) {
    await window.electronAPI.supabaseEditComment(commentId, text, mentions, images);
    void imagesPatch; // 캐릭터 경로는 캐시 패치 없이 리로드로 반영.
    window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail: { characterId: editCharacterId } }));
    return;
  }

  if (sheetsMode) {
    const { sheetName, sceneId } = parseSceneKey(sceneKey);
    await window.electronAPI.supabaseEditComment(commentId, text, mentions, images);
    // 파트 행 캐시의 그 댓글만 바꾼다(BG·ACT 양쪽 반영, 재조회 없음). 다른 PC 는 comment-updated 방송·실시간으로 받는다.
    applyCommentOpToCaches(
      { kind: 'patch', id: commentId, fields: { text, mentions, ...imagesPatch, editedAt } },
      { commentId, action: 'edit', sceneId, alsoSheet: sheetName },
    );
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
  // 캐릭터 스레드 댓글 — commentId 기준 Supabase 삭제. 패널은 invalidation 으로 리로드.
  const deleteCharacterId = parseCharacterCommentKey(sceneKey);
  if (deleteCharacterId) {
    await window.electronAPI.supabaseDeleteComment(commentId);
    window.dispatchEvent(new CustomEvent('bflow:comments-invalidated', { detail: { characterId: deleteCharacterId } }));
    return;
  }
  if (sheetsMode) {
    const { sheetName, sceneId } = parseSceneKey(sceneKey);
    await window.electronAPI.supabaseDeleteComment(commentId);
    // 캐시에서 제거 — 파트 행 캐시에서 빼면 BG·ACT 양쪽 시트 묶음이 같이 바뀐다.
    // v1.24.0 P1 #5: 부모 삭제 시 답글의 parentCommentId 도 NULL 갱신 (DB ON DELETE SET NULL 과 일관).
    //   안 그러면 답글이 stale 한 parentCommentId 를 들고 있어 "원답글이 삭제된 답글" orphan 배지가 잘못 노출됨.
    applyCommentOpToCaches(
      { kind: 'delete', id: commentId },
      { commentId, action: 'delete', sceneId, alsoSheet: sheetName },
    );
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
    // 시트 묶음이 아직 없어도 파트 행이 캐시에 있으면 그 자리에서 만든다(서버 요청 없음).
    const store = sheetPartCache.get(sheetName) ?? buildSheetStoreFromCachedRows(sheetName);
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
    const row = rowCache.findById(commentId);
    if (row) {
      return {
        id: row.id, userId: row.userId, userName: row.userName, text: row.text,
        mentions: row.mentions ?? [], images: row.images, createdAt: row.createdAt,
        editedAt: row.editedAt || undefined, revisionId: row.revisionId ?? null,
        parentCommentId: row.parentCommentId ?? null,
      };
    }
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
  return (await fetchReactionsBulkResult(commentIds)).map;
}

/** 리액션 일괄 조회 — 실패를 빈 결과와 구분한다(댓글 패널이 '반응을 다 불러왔다'고 잘못 기억하지 않게, v1.145.0). */
export async function fetchReactionsBulkResult(commentIds: string[]): Promise<{ ok: boolean; map: Map<string, CommentReaction[]> }> {
  if (commentIds.length === 0) return { ok: true, map: new Map() };
  try {
    const raw = await window.electronAPI.supabaseGetCommentReactionsBulk(commentIds);
    const map = new Map<string, CommentReaction[]>();
    for (const [cid, list] of Object.entries(raw)) {
      map.set(cid, list as CommentReaction[]);
    }
    return { ok: true, map };
  } catch (err) {
    console.error('[commentService] fetchReactionsBulk 실패', err);
    return { ok: false, map: new Map() };
  }
}
