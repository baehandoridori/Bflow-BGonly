/**
 * Main-only 씬 댓글 서버 알림 저장소(씬 댓글 B안 PR 6) — threadTodoStore 와 같은 세션 토큰 경계.
 * 래퍼는 actor id 가 아니라 app_login 이 발급한 세션 토큰을 받는다. 토큰은 이 파일 안에서만 쓰이고 응답에 실리지 않는다.
 * 서버에 래퍼가 아직 없으면(DB 적용 전) available:false 로 돌려준다 — 렌더러는 예전 길(렌더러 판정 + 놓친 멘션 훑기)로 간다.
 * 입력 검사는 토큰을 꺼내기 전에 끝낸다.
 */
import { supabase } from './supabase';
import {
  COMMENT_NOTIFICATION_LIST_LIMIT,
  parseCommentNotificationRows,
  validateCommentNotificationCursor,
  validateCommentNotificationReadTarget,
  type CommentNotificationListResult,
  type CommentNotificationReadResult,
} from '../src/shared/commentNotification';

type RpcError = { code?: string; message?: string };
export interface CommentNotificationRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>;
}
export interface CommentNotificationSessionResolver {
  tokenFor(actorId: string): string;
}
const SESSION_REQUIRED = '로그인 세션이 필요합니다. 다시 로그인해 주세요.';
let sessionResolver: CommentNotificationSessionResolver = { tokenFor() { throw new Error(SESSION_REQUIRED); } };
/** main 이 SessionManager 배선 뒤 한 번 호출한다. 테스트는 createCommentNotificationStore 에 직접 주입한다. */
export function setCommentNotificationSessionTokenResolver(resolver: CommentNotificationSessionResolver): void {
  sessionResolver = resolver;
}

/** 래퍼·표가 아직 없다(DB 적용 전) — 실패가 아니라 '서버 알림 없음'. */
function missingMigration(error: RpcError): boolean {
  return ['42P01', 'PGRST205', '42883', 'PGRST202'].includes(error.code ?? '');
}
function fail(error: RpcError): never {
  // SQLSTATE 를 남겨 호출자가 세션 만료(42501)를 구분할 수 있게 한다.
  throw Object.assign(new Error(error.message || '알림을 불러오지 못했어요.'), { code: error.code });
}

export function createCommentNotificationStore(
  client: CommentNotificationRpcClient,
  session: CommentNotificationSessionResolver = { tokenFor: (actorId) => sessionResolver.tokenFor(actorId) },
) {
  async function list(actorId: string, rawCursor: unknown, rawLimit?: unknown): Promise<CommentNotificationListResult> {
    const cursor = validateCommentNotificationCursor(rawCursor);
    const limit = typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, COMMENT_NOTIFICATION_LIST_LIMIT)
      : COMMENT_NOTIFICATION_LIST_LIMIT;
    const token = session.tokenFor(actorId);
    const { data, error } = await client.rpc('comment_notifications_session_list', {
      p_session_token: token,
      p_after_at: cursor?.at ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: limit,
    });
    if (error) {
      if (missingMigration(error)) return { available: false, rows: [] };
      fail(error);
    }
    return { available: true, rows: parseCommentNotificationRows(data) };
  }

  async function markRead(actorId: string, rawTarget: unknown): Promise<CommentNotificationReadResult> {
    const target = validateCommentNotificationReadTarget(rawTarget);
    if (target.addCommentIds.length === 0 && target.editCommentIds.length === 0) return { available: true, updated: 0 };
    const token = session.tokenFor(actorId);
    const { data, error } = await client.rpc('comment_notifications_session_mark_read', {
      p_session_token: token,
      p_add_comment_ids: target.addCommentIds,
      p_edit_comment_ids: target.editCommentIds,
    });
    if (error) {
      if (missingMigration(error)) return { available: false, updated: 0 };
      fail(error);
    }
    const updated = (data as { updated?: unknown } | null)?.updated;
    return { available: true, updated: typeof updated === 'number' && Number.isFinite(updated) ? updated : 0 };
  }

  return { list, markRead };
}
export type CommentNotificationStore = ReturnType<typeof createCommentNotificationStore>;

const persistence = createCommentNotificationStore(supabase);
export const listCommentNotifications = persistence.list;
export const markCommentNotificationsRead = persistence.markRead;
