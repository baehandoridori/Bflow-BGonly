/**
 * 씬 댓글 서버 알림(씬 댓글 B안 PR 6 · 인수인계서 §10) — main·렌더러·미리보기가 같이 쓰는 줄 모양과 입력 검사.
 *
 * 줄은 서버 트리거가 댓글 저장 순간에 만든다(DEVLOG/migrations/2026-11-05-comment-notifications.sql).
 * 앱은 세션 래퍼로 내 줄만 읽는다 — main 은 토큰을, 렌더러는 커서·댓글 id 만 다룬다.
 * 런타임 import 가 없어 node --test 가 바로 불러 쓴다.
 */

export type CommentNotificationReason = 'mention' | 'reply' | 'retake' | 'auto';
export type CommentNotificationDetail = 'assignee' | 'counterpart' | 'participant';
export type CommentNotificationKind = 'add' | 'edit';

/** 줄과 함께 오는 댓글 내용(앱이 스토어 없이도 제목·본문·이동 정보를 만든다). */
export interface CommentNotificationComment {
  partId: string | null;
  /** comments.scene_id = 씬 순서(sort_order) 글자. */
  sceneId: string | null;
  sceneUuid: string | null;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];
  imageCount: number;
  parentCommentId: string | null;
  revisionId: string | null;
  characterId: string | null;
  createdAt: string | null;
  editedAt: string | null;
}

export interface CommentNotificationRow {
  id: string;
  commentId: string;
  kind: CommentNotificationKind;
  reason: CommentNotificationReason;
  detail: CommentNotificationDetail | null;
  /** 서버 시각 — 목록 커서. */
  eventAt: string;
  /** 수정 줄: 그 수정의 시각(수정 방송의 editedAt 과 같은 값). 새 댓글 줄은 null. */
  editAt: string | null;
  /** 다른 PC 에서 읽었으면 그 시각. */
  readAt: string | null;
  revisionNo: number | null;
  comment: CommentNotificationComment;
}

/** (서버 시각, 줄 id) 커서. id 가 없으면 '그 시각보다 뒤'. */
export interface CommentNotificationCursor {
  at: string;
  id: string | null;
}

/** available=false 면 서버에 알림 줄이 아직 없다(DB 적용 전) — 앱은 예전 길로 간다. */
export interface CommentNotificationListResult {
  available: boolean;
  rows: CommentNotificationRow[];
}

export interface CommentNotificationReadTarget {
  /** 새 댓글 알림의 댓글 id. */
  addCommentIds: string[];
  /** 수정으로 넣은 @ 알림의 댓글 id. */
  editCommentIds: string[];
}

export interface CommentNotificationReadResult {
  available: boolean;
  updated: number;
}

/** 요청한 세션이 응답 전에 바뀌었다 — 화면은 이 응답을 버린다(서버엔 반영됐을 수 있다). */
export const COMMENT_NOTIFICATION_RESPONSE_DISCARDED = '로그인 세션이 바뀌어 알림 응답을 버렸어요.';
export const COMMENT_NOTIFICATION_LIST_LIMIT = 200;
export const COMMENT_NOTIFICATION_READ_LIMIT = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** comments.id 는 앱이 만든 UUID 지만 예전 행·미리보기 시드는 다른 글자도 쓴다 — 길이·글자만 본다. */
const COMMENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const REASONS: readonly string[] = ['mention', 'reply', 'retake', 'auto'];
const DETAILS: readonly string[] = ['assignee', 'counterpart', 'participant'];

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const isoText = (value: unknown): string | null => {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : null;
};

export function isCommentNotificationCommentId(value: unknown): value is string {
  return typeof value === 'string' && COMMENT_ID_RE.test(value);
}

/** 서버가 돌려준 줄 하나 — 모양이 다르면 버린다(null). */
export function parseCommentNotificationRow(raw: unknown): CommentNotificationRow | null {
  if (!isRecord(raw) || !isRecord(raw.comment)) return null;
  const id = text(raw.id);
  const commentId = text(raw.commentId);
  const eventAt = isoText(raw.eventAt);
  if (!id || !UUID_RE.test(id) || !commentId || !eventAt) return null;
  if (raw.kind !== 'add' && raw.kind !== 'edit') return null;
  if (typeof raw.reason !== 'string' || !REASONS.includes(raw.reason)) return null;
  const detail = raw.detail == null ? null : (typeof raw.detail === 'string' && DETAILS.includes(raw.detail) ? raw.detail : undefined);
  if (detail === undefined) return null;
  if ((raw.reason === 'auto') !== (detail !== null)) return null;
  const c = raw.comment;
  const userId = text(c.userId);
  if (!userId) return null;
  return {
    id,
    commentId,
    kind: raw.kind,
    reason: raw.reason as CommentNotificationReason,
    detail: detail as CommentNotificationDetail | null,
    eventAt,
    editAt: isoText(raw.editAt),
    readAt: isoText(raw.readAt),
    revisionNo: typeof raw.revisionNo === 'number' && Number.isFinite(raw.revisionNo) ? raw.revisionNo : null,
    comment: {
      partId: text(c.partId),
      sceneId: c.sceneId == null ? null : String(c.sceneId),
      sceneUuid: text(c.sceneUuid),
      userId,
      userName: typeof c.userName === 'string' ? c.userName : '',
      text: typeof c.text === 'string' ? c.text : '',
      mentions: Array.isArray(c.mentions) ? c.mentions.filter((name): name is string => typeof name === 'string' && name !== '') : [],
      imageCount: typeof c.imageCount === 'number' && Number.isFinite(c.imageCount) && c.imageCount > 0 ? Math.floor(c.imageCount) : 0,
      parentCommentId: text(c.parentCommentId),
      revisionId: text(c.revisionId),
      characterId: text(c.characterId),
      createdAt: isoText(c.createdAt),
      editedAt: isoText(c.editedAt),
    },
  };
}

export function parseCommentNotificationRows(raw: unknown): CommentNotificationRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: CommentNotificationRow[] = [];
  for (const item of raw) {
    const row = parseCommentNotificationRow(item);
    if (row) rows.push(row);
  }
  return rows;
}

/** IPC 로 온 커서 — 없거나(null) 올바른 것만. 이상하면 던진다. */
export function validateCommentNotificationCursor(raw: unknown): CommentNotificationCursor | null {
  if (raw == null) return null;
  if (!isRecord(raw)) throw new Error('알림 커서가 올바르지 않습니다.');
  const at = isoText(raw.at);
  if (!at || at.length > 64) throw new Error('알림 커서가 올바르지 않습니다.');
  const id = raw.id == null ? null : text(raw.id);
  if (id !== null && !UUID_RE.test(id)) throw new Error('알림 커서가 올바르지 않습니다.');
  return { at, id };
}

/** IPC 로 온 읽음 대상 — 댓글 id 만, 합쳐 500개까지. 이상하면 던진다. */
export function validateCommentNotificationReadTarget(raw: unknown): CommentNotificationReadTarget {
  if (!isRecord(raw)) throw new Error('읽음 대상이 올바르지 않습니다.');
  const list = (value: unknown): string[] => {
    if (value == null) return [];
    if (!Array.isArray(value) || !value.every(isCommentNotificationCommentId)) throw new Error('읽음 대상이 올바르지 않습니다.');
    return [...new Set(value as string[])];
  };
  const target = { addCommentIds: list(raw.addCommentIds), editCommentIds: list(raw.editCommentIds) };
  if (target.addCommentIds.length + target.editCommentIds.length > COMMENT_NOTIFICATION_READ_LIMIT) {
    throw new Error('한 번에 읽음으로 바꿀 수 있는 알림은 500개까지예요.');
  }
  return target;
}
