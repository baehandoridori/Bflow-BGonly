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
};

function harness(options: HarnessOptions = {}) {
  const written: Array<RememberedAuthSession | null> = [];
  const published: Array<{ user: { id: string } | null; session: RememberedAuthSession | null }> = [];
  const revoked: string[] = [];
  const users = options.users ?? [{ id: 'user-a', name: 'A' }];
  const dependencies: SessionManagerDependencies = {
    readUsers: async () => ({ users, status: options.status ?? 'authoritative' }),
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
  return { manager: new SessionManager(dependencies), written, published, revoked };
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

test('a server rejection is final even when a local directory would have matched the password', async () => {
  const { manager } = harness({
    users: [{ id: 'user-a', name: 'A', password: 'a' }],
    remoteLogin: async () => ({ status: 'rejected', error: '비밀번호가 일치하지 않습니다.' }),
  });
  const result = await manager.login({ name: 'A', password: 'a' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /비밀번호/);
  assert.equal(manager.getCanonicalUserId(), null);
  assert.equal(manager.getSessionToken(), null);
});

test('offline fallback verifies against a directory that carries passwords and leaves no server token', async () => {
  const { manager, written } = harness({
    users: [{ id: 'user-a', name: 'A', password: 'a' }],
    status: 'fallback',
    remoteLogin: async () => ({ status: 'unavailable', error: 'fetch failed' }),
  });
  assert.equal((await manager.login({ name: 'A', password: 'wrong' })).ok, false);
  const result = await manager.login({ name: 'A', password: 'a' });
  assert.equal(result.ok, true);
  assert.equal(manager.getSessionToken(), null);
  assert.equal(written.at(-1)?.sessionToken, null);
  assert.throws(() => manager.getSessionTokenFor('user-a'), /로그인 세션이 필요/);
});

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

test('without a remoteLogin dependency the legacy directory check still works (existing tests)', async () => {
  const { manager } = harness({ users: [{ id: 'user-a', name: 'A', password: 'a' }] });
  assert.equal((await manager.login({ name: 'A', password: 'a' })).ok, true);
  assert.equal(manager.getSessionToken(), null);
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
