/**
 * 피드백 58: main 팀 할 일 저장소(electron/threadTodoStore.ts)·IPC(electron/threadTodoIpc.ts) 동작 테스트.
 * tests/ganttPersistence.test.ts 와 같은 esbuild 로더 — './supabase' 와 'electron' 을 stub 해 DB·Electron 없이 실행.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

let nonce = 0;
/** 테스트용 세션 해석기: actor id → 결정적 토큰. 실제 앱은 SessionManager 가 canonical 사용자에게만 토큰을 준다. */
const sessions = { tokenFor: (actorId: string) => `token-${actorId}` };
const noSession = { tokenFor(): string { throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.'); } };

async function load(entry: string, client?: unknown) {
  const key = `__threadTodoClient${nonce++}`;
  (globalThis as Record<string, unknown>)[key] = client;
  const result = await build({
    stdin: { contents: `export * from './${entry}';`, resolveDir: process.cwd() },
    bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'no-runtime-io', setup(builder) {
      builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'db', namespace: 'stub' }));
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }));
      builder.onLoad({ filter: /./, namespace: 'stub' }, ({ path }) => ({ contents: path === 'db'
        ? `export const supabase = globalThis.${key} ?? {rpc(){throw new Error("unexpected database access")}};`
        : 'export const ipcMain = {handle(){throw new Error("inject ipc in tests")}};' }));
    } }],
  });
  try { return await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${nonce++}`); }
  finally { delete (globalThis as Record<string, unknown>)[key]; }
}

const ID = '11111111-2222-4333-8444-555555555555';
const KEY = 'EP05:A:a001';
const row = (over: Record<string, unknown> = {}) => ({
  id: ID, thread_key: KEY, text: '출력 크기 키우기', created_by: 'alice', created_by_name: '앨리스',
  created_at: '2026-09-14T00:00:00+00:00', done_at: null, done_by: null, done_by_name: null, ...over,
});
type Call = { name: string; args: Record<string, unknown> };

test('store: 4개 RPC 는 세션 토큰만 보내고 actor id 는 절대 싣지 않는다 (텍스트는 정제해서 보낸다)', async () => {
  const { createThreadTodoStore } = await load('electron/threadTodoStore.ts');
  const calls: Call[] = [];
  const store = createThreadTodoStore({ rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const data = name.endsWith('_list') ? [row(), { id: 'broken' }] : name.endsWith('_delete') ? { ok: true, deleted: true } : row();
    return { data, error: null };
  } }, sessions);
  assert.deepEqual(await store.list('alice', KEY), [row()]);
  assert.deepEqual(await store.add('alice', KEY, '  출력   크기 키우기 '), row());
  assert.deepEqual(await store.setDone('alice', ID, true), row());
  assert.deepEqual(await store.remove('alice', ID), { ok: true, deleted: true });
  assert.deepEqual(calls.map((c) => c.name), [
    'comment_thread_todos_session_list', 'comment_thread_todos_session_add',
    'comment_thread_todos_session_set_done', 'comment_thread_todos_session_delete',
  ]);
  assert.deepEqual(calls[0].args, { p_session_token: 'token-alice', p_thread_key: KEY });
  assert.deepEqual(calls[1].args, { p_session_token: 'token-alice', p_thread_key: KEY, p_text: '출력 크기 키우기' });
  assert.deepEqual(calls[2].args, { p_session_token: 'token-alice', p_id: ID, p_done: true });
  assert.deepEqual(calls[3].args, { p_session_token: 'token-alice', p_id: ID });
  const wire = JSON.stringify(calls);
  assert.equal(wire.includes('p_actor_id'), false);
  assert.equal(wire.includes('"alice"'), false);
});

test('store: 토큰이 없으면 RPC 를 한 번도 부르지 않고 다시 로그인 안내', async () => {
  const { createThreadTodoStore } = await load('electron/threadTodoStore.ts');
  let calls = 0;
  const store = createThreadTodoStore({ rpc: async () => { calls += 1; return { data: null, error: null }; } }, noSession);
  await assert.rejects(store.list('alice', KEY), /다시 로그인/);
  await assert.rejects(store.add('alice', KEY, '할 일'), /다시 로그인/);
  assert.equal(calls, 0);
});

test('store: 입력 검증은 토큰을 꺼내기 전에 끝난다 (빈 텍스트·201자·빈 키·비 UUID → RPC 0회)', async () => {
  const { createThreadTodoStore } = await load('electron/threadTodoStore.ts');
  let calls = 0;
  const store = createThreadTodoStore({ rpc: async () => { calls += 1; return { data: null, error: null }; } }, noSession);
  await assert.rejects(store.add('alice', KEY, '   '), /1~200자/);
  await assert.rejects(store.add('alice', KEY, '가'.repeat(201)), /1~200자/);
  await assert.rejects(store.add('alice', '', '할 일'), /대상이 올바르지/);
  await assert.rejects(store.list('alice', 'k'.repeat(201)), /대상이 올바르지/);
  await assert.rejects(store.setDone('alice', 'not-a-uuid', true), /식별자/);
  await assert.rejects(store.remove('alice', 123), /식별자/);
  assert.equal(calls, 0);
});

test('store: 세션 만료(42501)는 SQLSTATE 를 보존하고, 마이그레이션 미적용은 준비 안내로 바꾼다', async () => {
  const { createThreadTodoStore } = await load('electron/threadTodoStore.ts');
  const expired = createThreadTodoStore({ rpc: async () => ({ data: null, error: { code: '42501', message: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' } }) }, sessions);
  await assert.rejects(expired.list('alice', KEY), (err: Error & { code?: string }) => err.code === '42501' && /다시 로그인/.test(err.message));
  const missing = createThreadTodoStore({ rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'missing function' } }) }, sessions);
  await assert.rejects(missing.add('alice', KEY, '할 일'), /준비가 필요/);
  const malformed = createThreadTodoStore({ rpc: async () => ({ data: { id: 'x' }, error: null }) }, sessions);
  await assert.rejects(malformed.setDone('alice', ID, false), /올바르지 않습니다/);
});

function fakeIpc() {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  return {
    handlers,
    ipc: { handle(channel: string, handler: (...args: unknown[]) => Promise<unknown>) { handlers.set(channel, handler); } },
  };
}

test('ipc: 채널 4개 등록, 요청 epoch 검사, 커밋된 변경은 세션이 바뀌어도 다른 창에 알린 뒤 응답을 폐기한다', async () => {
  const { registerThreadTodoIpc } = await load('electron/threadTodoIpc.ts');
  const { handlers, ipc } = fakeIpc();
  let origin = { userId: 'alice', epoch: 3 };
  const calls: string[] = [];
  const store = {
    list: async (actorId: string) => { calls.push(`list:${actorId}`); return [row()]; },
    add: async (actorId: string) => { calls.push(`add:${actorId}`); origin = { ...origin, epoch: 4 }; return row(); },
    setDone: async (actorId: string) => { calls.push(`setDone:${actorId}`); return row(); },
    remove: async (actorId: string) => { calls.push(`remove:${actorId}`); return { ok: true, deleted: true }; },
  };
  registerThreadTodoIpc({ getSessionOriginOrThrow: () => ({ ...origin }), onChanged: () => calls.push('changed'), ipc, store });
  assert.deepEqual([...handlers.keys()], ['thread-todo:list', 'thread-todo:add', 'thread-todo:set-done', 'thread-todo:delete']);
  await assert.rejects(handlers.get('thread-todo:list')!({}, KEY, 2), /화면을 다시 열어/);
  assert.deepEqual(await handlers.get('thread-todo:list')!({}, KEY, 3), [row()]);
  await assert.rejects(handlers.get('thread-todo:add')!({}, KEY, '할 일', 3), /변경되어/);
  assert.deepEqual(calls, ['list:alice', 'add:alice', 'changed']);
  // 새 epoch 로는 정상 — 호출자 id 는 렌더러가 아니라 main 세션에서 온다.
  assert.deepEqual(await handlers.get('thread-todo:set-done')!({}, ID, true, 4), row());
  assert.deepEqual(await handlers.get('thread-todo:delete')!({}, ID, 4), { ok: true, deleted: true });
  assert.deepEqual(calls.slice(3), ['setDone:alice', 'changed', 'remove:alice', 'changed']);
});

test('ipc: 커밋 뒤 세션이 사라져도(로그아웃) 실패가 아니라 폐기 문구로 답하고 다른 창에는 알린다', async () => {
  const { registerThreadTodoIpc } = await load('electron/threadTodoIpc.ts');
  const { handlers, ipc } = fakeIpc();
  let origin: { userId: string; epoch: number } | null = { userId: 'alice', epoch: 3 };
  const calls: string[] = [];
  const store = {
    list: async () => [],
    add: async () => { calls.push('add'); origin = null; return row(); },
    setDone: async () => row(),
    remove: async () => ({ ok: true, deleted: true }),
  };
  registerThreadTodoIpc({
    getSessionOriginOrThrow: () => { if (!origin) throw new Error('세션에 로그인 사용자 정보가 없습니다 (비공개 일정)'); return { ...origin }; },
    onChanged: () => calls.push('changed'), ipc, store,
  });
  await assert.rejects(handlers.get('thread-todo:add')!({}, KEY, '할 일', 3), (err: Error) => /폐기했습니다/.test(err.message) && !/비공개|필요합니다/.test(err.message));
  assert.deepEqual(calls, ['add', 'changed']);
});

test('ipc: 세션이 아예 없으면 main 의 원래 문구 대신 다시 로그인 안내를 준다', async () => {
  const { registerThreadTodoIpc } = await load('electron/threadTodoIpc.ts');
  const { handlers, ipc } = fakeIpc();
  const store = { list: async () => [], add: async () => row(), setDone: async () => row(), remove: async () => ({ ok: true, deleted: false }) };
  registerThreadTodoIpc({
    getSessionOriginOrThrow: () => { throw new Error('세션에 로그인 사용자 정보가 없습니다 (비공개 일정)'); },
    onChanged: () => {}, ipc, store,
  });
  await assert.rejects(handlers.get('thread-todo:list')!({}, KEY, 0), (err: Error) => /다시 로그인/.test(err.message) && !/비공개/.test(err.message));
});

// ── 구현 후 리뷰(뮤테이션 테스트) 보강 ──
test('store 기본 인스턴스: main 이 리졸버를 넣기 전엔 RPC 없이 거부하고, 넣은 뒤엔 호출 시점의 리졸버 토큰으로 보낸다', async () => {
  const calls: Call[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: [row()], error: null }; } };
  const mod = await load('electron/threadTodoStore.ts', client);
  await assert.rejects(mod.listThreadTodos('alice', KEY), /다시 로그인/);
  assert.equal(calls.length, 0);
  mod.setThreadTodoSessionTokenResolver({ tokenFor: (actorId: string) => `live-${actorId}` });
  assert.deepEqual(await mod.listThreadTodos('alice', KEY), [row()]);
  assert.deepEqual(calls, [{ name: 'comment_thread_todos_session_list', args: { p_session_token: 'live-alice', p_thread_key: KEY } }]);
});

test('store: 삭제·완료 RPC 오류는 성공으로 삼키지 않고, 완료 값은 true 일 때만 true 로 보낸다', async () => {
  const { createThreadTodoStore } = await load('electron/threadTodoStore.ts');
  const denied = createThreadTodoStore({ rpc: async () => ({ data: null, error: { code: '42501', message: '내가 추가한 할 일만 지울 수 있어요.' } }) }, sessions);
  await assert.rejects(denied.remove('alice', ID), (err: Error & { code?: string }) => err.code === '42501' && /내가 추가한/.test(err.message));
  const gone = createThreadTodoStore({ rpc: async () => ({ data: null, error: { code: 'P0002', message: '이미 지워진 할 일이에요.' } }) }, sessions);
  await assert.rejects(gone.setDone('alice', ID, true), /이미 지워진/);
  const notDeleted = createThreadTodoStore({ rpc: async () => ({ data: { ok: true, deleted: false }, error: null }) }, sessions);
  assert.deepEqual(await notDeleted.remove('alice', ID), { ok: true, deleted: false });
  const calls: Call[] = [];
  const store = createThreadTodoStore({ rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: row(), error: null }; } }, sessions);
  await store.setDone('alice', ID, false);
  await store.setDone('alice', ID, 'true');
  assert.deepEqual(calls.map((c) => c.args.p_done), [false, false]);
});

test('ipc: 네 핸들러는 렌더러 인자를 순서 그대로 store 에 넘기고, 오래된 요청 epoch 는 채널마다 store 호출 전에 거절한다', async () => {
  const { registerThreadTodoIpc } = await load('electron/threadTodoIpc.ts');
  const { handlers, ipc } = fakeIpc();
  const calls: unknown[][] = [];
  const store = {
    list: async (...args: unknown[]) => { calls.push(['list', ...args]); return [row()]; },
    add: async (...args: unknown[]) => { calls.push(['add', ...args]); return row(); },
    setDone: async (...args: unknown[]) => { calls.push(['setDone', ...args]); return row(); },
    remove: async (...args: unknown[]) => { calls.push(['remove', ...args]); return { ok: true, deleted: true }; },
  };
  registerThreadTodoIpc({ getSessionOriginOrThrow: () => ({ userId: 'alice', epoch: 7 }), onChanged: () => {}, ipc, store });
  await handlers.get('thread-todo:list')!({}, KEY, 7);
  await handlers.get('thread-todo:add')!({}, KEY, '할 일 본문', 7);
  await handlers.get('thread-todo:set-done')!({}, ID, false, 7);
  await handlers.get('thread-todo:delete')!({}, ID, 7);
  assert.deepEqual(calls, [
    ['list', 'alice', KEY],
    ['add', 'alice', KEY, '할 일 본문'],
    ['setDone', 'alice', ID, false],
    ['remove', 'alice', ID],
  ]);
  calls.length = 0;
  await assert.rejects(handlers.get('thread-todo:list')!({}, KEY, 6), /화면을 다시 열어/);
  await assert.rejects(handlers.get('thread-todo:add')!({}, KEY, '할 일', 6), /화면을 다시 열어/);
  await assert.rejects(handlers.get('thread-todo:set-done')!({}, ID, true, 6), /화면을 다시 열어/);
  await assert.rejects(handlers.get('thread-todo:delete')!({}, ID, 6), /화면을 다시 열어/);
  await assert.rejects(handlers.get('thread-todo:delete')!({}, ID), /화면을 다시 열어/);
  assert.deepEqual(calls, []);
});
