// BAE경 9단계 '코멘트': 기록 한 건 = 댓글 스레드 하나(스레드 이름 bae:{작업 id}). 서버(DEVLOG/migrations/2026-11-16-bae-gyeong-comments.sql)의 짝.
// 화면 · 메인 · 테스트 모드가 같이 쓰는 모양 · 검사 · 이름 규칙. node --test 가 바로 읽을 수 있게 값 import 가 없다 (DOM · Electron · '@/' 없이).
//
// 경계: BAE 댓글은 Bflow 의 comments 표에 칸 하나(bae_job_id)로 들어가지만, 그 줄은 표에서 보이지 않는다(RESTRICTIVE 정책).
// 읽고 쓰는 길은 세션 래퍼(bae_gyeong_session_comment_*)뿐이고, 만든 사람과 검수자(관리자 포함)만 그 스레드를 본다.
// 그래서 씬 댓글의 실시간 행 · 'comment-added' 방송 · 행 캐시를 타지 않는다 — 내용 없는 'comments-changed' 신호 → 다시 읽기.

/** CommentPanel 이 쓰는 저장 키(씬 'EP01_A_BG:3', 캐릭터 'char:{id}' 와 같은 자리). */
export const BAE_COMMENT_KEY_PREFIX = 'bae:';
/** BAE 댓글 id 의 앞글자 — 서버 CHECK 와 반응 표 정책이 이것으로 BAE 댓글을 알아본다. */
export const BAE_COMMENT_ID_PREFIX = 'baec_';
export const BAE_COMMENT_TEXT_MAX = 5000;
export const BAE_COMMENT_IMAGES_MAX = 10;
export const BAE_COMMENT_MENTIONS_MAX = 30;
/** 창끼리 '이 기록의 코멘트가 바뀌었다'를 알리는 화면 이벤트(씬 댓글의 'bflow:comments-invalidated' 와 따로 — 씬 화면들이 듣지 않게). */
export const BAE_COMMENTS_INVALIDATED_EVENT = 'bflow:bae-comments-invalidated';

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COMMENT_ID_RE = /^baec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isBaeCommentJobId = (v: unknown): v is string => typeof v === 'string' && JOB_ID_RE.test(v);
export const isBaeCommentId = (v: unknown): v is string => typeof v === 'string' && COMMENT_ID_RE.test(v);
/** 댓글 id 가 BAE 댓글의 것인가(앞글자만 — 반응 · 지우기를 BAE 길로 보낼지 정할 때). */
export const looksLikeBaeCommentId = (v: unknown): boolean => typeof v === 'string' && v.startsWith(BAE_COMMENT_ID_PREFIX);

export function buildBaeCommentKey(jobId: string): string {
  return `${BAE_COMMENT_KEY_PREFIX}${jobId}`;
}
export function isBaeCommentKey(key: unknown): key is string {
  return typeof key === 'string' && key.startsWith(BAE_COMMENT_KEY_PREFIX);
}
/** 'bae:{작업 id}' → 작업 id. 모양이 다르면 null. */
export function parseBaeCommentKey(key: unknown): string | null {
  if (!isBaeCommentKey(key)) return null;
  const id = key.slice(BAE_COMMENT_KEY_PREFIX.length);
  return isBaeCommentJobId(id) ? id : null;
}
/** 새 댓글 id: 'baec_' + UUID(소문자). */
export function newBaeCommentId(uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error('댓글 번호를 만들지 못했어요.');
  return `${BAE_COMMENT_ID_PREFIX}${uuid.toLowerCase()}`;
}

export interface BaeCommentRow {
  id: string;
  baeJobId: string;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];
  images: string[];
  parentCommentId: string | null;
  createdAt: string;
  editedAt: string | null;
}
/** 이 스레드를 읽을 수 있는 사람(만든 사람 · 검수자 · 관리자) — @ 목록과 슬랙 받는 사람을 여기서 고른다. */
export interface BaeCommentPerson { id: string; name: string }
export interface BaeCommentThread {
  comments: BaeCommentRow[];
  audience: BaeCommentPerson[];
  /** 남의 댓글도 지울 수 있다(Bflow 관리자). */
  canModerate: boolean;
}
export interface BaeCommentReaction { id: string; commentId: string; userId: string; userName: string; emoji: string; createdAt: string }
/** 새 댓글 저장 결과: 저장된 줄, @ 가 닿은 사람(쓴 사람 빼고 — 슬랙), 같은 번호를 다시 보낸 것이었나. */
export interface BaeCommentAddResult { comment: BaeCommentRow; mentioned: string[]; duplicate: boolean }
export interface BaeCommentEditResult { comment: BaeCommentRow; addedMentioned: string[] }
export interface BaeCommentDeleteResult { deleted: boolean; images: string[] }
/** 화면 → 메인으로 보내는 새 댓글(누가 · 언제는 서버가 정한다). */
export interface BaeCommentDraft { id: string; text: string; mentions: string[]; images: string[]; parentCommentId: string | null }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);
const iso = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

/** 서버가 돌려준 댓글 한 줄 — 모양이 다르면 null(버린다). */
export function parseBaeCommentRow(v: unknown): BaeCommentRow | null {
  const r = obj(v);
  const createdAt = iso(r.createdAt);
  if (!isBaeCommentId(r.id) || !isBaeCommentJobId(r.baeJobId) || !str(r.userId) || !createdAt) return null;
  return {
    id: r.id, baeJobId: r.baeJobId, userId: r.userId as string, userName: str(r.userName) ?? '', text: str(r.text) ?? '',
    mentions: strings(r.mentions), images: strings(r.images),
    parentCommentId: str(r.parentCommentId) || null, createdAt, editedAt: iso(r.editedAt),
  };
}
const rows = (v: unknown): BaeCommentRow[] => (Array.isArray(v) ? v.map(parseBaeCommentRow).filter((x): x is BaeCommentRow => !!x) : []);
const people = (v: unknown): BaeCommentPerson[] => (Array.isArray(v)
  ? v.map(obj).filter((p) => typeof p.id === 'string' && p.id && typeof p.name === 'string').map((p) => ({ id: p.id as string, name: p.name as string }))
  : []);

export function parseBaeCommentThread(v: unknown): BaeCommentThread {
  const r = obj(v);
  if (!Array.isArray(r.comments)) throw new Error('BAE경 코멘트 응답이 올바르지 않아요.');
  return { comments: rows(r.comments), audience: people(r.audience), canModerate: r.canModerate === true };
}
export function parseBaeCommentAdd(v: unknown): BaeCommentAddResult {
  const r = obj(v);
  const comment = parseBaeCommentRow(r.comment);
  if (!comment) throw new Error('BAE경 코멘트 저장 응답이 올바르지 않아요.');
  return { comment, mentioned: strings(r.mentioned), duplicate: r.duplicate === true };
}
export function parseBaeCommentEdit(v: unknown): BaeCommentEditResult {
  const r = obj(v);
  const comment = parseBaeCommentRow(r.comment);
  if (!comment) throw new Error('BAE경 코멘트 수정 응답이 올바르지 않아요.');
  return { comment, addedMentioned: strings(r.addedMentioned) };
}
export function parseBaeCommentDelete(v: unknown): BaeCommentDeleteResult {
  const r = obj(v);
  return { deleted: r.deleted === true, images: strings(r.images) };
}
export function parseBaeCommentReactions(v: unknown): BaeCommentReaction[] {
  if (!Array.isArray(v)) return [];
  return v.map(obj).filter((x) => typeof x.id === 'string' && isBaeCommentId(x.commentId) && typeof x.userId === 'string' && typeof x.emoji === 'string')
    .map((x) => ({ id: x.id as string, commentId: x.commentId as string, userId: x.userId as string, userName: str(x.userName) ?? '', emoji: x.emoji as string, createdAt: str(x.createdAt) ?? '' }));
}
export function parseBaeCommentReactionMap(v: unknown): Record<string, BaeCommentReaction[]> {
  const out: Record<string, BaeCommentReaction[]> = {};
  for (const [id, list] of Object.entries(obj(v))) if (isBaeCommentId(id)) out[id] = parseBaeCommentReactions(list);
  return out;
}

/** 화면이 보낸 새 댓글의 문제(없으면 null). 서버도 다시 본다 — 여기서는 모양만. */
export function baeCommentDraftProblem(v: unknown): string | null {
  const d = obj(v);
  if (!isBaeCommentId(d.id)) return '댓글 번호가 올바르지 않아요.';
  return baeCommentBodyProblem(d.text, d.mentions, d.images ?? [])
    ?? (d.parentCommentId !== null && d.parentCommentId !== undefined && !isBaeCommentId(d.parentCommentId) ? '답글을 달 댓글이 올바르지 않아요.' : null);
}
/** 글 · @ 이름 · 그림 주소의 모양(수정에도 쓴다). images 가 null 이면 그림은 그대로 둔다는 뜻. */
export function baeCommentBodyProblem(text: unknown, mentions: unknown, images: unknown): string | null {
  if (typeof text !== 'string') return '댓글 내용이 올바르지 않아요.';
  if (text.length > BAE_COMMENT_TEXT_MAX) return `댓글은 ${BAE_COMMENT_TEXT_MAX}자까지 쓸 수 있어요.`;
  if (!Array.isArray(mentions) || mentions.length > BAE_COMMENT_MENTIONS_MAX || !mentions.every((m) => typeof m === 'string' && m.length >= 1 && m.length <= 100)) return '댓글의 멘션이 올바르지 않아요.';
  // 그림 주소: 앱은 저장소의 공개 주소(https — 서버가 bae/{작업 id}/comments/ 자리인지 다시 본다), 테스트 모드는 가짜 주소(mock://).
  if (images !== null && (!Array.isArray(images) || images.length > BAE_COMMENT_IMAGES_MAX
    || !images.every((u) => typeof u === 'string' && /^(https?|mock):\/\/\S+$/.test(u) && u.length <= 1000))) return '댓글 그림이 올바르지 않아요.';
  if (!text.trim() && (!Array.isArray(images) || images.length === 0) && images !== null) return '댓글 내용을 적어 주세요.';
  return null;
}
/** 반응 하나의 모양(이모지 1~32자, 공백 없음). */
export function baeCommentEmojiProblem(emoji: unknown): string | null {
  return typeof emoji === 'string' && emoji.length >= 1 && emoji.length <= 32 && !/[\s\p{Cc}]/u.test(emoji) ? null : '반응이 올바르지 않아요.';
}

/** 슬랙 · 알림에 쓰는 기록 이름(이름이 없으면 '이름 없는 기록'). */
export function baeCommentPlaceLabel(jobName: string | null | undefined): string {
  const name = (jobName ?? '').replace(/\s+/g, ' ').trim();
  return name ? `BAE경 · ${name.length > 40 ? `${name.slice(0, 40)}…` : name}` : 'BAE경 기록';
}

/** @ 이름 중 이 스레드를 읽을 수 있는 사람의 id(쓴 사람 빼고) — 서버의 bae_gyeong_comment_reached 와 같은 규칙. */
export function baeMentionedPeople(names: readonly string[], audience: readonly BaeCommentPerson[], writerId: string): string[] {
  const wanted = new Set(names);
  return [...new Set(audience.filter((p) => wanted.has(p.name) && p.id !== writerId).map((p) => p.id))].sort();
}
