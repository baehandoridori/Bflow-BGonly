import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { GanttSnapshot } from '../src/features/gantt/types.ts';

let nonce = 0;
const token = (actorId: string) => `token-${actorId}`;
/** 테스트용 세션 해석기: actor id → 결정적 토큰. 실제 앱은 SessionManager 가 canonical 사용자에게만 토큰을 준다. */
const sessions = { tokenFor: token };
async function load(entry: string, client?: unknown, extraExports = '') {
  const key = `__ganttPersistenceClient${nonce++}`;
  (globalThis as Record<string, unknown>)[key] = client;
  const result = await build({
    stdin: { contents: `export * from './${entry}';${extraExports}`, resolveDir: process.cwd() },
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

test('read reports missing migration while calendar projection remains compatible', async () => {
  const { createGanttStore } = await load('electron/ganttStore.ts');
  const store = createGanttStore({ rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'missing function' } }) }, sessions);
  await assert.rejects(store.read('alice'), /간트.*준비/);
  assert.deepEqual(await store.listCalendarEvents('alice', {}), []);
});

test('store sends the session token (never an actor id) with the original request id and propagates conflicts', async () => {
  const { createGanttStore } = await load('electron/ganttStore.ts');
  const calls: unknown[] = [];
  const store = createGanttStore({ rpc: async (name: string, args: unknown) => {
    calls.push({ name, args });
    return { data: null, error: { code: '40001', message: '다른 사용자가 먼저 수정했습니다' } };
  } }, sessions);
  const request = { requestId: 'request-1', command: { type: 'deleteProject', projectId: 'p', expectedRevision: 2 } };
  await assert.rejects(store.execute('alice', request), /먼저 수정/);
  assert.deepEqual(calls, [{ name: 'gantt_session_execute', args: { p_session_token: 'token-alice', p_request_id: 'request-1', p_command: request.command } }]);
  assert.equal(JSON.stringify(calls).includes('p_actor_id'), false);
});

test('without a server session the store sends nothing and asks to log in again', async () => {
  const { createGanttStore } = await load('electron/ganttStore.ts');
  let calls = 0;
  const noSession = { tokenFor() { throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.'); } };
  const store = createGanttStore({ rpc: async () => { calls++; return { data: [], error: null }; } }, noSession);
  await assert.rejects(store.read('alice'), /다시 로그인/);
  await assert.rejects(store.execute('alice', { requestId: 'r', command: { type: 'deleteProject', projectId: 'p', expectedRevision: 1 } }), /다시 로그인/);
  // 캘린더 목록은 막히지 않는다: projection 만 비운다.
  assert.deepEqual(await store.listCalendarEvents('alice', {}), []);
  // 쓰기 경로는 조용히 넘어가지 않는다.
  await assert.rejects(store.updateCalendarEvent('alice', 'gantt:project:task', { title: 'x' }, 'cal'), /다시 로그인/);
  assert.equal(calls, 0);
});

test('an expired server session empties the calendar projection but surfaces on projection writes', async () => {
  const { createGanttStore } = await load('electron/ganttStore.ts');
  const expired = { code: '42501', message: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' };
  const store = createGanttStore({ rpc: async () => ({ data: null, error: expired }) }, sessions);
  assert.deepEqual(await store.listCalendarEvents('alice', {}), []);
  await assert.rejects(store.read('alice'), /만료/);
  await assert.rejects(store.updateCalendarEvent('alice', 'gantt:project:task', { title: 'x' }, 'cal'), /만료/);
});

test('projection identifiers are distinct and invalid identifiers never reach SQL', async () => {
  const { createGanttStore, isGanttCalendarEventId } = await load('electron/ganttStore.ts');
  let calls = 0;
  const store = createGanttStore({ rpc: async () => { calls++; return { data: [], error: null }; } }, sessions);
  assert.equal(isGanttCalendarEventId('gantt:project:task'), true);
  assert.equal(isGanttCalendarEventId('calendar-1'), false);
  await assert.rejects(store.updateCalendarEvent('alice', 'ordinary-event', {}, 'cal'), /간트 일정/);
  assert.equal(calls, 0);
});

test('calendar store routes projection identities away from UUID event storage', async () => {
  const calls: string[] = [];
  const store = await load('electron/calendarStore.ts', {
    from() { throw new Error('projection must not query UUID calendar_events table'); },
    async rpc(name: string) {
      calls.push(name);
      if (name !== 'gantt_session_calendar_events') throw new Error('projection must not call ordinary calendar RPC');
      return { data: [], error: null };
    },
  }, "export { setGanttSessionTokenResolver } from './electron/ganttStore.ts';");
  // 세션 해석기를 배선하기 전에는 projection 조회가 RPC 를 부르지 않는다.
  assert.equal(await store.getEventByIdForWrite('gantt:project:task', 'alice'), null);
  assert.deepEqual(calls, []);
  store.setGanttSessionTokenResolver(sessions);
  assert.equal(await store.getEventByIdForWrite('gantt:project:task', 'alice'), null);
  await assert.rejects(store.updateEvent('gantt:project:task', { title: 'x' }, 'calendar', 'alice'), /연결이 변경/);
  await assert.rejects(store.deleteEvent('gantt:project:task', 'calendar', 'alice'), /연결이 변경/);
  assert.deepEqual(calls, ['gantt_session_calendar_events', 'gantt_session_calendar_events', 'gantt_session_calendar_events']);
});

test('IPC discards reads when canonical session changes during persistence', async () => {
  const { registerGanttIpc } = await load('electron/ganttIpc.ts');
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  let origin = { userId: 'alice', epoch: 1 };
  let finish!: (snapshot: GanttSnapshot) => void;
  registerGanttIpc({
    getSessionOriginOrThrow: () => origin,
    ipc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
    store: { read: () => new Promise((resolve) => { finish = resolve; }), execute: async () => ({ spaces: [], projects: [] }) },
    onChanged() {},
  });
  const pending = handlers.get('gantt:read')!({}, 1);
  origin = { userId: 'bob', epoch: 2 };
  finish({ spaces: [], projects: [] });
  await assert.rejects(pending, /세션/);
});

test('IPC fixes actor before await, ignores renderer actor, and broadcasts only committed writes', async () => {
  const { registerGanttIpc } = await load('electron/ganttIpc.ts');
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const actors: string[] = []; let changed = 0; let fail = false;
  registerGanttIpc({
    getSessionOriginOrThrow: () => ({ userId: 'alice', epoch: 1 }),
    ipc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
    store: { read: async () => ({ spaces: [], projects: [] }), execute: async (actor: string) => {
      actors.push(actor); if (fail) throw new Error('권한 없음'); return { spaces: [], projects: [] };
    } },
    onChanged() { changed++; },
  });
  const input = { actorId: 'bob', requestId: 'request-1', command: { type: 'deleteProject', projectId: 'p', expectedRevision: 1 } };
  await handlers.get('gantt:execute')!({}, input, 1);
  fail = true;
  await assert.rejects(handlers.get('gantt:execute')!({}, input, 1), /권한/);
  assert.deepEqual(actors, ['alice', 'alice']); assert.equal(changed, 1);
});

test('IPC validates request shape before executing persistence', async () => {
  const { registerGanttIpc } = await load('electron/ganttIpc.ts');
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>(); let calls = 0;
  registerGanttIpc({
    getSessionOriginOrThrow: () => ({ userId: 'alice', epoch: 1 }),
    ipc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
    store: { read: async () => ({ spaces: [], projects: [] }), execute: async () => { calls++; return { spaces: [], projects: [] }; } },
    onChanged() {},
  });
  await assert.rejects(handlers.get('gantt:execute')!({}, { requestId: '', command: {} }, 1), /요청/);
  assert.equal(calls, 0);
});

test('an old-session commit still invalidates other windows without returning private results', async () => {
  const { registerGanttIpc } = await load('electron/ganttIpc.ts');
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>(); let changed = 0;
  let origin = { userId: 'alice', epoch: 1 }; let finish!: (snapshot: GanttSnapshot) => void;
  registerGanttIpc({
    getSessionOriginOrThrow: () => origin,
    ipc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
    store: { read: async () => ({ spaces: [], projects: [] }), execute: async () => new Promise((resolve) => { finish = resolve; }) },
    onChanged() { changed++; },
  });
  const pending = handlers.get('gantt:execute')!({}, { requestId: 'old-commit', command: { type: 'deleteProject', projectId: 'p', expectedRevision: 1 } }, 1);
  origin = { userId: 'bob', epoch: 2 }; finish({ spaces: [], projects: [] });
  await assert.rejects(pending, /세션/); assert.equal(changed, 1);
});

test('IPC rejects a queued previous-session request before reading or writing', async () => {
  const { registerGanttIpc } = await load('electron/ganttIpc.ts');
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>(); let calls = 0;
  registerGanttIpc({
    getSessionOriginOrThrow: () => ({ userId: 'bob', epoch: 2 }),
    ipc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
    store: { read: async () => { calls++; return { spaces: [], projects: [] }; }, execute: async () => { calls++; return { spaces: [], projects: [] }; } }, onChanged() {},
  });
  await assert.rejects(handlers.get('gantt:read')!({}, 1), /세션/);
  await assert.rejects(handlers.get('gantt:execute')!({}, {}, 1), /세션/);
  assert.equal(calls, 0);
});

// Optional local PostgreSQL runtime, installed outside the project. CI's ordinary suite
// still covers the store/IPC; run this with BFLOW_PGLITE_MODULE for real SQL transactions.
test('PostgreSQL migration, ACL, CAS, replay, projection, and calendar deletion transactions', {
  skip: !process.env.BFLOW_PGLITE_MODULE,
}, async (t) => {
  const { PGlite } = await import(pathToFileURL(process.env.BFLOW_PGLITE_MODULE!).href);
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT DEFAULT 'user',name TEXT DEFAULT '',password TEXT,slack_id TEXT,hire_date TEXT,birthday TEXT,
        is_initial_password BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT now(),is_compositor BOOLEAN DEFAULT false,is_acting_supervisor BOOLEAN DEFAULT false);
      CREATE TABLE calendars(id UUID PRIMARY KEY,owner_id TEXT REFERENCES users(id),visibility TEXT,is_personal BOOLEAN DEFAULT false);
      CREATE TABLE calendar_members(calendar_id UUID REFERENCES calendars(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id),can_edit BOOLEAN,PRIMARY KEY(calendar_id,user_id));
      INSERT INTO users(id,name,password) VALUES('alice','alice','pw'),('bob','bob','pw'),('carol','carol','pw'),('dave','dave','pw');
      INSERT INTO calendars VALUES('00000000-0000-4000-8000-000000000010','alice','team',false);
      INSERT INTO calendar_members VALUES('00000000-0000-4000-8000-000000000010','bob',true);
    `);
    const sql = readFileSync(new URL('../DEVLOG/migrations/2026-09-05-gantt-workspaces.sql', import.meta.url), 'utf8');
    // 2026-09-05-gantt-containment.sql 은 anon/authenticated 역할을 전제하므로(PGlite 에 없음) 건너뛴다.
    // app-sessions 마이그레이션은 역할 유무를 검사하며 같은 회수를 수행한다.
    const sessionsSql = readFileSync(new URL('../DEVLOG/migrations/2026-09-05-app-sessions-gantt-auth.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql); await db.exec(sessionsSql); await db.exec(sessionsSql);
    const { createGanttStore } = await load('electron/ganttStore.ts');
    const client = { rpc: async (name: string, args: Record<string, unknown>) => {
      try {
        const values = Object.values(args);
        const result = await db.query(`SELECT public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) AS result`, values);
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    } };
    // 실제 앱처럼 서버 로그인으로 토큰을 받는다. actor id 는 RPC 로 전달되지 않는다.
    const tokens: Record<string, string> = {};
    for (const id of ['alice', 'bob', 'carol', 'dave']) {
      const login = await db.query('SELECT public.app_login($1,$2) AS result', [id, 'pw']);
      tokens[id] = (login.rows[0].result as { token: string }).token;
    }
    const store = createGanttStore(client, { tokenFor: (id) => tokens[id] });
    await t.test('server login issues tokens, rejects wrong passwords, and wrappers reject unknown or revoked tokens', async () => {
      const bad = await db.query('SELECT public.app_login($1,$2) AS result', ['alice', 'nope']);
      assert.equal((bad.rows[0].result as { ok: boolean }).ok, false);
      const forged = await client.rpc('gantt_session_read', { p_session_token: '0'.repeat(64) });
      assert.ok(forged.error); assert.match(String((forged.error as Error).message), /다시 로그인/);
      const extra = await db.query('SELECT public.app_login($1,$2) AS result', ['dave', 'pw']);
      const extraToken = (extra.rows[0].result as { token: string }).token;
      assert.equal((await client.rpc('gantt_session_read', { p_session_token: extraToken })).error, null);
      await db.query('SELECT public.app_logout($1)', [extraToken]);
      const revoked = await client.rpc('gantt_session_read', { p_session_token: extraToken });
      assert.ok(revoked.error); assert.match(String((revoked.error as Error).message), /만료/);
      const hashes = await db.query('SELECT token_hash FROM app_sessions');
      assert.ok(hashes.rows.every((row) => !Object.values(tokens).includes((row as { token_hash: string }).token_hash)), 'raw tokens are never stored');
    });
    const space = { id: '00000000-0000-4000-8000-000000000001', ownerId: 'alice', name: '교육', shared: true, revision: 1,
      members: [{ userId: 'bob', canEdit: true }, { userId: 'carol', canEdit: false }] };
    const task = { id: '00000000-0000-4000-8000-000000000003', parentId: null, kind: 'task', title: '첫 수업', memo: '공유 메모',
      startDate: '2026-09-05', endDate: '2026-09-05', allDay: true, startTime: '', endTime: '', mode: 'manual', predecessorId: null,
      progress: 0, progressMode: 'manual', sceneLinks: [], workers: ['alice'], attendees: [], color: null,
      calendarId: '00000000-0000-4000-8000-000000000010', calendarEventId: null, completed: false, sortOrder: 0 };
    const project = { id: '00000000-0000-4000-8000-000000000002', spaceId: space.id, ownerId: 'alice', name: '신입 교육', memo: '비공개 프로젝트 메모',
      color: '#6C5CE7', completed: false, revision: 1, memberIds: null, editorIds: null, linkedEpisode: null,
      tasks: [task, { ...task, id: '00000000-0000-4000-8000-000000000004', title: '후속 수업', mode: 'auto', predecessorId: task.id,
        startDate: '2026-09-06', endDate: '2026-09-06' }] };
    const createSpace = { requestId: 'space-create', command: { type: 'saveSpace', space, expectedRevision: null } };
    const createProject = { requestId: 'project-create', command: { type: 'saveProject', project, expectedRevision: null } };
    await store.execute('alice', createSpace); await store.execute('alice', createProject);
    await t.test('request replay does not duplicate records or revisions', async () => {
      const result = await store.execute('alice', createProject);
      assert.equal(result.projects.length, 1); assert.equal(result.projects[0].revision, 1);
      await assert.rejects(store.execute('alice', { ...createProject, command: { ...createProject.command, project: { ...project, name: '다른 내용' } } }), /같은 요청 ID/);
    });
    await t.test('calendar-only viewers receive shared projection, never project metadata', async () => {
      assert.deepEqual((await store.read('dave')).projects, []);
      const rows = await store.listCalendarEvents('dave', {});
      assert.equal(rows.length, 2); assert.equal(rows[0].gantt_can_edit, false); assert.equal(rows[0].memo, '공유 메모');
      assert.equal('workers' in rows[0], false); assert.equal('tasks' in rows[0], false);
      await assert.rejects(store.updateCalendarEvent('dave', rows[0].id, { title: '공격' }, task.calendarId), /양쪽/);
    });
    await t.test('space viewers cannot write and raw SQL rejects forged project visibility', async () => {
      await assert.rejects(store.execute('carol', { requestId: 'readonly', command: { ...createProject.command, expectedRevision: 1 } }), /편집 권한/);
      const result = await client.rpc('gantt_execute', { p_actor_id: 'alice', p_request_id: 'bad-member', p_command: {
        ...createProject.command, expectedRevision: 1, project: { ...project, memberIds: ['dave'] },
      } });
      assert.ok(result.error); assert.equal((await store.read('alice')).projects[0].revision, 1);
    });
    await t.test('calendar edit moves automatic successor and commits one revision', async () => {
      const row = (await store.listCalendarEvents('bob', { eventId: `gantt:${project.id}:${task.id}` }))[0];
      await store.updateCalendarEvent('bob', row.id, { title: '연기된 수업', start_date: '2026-09-07', end_date: '2026-09-07' }, task.calendarId);
      const saved = (await store.read('alice')).projects[0];
      assert.equal(saved.revision, 2); assert.equal(saved.tasks[0].title, '연기된 수업'); assert.equal(saved.tasks[1].startDate, '2026-09-08');
      await assert.rejects(store.execute('alice', { requestId: 'stale', command: { ...createProject.command, expectedRevision: 1 } }), /먼저 수정/);
    });
    await t.test('denied linked-calendar change rolls back every task and receipt', async () => {
      const saved = (await store.read('alice')).projects[0];
      const changed = structuredClone(saved); changed.tasks[0].title = '저장되면 안 됨'; changed.tasks[1].calendarId = '00000000-0000-4000-8000-000000000099';
      await assert.rejects(store.execute('alice', { requestId: 'atomic-failure', command: { type: 'saveProject', project: changed, expectedRevision: 2 } }), /캘린더/);
      assert.deepEqual((await store.read('alice')).projects[0], saved);
      const receipts = await db.query("SELECT count(*)::INTEGER AS count FROM gantt_requests WHERE request_id='atomic-failure'");
      assert.equal(receipts.rows[0].count, 0);
    });
    await t.test('time fields round trip through the one canonical task and auto tasks require explicit manual mode', async () => {
      await db.exec('BEGIN');
      try {
        const row = await store.updateCalendarEvent('alice', `gantt:${project.id}:${task.id}`, { all_day: false, start_time: '10:00', end_time: '14:00' }, task.calendarId);
        assert.equal(row.all_day, false); assert.equal(row.start_time, '10:00'); assert.equal(row.end_time, '14:00');
        assert.equal((await store.read('alice')).projects[0].tasks[0].startTime, '10:00');
        await assert.rejects(store.updateCalendarEvent('alice', `gantt:${project.id}:${project.tasks[1].id}`, { start_date: '2026-09-09', end_date: '2026-09-09' }, task.calendarId), /수동으로 전환/);
      } finally { await db.exec('ROLLBACK'); }
    });
    await t.test('revoked calendar edit rights block shared edits but not unrelated project colors', async () => {
      await db.exec('BEGIN');
      try {
        await db.exec("UPDATE calendar_members SET can_edit=false WHERE user_id='bob'");
        const before = (await store.read('bob')).projects[0];
        const saved = await store.execute('bob', { requestId: 'color-without-calendar-edit', command: { type: 'saveProject', expectedRevision: before.revision, project: { ...before, color: '#123456' } } });
        assert.equal(saved.projects[0].color, '#123456');
        await assert.rejects(store.updateCalendarEvent('bob', `gantt:${project.id}:${task.id}`, { title: '안 됨' }, task.calendarId), /양쪽/);
      } finally { await db.exec('ROLLBACK'); }
    });
    await t.test('raw RPC rejects malformed aggregates and combined parent/dependency cycles atomically', async () => {
      const saved = (await store.read('alice')).projects[0];
      const malformed = structuredClone(saved); delete malformed.memberIds;
      let result = await client.rpc('gantt_execute', { p_actor_id: 'alice', p_request_id: 'malformed', p_command: { type: 'saveProject', expectedRevision: 2, project: malformed } });
      assert.ok(result.error);
      const cyclic = structuredClone(saved);
      cyclic.tasks[0].kind = 'group'; cyclic.tasks[1].parentId = cyclic.tasks[0].id; cyclic.tasks[1].predecessorId = cyclic.tasks[0].id;
      result = await client.rpc('gantt_execute', { p_actor_id: 'alice', p_request_id: 'cyclic', p_command: { type: 'saveProject', expectedRevision: 2, project: cyclic } });
      assert.ok(result.error); assert.match(result.error.message, /순환/);
      const inheritedCycle = structuredClone(saved);
      inheritedCycle.tasks[0].kind = 'group'; inheritedCycle.tasks[0].predecessorId = '00000000-0000-4000-8000-000000000005';
      inheritedCycle.tasks[1].parentId = inheritedCycle.tasks[0].id; inheritedCycle.tasks[1].predecessorId = null;
      inheritedCycle.tasks.push({ ...inheritedCycle.tasks[1], id: inheritedCycle.tasks[0].predecessorId, parentId: null, predecessorId: inheritedCycle.tasks[1].id });
      result = await client.rpc('gantt_execute', { p_actor_id: 'alice', p_request_id: 'inherited-cycle', p_command: { type: 'saveProject', expectedRevision: 2, project: inheritedCycle } });
      assert.ok(result.error); assert.match(result.error.message, /순환/);
      assert.deepEqual((await store.read('alice')).projects[0], saved);
    });
    await t.test('unlink removes the calendar entry while preserving the task', async () => {
      await store.unlinkCalendarEvent('alice', `gantt:${project.id}:${task.id}`, task.calendarId);
      const saved = (await store.read('alice')).projects[0];
      assert.equal(saved.tasks.length, 2); assert.equal(saved.tasks[0].calendarId, null); assert.equal(saved.revision, 3);
      assert.equal((await store.listCalendarEvents('alice', {})).length, 1);
    });
    await t.test('calendar deletion unlinks remaining tasks and invalidates stale project saves', async () => {
      const before = (await store.read('alice')).projects[0];
      await db.query('DELETE FROM calendars WHERE id=$1', [task.calendarId]);
      const after = (await store.read('alice')).projects[0];
      assert.equal(after.revision, 4); assert.equal(after.tasks.length, 2); assert.equal(after.tasks[1].calendarId, null);
      await assert.rejects(store.execute('alice', { requestId: 'stale-link', command: { type: 'saveProject', project: before, expectedRevision: 3 } }), /먼저 수정/);
    });
    await t.test('request replay cannot return project contents after membership revocation', async () => {
      await db.exec('BEGIN');
      try {
        const before = (await store.read('bob')).projects[0];
        const request = { requestId: 'bob-before-revocation', command: { type: 'saveProject', expectedRevision: before.revision, project: before } };
        await store.execute('bob', request);
        await store.execute('alice', { requestId: 'revoke-bob', command: { type: 'saveSpace', expectedRevision: 1, space: { ...space, members: [] } } });
        assert.deepEqual(await store.execute('bob', request), { spaces: [], projects: [] });
      } finally { await db.exec('ROLLBACK'); }
    });
    await t.test('restricted projects remain hidden and request replay returns current revisions', async () => {
      const saved = (await store.read('alice')).projects[0];
      const restricted = { ...saved, memberIds: ['bob'], editorIds: [] };
      await store.execute('alice', { requestId: 'restrict', command: { type: 'saveProject', expectedRevision: 4, project: restricted } });
      assert.equal((await store.read('carol')).projects.length, 0);
      assert.equal((await store.read('bob')).projects.length, 1);
      await assert.rejects(store.execute('bob', { requestId: 'not-editor', command: { type: 'saveProject', expectedRevision: 5, project: { ...restricted, revision: 5 } } }), /프로젝트 편집/);
      await store.execute('alice', { requestId: 'remove-member', command: { type: 'saveSpace', expectedRevision: 1, space: { ...space, members: [] } } });
      assert.deepEqual(await store.read('bob'), { spaces: [], projects: [] });
      const replay = await store.execute('alice', createProject);
      assert.equal(replay.projects[0].revision, 5);
    });
    await t.test('user deletion requires a successor, preserves shared projects, and removes personal projects', async () => {
      const personalSpace = { ...space, id: '00000000-0000-4000-8000-000000000011', name: '개인', shared: false, members: [] };
      const personalProject = { ...project, id: '00000000-0000-4000-8000-000000000012', spaceId: personalSpace.id, tasks: [{ ...task, calendarId: null }] };
      await store.execute('alice', { requestId: 'personal-space', command: { type: 'saveSpace', space: personalSpace, expectedRevision: null } });
      await store.execute('alice', { requestId: 'personal-project', command: { type: 'saveProject', project: personalProject, expectedRevision: null } });
      await assert.rejects(db.query("DELETE FROM users WHERE id='alice'"), /다른 관리자/);
      assert.equal((await store.read('alice')).projects.length, 2);
      await db.exec("UPDATE users SET role='admin',name='배한솔' WHERE id='carol'");
      await db.query("DELETE FROM users WHERE id='alice'");
      const inherited = await store.read('carol');
      assert.equal(inherited.spaces.length, 1); assert.equal(inherited.spaces[0].ownerId, 'carol');
      assert.equal(inherited.projects.length, 1); assert.equal(inherited.projects[0].ownerId, 'carol');
      assert.ok(inherited.projects[0].revision > 5); assert.deepEqual(inherited.projects[0].tasks[0].workers, []);
      assert.equal((await store.listCalendarEvents('carol', {})).length, 0);
    });
  } finally { await db.close(); }
});
