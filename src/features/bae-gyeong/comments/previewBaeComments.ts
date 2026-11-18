/**
 * 테스트 모드(?preview=1)의 BAE경 기록 코멘트 저장소 — 서버(bae_gyeong_session_comment_* · DEVLOG/migrations/2026-11-16-bae-gyeong-comments.sql)와 같은 규칙:
 *   - 읽고 쓰기는 그 기록을 만든 사람과 검수자(관리자 + 'BAE경 검수자')만. 다른 사람은 서버와 같은 문구로 거절.
 *   - 새 댓글 번호는 'baec_' + UUID, 같은 번호를 같은 사람이 다시 보내면 같은 댓글, 다른 사람이면 충돌.
 *   - @ 이름은 스레드를 읽을 수 있는 사람만 남기고, 고치기는 쓴 사람만, 지우기는 쓴 사람 또는 관리자.
 *   - 알림 줄은 씬 댓글 미리보기 알림 저장소(commentNotificationPreviewStore)에 같은 규칙의 짝으로 만든다 — 종이 서버처럼 뜬다.
 * 기록 · 명단은 BAE경 테스트 모드 저장소(previewGateway)의 localStorage 자리를 읽기만 한다. 다른 창에는 BroadcastChannel 로 '바뀌었다'만.
 * node --test 가 바로 읽을 수 있게 '@/' 별칭을 쓰지 않는다.
 */
import {
  BAE_COMMENT_ID_PREFIX, baeCommentBodyProblem, baeCommentDraftProblem, baeCommentEmojiProblem, isBaeCommentId, isBaeCommentJobId,
  type BaeCommentAddResult, type BaeCommentDeleteResult, type BaeCommentDraft, type BaeCommentEditResult, type BaeCommentPerson,
  type BaeCommentReaction, type BaeCommentRow, type BaeCommentThread,
} from '../../../shared/bae/comments.ts';
import type { CommentNotificationComment } from '../../../shared/commentNotification.ts';
import type { RecipientWorld } from '../../../shared/commentNotificationRecipients.ts';
import type { BaeCommentsGateway } from './baeCommentsTypes.ts';

/** BAE경 테스트 모드 저장소(previewGateway.ts)의 자리 — 기록과 명단을 읽기만 한다. */
export const BAE_PREVIEW_JOBS_KEY = 'bflow:preview:bae-jobs';
export const BAE_PREVIEW_MEMBERS_KEY = 'bflow:preview:bae-members';
export const BAE_PREVIEW_COMMENTS_KEY = 'bflow:preview:bae-comments:v1';
export const BAE_PREVIEW_REACTIONS_KEY = 'bflow:preview:bae-comment-reactions:v1';
export const BAE_PREVIEW_COMMENTS_CHANNEL = 'bflow-preview-bae-comments';

export interface BaePreviewPerson { id: string; name: string; role?: string | null }
export interface BaePreviewNotifier {
  fanoutAdd(world: RecipientWorld, commentId: string, comment: CommentNotificationComment): Promise<number>;
  fanoutEdit(world: RecipientWorld, commentId: string, previousMentions: unknown, comment: CommentNotificationComment): Promise<number>;
  removeComment(commentId: string): Promise<void>;
}
export interface BaePreviewCommentsOptions {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  identity: () => BaePreviewPerson | null;
  users: () => readonly BaePreviewPerson[];
  notifier?: BaePreviewNotifier | null;
  channel?: { postMessage(m: unknown): void; addEventListener(t: 'message', l: (e: { data: unknown }) => void): void; removeEventListener(t: 'message', l: (e: { data: unknown }) => void): void } | null;
  now?: () => string;
  newId?: () => string;
}

/**
 * 미리보기 알림 목록(devElectronAPI 의 commentNotificationsList)이 BAE 댓글 줄을 보여 줄지 — 실서버 래퍼처럼 댓글이 아직 있고
 * 받는 사람이 그 스레드를 아직 읽을 수 있을 때만.
 */
export function baePreviewCommentReadable(
  storage: Pick<Storage, 'getItem'>, users: readonly BaePreviewPerson[], commentId: string, userId: string,
): boolean {
  if (!isBaeCommentId(commentId)) return false;
  const read = <T>(key: string, fallback: T): T => { try { const t = storage.getItem(key); return t === null ? fallback : JSON.parse(t) as T; } catch { return fallback; } };
  const row = read<BaeCommentRow[]>(BAE_PREVIEW_COMMENTS_KEY, []).find((c) => c.id === commentId);
  if (!row) return false;
  const me = users.find((u) => u.id === userId);
  if (!me) return false;
  const maker = read<Array<{ id?: unknown; userId?: unknown }>>(BAE_PREVIEW_JOBS_KEY, []).find((j) => j.id === row.baeJobId)?.userId;
  const reviewer = me.role === 'admin' || read<Array<{ userId?: unknown; role?: unknown }>>(BAE_PREVIEW_MEMBERS_KEY, []).some((m) => m.userId === userId && m.role === 'reviewer');
  return maker === userId || reviewer;
}

class PreviewError extends Error {
  readonly code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}

export function createBaePreviewComments(opts: BaePreviewCommentsOptions): BaeCommentsGateway & {
  /** 테스트 모드의 도장 → 코멘트 한 줄(서버의 bae_gyeong_stamp_comment 트리거와 같다). 좋아요 · 다시만, 확인함은 조용히. */
  recordStamp(jobId: string, stamp: string | null, note: string | null, by: string): Promise<void>;
  /** 이 댓글이 아직 있는가(미리보기 알림 목록이 지운 댓글의 줄을 감출 때). */
  has(commentId: string): boolean;
} {
  const now = opts.now ?? (() => new Date().toISOString());
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const listeners = new Set<() => void>();
  const read = <T>(key: string, fallback: T): T => { try { const t = opts.storage.getItem(key); return t === null ? fallback : JSON.parse(t) as T; } catch { return fallback; } };
  const write = (key: string, value: unknown) => opts.storage.setItem(key, JSON.stringify(value));
  const signal = () => { for (const l of [...listeners]) { try { l(); } catch { /* ignore */ } } try { opts.channel?.postMessage({ baeComments: true }); } catch { /* ignore */ } };
  const comments = () => read<BaeCommentRow[]>(BAE_PREVIEW_COMMENTS_KEY, []);
  const reactionsAll = () => read<BaeCommentReaction[]>(BAE_PREVIEW_REACTIONS_KEY, []);
  const me = (): BaePreviewPerson => { const u = opts.identity(); if (!u) throw new PreviewError('로그인 세션이 필요합니다. 다시 로그인해 주세요.', '42501'); return u; };
  const jobMaker = (jobId: string): string | null => read<Array<{ id?: unknown; userId?: unknown }>>(BAE_PREVIEW_JOBS_KEY, []).find((j) => j.id === jobId)?.userId as string ?? null;
  const reviewerIds = (): string[] => {
    const people = opts.users();
    const members = read<Array<{ userId?: unknown; role?: unknown }>>(BAE_PREVIEW_MEMBERS_KEY, []);
    return people.filter((p) => p.role === 'admin' || members.some((m) => m.userId === p.id && m.role === 'reviewer')).map((p) => p.id);
  };
  const canRead = (userId: string, jobId: string) => opts.users().some((u) => u.id === userId) && (jobMaker(jobId) === userId || reviewerIds().includes(userId));
  const audience = (jobId: string): BaeCommentPerson[] => opts.users()
    .filter((u) => canRead(u.id, jobId)).map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const requireJob = (jobId: string) => {
    if (!isBaeCommentJobId(jobId) || jobMaker(jobId) === null) throw new PreviewError('BAE경 작업 기록을 찾을 수 없습니다.', 'P0002');
  };
  const requireRead = (u: BaePreviewPerson, jobId: string, verb: string) => {
    if (!canRead(u.id, jobId)) throw new PreviewError(`이 BAE경 기록${verb}`, '42501');
  };
  const keepMentions = (jobId: string, names: readonly string[]) => {
    const allowed = new Set(audience(jobId).map((p) => p.name));
    return [...new Set(names)].filter((n) => allowed.has(n));
  };
  const reached = (jobId: string, names: readonly string[], actor: string) => {
    const wanted = new Set(names);
    return [...new Set(audience(jobId).filter((p) => p.id !== actor && wanted.has(p.name)).map((p) => p.id))].sort();
  };
  const world = (): RecipientWorld => {
    const all = comments();
    const jobIds = [...new Set(all.map((c) => c.baeJobId))];
    return {
      users: opts.users().map((u) => ({ id: u.id, name: u.name })), episodes: [], parts: [], scenes: [], revisions: [],
      comments: all.map((c) => ({ id: c.id, userId: c.userId, partId: null, sceneId: null, sceneUuid: null, mentions: c.mentions,
        parentCommentId: c.parentCommentId, revisionId: null, characterId: null, baeJobId: c.baeJobId })),
      baeJobs: jobIds.map((id) => ({ id, makerId: jobMaker(id) ?? '' })).filter((j) => j.makerId),
      baeReviewerIds: reviewerIds(),
    };
  };
  const notificationComment = (c: BaeCommentRow): CommentNotificationComment => ({
    partId: null, sceneId: null, sceneUuid: null, userId: c.userId, userName: c.userName, text: c.text, mentions: [...c.mentions],
    imageCount: c.images.length, parentCommentId: c.parentCommentId, revisionId: null, characterId: null, baeJobId: c.baeJobId,
    createdAt: c.createdAt, editedAt: c.editedAt,
  });
  const reactionsOf = (commentId: string) => reactionsAll().filter((r) => r.commentId === commentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const insert = (row: BaeCommentRow) => {
    const all = comments(); all.push(row); write(BAE_PREVIEW_COMMENTS_KEY, all);
    void opts.notifier?.fanoutAdd(world(), row.id, notificationComment(row)).catch(() => undefined);
    signal();
  };

  return {
    async list(jobId) {
      const u = me(); requireJob(jobId); requireRead(u, jobId, '의 코멘트는 만든 사람과 검수자만 볼 수 있습니다.');
      const rows = comments().filter((c) => c.baeJobId === jobId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const thread: BaeCommentThread = { comments: rows, audience: audience(jobId), canModerate: u.role === 'admin' };
      return thread;
    },
    async add(jobId, draft: BaeCommentDraft): Promise<BaeCommentAddResult> {
      const u = me(); requireJob(jobId); requireRead(u, jobId, '에는 만든 사람과 검수자만 코멘트를 남길 수 있습니다.');
      const problem = baeCommentDraftProblem(draft); if (problem) throw new PreviewError(problem, '22023');
      const existing = comments().find((c) => c.id === draft.id);
      if (existing) {
        if (existing.baeJobId !== jobId || existing.userId !== u.id) throw new PreviewError('같은 번호의 댓글이 이미 있습니다.', 'PT409');
        return { comment: existing, mentioned: reached(jobId, existing.mentions, u.id), duplicate: true };
      }
      if (draft.parentCommentId && !comments().some((c) => c.id === draft.parentCommentId && c.baeJobId === jobId)) throw new PreviewError('답글을 달 댓글을 찾을 수 없습니다.', 'P0002');
      const mentions = keepMentions(jobId, draft.mentions);
      const row: BaeCommentRow = { id: draft.id, baeJobId: jobId, userId: u.id, userName: u.name, text: draft.text, mentions, images: [...draft.images],
        parentCommentId: draft.parentCommentId ?? null, createdAt: now(), editedAt: null };
      insert(row);
      return { comment: row, mentioned: reached(jobId, mentions, u.id), duplicate: false };
    },
    async edit(commentId, text, mentions, images): Promise<BaeCommentEditResult> {
      const u = me();
      const all = comments(); const i = all.findIndex((c) => c.id === commentId);
      if (i < 0) throw new PreviewError('댓글을 찾을 수 없습니다.', 'P0002');
      const cur = all[i]!;
      requireRead(u, cur.baeJobId, '의 코멘트는 만든 사람과 검수자만 볼 수 있습니다.');
      if (cur.userId !== u.id) throw new PreviewError('내가 쓴 댓글만 고칠 수 있습니다.', '42501');
      const problem = baeCommentBodyProblem(text, mentions, images ?? cur.images); if (problem) throw new PreviewError(problem, '22023');
      const kept = keepMentions(cur.baeJobId, mentions);
      const added = kept.filter((n) => !cur.mentions.includes(n));
      const next: BaeCommentRow = { ...cur, text, mentions: kept, images: images ? [...images] : cur.images, editedAt: now() };
      all[i] = next; write(BAE_PREVIEW_COMMENTS_KEY, all);
      void opts.notifier?.fanoutEdit(world(), commentId, cur.mentions, notificationComment(next)).catch(() => undefined);
      signal();
      return { comment: next, addedMentioned: reached(cur.baeJobId, added, u.id) };
    },
    async remove(commentId): Promise<BaeCommentDeleteResult> {
      const u = me();
      const all = comments(); const cur = all.find((c) => c.id === commentId);
      if (!cur) return { deleted: false, images: [] };
      requireRead(u, cur.baeJobId, '의 코멘트는 만든 사람과 검수자만 볼 수 있습니다.');
      if (cur.userId !== u.id && u.role !== 'admin') throw new PreviewError('내가 쓴 댓글만 지울 수 있습니다.', '42501');
      write(BAE_PREVIEW_COMMENTS_KEY, all.filter((c) => c.id !== commentId).map((c) => (c.parentCommentId === commentId ? { ...c, parentCommentId: null } : c)));
      write(BAE_PREVIEW_REACTIONS_KEY, reactionsAll().filter((r) => r.commentId !== commentId));
      void opts.notifier?.removeComment(commentId).catch(() => undefined);
      signal();
      return { deleted: true, images: cur.images };
    },
    async react(commentId, emoji, on) {
      const u = me();
      const cur = comments().find((c) => c.id === commentId);
      if (!cur) throw new PreviewError('댓글을 찾을 수 없습니다.', 'P0002');
      requireRead(u, cur.baeJobId, '의 코멘트는 만든 사람과 검수자만 볼 수 있습니다.');
      const problem = baeCommentEmojiProblem(emoji); if (problem) throw new PreviewError(problem, '22023');
      const all = reactionsAll();
      const mine = all.some((r) => r.commentId === commentId && r.userId === u.id && r.emoji === emoji);
      if (on && !mine) all.push({ id: newId(), commentId, userId: u.id, userName: u.name, emoji, createdAt: now() });
      const next = on ? all : all.filter((r) => !(r.commentId === commentId && r.userId === u.id && r.emoji === emoji));
      write(BAE_PREVIEW_REACTIONS_KEY, next);
      signal();
      return reactionsOf(commentId);
    },
    async reactions(commentIds) {
      const u = me();
      const out: Record<string, BaeCommentReaction[]> = {};
      for (const c of comments()) if (commentIds.includes(c.id) && canRead(u.id, c.baeJobId)) out[c.id] = reactionsOf(c.id);
      return out;
    },
    onChanged(callback) {
      listeners.add(callback);
      const onMsg = (e: { data: unknown }) => { if ((e.data as { baeComments?: unknown } | null)?.baeComments) callback(); };
      opts.channel?.addEventListener('message', onMsg);
      return () => { listeners.delete(callback); opts.channel?.removeEventListener('message', onMsg); };
    },
    async recordStamp(jobId, stamp, note, by) {
      if (stamp !== 'good' && stamp !== 'again') return;
      const who = opts.users().find((p) => p.id === by);
      if (!who || jobMaker(jobId) === null) return;
      const clean = (note ?? '').trim();
      const text = `${stamp === 'good' ? '좋아요 도장을 찍었어요.' : '다시 도장을 찍었어요.'}${clean ? `\n${clean}` : ''}`;
      insert({ id: `${BAE_COMMENT_ID_PREFIX}${newId().toLowerCase()}`, baeJobId: jobId, userId: who.id, userName: who.name, text, mentions: [], images: [],
        parentCommentId: null, createdAt: now(), editedAt: null });
    },
    has(commentId) {
      return isBaeCommentId(commentId) && comments().some((c) => c.id === commentId);
    },
  };
}
