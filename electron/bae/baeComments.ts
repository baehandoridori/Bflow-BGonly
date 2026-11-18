/**
 * BAE경 9단계 코멘트 — 메인 전용 통로. 화면 → preload(요청 epoch) → 여기 → bae_gyeong_session_comment_* (세션 토큰은 이 모듈 밖으로 나가지 않는다).
 * 서버: DEVLOG/migrations/2026-11-16-bae-gyeong-comments.sql. 누가 쓰는지 · 볼 수 있는지는 서버가 세션으로 정한다 — 화면이 보낸 사용자 id 는 받지 않는다.
 * 실시간: 서버의 내용 없는 'comments-changed'(채널 'bae-gyeong-comments')를 받으면 모든 창에 'bae-comments:changed' 를 보내고, 열린 패널이 다시 읽는다.
 * 씬 댓글 길(supabase:add-comment · comment-added 방송 · 행 캐시)은 타지 않는다 — BAE 댓글 내용이 공개 채널로 나가지 않게.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  baeCommentBodyProblem, baeCommentDraftProblem, baeCommentEmojiProblem, isBaeCommentId, isBaeCommentJobId,
  parseBaeCommentAdd, parseBaeCommentDelete, parseBaeCommentEdit, parseBaeCommentReactionMap, parseBaeCommentReactions, parseBaeCommentThread,
  type BaeCommentAddResult, type BaeCommentDeleteResult, type BaeCommentDraft, type BaeCommentEditResult, type BaeCommentReaction, type BaeCommentThread,
} from '../../src/shared/bae/comments';

export interface BaeCommentsRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}
export interface BaeCommentsSessionResolver { tokenFor(actorId: string): string }

/** 서버에 9단계 SQL 이 아직 없을 때(함수 없음). */
const NOT_READY = ['42883', 'PGRST202', '42P01', 'PGRST205'];
export const BAE_COMMENTS_NOT_READY = 'BAE경 코멘트 서버 준비가 필요해요. 관리자에게 BAE경 데이터베이스 업데이트를 부탁해 주세요.';

export function createBaeCommentsStore(client: BaeCommentsRpcClient, sessions: BaeCommentsSessionResolver) {
  async function call<T>(actorId: string, name: string, args: Record<string, unknown>, parse: (data: unknown) => T): Promise<T> {
    const token = sessions.tokenFor(actorId);
    if (typeof token !== 'string' || !token.trim()) throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.');
    const { data, error } = await client.rpc(name, { p_session_token: token, ...args });
    if (error) {
      if (NOT_READY.includes(error.code ?? '')) throw Object.assign(new Error(BAE_COMMENTS_NOT_READY), { code: 'BAE_NOT_READY' });
      throw Object.assign(new Error(error.message || 'BAE경 코멘트 서버 오류가 났어요.'), { code: error.code });
    }
    return parse(data);
  }
  return {
    list: (actorId: string, jobId: string): Promise<BaeCommentThread> =>
      call(actorId, 'bae_gyeong_session_comment_list', { p_job_id: jobId }, parseBaeCommentThread),
    add: (actorId: string, jobId: string, draft: BaeCommentDraft): Promise<BaeCommentAddResult> =>
      call(actorId, 'bae_gyeong_session_comment_add', { p_job_id: jobId, p_comment: draft }, parseBaeCommentAdd),
    edit: (actorId: string, commentId: string, text: string, mentions: string[], images: string[] | null): Promise<BaeCommentEditResult> =>
      call(actorId, 'bae_gyeong_session_comment_edit', { p_comment_id: commentId, p_text: text, p_mentions: mentions, p_images: images }, parseBaeCommentEdit),
    remove: (actorId: string, commentId: string): Promise<BaeCommentDeleteResult> =>
      call(actorId, 'bae_gyeong_session_comment_delete', { p_comment_id: commentId }, parseBaeCommentDelete),
    react: (actorId: string, commentId: string, emoji: string, on: boolean): Promise<BaeCommentReaction[]> =>
      call(actorId, 'bae_gyeong_session_comment_react', { p_comment_id: commentId, p_emoji: emoji, p_on: on }, parseBaeCommentReactions),
    reactions: (actorId: string, commentIds: string[]): Promise<Record<string, BaeCommentReaction[]>> =>
      call(actorId, 'bae_gyeong_session_comment_reactions', { p_comment_ids: commentIds }, parseBaeCommentReactionMap),
  };
}
export type BaeCommentsStore = ReturnType<typeof createBaeCommentsStore>;

export interface BaeCommentsIpcDependencies {
  ipc: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void };
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  store: BaeCommentsStore;
  /** 이 PC 의 모든 창에 '코멘트가 바뀌었다'(내용 없음). 다른 PC 는 서버 신호로 안다. */
  onChanged(): void;
  /** 지운 댓글의 그림 정리(실패해도 지우기는 끝난 것). */
  deleteImage?(url: string): Promise<void>;
}

/** 화면 ↔ 메인 채널. preload 의 window.baeCommentsAPI 가 이 채널들을 부른다(요청 때의 로그인 세션 epoch 를 함께). */
export const BAE_COMMENT_CHANNELS = {
  list: 'bae-comments:list',
  add: 'bae-comments:add',
  edit: 'bae-comments:edit',
  remove: 'bae-comments:delete',
  react: 'bae-comments:react',
  reactions: 'bae-comments:reactions',
  changed: 'bae-comments:changed',
} as const;

export function registerBaeCommentsIpc(deps: BaeCommentsIpcDependencies): void {
  function originFor(requestEpoch: unknown) {
    const origin = { ...deps.getSessionOriginOrThrow() };
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 바뀌었어요. 화면을 다시 열어 주세요.');
    return origin;
  }
  function current(origin: { userId: string; epoch: number }) {
    const now = deps.getSessionOriginOrThrow();
    if (origin.userId !== now.userId || origin.epoch !== now.epoch) throw new Error('로그인 세션이 바뀌어 BAE경 응답을 버렸어요.');
  }
  const changed = () => { try { deps.onChanged(); } catch (error) { console.warn('[bae-comments] 변경 알림 실패:', error); } };
  const jobIdOk = (v: unknown): string => { if (!isBaeCommentJobId(v)) throw new Error('BAE경 작업 번호가 올바르지 않아요.'); return v; };
  const commentIdOk = (v: unknown): string => { if (!isBaeCommentId(v)) throw new Error('댓글 번호가 올바르지 않아요.'); return v; };

  deps.ipc.handle(BAE_COMMENT_CHANNELS.list, async (_e, jobId, epoch) => {
    const origin = originFor(epoch);
    const r = await deps.store.list(origin.userId, jobIdOk(jobId)); current(origin); return r;
  });
  deps.ipc.handle(BAE_COMMENT_CHANNELS.add, async (_e, jobId, draft, epoch) => {
    const origin = originFor(epoch);
    const job = jobIdOk(jobId);
    const problem = baeCommentDraftProblem(draft); if (problem) throw new Error(problem);
    const d = draft as BaeCommentDraft;
    const clean: BaeCommentDraft = { id: d.id, text: d.text, mentions: [...d.mentions], images: [...(d.images ?? [])], parentCommentId: d.parentCommentId ?? null };
    const r = await deps.store.add(origin.userId, job, clean);
    changed(); current(origin); return r;
  });
  deps.ipc.handle(BAE_COMMENT_CHANNELS.edit, async (_e, commentId, text, mentions, images, epoch) => {
    const origin = originFor(epoch);
    const id = commentIdOk(commentId);
    const imgs = images === undefined ? null : images;
    const problem = baeCommentBodyProblem(text, mentions, imgs); if (problem) throw new Error(problem);
    const r = await deps.store.edit(origin.userId, id, text as string, [...(mentions as string[])], imgs === null ? null : [...(imgs as string[])]);
    changed(); current(origin); return r;
  });
  deps.ipc.handle(BAE_COMMENT_CHANNELS.remove, async (_e, commentId, epoch) => {
    const origin = originFor(epoch);
    const r = await deps.store.remove(origin.userId, commentIdOk(commentId));
    changed();
    if (r.deleted && deps.deleteImage) for (const url of r.images) void deps.deleteImage(url).catch((error) => console.warn('[bae-comments] 그림 정리 실패:', error));
    current(origin); return r;
  });
  deps.ipc.handle(BAE_COMMENT_CHANNELS.react, async (_e, commentId, emoji, on, epoch) => {
    const origin = originFor(epoch);
    const id = commentIdOk(commentId);
    const problem = baeCommentEmojiProblem(emoji); if (problem) throw new Error(problem);
    if (typeof on !== 'boolean') throw new Error('반응이 올바르지 않아요.');
    const r = await deps.store.react(origin.userId, id, emoji as string, on);
    changed(); current(origin); return r;
  });
  deps.ipc.handle(BAE_COMMENT_CHANNELS.reactions, async (_e, commentIds, epoch) => {
    const origin = originFor(epoch);
    if (!Array.isArray(commentIds) || commentIds.length > 500 || !commentIds.every(isBaeCommentId)) throw new Error('댓글 번호가 올바르지 않아요.');
    if (commentIds.length === 0) return {};
    const r = await deps.store.reactions(origin.userId, [...new Set(commentIds as string[])]); current(origin); return r;
  });
}

/**
 * 내용 없는 신호만 받는다(채널 'bae-gyeong-comments', 이벤트 'comments-changed'). 받은 쪽은 자기 세션으로 다시 읽는다.
 * 다시 이어졌을 때도 한 번 알린다(끊긴 사이에 놓친 것 — 열린 패널만 읽는다).
 */
export function startBaeCommentsRealtime(client: Pick<SupabaseClient, 'channel' | 'removeChannel'>, onSignal: () => void): () => void {
  const channel = client.channel('bae-gyeong-comments')
    .on('broadcast', { event: 'comments-changed' }, () => onSignal())
    .subscribe((status) => { if (status === 'SUBSCRIBED') onSignal(); });
  return () => { void client.removeChannel(channel); };
}
