/**
 * 씬 댓글 서버 알림(씬 댓글 B안 PR 6): main 저장소(electron/commentNotificationStore.ts)·IPC(electron/commentNotificationIpc.ts).
 * tests/threadTodoPersistence.test.ts 와 같은 esbuild 로더 — './supabase' 와 'electron' 을 stub 해 DB·Electron 없이 실행.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

let nonce = 0;
const sessions = { tokenFor: (actorId: string) => `token-${actorId}` };
const noSession = { tokenFor(): string { throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.'); } };

async function load(entry: string, client?: unknown) {
  const key = `__commentNotificationClient${nonce++}`;
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

const ROW_ID = '11111111-2222-4333-8444-555555555555';
const serverRow = (over: Record<string, unknown> = {}) => ({
  id: ROW_ID, commentId: 'c1', kind: 'add', reason: 'auto', detail: 'assignee',
  eventAt: '2026-11-05T01:02:03.123456+00:00', readAt: null, revisionNo: null,
  comment: {
    partId: 'p1', sceneId: '3', sceneUuid: null, userId: 'kim', userName: '김어진', text: '본문', mentions: ['이혜민'],
    imageCount: 1, parentCommentId: null, revisionId: null, characterId: null, createdAt: '2026-11-05T01:02:03.000Z', editedAt: null,
  },
  ...over,
});
type Call = { name: string; args: Record<string, unknown> };

test('store: 목록·읽음 RPC 는 세션 토큰만 보내고 actor id 는 싣지 않는다, 이상한 줄은 버린다', async () => {
  const calls: Call[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'comment_notifications_session_list') return { data: [serverRow(), { id: 'bad' }, serverRow({ id: '22222222-2222-4333-8444-555555555555', reason: 'auto', detail: null })], error: null };
    return { data: { updated: 2 }, error: null };
  } };
  const { createCommentNotificationStore } = await load('electron/commentNotificationStore.ts');
  const store = createCommentNotificationStore(client, sessions);
  const listed = await store.list('alice', { at: '2026-11-05T01:00:00.000Z', id: null }, 50);
  assert.equal(listed.available, true);
  assert.deepEqual(listed.rows.map((row: { id: string }) => row.id), [ROW_ID], '자동 줄에 종류가 없으면 버린다');
  assert.deepEqual(calls[0], { name: 'comment_notifications_session_list', args: { p_session_token: 'token-alice', p_after_at: '2026-11-05T01:00:00.000Z', p_after_id: null, p_limit: 50 } });
  assert.deepEqual(await store.markRead('alice', { addCommentIds: ['c1', 'c1', 'c2'], editCommentIds: ['c3'] }), { available: true, updated: 2 });
  assert.deepEqual(calls[1], { name: 'comment_notifications_session_mark_read', args: { p_session_token: 'token-alice', p_add_comment_ids: ['c1', 'c2'], p_edit_comment_ids: ['c3'] } });
  for (const call of calls) {
    assert.ok(!Object.values(call.args).includes('alice'), '사람 id 를 싣지 않는다');
    assert.doesNotMatch(Object.keys(call.args).join(','), /p_actor|p_user_id|p_recipient/);
  }
  // 한 번에 받는 수는 200 이 넘지 않는다.
  await store.list('alice', null, 9999);
  assert.equal(calls[2].args.p_limit, 200);
});

test('store: 래퍼가 없으면(DB 적용 전) available:false, 다른 오류는 코드를 남겨 던진다, 세션이 없으면 요청하지 않는다', async () => {
  const { createCommentNotificationStore } = await load('electron/commentNotificationStore.ts');
  for (const code of ['42883', 'PGRST202', '42P01', 'PGRST205']) {
    const store = createCommentNotificationStore({ rpc: async () => ({ data: null, error: { code, message: 'missing' } }) }, sessions);
    assert.deepEqual(await store.list('alice', null), { available: false, rows: [] }, code);
    assert.deepEqual(await store.markRead('alice', { addCommentIds: ['c1'], editCommentIds: [] }), { available: false, updated: 0 }, code);
  }
  const expired = createCommentNotificationStore({ rpc: async () => ({ data: null, error: { code: '42501', message: '로그인 세션이 만료되었습니다.' } }) }, sessions);
  await assert.rejects(expired.list('alice', null), (error: { code?: string }) => error.code === '42501');
  let called = 0;
  const guarded = createCommentNotificationStore({ rpc: async () => { called += 1; return { data: [], error: null }; } }, noSession);
  await assert.rejects(guarded.list('alice', null), /로그인 세션/);
  assert.equal(called, 0);
  // 비어 있는 읽음 요청은 서버에 가지 않는다. 이상한 커서·id 는 토큰을 꺼내기 전에 거절한다.
  assert.deepEqual(await guarded.markRead('alice', { addCommentIds: [], editCommentIds: [] }), { available: true, updated: 0 });
  await assert.rejects(guarded.list('alice', { at: 'not-a-date', id: null }), /커서/);
  await assert.rejects(guarded.list('alice', { at: '2026-11-05T00:00:00Z', id: 'x' }), /커서/);
  await assert.rejects(guarded.markRead('alice', { addCommentIds: ['bad id!'] }), /읽음 대상/);
  await assert.rejects(guarded.markRead('alice', { addCommentIds: Array.from({ length: 501 }, (_, i) => `c${i}`) }), /500/);
  assert.equal(called, 0);
});

test('ipc: 호출자는 main 세션 — 요청 세대가 다르면 거절, 응답 전에 세션이 바뀌면 응답을 버린다', async () => {
  const { registerCommentNotificationIpc } = await load('electron/commentNotificationIpc.ts');
  const { COMMENT_NOTIFICATION_RESPONSE_DISCARDED } = await import('../src/shared/commentNotification.ts');
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  let origin = { userId: 'alice', epoch: 3 };
  const seen: Array<[string, unknown]> = [];
  registerCommentNotificationIpc({
    getSessionOriginOrThrow: () => origin,
    ipc: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => { handlers.set(channel, handler); } },
    store: {
      list: async (actorId: string, cursor: unknown) => { seen.push([actorId, cursor]); return { available: true, rows: [] }; },
      markRead: async (actorId: string, target: unknown) => {
        seen.push([actorId, target]);
        origin = { userId: 'bob', epoch: 4 };
        return { available: true, updated: 1 };
      },
    },
  });
  assert.deepEqual([...handlers.keys()].sort(), ['comment-notifications:list', 'comment-notifications:mark-read']);
  assert.deepEqual(await handlers.get('comment-notifications:list')!(null, null, 50, 3), { available: true, rows: [] });
  assert.deepEqual(seen[0], ['alice', null]);
  await assert.rejects(handlers.get('comment-notifications:list')!(null, null, 50, 2), /세션이 변경/);
  await assert.rejects(handlers.get('comment-notifications:mark-read')!(null, { addCommentIds: ['c1'] }, 3), new RegExp(COMMENT_NOTIFICATION_RESPONSE_DISCARDED));
  origin = null as unknown as typeof origin;
  const throwing = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  registerCommentNotificationIpc({
    getSessionOriginOrThrow: () => { throw new Error('세션에 로그인 사용자 정보가 없습니다 (비공개 일정)'); },
    ipc: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => { throwing.set(channel, handler); } },
    store: { list: async () => ({ available: true, rows: [] }), markRead: async () => ({ available: true, updated: 0 }) },
  });
  await assert.rejects(throwing.get('comment-notifications:list')!(null, null, 50, 0), /^Error: 로그인 세션이 필요합니다/, '다른 기능의 문구가 새지 않는다');
});
