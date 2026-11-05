/**
 * 미리보기(?preview=1) 씬 댓글 서버 알림 저장소 — 씬 댓글 B안 PR 6.
 *
 * 실서버는 댓글이 저장되는 순간 트리거가 받는 사람별 줄을 만들고(DEVLOG/migrations/2026-11-05-comment-notifications.sql),
 * 줄이 생기면 내용 없는 신호를 보낸다. 미리보기도 같은 흐름을 눈으로 확인할 수 있게
 *  - 댓글을 쓴 창이 같은 규칙(src/shared/commentNotificationRecipients.ts)으로 줄을 만들어 localStorage 에 둔다
 *    (쓸 수 없는 환경이면 이 창 메모리로 대신).
 *  - 쓰기는 navigator.locks 로 창끼리 직렬화한다.
 *  - 줄이 생기면 이 창과 다른 탭·창에 한 번씩 알린다(실서버 신호도 쓴 PC 를 포함해 모두에게 간다).
 * 목록은 받는 사람·(시각, id) 커서·읽음 규칙이 서버 래퍼와 같다. 런타임 import 는 import 없는 공유 파일뿐이라 node --test 가 바로 쓴다.
 */
import { createUuid } from '../utils/createUuid.ts';
import {
  COMMENT_NOTIFICATION_LIST_LIMIT,
  parseCommentNotificationRow,
  validateCommentNotificationCursor,
  validateCommentNotificationReadTarget,
  type CommentNotificationComment,
  type CommentNotificationListResult,
  type CommentNotificationReadResult,
  type CommentNotificationRow,
} from '../shared/commentNotification.ts';
import {
  commentNotificationEditRecipients,
  commentNotificationRecipients,
  type RecipientWorld,
} from '../shared/commentNotificationRecipients.ts';

export const COMMENT_NOTIFICATION_PREVIEW_STORAGE_KEY = 'bflow:preview:comment-notifications:v1';
export const COMMENT_NOTIFICATION_PREVIEW_LOCK = 'bflow:preview:comment-notifications';
export const COMMENT_NOTIFICATION_PREVIEW_CHANNEL = 'bflow:preview:comment-notifications:changed';

export interface CommentNotificationPreviewStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface CommentNotificationPreviewLocks { request<T>(name: string, callback: () => Promise<T>): Promise<T> }
export interface CommentNotificationPreviewChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}
export interface CommentNotificationPreviewOptions {
  storage?: CommentNotificationPreviewStorage | null;
  locks?: CommentNotificationPreviewLocks | null;
  openChannel?: (() => CommentNotificationPreviewChannel | null) | null;
  now?: () => string;
  newId?: () => string;
}

type StoredRow = CommentNotificationRow & { recipientId: string };

function defaultStorage(): CommentNotificationPreviewStorage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch { /* 저장소 접근이 막힌 환경 */ }
  return null;
}
function defaultLocks(): CommentNotificationPreviewLocks | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}
function defaultOpenChannel(): CommentNotificationPreviewChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  try { return new BroadcastChannel(COMMENT_NOTIFICATION_PREVIEW_CHANNEL) as unknown as CommentNotificationPreviewChannel; } catch { return null; }
}

function isStoredRow(value: unknown): value is StoredRow {
  return !!value && typeof value === 'object' && typeof (value as { recipientId?: unknown }).recipientId === 'string'
    && parseCommentNotificationRow(value) !== null;
}

const cursorAfter = (row: StoredRow, at: string, id: string | null) => {
  const rowTime = Date.parse(row.eventAt), atTime = Date.parse(at);
  if (rowTime !== atTime) return rowTime > atTime;
  return id !== null && row.id > id;
};

export function createCommentNotificationPreviewStore(options: CommentNotificationPreviewOptions = {}) {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const locks = options.locks === undefined ? defaultLocks() : options.locks;
  const openChannel = options.openChannel === undefined ? defaultOpenChannel : options.openChannel;
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? (() => createUuid());
  const sourceId = newId();
  let memoryRows: StoredRow[] = [];
  let memoryOnly = !storage;
  let localTail: Promise<unknown> = Promise.resolve();
  let lastEventAt = 0;
  const listeners = new Set<() => void>();

  function readRows(): StoredRow[] {
    if (memoryOnly || !storage) return memoryRows.map((row) => ({ ...row }));
    let raw: string | null = null;
    try { raw = storage.getItem(COMMENT_NOTIFICATION_PREVIEW_STORAGE_KEY); } catch { memoryOnly = true; return memoryRows.map((row) => ({ ...row })); }
    let rows: StoredRow[] = [];
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        rows = Array.isArray(parsed) ? parsed.filter(isStoredRow).map((row) => ({ ...row })) : [];
      } catch { rows = []; }
    }
    memoryRows = rows.map((row) => ({ ...row }));
    return rows;
  }
  function writeRows(rows: StoredRow[]): void {
    memoryRows = rows.map((row) => ({ ...row }));
    if (memoryOnly || !storage) return;
    try { storage.setItem(COMMENT_NOTIFICATION_PREVIEW_STORAGE_KEY, JSON.stringify(rows)); } catch { memoryOnly = true; }
  }
  function withLock<T>(run: () => T): Promise<T> {
    if (locks) return locks.request(COMMENT_NOTIFICATION_PREVIEW_LOCK, async () => run());
    const next = localTail.then(run, run);
    localTail = next.then(() => undefined, () => undefined);
    return next;
  }
  /** 서버 now() 처럼 늘 앞으로 가는 시각(같은 밀리초에 두 번 써도 순서가 서게). */
  function eventAt(): string {
    const time = Math.max(Date.parse(now()) || Date.now(), lastEventAt + 1);
    lastEventAt = time;
    return new Date(time).toISOString();
  }
  function notifyChanged(): void {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* 화면 오류가 커밋된 쓰기를 되돌리지 않는다 */ }
    }
    const channel = openChannel?.();
    if (!channel) return;
    try { channel.postMessage({ source: sourceId }); } catch { /* 다음 조회가 저장된 값을 읽는다 */ } finally { channel.close(); }
  }

  return {
    /** 새 댓글 — 서버 트리거처럼 받는 사람별 줄을 만든다. 만든 줄 수. */
    async fanoutAdd(world: RecipientWorld, commentId: string, comment: CommentNotificationComment, revisionNo: number | null = null): Promise<number> {
      const recipients = commentNotificationRecipients(world, commentId);
      if (recipients.length === 0) return 0;
      const created = await withLock(() => {
        const rows = readRows();
        const at = eventAt();
        let count = 0;
        for (const recipient of recipients) {
          if (rows.some((row) => row.recipientId === recipient.recipientId && row.commentId === commentId && row.kind === 'add')) continue;
          rows.push({
            id: newId(), recipientId: recipient.recipientId, commentId, kind: 'add', reason: recipient.reason, detail: recipient.detail,
            eventAt: at, editAt: null, readAt: null, revisionNo, comment: { ...comment, mentions: [...comment.mentions] },
          });
          count += 1;
        }
        if (count > 0) writeRows(rows);
        return count;
      });
      if (created > 0) notifyChanged();
      return created;
    },
    /** 수정 — 새로 들어간 @이름의 사람에게 멘션 줄(같은 사람이 다시 들어가면 그 줄을 안 읽음으로 새로). 모든 줄의 댓글 내용도 고친다. */
    async fanoutEdit(world: RecipientWorld, commentId: string, previousMentions: unknown, comment: CommentNotificationComment): Promise<number> {
      const recipients = commentNotificationEditRecipients(world, commentId, previousMentions, comment.mentions);
      const changed = await withLock(() => {
        const rows = readRows();
        for (const row of rows) if (row.commentId === commentId) row.comment = { ...comment, mentions: [...comment.mentions] };
        const at = eventAt();
        let count = 0;
        for (const recipientId of recipients) {
          const existing = rows.find((row) => row.recipientId === recipientId && row.commentId === commentId && row.kind === 'edit');
          if (existing) {
            existing.eventAt = at;
            existing.editAt = comment.editedAt;
            existing.readAt = null;
          } else {
            const sample = rows.find((row) => row.commentId === commentId);
            rows.push({
              id: newId(), recipientId, commentId, kind: 'edit', reason: 'mention', detail: null,
              eventAt: at, editAt: comment.editedAt, readAt: null, revisionNo: sample?.revisionNo ?? null, comment: { ...comment, mentions: [...comment.mentions] },
            });
          }
          count += 1;
        }
        writeRows(rows);
        return count;
      });
      if (changed > 0) notifyChanged();
      return changed;
    },
    /** 댓글이 지워지면 그 줄도(서버 삭제 트리거처럼). 신호는 없다. */
    async removeComment(commentId: string): Promise<void> {
      await withLock(() => {
        const rows = readRows();
        const kept = rows.filter((row) => row.commentId !== commentId);
        if (kept.length !== rows.length) writeRows(kept);
      });
    },
    /** commentExists: 실서버 래퍼처럼 댓글이 아직 있는 줄만(comments INNER JOIN). 없으면 모두. */
    async list(recipientId: string, rawCursor: unknown, rawLimit?: unknown, commentExists?: (commentId: string) => boolean): Promise<CommentNotificationListResult> {
      const cursor = validateCommentNotificationCursor(rawCursor);
      const limit = typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, COMMENT_NOTIFICATION_LIST_LIMIT)
        : COMMENT_NOTIFICATION_LIST_LIMIT;
      const rows = readRows()
        .filter((row) => row.recipientId === recipientId && (!cursor || cursorAfter(row, cursor.at, cursor.id)))
        .filter((row) => !commentExists || commentExists(row.commentId))
        .sort((a, b) => (Date.parse(a.eventAt) - Date.parse(b.eventAt)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, limit)
        .map(({ recipientId: _recipient, ...row }) => row);
      return { available: true, rows };
    },
    async markRead(recipientId: string, rawTarget: unknown): Promise<CommentNotificationReadResult> {
      const target = validateCommentNotificationReadTarget(rawTarget);
      const updated = await withLock(() => {
        const rows = readRows();
        const at = now();
        let count = 0;
        for (const row of rows) {
          if (row.recipientId !== recipientId || row.readAt) continue;
          const ids = row.kind === 'add' ? target.addCommentIds : target.editCommentIds;
          if (!ids.includes(row.commentId)) continue;
          row.readAt = at;
          count += 1;
        }
        if (count > 0) writeRows(rows);
        return count;
      });
      return { available: true, updated };
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      const channel = openChannel?.() ?? null;
      channel?.addEventListener('message', (event) => {
        const source = (event.data as { source?: unknown } | null)?.source;
        if (source === sourceId) return;
        try { listener(); } catch { /* ignore */ }
      });
      return () => { listeners.delete(listener); channel?.close(); };
    },
  };
}
export type CommentNotificationPreviewStore = ReturnType<typeof createCommentNotificationPreviewStore>;
