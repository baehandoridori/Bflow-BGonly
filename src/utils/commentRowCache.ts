/**
 * 씬 댓글 원본 행 캐시 — 파트(UUID)마다 서버에서 받은 댓글 행을 한 벌만 들고 있는다.
 *
 * 왜(씬 댓글 B안 인수인계 §7, 2026-11-04):
 *  - 같은 장면의 댓글은 BG·ACT 두 파트에 나뉘어 저장되고, 화면은 두 시트(EP05_A_BG·EP05_A_ACT) 어느 쪽에서 보든
 *    두 파트를 함께 읽는다. 시트별로 따로 캐시하면 '통합' 화면에서 같은 파트를 두 번 읽었다.
 *  - 댓글 하나가 추가·수정·삭제될 때마다 캐시를 통째로 비우고 다시 읽었다. 이제는 실시간·방송으로 받은 행을
 *    캐시에 끼워 넣기·바꾸기·빼기만 한다(재조회 없음).
 *  - 같은 파트를 여러 곳(패널·씬 목록·컴포지팅 카드)이 동시에 요청하면 진행 중인 요청 하나를 같이 기다린다.
 *    읽는 동안 도착한 변경은 모아 두었다가 결과에 덧씌운다(읽기 시작 전 상태를 받은 결과가 새 변경을 지우지 않게).
 *
 * 이 파일은 DOM·스토어·IPC 를 모른다(node --test 로 바로 검사). 연결은 services/commentService.ts.
 */

import type { Part } from '../types/index.ts';
import { normalizeSceneIdKey } from './sceneIdKey.ts';

/** 서버 댓글 한 행(씬 댓글). 캐릭터 댓글은 이 캐시에 들어오지 않는다. */
export interface CommentRow {
  id: string;
  /** 저장된 파트 UUID. */
  partId: string;
  /** 저장된 씬의 scene.no(정렬 번호) 문자열. */
  sceneId: string;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];
  images?: string[];
  createdAt: string;
  editedAt: string | null;
  revisionId?: string | null;
  parentCommentId?: string | null;
}

/** 댓글 화면이 쓰는 모양(services/commentService.ts SceneComment 와 같은 필드). */
export interface CommentStoreItem {
  id: string;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];
  images?: string[];
  createdAt: string;
  editedAt?: string;
  revisionId?: string | null;
  parentCommentId?: string | null;
  storageKey?: string;
}

export type CommentStoreMap = Record<string, CommentStoreItem[]>;

export type CommentRowOp =
  /** 전체 행을 안다 — 없으면 넣고, 있으면 바꾼다. */
  | { kind: 'upsert'; row: CommentRow }
  /** 일부 칸만 안다(수정 방송) — 있을 때만 바꾼다. */
  | { kind: 'patch'; id: string; fields: Partial<Omit<CommentRow, 'id'>> }
  /** 지운다. 답글의 부모 참조는 비운다(DB ON DELETE SET NULL 과 같게). */
  | { kind: 'delete'; id: string };

const COMPARED_FIELDS: readonly (keyof CommentRow)[] = [
  'partId', 'sceneId', 'userId', 'userName', 'text', 'createdAt', 'editedAt', 'revisionId', 'parentCommentId',
];

function sameStringList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) return true;
  // undefined(모름)와 [](없음)는 다르다 — 이미지 칸을 모르는 행이 실제 목록으로 바뀌면 바뀐 것이다.
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function sameRow(a: CommentRow, b: CommentRow): boolean {
  for (const key of COMPARED_FIELDS) {
    if ((a[key] ?? null) !== (b[key] ?? null)) return false;
  }
  return sameStringList(a.mentions, b.mentions) && sameStringList(a.images, b.images);
}

/**
 * 받은 내용이 이미 가진 것보다 오래됐는가(코덱스 1차 — 방송과 실시간은 따로 오므로 순서가 바뀔 수 있다).
 * 수정 시각(editedAt)으로만 판단한다: 가진 행이 수정됐는데 받은 쪽이 수정 전(없음)이거나 더 이른 수정이면 오래된 것.
 */
function isStaleAgainst(existing: CommentRow, incomingEditedAt: string | null | undefined): boolean {
  if (!existing.editedAt) return false;
  if (!incomingEditedAt) return true;
  const a = Date.parse(existing.editedAt);
  const b = Date.parse(incomingEditedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return b < a;
}

/** 행 목록에 변경 하나를 적용한다. 바뀐 게 없으면 같은 배열을 돌려준다(changed=false). */
export function applyCommentRowOp(rows: readonly CommentRow[], op: CommentRowOp): { rows: readonly CommentRow[]; changed: boolean } {
  if (op.kind === 'upsert') {
    const index = rows.findIndex((row) => row.id === op.row.id);
    if (index < 0) return { rows: [...rows, op.row], changed: true };
    if (sameRow(rows[index], op.row)) return { rows, changed: false };
    // 늦게 도착한 옛 스냅샷(예: 수정 뒤에 온 추가 방송)이 새 수정을 덮지 않게.
    if (isStaleAgainst(rows[index], op.row.editedAt)) return { rows, changed: false };
    const next = rows.slice();
    next[index] = op.row;
    return { rows: next, changed: true };
  }
  if (op.kind === 'patch') {
    const index = rows.findIndex((row) => row.id === op.id);
    if (index < 0) return { rows, changed: false };
    if (op.fields.editedAt !== undefined && isStaleAgainst(rows[index], op.fields.editedAt)) return { rows, changed: false };
    const merged: CommentRow = { ...rows[index], ...op.fields, id: op.id };
    if (sameRow(rows[index], merged)) return { rows, changed: false };
    const next = rows.slice();
    next[index] = merged;
    return { rows: next, changed: true };
  }
  let changed = false;
  const next: CommentRow[] = [];
  for (const row of rows) {
    if (row.id === op.id) { changed = true; continue; }
    if (row.parentCommentId === op.id) {
      changed = true;
      next.push({ ...row, parentCommentId: null });
      continue;
    }
    next.push(row);
  }
  return changed ? { rows: next, changed } : { rows, changed: false };
}

/** 이 변경이 어느 파트의 행을 건드릴 수 있는지(upsert 는 그 행의 파트, 나머지는 id 로 찾아야 한다). */
function opTouchesPart(op: CommentRowOp, partId: string, rows: readonly CommentRow[] | undefined): boolean {
  if (op.kind === 'upsert') {
    if (op.row.partId === partId) return true;
    // 다른 파트로 옮겨 간 행(드묾) — 예전 파트에 남은 같은 id 를 지운다.
    return !!rows?.some((row) => row.id === op.row.id);
  }
  if (!rows) return true; // 진행 중인 결과에는 아직 무엇이 들었는지 모른다 — 모아 두었다가 덧씌운다.
  return rows.some((row) => row.id === op.id || (op.kind === 'delete' && row.parentCommentId === op.id));
}

function opForPart(op: CommentRowOp, partId: string): CommentRowOp {
  // 다른 파트로 옮겨 간 upsert 는 예전 파트 입장에서는 '빼기'다.
  if (op.kind === 'upsert' && op.row.partId !== partId) return { kind: 'delete', id: op.row.id };
  return op;
}

export interface CommentRowCacheDeps {
  read: (partId: string) => Promise<CommentRow[]>;
}

export interface CommentRowCache {
  /** 캐시에 있으면 그 행들, 없으면 undefined(조회 시작 안 함). */
  peek(partId: string): readonly CommentRow[] | undefined;
  /** 캐시 → 진행 중인 요청 → 새 요청 순서. 같은 파트를 동시에 부르면 요청은 한 번. */
  load(partId: string): Promise<readonly CommentRow[]>;
  /** 변경 하나를 캐시와 진행 중인 요청에 적용한다. 캐시 행이 실제로 바뀐 파트 id 들을 돌려준다. */
  apply(op: CommentRowOp): string[];
  /** 파트 하나(또는 전부)를 버린다. 진행 중인 요청의 결과는 부른 쪽에는 가지만 캐시에는 남지 않는다. */
  invalidate(partId?: string): void;
  /** 캐시 전체에서 id 로 찾는다(동기). */
  findById(id: string): CommentRow | undefined;
}

export function createCommentRowCache(deps: CommentRowCacheDeps): CommentRowCache {
  const rowsByPart = new Map<string, readonly CommentRow[]>();
  const inFlight = new Map<string, { promise: Promise<readonly CommentRow[]>; pending: CommentRowOp[] }>();
  const epochByPart = new Map<string, number>();
  let globalEpoch = 0;
  // 지운 댓글 id(세션 동안, 상한) — 삭제 뒤에 늦게 온 추가 신호나 삭제 전에 시작한 조회 결과가 되살리지 않게(코덱스 1차).
  const deletedIds = new Set<string>();
  const DELETED_LIMIT = 2000;
  const rememberDeleted = (id: string) => {
    deletedIds.add(id);
    if (deletedIds.size > DELETED_LIMIT) {
      const first = deletedIds.values().next().value;
      if (first !== undefined) deletedIds.delete(first);
    }
  };
  const withoutDeleted = (rows: readonly CommentRow[]): readonly CommentRow[] => (
    deletedIds.size > 0 && rows.some((row) => deletedIds.has(row.id))
      ? rows.filter((row) => !deletedIds.has(row.id))
      : rows
  );

  const epochOf = (partId: string) => `${globalEpoch}:${epochByPart.get(partId) ?? 0}`;

  return {
    peek(partId) {
      return rowsByPart.get(partId);
    },

    load(partId) {
      const cached = rowsByPart.get(partId);
      if (cached) return Promise.resolve(cached);
      const running = inFlight.get(partId);
      if (running) return running.promise;
      const startedEpoch = epochOf(partId);
      const pending: CommentRowOp[] = [];
      let entry: { promise: Promise<readonly CommentRow[]>; pending: CommentRowOp[] } | null = null;
      const promise = deps.read(partId).then((fetched) => {
        let rows: readonly CommentRow[] = Array.isArray(fetched) ? fetched : [];
        for (const op of pending) rows = applyCommentRowOp(rows, opForPart(op, partId)).rows;
        rows = withoutDeleted(rows);
        if (inFlight.get(partId) === entry) inFlight.delete(partId);
        if (epochOf(partId) === startedEpoch) rowsByPart.set(partId, rows);
        return rows;
      }, (error: unknown) => {
        if (inFlight.get(partId) === entry) inFlight.delete(partId);
        throw error;
      });
      entry = { promise, pending };
      inFlight.set(partId, entry);
      return promise;
    },

    apply(op) {
      if (op.kind === 'delete') rememberDeleted(op.id);
      else if (op.kind === 'upsert' && deletedIds.has(op.row.id)) return [];
      const changedParts: string[] = [];
      for (const [partId, rows] of rowsByPart) {
        if (!opTouchesPart(op, partId, rows)) continue;
        const result = applyCommentRowOp(rows, opForPart(op, partId));
        if (!result.changed) continue;
        rowsByPart.set(partId, result.rows);
        changedParts.push(partId);
      }
      for (const [partId, entry] of inFlight) {
        if (op.kind === 'upsert' && op.row.partId !== partId) continue;
        entry.pending.push(op);
      }
      return changedParts;
    },

    invalidate(partId) {
      if (partId) {
        rowsByPart.delete(partId);
        epochByPart.set(partId, (epochByPart.get(partId) ?? 0) + 1);
        inFlight.delete(partId);
        return;
      }
      rowsByPart.clear();
      inFlight.clear();
      globalEpoch += 1;
    },

    findById(id) {
      for (const rows of rowsByPart.values()) {
        const found = rows.find((row) => row.id === id);
        if (found) return found;
      }
      return undefined;
    },
  };
}

/** BG↔ACT 상대 sheetName. 같은 장면의 댓글을 양쪽 탭에서 공유하기 위해 사용. */
export function getCounterpartSheetName(sheetName: string): string | null {
  if (sheetName.endsWith('_BG')) return sheetName.slice(0, -3) + '_ACT';
  if (sheetName.endsWith('_ACT')) return sheetName.slice(0, -4) + '_BG';
  return null;
}

export function getRelatedSheetNames(sheetName: string): string[] {
  const counterpart = getCounterpartSheetName(sheetName);
  return counterpart ? [sheetName, counterpart] : [sheetName];
}

/**
 * 댓글 row 를 요청된 시트 기준 scene.no 문자열로 바꾼다. 맞는 씬이 없으면 null(건너뜀).
 *
 * Codex P1 3차(2026-04-23): 정규화만으로 매칭하면 alias-collision(예: `a001`·`ac001` 이 같은 키) 때 상대 부서 댓글이
 * 다른 물리 씬에 붙을 수 있다. 순서:
 *   1) 원본 scene_number(lowercase) 정확 매칭
 *   2) 정규화 매칭 — 요청 파트에 같은 정규화 씬이 '하나'일 때만. 둘 이상이면 건너뜀.
 */
export function mapCommentRowToRequestedSceneNo(
  row: Pick<CommentRow, 'partId' | 'sceneId'>,
  requestedPart: Part | undefined,
  partByUuid: ReadonlyMap<string, Part>,
): string | null {
  if (!requestedPart) return row.sceneId;
  const sourcePart = row.partId ? partByUuid.get(row.partId) : undefined;
  if (!sourcePart || sourcePart.id === requestedPart.id) return row.sceneId;

  const sourceScene = sourcePart.scenes.find((scene) => String(scene.no) === String(row.sceneId));
  if (!sourceScene) return null;

  const sourceSceneNumber = (sourceScene.sceneId || '').trim().toLowerCase();
  if (sourceSceneNumber) {
    const exactMatch = requestedPart.scenes.find(
      (scene) => (scene.sceneId || '').trim().toLowerCase() === sourceSceneNumber,
    );
    if (exactMatch) return String(exactMatch.no);
  }

  const normalizedSource = normalizeSceneIdKey(sourceScene.sceneId, sourcePart.partId);
  if (!normalizedSource) return null;
  const normalizedMatches = requestedPart.scenes.filter(
    (scene) => normalizeSceneIdKey(scene.sceneId, requestedPart.partId) === normalizedSource,
  );
  if (normalizedMatches.length === 1) return String(normalizedMatches[0].no);
  return null;
}

/** 관련 파트들의 행으로 요청 시트의 `{ sceneKey → 댓글[] }` 를 만든다. 같은 id 는 한 번만. */
export function buildSheetCommentStore(
  sheetName: string,
  rowLists: readonly (readonly CommentRow[])[],
  requestedPart: Part | undefined,
  partByUuid: ReadonlyMap<string, Part>,
): CommentStoreMap {
  const store: CommentStoreMap = {};
  const seenIds = new Set<string>();
  for (const rows of rowLists) {
    for (const row of rows) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      const targetSceneNo = mapCommentRowToRequestedSceneNo(row, requestedPart, partByUuid);
      if (targetSceneNo == null) continue;
      const key = `${sheetName}:${targetSceneNo}`;
      if (!store[key]) store[key] = [];
      // 실제 저장 위치(답글을 부모와 같은 시트에 쓰기 위해). 파트를 모르면 비워 두고 호출자가 sceneKey 로 대신한다.
      const sourcePart = row.partId ? partByUuid.get(row.partId) : undefined;
      store[key].push({
        id: row.id,
        userId: row.userId,
        userName: row.userName,
        text: row.text,
        mentions: row.mentions ?? [],
        // undefined 면 그대로 — 수정 때 실제 이미지 주소를 빈 배열로 덮지 않게.
        images: row.images,
        createdAt: row.createdAt,
        editedAt: row.editedAt || undefined,
        revisionId: row.revisionId ?? null,
        parentCommentId: row.parentCommentId ?? null,
        storageKey: sourcePart?.sheetName ? `${sourcePart.sheetName}:${row.sceneId}` : undefined,
      });
    }
  }
  return store;
}

/** 파트 행에서 scene.no 별 댓글 수(컴포지팅 카드 배지). */
export function countCommentRowsByScene(rows: readonly CommentRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = String(row.sceneId ?? '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// ─── 실시간·방송으로 받은 변경 정리 ─────────────────────────

type UnknownRecord = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function strList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

/** 받은 댓글 변경을 캐시 적용 단위로 정리한 결과. */
export type RemoteCommentChange =
  | { kind: 'op'; op: CommentRowOp; partId: string | null; commentId: string; action: 'add' | 'edit' | 'delete' }
  /** 캐릭터 댓글 — 씬 캐시와 무관, 그 캐릭터 화면만 다시 읽는다. */
  | { kind: 'character'; characterId: string; commentId: string | null; action: 'add' | 'edit' | 'delete' }
  /** 끼워 넣을 만큼 내용을 모른다(예전 버전이 보낸 방송) — 그 파트만 다시 읽게 한다. partId 도 모르면 전체. */
  | { kind: 'invalidate'; partId: string | null; commentId: string | null; action: 'add' | 'edit' | 'delete' }
  | { kind: 'ignore' };

/** DB 행(snake_case) → CommentRow. 씬 댓글에 필요한 칸이 빠졌으면 null. */
export function commentRowFromDbRecord(record: unknown): CommentRow | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as UnknownRecord;
  const id = str(r.id);
  const partId = str(r.part_id);
  const sceneId = r.scene_id == null ? null : String(r.scene_id);
  const createdAt = str(r.created_at);
  if (!id || !partId || !sceneId || !createdAt) return null;
  return {
    id,
    partId,
    sceneId,
    userId: str(r.user_id) ?? '',
    userName: str(r.user_name) ?? '',
    text: typeof r.text === 'string' ? r.text : '',
    mentions: strList(r.mentions) ?? [],
    images: strList(r.images) ?? [],
    createdAt,
    editedAt: str(r.edited_at),
    revisionId: str(r.revision_id),
    parentCommentId: str(r.parent_comment_id),
  };
}

/** Supabase 실시간(postgres_changes) comments 이벤트 정리. */
export function normalizeRealtimeCommentChange(payload: unknown): RemoteCommentChange {
  if (!payload || typeof payload !== 'object') return { kind: 'ignore' };
  const p = payload as UnknownRecord;
  const eventType = p.eventType;
  const next = (p.new && typeof p.new === 'object' ? p.new : null) as UnknownRecord | null;
  const old = (p.old && typeof p.old === 'object' ? p.old : null) as UnknownRecord | null;
  const characterId = str(next?.character_id) ?? str(old?.character_id);
  const action = eventType === 'INSERT' ? 'add' : eventType === 'UPDATE' ? 'edit' : eventType === 'DELETE' ? 'delete' : null;
  if (!action) return { kind: 'ignore' };
  const commentId = str(next?.id) ?? str(old?.id);
  if (characterId) return { kind: 'character', characterId, commentId, action };
  if (action === 'delete') {
    if (!commentId) return { kind: 'invalidate', partId: str(old?.part_id), commentId: null, action };
    return { kind: 'op', op: { kind: 'delete', id: commentId }, partId: str(old?.part_id), commentId, action };
  }
  const row = commentRowFromDbRecord(next);
  if (!row) return { kind: 'invalidate', partId: str(next?.part_id), commentId, action };
  return { kind: 'op', op: { kind: 'upsert', row }, partId: row.partId, commentId: row.id, action };
}

/**
 * 댓글 방송(comment-added / comment-updated / comment-deleted) 정리.
 * comment-added 는 v1.145.0 부터 images·createdAt 을 싣는다. 그 전 버전이 보낸 방송이면 끼워 넣지 못하니 그 파트만 다시 읽는다.
 */
export function normalizeCommentBroadcastChange(event: string, payload: unknown): RemoteCommentChange {
  if (!payload || typeof payload !== 'object') return { kind: 'ignore' };
  const p = payload as UnknownRecord;
  const commentId = str(p.commentId);
  const partId = str(p.partId);
  const sceneId = p.sceneId == null ? null : String(p.sceneId);
  const characterId = str(p.characterId)
    ?? (sceneId && sceneId.startsWith('char:') ? sceneId.slice('char:'.length) || null : null);

  if (event === 'comment-added') {
    if (characterId) return { kind: 'character', characterId, commentId, action: 'add' };
    const createdAt = str(p.createdAt);
    const images = strList(p.images);
    if (!commentId || !partId || !sceneId || !createdAt || !images) {
      return { kind: 'invalidate', partId, commentId, action: 'add' };
    }
    return {
      kind: 'op',
      op: {
        kind: 'upsert',
        row: {
          id: commentId,
          partId,
          sceneId,
          userId: str(p.userId) ?? '',
          userName: str(p.userName) ?? '',
          text: typeof p.text === 'string' ? p.text : '',
          mentions: strList(p.mentions) ?? [],
          images,
          createdAt,
          editedAt: null,
          revisionId: str(p.revisionId),
          parentCommentId: str(p.parentCommentId),
        },
      },
      partId,
      commentId,
      action: 'add',
    };
  }

  if (event === 'comment-updated') {
    if (characterId) return { kind: 'character', characterId, commentId, action: 'edit' };
    if (!commentId) return { kind: 'invalidate', partId, commentId: null, action: 'edit' };
    const fields: Partial<Omit<CommentRow, 'id'>> = {};
    if (typeof p.text === 'string') fields.text = p.text;
    const mentions = strList(p.mentions);
    if (mentions) fields.mentions = mentions;
    const images = strList(p.images);
    if (images) fields.images = images;
    const editedAt = str(p.editedAt);
    if (editedAt) fields.editedAt = editedAt;
    if (fields.text === undefined) return { kind: 'invalidate', partId, commentId, action: 'edit' };
    return { kind: 'op', op: { kind: 'patch', id: commentId, fields }, partId, commentId, action: 'edit' };
  }

  if (event === 'comment-deleted') {
    if (characterId) return { kind: 'character', characterId, commentId, action: 'delete' };
    if (!commentId) return { kind: 'invalidate', partId, commentId: null, action: 'delete' };
    return { kind: 'op', op: { kind: 'delete', id: commentId }, partId, commentId, action: 'delete' };
  }

  return { kind: 'ignore' };
}

// ─── 'bflow:comments-invalidated' 신호 ─────────────────────

export interface CommentsInvalidatedDetail {
  /** 바뀐 댓글이 저장된 시트(대표). */
  sheetName?: string;
  /** 영향을 받은 시트 전부(상대 부서 포함). */
  sheetNames?: string[];
  /** 영향을 받은 파트 UUID. */
  partIds?: string[];
  sceneId?: string;
  characterId?: string;
  commentId?: string;
  commentAction?: 'add' | 'edit' | 'delete';
  /** 캐시를 그 자리에서 고쳤다 — 듣는 쪽은 캐시만 다시 보면 된다(반응 같은 곁 자료는 다시 읽지 않는다). */
  patched?: boolean;
  /**
   * 실시간 DELETE(기본 키만 실림)가 씬 캐시 어디에도 없던 댓글을 지웠다 — 캐릭터 댓글일 수 있다.
   * 그 댓글을 지금 보여 주는 화면(knownCommentIds)과 캐릭터 배지만 반응한다.
   */
  unresolvedDelete?: boolean;
}

/**
 * 이 신호가 듣는 쪽(씬 시트 몇 개 또는 캐릭터 하나)과 관계있는가.
 * 시트도 캐릭터도 없는 신호는 '전부 다시'라 모두와 관계있다.
 */
export function isCommentsInvalidationRelevant(
  detail: CommentsInvalidatedDetail | null | undefined,
  target: {
    sheetNames?: readonly (string | null | undefined)[];
    characterId?: string | null;
    partIds?: readonly (string | null | undefined)[];
    /** 지금 보여 주는 댓글 id — 어디 것인지 모르는 삭제 신호에만 쓴다. */
    knownCommentIds?: ReadonlySet<string> | null;
  },
): boolean {
  if (!detail) return true;
  if (detail.unresolvedDelete) return !!detail.commentId && !!target.knownCommentIds?.has(detail.commentId);
  const changedSheets = [
    ...(detail.sheetNames ?? []),
    ...(detail.sheetName ? [detail.sheetName] : []),
  ];
  const changedParts = detail.partIds ?? [];
  if (!detail.characterId && changedSheets.length === 0 && changedParts.length === 0) return true;
  if (detail.characterId) return !!target.characterId && target.characterId === detail.characterId;
  if (target.characterId && !target.sheetNames?.length && !target.partIds?.length) return false;
  const watchedParts = (target.partIds ?? []).filter((id): id is string => !!id);
  if (watchedParts.some((id) => changedParts.includes(id))) return true;
  const related = new Set<string>();
  for (const sheet of changedSheets) for (const name of getRelatedSheetNames(sheet)) related.add(name);
  return (target.sheetNames ?? []).some((sheet) => !!sheet && related.has(sheet));
}
