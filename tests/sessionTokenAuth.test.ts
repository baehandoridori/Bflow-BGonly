import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionManager } from '../electron/sessionManager.ts';
import type {
  RememberedAuthSession,
  RemoteLoginResult,
  SessionManagerDependencies,
  SessionUserRecord,
} from '../electron/sessionManager.ts';

type HarnessOptions = {
  users?: SessionUserRecord[];
  status?: 'authoritative' | 'fallback' | 'remote-unavailable';
  remembered?: RememberedAuthSession | null;
  remoteLogin?: (name: string, password: string) => Promise<RemoteLoginResult>;
  remoteLogout?: (token: string) => Promise<void>;
  readUsers?: SessionManagerDependencies['readUsers'];
};

function harness(options: HarnessOptions = {}) {
  const written: Array<RememberedAuthSession | null> = [];
  const published: Array<{ user: { id: string } | null; session: RememberedAuthSession | null }> = [];
  const revoked: string[] = [];
  const directoryReads: number[] = [];
  const users = options.users ?? [{ id: 'user-a', name: 'A' }];
  const dependencies: SessionManagerDependencies = {
    readUsers: async () => {
      directoryReads.push(1);
      return options.readUsers ? options.readUsers() : { users, status: options.status ?? 'authoritative' };
    },
    readRememberedSession: async () => options.remembered ?? null,
    writeRememberedSession: async (session) => { written.push(session ? { ...session } : null); },
    beginPersonalDataTransition: () => undefined,
    endPersonalDataTransition: () => undefined,
    drainPersonalDataQueue: async () => undefined,
    beginPrivacyReplacementTransition: () => undefined,
    drainPrivacyReplacementTransition: async () => undefined,
    flushCalendarJournal: async () => undefined,
    setActivityUser: () => undefined,
    broadcast: (payload) => { published.push({ user: payload.user, session: payload.session }); },
    remoteLogout: options.remoteLogout ?? (async (token) => { revoked.push(token); }),
  };
  if (options.remoteLogin) dependencies.remoteLogin = options.remoteLogin;
  return { manager: new SessionManager(dependencies), written, published, revoked, directoryReads };
}

const serverUser: SessionUserRecord = { id: 'user-a', name: 'A', role: 'user' };
const okLogin = (token: string, user: SessionUserRecord = serverUser): RemoteLoginResult => ({ status: 'ok', token, user });

test('server login keeps the token in main only: remembered file has it, published payloads never do', async () => {
  const { manager, written, published } = harness({ remoteLogin: async () => okLogin('t-1') });
  const result = await manager.login({ name: 'A', password: 'ignored-by-test-server' });
  assert.equal(result.ok, true);
  assert.equal(manager.getSessionToken(), 't-1');
  assert.equal(manager.getSessionTokenFor('user-a'), 't-1');
  assert.throws(() => manager.getSessionTokenFor('user-b'), /다시 로그인/);
  assert.equal(written[0]?.sessionToken, 't-1');
  assert.equal(published.length, 1);
  assert.equal('sessionToken' in (published[0].session ?? {}), false);
  assert.equal('sessionToken' in (result.payload.session ?? {}), false);
  assert.equal('sessionToken' in (manager.getCurrentPayload().session ?? {}), false);
});

for (const error of ['비밀번호가 일치하지 않습니다.', '등록되지 않은 사용자입니다.', '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.']) {
  test(`server rejection is final despite matching local credentials: ${error}`, async () => {
    const { manager, directoryReads, written, published } = harness({
      users: [{ id: 'user-a', name: 'A', password: 'a' }],
      remoteLogin: async () => ({ status: 'rejected', error }),
    });
    const result = await manager.login({ name: 'A', password: 'a' });
    assert.equal(result.ok, false);
    assert.equal(result.error, error);
    assert.equal(manager.getCanonicalUserId(), null);
    assert.equal(manager.getSessionToken(), null);
    assert.deepEqual(directoryReads, []);
    assert.deepEqual(written, []);
    assert.deepEqual(published, []);
  });
}

for (const password of ['cached-password', 'new-server-password']) {
  test(`an unavailable login server never authenticates or judges a cached password (${password})`, async () => {
    const { manager, written, published, directoryReads } = harness({
      users: [{ id: 'user-a', name: 'A', password: 'cached-password' }],
      status: 'fallback',
      remoteLogin: async () => ({ status: 'unavailable', error: 'private connection details' }),
    });
    const result = await manager.login({ name: 'A', password });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /로그인 서버/);
    assert.doesNotMatch(result.error ?? '', /비밀번호가 일치하지|등록되지 않은|private connection details/);
    assert.equal(manager.getCanonicalUserId(), null);
    assert.equal(manager.getSessionToken(), null);
    assert.deepEqual(written, []);
    assert.deepEqual(published, []);
    assert.deepEqual(directoryReads, [], 'new login must not depend on a cached user directory');
  });
}

test('a directory without passwords cannot approve a login while the server is unreachable', async () => {
  const { manager } = harness({
    users: [{ id: 'user-a', name: 'A' }],
    remoteLogin: async () => ({ status: 'unavailable', error: 'fetch failed' }),
  });
  const result = await manager.login({ name: 'A', password: 'a' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /로그인 서버/);
  assert.equal(manager.getCanonicalUserId(), null);
});

for (const status of ['fallback', 'remote-unavailable'] as const) {
  test(`an incomplete ${status} directory cannot label a missing login as unregistered`, async () => {
    const { manager, written, published } = harness({
      users: status === 'fallback' ? [{ id: 'another-user', name: 'B' }] : [],
      status,
      remoteLogin: async () => ({ status: 'unavailable', error: 'internal connection details' }),
    });
    const result = await manager.login({ name: 'A', password: 'test-only' });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /로그인 서버/);
    assert.match(result.error ?? '', /업데이트/);
    assert.doesNotMatch(result.error ?? '', /등록되지 않은|internal connection details/);
    assert.equal(manager.getCanonicalUserId(), null);
    assert.equal(manager.getSessionToken(), null);
    assert.deepEqual(written, []);
    assert.deepEqual(published, []);
  });
}

test('a directory cannot declare a name unregistered when the login server is unavailable', async () => {
  const { manager, directoryReads } = harness({
    users: [],
    status: 'authoritative',
    remoteLogin: async () => ({ status: 'unavailable' }),
  });
  const result = await manager.login({ name: 'A', password: 'test-only' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /로그인 서버/);
  assert.doesNotMatch(result.error ?? '', /등록되지 않은/);
  assert.deepEqual(directoryReads, []);
});

test('a passwordless directory reports a safe recovery message, not raw server details', async () => {
  const { manager } = harness({
    users: [{ id: 'user-a', name: 'A' }],
    remoteLogin: async () => ({ status: 'unavailable', error: 'internal connection details' }),
  });
  const result = await manager.login({ name: 'A', password: 'test-only' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /로그인 서버/);
  assert.match(result.error ?? '', /업데이트/);
  assert.doesNotMatch(result.error ?? '', /internal connection details/);
});

test('a missing login provider fails closed without falling back to local credentials', async () => {
  const { manager, written, published, directoryReads } = harness({ users: [{ id: 'user-a', name: 'A', password: 'a' }] });
  const result = await manager.login({ name: 'A', password: 'a' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /로그인 서버/);
  assert.equal(manager.getSessionToken(), null);
  assert.deepEqual(written, []);
  assert.deepEqual(published, []);
  assert.deepEqual(directoryReads, []);
});

test('a thrown login transport error is safe and never triggers directory fallback', async () => {
  const { manager, written, published, directoryReads } = harness({
    remoteLogin: async () => { throw new Error('private transport details'); },
    readUsers: async () => { throw new Error('damaged local directory'); },
  });
  const result = await manager.login({ name: 'A', password: 'test-only' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /로그인 서버/);
  assert.doesNotMatch(result.error ?? '', /private transport details|damaged local directory/);
  assert.deepEqual(directoryReads, []);
  assert.deepEqual(written, []);
  assert.deepEqual(published, []);
});

test('successful server authentication ignores a missing or damaged local directory', async () => {
  const { manager, directoryReads } = harness({
    remoteLogin: async (name, password) => {
      assert.equal(name, 'A');
      assert.equal(password, 'current-server-password');
      return okLogin('server-only-token');
    },
    readUsers: async () => { throw new Error('damaged local directory'); },
  });
  assert.equal((await manager.login({ name: 'A', password: 'current-server-password' })).ok, true);
  assert.equal(manager.getSessionTokenFor('user-a'), 'server-only-token');
  assert.deepEqual(directoryReads, []);
});

test('a user can retry after connection recovery without changing saved account data', async () => {
  let available = false;
  let calls = 0;
  const { manager, written, published, directoryReads } = harness({
    users: [],
    remoteLogin: async () => {
      calls += 1;
      return available ? okLogin('recovered-token') : { status: 'unavailable' };
    },
  });
  const input = { name: 'A', password: 'test-only' };
  assert.equal((await manager.login(input)).ok, false);
  assert.equal(calls, 1, 'do not automatically repeat a password submission');
  assert.deepEqual(written, []);
  assert.deepEqual(published, []);
  available = true;
  assert.equal((await manager.login(input)).ok, true);
  assert.equal(calls, 2);
  assert.equal(manager.getSessionTokenFor('user-a'), 'recovered-token');
  assert.deepEqual(directoryReads, []);
});

test('a failed new login preserves the existing verified session and remembered record', async () => {
  let available = true;
  const { manager, written, published, revoked } = harness({
    remoteLogin: async () => available ? okLogin('existing-token') : { status: 'unavailable' },
  });
  assert.equal((await manager.login({ name: 'A', password: 'test-only' })).ok, true);
  const originalPayload = manager.getCurrentPayload();
  const originalWrites = [...written];
  available = false;
  assert.equal((await manager.login({ name: 'B', password: 'test-only', rememberMe: false })).ok, false);
  assert.deepEqual(manager.getCurrentPayload(), originalPayload);
  assert.equal(manager.getSessionTokenFor('user-a'), 'existing-token');
  assert.deepEqual(written, originalWrites);
  assert.equal(published.length, 1);
  assert.deepEqual(revoked, []);
});

test('restore reloads the remembered token, and logout revokes it on the server', async () => {
  const { manager, published, revoked } = harness({
    remembered: { userId: 'user-a', userName: 'A', loggedInAt: '2026-09-05T00:00:00.000Z', sessionToken: 't-old' },
  });
  assert.equal((await manager.restore()).ok, true);
  assert.equal(manager.getSessionTokenFor('user-a'), 't-old');
  assert.equal('sessionToken' in (published[0].session ?? {}), false);
  assert.equal((await manager.logout()).ok, true);
  assert.equal(manager.getSessionToken(), null);
  assert.deepEqual(revoked, ['t-old']);
});

for (const sessionToken of [undefined, null, '']) {
  test(`server-backed restore refuses identity without a usable token (${String(sessionToken)}) and allows fresh login`, async () => {
    let loginCalls = 0;
    const remembered = { userId: 'user-a', userName: 'A', loggedInAt: '2026-09-05T00:00:00.000Z', sessionToken };
    const { manager, published, written } = harness({
      remembered,
      remoteLogin: async () => { loginCalls += 1; return okLogin('t-reauthenticated'); },
    });
    const restored = await manager.restore();
    assert.equal(restored.ok, false);
    assert.match(restored.error ?? '', /다시 로그인/);
    assert.equal(restored.payload.user, null);
    assert.equal(manager.getCanonicalUserId(), null);
    assert.equal((await manager.ensure()).ok, false);
    assert.equal(published.length, 0, 'identity alone must not start personal-data loads');
    assert.equal(written.length, 0, 'a transient decryption failure must not destroy the stored record');
    assert.equal(loginCalls, 0, 'restore cannot silently manufacture credentials');
    assert.throws(() => manager.getSessionTokenFor('user-a'), /다시 로그인/);
    assert.equal((await manager.login({ name: 'A', password: 'test-only' })).ok, true);
    assert.equal(manager.getSessionTokenFor('user-a'), 't-reauthenticated');
    assert.equal(loginCalls, 1);
  });
}

test('server-backed restore keeps a valid remembered token without requesting a password', async () => {
  let loginCalls = 0;
  const { manager } = harness({
    remembered: { userId: 'user-a', userName: 'A', loggedInAt: '2026-09-05T00:00:00.000Z', sessionToken: 't-remembered' },
    remoteLogin: async () => { loginCalls += 1; return okLogin('unexpected'); },
  });
  assert.equal((await manager.restore()).ok, true);
  assert.equal(manager.getSessionTokenFor('user-a'), 't-remembered');
  assert.equal(loginCalls, 0);
});

test('switching users revokes the previous server token and keeps only the new one', async () => {
  const users: SessionUserRecord[] = [{ id: 'user-a', name: 'A' }, { id: 'user-b', name: 'B' }];
  const { manager, revoked } = harness({
    users,
    remoteLogin: async (name) => okLogin(name === 'A' ? 't-a' : 't-b', users.find((user) => user.name === name)!),
  });
  await manager.login({ name: 'A', password: 'x' });
  await manager.login({ name: 'B', password: 'x' });
  assert.equal(manager.getSessionTokenFor('user-b'), 't-b');
  assert.throws(() => manager.getSessionTokenFor('user-a'), /다시 로그인/);
  assert.deepEqual(revoked, ['t-a']);
});

test('rememberMe=false keeps the token in memory without writing it to disk', async () => {
  const { manager, written } = harness({ remoteLogin: async () => okLogin('t-mem') });
  await manager.login({ name: 'A', password: 'x', rememberMe: false });
  assert.deepEqual(written, [null]);
  assert.equal(manager.getSessionToken(), 't-mem');
});

test('a failed server revoke never blocks logout', async () => {
  const { manager } = harness({
    remoteLogin: async () => okLogin('t-1'),
    remoteLogout: async () => { throw new Error('network down'); },
  });
  await manager.login({ name: 'A', password: 'x' });
  assert.equal((await manager.logout()).ok, true);
  assert.equal(manager.getSessionToken(), null);
});
