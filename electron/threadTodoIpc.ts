/**
 * 팀 할 일 IPC (피드백 58) — ganttIpc 미러.
 * 렌더러는 스레드 키·텍스트·id 만 보내고, 호출자는 main 의 canonical 세션에서 확정한다(actor id 를 받지 않는다).
 * 권한 판정(작성자/관리자)은 서버 래퍼 전용 — 세션의 role 은 받지도 쓰지도 않는다.
 */
import { ipcMain } from 'electron';
import { THREAD_TODO_RESPONSE_DISCARDED } from '../src/shared/threadTodo';
import { addThreadTodo, listThreadTodos, removeThreadTodo, setThreadTodoDone, type ThreadTodoStore } from './threadTodoStore';

interface SessionOrigin { userId: string; epoch: number }
interface ThreadTodoIpcDependencies {
  getSessionOriginOrThrow(): SessionOrigin;
  onChanged(): void;
  /** Injectable boundaries let persistence/session behavior run without Electron or a live DB. */
  ipc?: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void };
  store?: ThreadTodoStore;
}
const SESSION_REQUIRED = '로그인 세션이 필요합니다. 다시 로그인해 주세요.';

export function registerThreadTodoIpc(deps: ThreadTodoIpcDependencies): void {
  const ipc = deps.ipc ?? ipcMain;
  const store = deps.store ?? { list: listThreadTodos, add: addThreadTodo, setDone: setThreadTodoDone, remove: removeThreadTodo };
  // 세션이 없을 때 main 의 원래 문구('(비공개 일정)' 등)가 팀 할 일 화면에 새지 않게 통일한다.
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
    // 커밋 뒤 세션이 사라진 경우(로그아웃)도 '폐기' 다 — 서버엔 저장됐으므로 실패로 보이면 안 된다.
    try { now = originOrThrow(); } catch { throw new Error(THREAD_TODO_RESPONSE_DISCARDED); }
    if (origin.userId !== now.userId || origin.epoch !== now.epoch) throw new Error(THREAD_TODO_RESPONSE_DISCARDED);
  }
  function checkRequestEpoch(requestEpoch: unknown, origin: SessionOrigin) {
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 변경되었습니다. 화면을 다시 열어 주세요.');
  }
  // 커밋된 변경은 요청한 세션이 바뀌었어도 다른 창을 무효화해야 한다 → onChanged 를 current 검사보다 먼저.
  function notify() {
    try { deps.onChanged(); } catch (error) { console.warn('[thread-todo] 변경 알림 실패:', error); }
  }
  ipc.handle('thread-todo:list', async (_event, threadKey, requestEpoch) => {
    const origin = originOrThrow();
    checkRequestEpoch(requestEpoch, origin);
    const result = await store.list(origin.userId, threadKey);
    current(origin);
    return result;
  });
  ipc.handle('thread-todo:add', async (_event, threadKey, text, requestEpoch) => {
    const origin = originOrThrow();
    checkRequestEpoch(requestEpoch, origin);
    const result = await store.add(origin.userId, threadKey, text);
    notify();
    current(origin);
    return result;
  });
  ipc.handle('thread-todo:set-done', async (_event, id, done, requestEpoch) => {
    const origin = originOrThrow();
    checkRequestEpoch(requestEpoch, origin);
    const result = await store.setDone(origin.userId, id, done);
    notify();
    current(origin);
    return result;
  });
  ipc.handle('thread-todo:delete', async (_event, id, requestEpoch) => {
    const origin = originOrThrow();
    checkRequestEpoch(requestEpoch, origin);
    const result = await store.remove(origin.userId, id);
    notify();
    current(origin);
    return result;
  });
}
