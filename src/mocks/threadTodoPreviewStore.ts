/**
 * 미리보기(?preview=1) 팀 할 일 저장소 — 피드백 58, 코덱스 2차 리뷰 반영.
 *
 * 실서버는 팀 할 일을 DB 에 저장해 모든 창·PC 가 공유한다. 미리보기도 같은 동작을 확인할 수 있게
 * - localStorage 에 저장한다(새로고침해도 남는다. 쓸 수 없는 환경이면 이 창 메모리로 대신한다).
 * - 쓰기는 navigator.locks 로 창끼리 직렬화한다(없으면 이 창 안에서만 순서대로).
 * - 변경은 이 창 구독자와 BroadcastChannel 로 다른 탭·창에 한 번씩 알린다(자기 창에서 보낸 방송은 무시).
 * 규칙·문구는 서버 래퍼(DEVLOG/migrations/2026-09-14-comment-thread-todos.sql)와 같다: 공백 정제·길이,
 * 최초 완료자 유지, 해제 시 세 칸 비움, 삭제는 작성자 또는 관리자, 없는 항목 삭제는 deleted:false.
 * 런타임 import 는 import 없는 공유 파일뿐이라 node --test 가 직접 불러 쓴다.
 */
import { canDeleteThreadTodo, isThreadTodoRow, isValidThreadKey, isValidThreadTodoText, sanitizeThreadTodoText, type ThreadTodoRow } from '../shared/threadTodo.ts';
import { createUuid } from '../utils/createUuid.ts';

export const THREAD_TODO_PREVIEW_STORAGE_KEY = 'bflow:preview:thread-todos:v1';
export const THREAD_TODO_PREVIEW_LOCK = 'bflow:preview:thread-todos';
export const THREAD_TODO_PREVIEW_CHANNEL = 'bflow:preview:thread-todos:changed';

export interface ThreadTodoPreviewActor { id: string; name: string; role?: string }
export interface ThreadTodoPreviewStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface ThreadTodoPreviewLocks { request<T>(name: string, callback: () => Promise<T>): Promise<T> }
export interface ThreadTodoPreviewChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}
export interface ThreadTodoPreviewOptions {
  storage?: ThreadTodoPreviewStorage | null;
  locks?: ThreadTodoPreviewLocks | null;
  openChannel?: (() => ThreadTodoPreviewChannel | null) | null;
  now?: () => string;
  newId?: () => string;
}

function defaultStorage(): ThreadTodoPreviewStorage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch { /* 저장소 접근이 막힌 환경 */ }
  return null;
}
function defaultLocks(): ThreadTodoPreviewLocks | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}
function defaultOpenChannel(): ThreadTodoPreviewChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  try { return new BroadcastChannel(THREAD_TODO_PREVIEW_CHANNEL) as unknown as ThreadTodoPreviewChannel; } catch { return null; }
}

export function createThreadTodoPreviewStore(options: ThreadTodoPreviewOptions = {}) {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const locks = options.locks === undefined ? defaultLocks() : options.locks;
  const openChannel = options.openChannel === undefined ? defaultOpenChannel : options.openChannel;
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? (() => createUuid());
  const sourceId = newId(); // 이 창이 보낸 방송을 되받았을 때 두 번 알리지 않기 위한 표시
  let memoryRows: ThreadTodoRow[] = [];
  // 저장소를 못 쓰게 되면(읽기·쓰기 예외) 이후엔 이 창 메모리만 기준으로 삼는다 — 읽기만 되는 저장소의 옛 값이
  //   방금 성공한 변경을 되돌리지 않게(코덱스 3차).
  let memoryOnly = !storage;
  let localTail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  function readRows(): ThreadTodoRow[] {
    if (memoryOnly || !storage) return memoryRows.map((row) => ({ ...row }));
    let raw: string | null = null;
    try { raw = storage.getItem(THREAD_TODO_PREVIEW_STORAGE_KEY); } catch { memoryOnly = true; return memoryRows.map((row) => ({ ...row })); }
    let rows: ThreadTodoRow[] = [];
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        rows = Array.isArray(parsed) ? parsed.filter(isThreadTodoRow).map((row) => ({ ...row })) : [];
      } catch {
        rows = []; // 깨진 미리보기 데이터는 빈 목록으로 시작한다(다음 쓰기가 덮어쓴다)
      }
    }
    // 코덱스 8차: 성공한 읽기도 메모리에 남겨, 나중에 저장소 접근이 막혀도 마지막으로 본 목록을 유지한다.
    memoryRows = rows.map((row) => ({ ...row }));
    return rows;
  }
  function writeRows(rows: ThreadTodoRow[]): void {
    memoryRows = rows.map((row) => ({ ...row }));
    if (memoryOnly || !storage) return;
    try { storage.setItem(THREAD_TODO_PREVIEW_STORAGE_KEY, JSON.stringify(rows)); } catch { memoryOnly = true; /* 용량·권한 문제 — 이후 이 창 메모리만 쓴다 */ }
  }
  function withLock<T>(run: () => T): Promise<T> {
    if (locks) return locks.request(THREAD_TODO_PREVIEW_LOCK, async () => run());
    const next = localTail.then(run, run);
    localTail = next.then(() => undefined, () => undefined);
    return next;
  }
  function notifyLocal(): void {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* 화면 오류가 커밋된 쓰기를 되돌리지 않는다 */ }
    }
  }
  function notifyChanged(): void {
    notifyLocal();
    const channel = openChannel?.();
    if (!channel) return;
    try { channel.postMessage({ source: sourceId }); } catch { /* 다음 조회가 저장된 값을 읽는다 */ } finally { channel.close(); }
  }

  return {
    async list(threadKey: unknown): Promise<ThreadTodoRow[]> {
      if (!isValidThreadKey(threadKey)) throw new Error('할 일 대상이 올바르지 않습니다.');
      return readRows().filter((row) => row.thread_key === threadKey);
    },
    async add(actor: ThreadTodoPreviewActor, threadKey: unknown, text: unknown): Promise<ThreadTodoRow> {
      const clean = sanitizeThreadTodoText(text);
      if (!isValidThreadKey(threadKey)) throw new Error('할 일 대상이 올바르지 않습니다.');
      if (!isValidThreadTodoText(clean)) throw new Error('할 일은 1~200자로 적어 주세요.');
      const row = await withLock(() => {
        const rows = readRows();
        const created: ThreadTodoRow = {
          id: newId(), thread_key: threadKey, text: clean,
          created_by: actor.id, created_by_name: actor.name, created_at: now(),
          done_at: null, done_by: null, done_by_name: null,
        };
        writeRows([...rows, created]);
        return created;
      });
      notifyChanged();
      return { ...row };
    },
    async setDone(actor: ThreadTodoPreviewActor, id: unknown, done: unknown): Promise<ThreadTodoRow> {
      const row = await withLock(() => {
        const rows = readRows();
        const target = rows.find((candidate) => candidate.id === id);
        if (!target) throw new Error('이미 지워진 할 일이에요.');
        if (done === true) {
          target.done_at ??= now();
          target.done_by ??= actor.id;
          target.done_by_name ??= actor.name;
        } else {
          target.done_at = null; target.done_by = null; target.done_by_name = null;
        }
        writeRows(rows);
        return target;
      });
      notifyChanged();
      return { ...row };
    },
    async remove(actor: ThreadTodoPreviewActor, id: unknown): Promise<{ ok: boolean; deleted: boolean }> {
      const deleted = await withLock(() => {
        const rows = readRows();
        const index = rows.findIndex((candidate) => candidate.id === id);
        if (index < 0) return false;
        if (!canDeleteThreadTodo(rows[index], actor)) throw new Error('내가 추가한 할 일만 지울 수 있어요.');
        writeRows(rows.filter((_, i) => i !== index));
        return true;
      });
      if (deleted) notifyChanged();
      return { ok: true, deleted };
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
export type ThreadTodoPreviewStore = ReturnType<typeof createThreadTodoPreviewStore>;
