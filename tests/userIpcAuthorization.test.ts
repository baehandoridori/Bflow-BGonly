import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { registerUserAdminIpc } from '../electron/userAdminIpc.ts';
import { registerLegacyPrivateEventIpc } from '../electron/legacyPrivateEventIpc.ts';
import { reconcileAuthoritativeUserDirectory } from '../src/services/authoritativeUserSession.ts';

type Handler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

function handlers() {
  const registered = new Map<string, Handler>();
  return {
    registered,
    ipc: {
      handle(channel: string, handler: Handler) {
        registered.set(channel, handler);
      },
    },
    async invoke(channel: string, ...args: unknown[]) {
      const handler = registered.get(channel);
      assert.ok(handler, `missing handler: ${channel}`);
      return handler({}, ...args);
    },
  };
}

test('user administration binds canonical actor and strips renderer-owned credential fields', async () => {
  const harness = handlers();
  const calls: Array<{ kind: string; args: unknown[] }> = [];
  registerUserAdminIpc(harness.ipc, {
    getCanonicalUserIdOrThrow: () => 'admin-1',
    addUser: async (...args) => { calls.push({ kind: 'add', args }); },
    updateUser: async (...args) => { calls.push({ kind: 'update', args }); },
    deleteUser: async (...args) => { calls.push({ kind: 'delete', args }); },
    refreshCurrentUser: async () => { calls.push({ kind: 'refresh', args: [] }); },
  });

  await harness.invoke('supabase:add-user', {
    id: 'user-2', name: '사용자 2', role: 'user', slackId: 'U2', hireDate: '', birthday: '',
    password: 'renderer-password', isInitialPassword: false, isCompositor: true, extra: 'blocked',
  });
  await harness.invoke('supabase:update-user', 'user-2', {
    role: 'admin', isCompositor: true, isActingSupervisor: true,
  });
  await harness.invoke('supabase:delete-user', 'user-2');

  assert.deepEqual(calls.find((call) => call.kind === 'add'), {
    kind: 'add',
    args: ['admin-1', {
      id: 'user-2', name: '사용자 2', role: 'user', slackId: 'U2', hireDate: '', birthday: '',
    }],
  });
  assert.deepEqual(calls.find((call) => call.kind === 'update'), {
    kind: 'update',
    args: ['admin-1', 'user-2', {
      role: 'admin', isCompositor: true, isActingSupervisor: true,
    }],
  });
  assert.deepEqual(calls.find((call) => call.kind === 'delete'), {
    kind: 'delete', args: ['admin-1', 'user-2'],
  });
  assert.equal(calls.filter((call) => call.kind === 'refresh').length, 0);
});

test('updating or deleting the canonical actor refreshes only that main-owned profile', async () => {
  const harness = handlers();
  let refreshes = 0;
  registerUserAdminIpc(harness.ipc, {
    getCanonicalUserIdOrThrow: () => 'admin-1',
    addUser: async () => {},
    updateUser: async () => {},
    deleteUser: async () => {},
    refreshCurrentUser: async () => { refreshes += 1; },
  });
  await harness.invoke('supabase:update-user', 'admin-1', { name: 'Admin Updated' });
  await harness.invoke('supabase:delete-user', 'admin-1');
  assert.equal(refreshes, 2);
});

test('user administration rejects immutable or credential updates before storage', async () => {
  const harness = handlers();
  let storageCalls = 0;
  registerUserAdminIpc(harness.ipc, {
    getCanonicalUserIdOrThrow: () => 'user-1',
    addUser: async () => { storageCalls += 1; },
    updateUser: async () => { storageCalls += 1; },
    deleteUser: async () => { storageCalls += 1; },
    refreshCurrentUser: async () => {},
  });

  await assert.rejects(
    harness.invoke('supabase:update-user', 'user-1', { password: 'promote-me', role: 'admin' }),
    /허용되지 않는 사용자 수정 필드/,
  );
  await assert.rejects(
    harness.invoke('supabase:update-user', 'user-1', { isInitialPassword: false }),
    /허용되지 않는 사용자 수정 필드/,
  );
  assert.equal(storageCalls, 0);
});

test('deleted live actor cannot read or mutate legacy private events', async () => {
  const harness = handlers();
  const storageCalls: string[] = [];
  registerLegacyPrivateEventIpc(harness.ipc, {
    getSessionUserIdOrThrow: () => 'deleted-user',
    assertLiveUser: async () => { throw new Error('사용자 세션이 더 이상 유효하지 않습니다'); },
    readEvents: async () => { storageCalls.push('read'); return []; },
    addEvent: async () => { storageCalls.push('add'); return { id: 'created' }; },
    getEventOwner: async () => { storageCalls.push('owner'); return 'deleted-user'; },
    updateEvent: async () => { storageCalls.push('update'); },
    deleteEvent: async () => { storageCalls.push('delete'); },
  });

  for (const [channel, args] of [
    ['supabase:read-private-events', []],
    ['supabase:add-private-event', [{ user_id: 'other-user', title: 'private' }]],
    ['supabase:update-private-event', ['event-1', { title: 'changed' }]],
    ['supabase:delete-private-event', ['event-1']],
  ] as const) {
    await assert.rejects(harness.invoke(channel, ...args), /더 이상 유효하지 않습니다/);
  }
  assert.deepEqual(storageCalls, []);
});

test('live legacy private handlers bind reads and creates to the canonical session owner', async () => {
  const harness = handlers();
  const calls: Array<{ kind: string; args: unknown[] }> = [];
  registerLegacyPrivateEventIpc(harness.ipc, {
    getSessionUserIdOrThrow: () => 'user-a',
    assertLiveUser: async (userId) => { calls.push({ kind: 'live', args: [userId] }); },
    readEvents: async (userId) => { calls.push({ kind: 'read', args: [userId] }); return []; },
    addEvent: async (input) => { calls.push({ kind: 'add', args: [input] }); return { id: 'created' }; },
    getEventOwner: async (id) => { calls.push({ kind: 'owner', args: [id] }); return 'user-a'; },
    updateEvent: async (id, ownerId, updates) => {
      calls.push({ kind: 'update', args: [id, ownerId, updates] });
    },
    deleteEvent: async (id) => { calls.push({ kind: 'delete', args: [id] }); },
  });

  await harness.invoke('supabase:read-private-events', 'forged-user');
  await harness.invoke('supabase:add-private-event', { user_id: 'forged-user', title: 'private' });
  await harness.invoke('supabase:update-private-event', 'event-1', { title: 'changed' });
  await harness.invoke('supabase:delete-private-event', 'event-1');

  assert.deepEqual(calls.filter((call) => call.kind === 'read')[0].args, ['user-a']);
  assert.deepEqual(calls.filter((call) => call.kind === 'add')[0].args, [{
    user_id: 'user-a', title: 'private',
  }]);
  assert.equal(calls.filter((call) => call.kind === 'live').length, 4);
  assert.deepEqual(calls.filter((call) => call.kind === 'update')[0].args, [
    'event-1',
    'user-a',
    { title: 'changed' },
  ]);
  assert.equal(calls.filter((call) => call.kind === 'delete').length, 1);
});

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('user admin SQL revalidates locked actor and whitelists admin-owned fields', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const sql = readFileSync(path.join(root, 'DEVLOG', 'migrations', '2026-08-24-shared-calendars.sql'), 'utf8');
  const create = between(sql, 'CREATE OR REPLACE FUNCTION public.create_user_authorized', 'COMMENT ON FUNCTION public.create_user_authorized');
  const update = between(sql, 'CREATE OR REPLACE FUNCTION public.update_user_authorized', 'COMMENT ON FUNCTION public.update_user_authorized');

  for (const fn of [create, update]) {
    assert.match(fn, /LANGUAGE\s+plpgsql\s+SECURITY INVOKER\s+SET search_path\s*=\s*public,\s*pg_temp/s);
    assert.match(fn, /LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;/);
    assert.match(fn, /role\s+IS DISTINCT FROM\s+'admin'[\s\S]*ERRCODE\s*=\s*'42501'/);
  }
  assert.match(create, /NOT EXISTS\s*\(SELECT 1 FROM users\)[\s\S]*p_actor_id[\s\S]*'admin'/s);
  assert.match(update, /ORDER BY id[\s\S]*FOR UPDATE;/s);
  for (const forbidden of ['password', 'is_initial_password', 'created_at']) {
    const allowed = update.match(/v_allowed_keys CONSTANT TEXT\[\] := ARRAY\[([\s\S]*?)\];/);
    assert.ok(allowed);
    assert.doesNotMatch(allowed[1], new RegExp(`'${forbidden}'`));
  }
});

test('authorized user delete locks calendar writers before actor and target rows', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const sql = readFileSync(path.join(root, 'DEVLOG', 'migrations', '2026-08-24-shared-calendars.sql'), 'utf8');
  const fn = between(sql, 'CREATE OR REPLACE FUNCTION public.delete_user_authorized', 'COMMENT ON FUNCTION public.delete_user_authorized');
  const calendarLock = fn.indexOf('LOCK TABLE calendars IN SHARE ROW EXCLUSIVE MODE;');
  const eventLock = fn.indexOf('LOCK TABLE calendar_events IN SHARE ROW EXCLUSIVE MODE;');
  const usersLock = fn.indexOf('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;');
  const rowLock = fn.indexOf('ORDER BY id');
  const permission = fn.indexOf("IS DISTINCT FROM 'admin'");
  const cascade = fn.indexOf('PERFORM public.delete_user_cascade(p_user_id);');

  assert.ok(calendarLock >= 0 && calendarLock < eventLock);
  assert.ok(eventLock < usersLock && usersLock < rowLock);
  assert.ok(rowLock < permission && permission < cascade);
});

test('main and storage route user writes through canonical actor-aware RPCs', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const main = readFileSync(path.join(root, 'electron', 'main.ts'), 'utf8');
  const storage = readFileSync(path.join(root, 'electron', 'supabase.ts'), 'utf8');

  assert.match(main, /registerUserAdminIpc\(ipcMain,[\s\S]*getCanonicalUserIdOrThrow/s);
  assert.match(main, /registerLegacyPrivateEventIpc\(ipcMain,[\s\S]*assertLiveUser/s);
  assert.match(storage, /rpc\('create_user_authorized',[\s\S]*p_actor_id:\s*actorId/s);
  assert.match(storage, /rpc\('update_user_authorized',[\s\S]*p_actor_id:\s*actorId/s);
  assert.match(storage, /rpc\('delete_user_authorized',[\s\S]*p_actor_id:\s*actorId/s);
});

test('empty-directory migration sends the canonical local admin first for one-shot bootstrap', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const service = readFileSync(path.join(root, 'src', 'services', 'userService.ts'), 'utf8');
  assert.match(service, /useAuthStore\.getState\(\)\.currentUser\?\.id/);
  assert.match(service, /orderedUsers[\s\S]*b\.id === actorId[\s\S]*a\.id === actorId/s);
  assert.match(service, /for \(const user of orderedUsers\)[\s\S]*supabaseAddUser\(user\)/s);
});

test('authoritative deletion clears renderer identity and caches before canonical logout finishes', async () => {
  let finishLogout!: (value: { ok: boolean; error?: string }) => void;
  const logout = new Promise<{ ok: boolean; error?: string }>((resolve) => { finishLogout = resolve; });
  const currentUser = { id: 'deleted-user', name: 'Deleted', role: 'user' };
  const currentValues: Array<typeof currentUser | null> = [];
  const userLists: unknown[][] = [];

  const reconciliation = reconcileAuthoritativeUserDirectory([], {
    getCurrentUser: () => currentUser,
    setUsers: (users) => { userLists.push(users); },
    setCurrentUser: (user) => { currentValues.push(user); },
    logoutCanonicalSession: () => logout,
  });

  assert.deepEqual(userLists, [[]]);
  assert.deepEqual(currentValues, [null], 'calendar auth subscription must clear caches synchronously');
  finishLogout({ ok: true });
  assert.equal(await reconciliation, 'deleted');
});

test('authoritative user refresh updates the live profile without logging out', async () => {
  let logoutCalls = 0;
  const currentUser = { id: 'user-1', name: 'Before', role: 'user' };
  const updatedUser = { id: 'user-1', name: 'After', role: 'admin' };
  let applied: typeof currentUser | null = null;
  const result = await reconcileAuthoritativeUserDirectory([updatedUser], {
    getCurrentUser: () => currentUser,
    setUsers: () => {},
    setCurrentUser: (user) => { applied = user; },
    logoutCanonicalSession: async () => { logoutCalls += 1; return { ok: true }; },
  });
  assert.equal(result, 'updated');
  assert.deepEqual(applied, updatedUser);
  assert.equal(logoutCalls, 0);
});

test('a transient directory fetch failure never reaches deletion reconciliation', async () => {
  let reconciliationCalls = 0;
  const fetchAndReconcile = async () => {
    const users = await Promise.reject(new Error('temporary network outage'));
    reconciliationCalls += 1;
    return reconcileAuthoritativeUserDirectory(users, {
      getCurrentUser: () => ({ id: 'user-1' }),
      setUsers: () => {},
      setCurrentUser: () => {},
      logoutCanonicalSession: async () => ({ ok: true }),
    });
  };

  await assert.rejects(fetchAndReconcile(), /temporary network outage/);
  assert.equal(reconciliationCalls, 0);
});

test('App applies deletion policy only after a direct authoritative user-directory fetch', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const app = readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const popup = readFileSync(path.join(root, 'src', 'views', 'WidgetPopup.tsx'), 'utf8');
  assert.match(app, /changedTable === 'users'[\s\S]*fetchFreshUsersFromSupabase\(\)[\s\S]*reconcileAuthoritativeUserDirectory/s);
  assert.doesNotMatch(app, /changedTable === 'users'[\s\S]{0,300}loadUsers\(\)/s);
  assert.match(popup, /reconcilePopupUserDirectory[\s\S]*fetchFreshUsersFromSupabase\(\)[\s\S]*reconcileAuthoritativeUserDirectory/s);
  assert.match(popup, /table === 'users'[\s\S]{0,300}reconcilePopupUserDirectory\(\)/s);
});
