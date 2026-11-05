/**
 * 씬 댓글 서버 알림(씬 댓글 B안 PR 6) — '서버에 줄이 있나'와 서버 읽음 처리. 스토어를 import 하지 않는 작은 파일이라
 * 알림 스토어·읽음 처리(notificationDomainRead)가 순환 없이 쓴다.
 */

import { COMMENT_NOTIFICATION_READ_LIMIT, type CommentNotificationReadTarget } from '../shared/commentNotification.ts';

/** null = 아직 모름, false = 서버에 줄이 없다(DB 적용 전 — 예전 길로). */
let available: boolean | null = null;

export function getServerCommentNotificationsAvailable(): boolean | null {
  return available;
}

export function setServerCommentNotificationsAvailable(value: boolean | null): void {
  available = value;
}

interface ReadRow {
  type: string;
  metadata?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** 씬·캐릭터 댓글 알림(멘션·답글·리테이크 댓글·자동·팔로우)의 서버 읽음 대상 — 댓글 id 를 종류별로. */
export function commentNotificationReadTarget(rows: readonly ReadRow[]): CommentNotificationReadTarget {
  const add = new Set<string>();
  const edit = new Set<string>();
  for (const row of rows) {
    if (row.type !== 'mention' && row.type !== 'comment') continue;
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : null;
    const commentId = text(meta?.commentId);
    if (!commentId || !/^[A-Za-z0-9_-]{1,128}$/.test(commentId)) continue;
    if (text(meta?.mentionEditAt)) edit.add(commentId);
    else add.add(commentId);
  }
  return { addCommentIds: [...add], editCommentIds: [...edit] };
}

/** 500개씩 나눠 서버 읽음. 서버에 줄이 없다고 알려졌으면 부르지 않는다. 실패는 다음 지우기·읽음이 다시 시도한다. */
export function markServerCommentNotificationsRead(
  target: CommentNotificationReadTarget,
  send: ((target: CommentNotificationReadTarget) => Promise<unknown>) | undefined,
): void {
  if (available === false || !send) return;
  const items: Array<['add' | 'edit', string]> = [
    ...target.addCommentIds.map((id) => ['add', id] as ['add', string]),
    ...target.editCommentIds.map((id) => ['edit', id] as ['edit', string]),
  ];
  for (let start = 0; start < items.length; start += COMMENT_NOTIFICATION_READ_LIMIT) {
    const chunk = items.slice(start, start + COMMENT_NOTIFICATION_READ_LIMIT);
    const part: CommentNotificationReadTarget = {
      addCommentIds: chunk.filter(([kind]) => kind === 'add').map(([, id]) => id),
      editCommentIds: chunk.filter(([kind]) => kind === 'edit').map(([, id]) => id),
    };
    Promise.resolve()
      .then(() => send(part))
      .catch((err) => console.warn('[commentNotificationServer] 서버 읽음 처리 실패:', err));
  }
}
