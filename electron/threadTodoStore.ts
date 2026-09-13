/**
 * Main-only 팀 할 일 저장소 (피드백 58) — ganttStore 와 같은 세션 토큰 경계.
 * RPC 는 actor id 가 아니라 서버(app_login)가 발급한 세션 토큰을 받는다. 토큰이 없으면 아무 요청도
 * 보내지 않고, main 의 SessionManager 가 canonical 사용자와 일치할 때만 토큰을 내준다.
 * 입력 검증은 토큰을 꺼내기 전에 끝낸다(잘못된 입력으로 세션 오류를 내지 않게).
 */
import { supabase } from './supabase';
import {
  isThreadTodoRow,
  isValidThreadKey,
  isValidThreadTodoText,
  sanitizeThreadTodoText,
  type ThreadTodoRow,
} from '../src/shared/threadTodo';

type RpcError = { code?: string; message?: string };
export interface ThreadTodoRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>;
}
export interface ThreadTodoSessionResolver {
  tokenFor(actorId: string): string;
}
const SESSION_REQUIRED = '로그인 세션이 필요합니다. 다시 로그인해 주세요.';
let sessionResolver: ThreadTodoSessionResolver = { tokenFor() { throw new Error(SESSION_REQUIRED); } };
/** main 이 SessionManager 배선 뒤 한 번 호출한다. 테스트는 createThreadTodoStore 에 직접 주입한다. */
export function setThreadTodoSessionTokenResolver(resolver: ThreadTodoSessionResolver): void {
  sessionResolver = resolver;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateThreadKey(value: unknown): string {
  if (!isValidThreadKey(value)) throw new Error('할 일 대상이 올바르지 않습니다.');
  return value;
}
export function validateTodoText(value: unknown): string {
  const text = sanitizeThreadTodoText(value);
  if (!isValidThreadTodoText(text)) throw new Error('할 일은 1~200자로 적어 주세요.');
  return text;
}
export function validateTodoId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Error('할 일 식별자가 올바르지 않습니다.');
  return value;
}

function missingMigration(error: RpcError): boolean {
  return ['42P01', 'PGRST205', '42883', 'PGRST202'].includes(error.code ?? '');
}
function fail(error: RpcError): never {
  if (missingMigration(error)) throw new Error('팀 할 일 저장소 준비가 필요합니다. 데이터베이스 업데이트를 적용해 주세요.');
  // SQLSTATE 를 남겨 호출자가 세션 만료(42501)를 구분할 수 있게 한다.
  throw Object.assign(new Error(error.message || '팀 할 일을 저장하지 못했어요.'), { code: error.code });
}
function row(data: unknown): ThreadTodoRow {
  if (!isThreadTodoRow(data)) throw new Error('팀 할 일 저장 결과가 올바르지 않습니다.');
  return data;
}

export function createThreadTodoStore(
  client: ThreadTodoRpcClient,
  session: ThreadTodoSessionResolver = { tokenFor: (actorId) => sessionResolver.tokenFor(actorId) },
) {
  async function list(actorId: string, threadKey: unknown): Promise<ThreadTodoRow[]> {
    const key = validateThreadKey(threadKey);
    const token = session.tokenFor(actorId);
    const { data, error } = await client.rpc('comment_thread_todos_session_list', { p_session_token: token, p_thread_key: key });
    if (error) fail(error);
    return Array.isArray(data) ? data.filter(isThreadTodoRow) : [];
  }
  async function add(actorId: string, threadKey: unknown, text: unknown): Promise<ThreadTodoRow> {
    const key = validateThreadKey(threadKey);
    const clean = validateTodoText(text);
    const token = session.tokenFor(actorId);
    const { data, error } = await client.rpc('comment_thread_todos_session_add', { p_session_token: token, p_thread_key: key, p_text: clean });
    if (error) fail(error);
    return row(data);
  }
  async function setDone(actorId: string, id: unknown, done: unknown): Promise<ThreadTodoRow> {
    const todoId = validateTodoId(id);
    const token = session.tokenFor(actorId);
    const { data, error } = await client.rpc('comment_thread_todos_session_set_done', { p_session_token: token, p_id: todoId, p_done: done === true });
    if (error) fail(error);
    return row(data);
  }
  async function remove(actorId: string, id: unknown): Promise<{ ok: boolean; deleted: boolean }> {
    const todoId = validateTodoId(id);
    const token = session.tokenFor(actorId);
    const { data, error } = await client.rpc('comment_thread_todos_session_delete', { p_session_token: token, p_id: todoId });
    if (error) fail(error);
    return { ok: true, deleted: (data as { deleted?: unknown } | null)?.deleted === true };
  }
  return { list, add, setDone, remove };
}
export type ThreadTodoStore = ReturnType<typeof createThreadTodoStore>;

const persistence = createThreadTodoStore(supabase);
export const listThreadTodos = persistence.list;
export const addThreadTodo = persistence.add;
export const setThreadTodoDone = persistence.setDone;
export const removeThreadTodo = persistence.remove;
