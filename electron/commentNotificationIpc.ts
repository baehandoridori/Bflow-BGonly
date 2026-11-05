/**
 * 씬 댓글 서버 알림 IPC(씬 댓글 B안 PR 6) — threadTodoIpc 미러.
 * 렌더러는 커서·댓글 id 만 보내고, 호출자는 main 의 canonical 세션에서 확정한다(actor id 를 받지 않는다).
 * 응답 전에 세션이 바뀌었으면(로그아웃·계정 전환) 응답을 버린다 — 다른 사람의 알림이 새 계정 화면에 들어가지 않게.
 */
import { ipcMain } from 'electron';
import { COMMENT_NOTIFICATION_RESPONSE_DISCARDED } from '../src/shared/commentNotification';
import { listCommentNotifications, markCommentNotificationsRead, type CommentNotificationStore } from './commentNotificationStore';

interface SessionOrigin { userId: string; epoch: number }
interface CommentNotificationIpcDependencies {
  getSessionOriginOrThrow(): SessionOrigin;
  /** Injectable boundaries let persistence/session behavior run without Electron or a live DB. */
  ipc?: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void };
  store?: CommentNotificationStore;
}
const SESSION_REQUIRED = '로그인 세션이 필요합니다. 다시 로그인해 주세요.';

export function registerCommentNotificationIpc(deps: CommentNotificationIpcDependencies): void {
  const ipc = deps.ipc ?? ipcMain;
  const store = deps.store ?? { list: listCommentNotifications, markRead: markCommentNotificationsRead };
  function originOrThrow(): SessionOrigin {
    try {
      const origin = deps.getSessionOriginOrThrow();
      return { userId: origin.userId, epoch: origin.epoch };
    } catch {
      throw new Error(SESSION_REQUIRED);
    }
  }
  function current(origin: SessionOrigin) {
    let now: SessionOrigin;
    try { now = originOrThrow(); } catch { throw new Error(COMMENT_NOTIFICATION_RESPONSE_DISCARDED); }
    if (origin.userId !== now.userId || origin.epoch !== now.epoch) throw new Error(COMMENT_NOTIFICATION_RESPONSE_DISCARDED);
  }
  function checkRequestEpoch(requestEpoch: unknown, origin: SessionOrigin) {
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 변경되었습니다. 화면을 다시 열어 주세요.');
  }
  ipc.handle('comment-notifications:list', async (_event, cursor, limit, requestEpoch) => {
    const origin = originOrThrow();
    checkRequestEpoch(requestEpoch, origin);
    const result = await store.list(origin.userId, cursor, limit);
    current(origin);
    return result;
  });
  ipc.handle('comment-notifications:mark-read', async (_event, target, requestEpoch) => {
    const origin = originOrThrow();
    checkRequestEpoch(requestEpoch, origin);
    const result = await store.markRead(origin.userId, target);
    current(origin);
    return result;
  });
}
