import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import type { AppUser, ElectronAPI } from '../src/types/index.ts';

type LoginResult = { ok: boolean; user?: AppUser; error?: string };
type PreviewWindow = {
  electronAPI: ElectronAPI | undefined;
  location: { protocol: string };
  localStorage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  __bflowMockSetLoginServerAvailable?: (available: boolean) => void;
};
const previewBundle = build({
  stdin: {
    contents: "export { installDevElectronAPI } from './src/mocks/devElectronAPI.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false,
});
const serviceBundle = build({
  stdin: {
    contents: "export { login, loadSession } from './src/services/userService.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false,
  external: ['@/stores/useAuthStore'],
});

/** The actual browser installation and renderer service; no replacement login implementation. */
async function harness(protocol = 'http:', initialStorage: Iterable<[string, string]> = []) {
  const values = new Map(initialStorage);
  const window: PreviewWindow = {
    electronAPI: undefined,
    location: { protocol },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    },
  };
  const document = { documentElement: { dataset: {} as Record<string, string> } };
  const preview = { exports: {} as { installDevElectronAPI(): void } };
  new Function('module', 'exports', 'window', 'document', 'navigator', 'BroadcastChannel', 'fetch', (await previewBundle).outputFiles[0].text)(
    preview, preview.exports, window, document, {}, undefined,
    () => { throw new Error('Login preview must not make external requests'); },
  );
  preview.exports.installDevElectronAPI();
  const service = { exports: {} as {
    login(name: string, password: string, rememberMe?: boolean): Promise<LoginResult>;
    loadSession(): Promise<{ user: AppUser | null }>;
  } };
  new Function('require', 'module', 'exports', 'window', (await serviceBundle).outputFiles[0].text)(
    (name: string) => {
      if (name === '@/stores/useAuthStore') return {};
      throw new Error(`Unexpected renderer dependency: ${name}`);
    }, service, service.exports, window,
  );
  return { window, document, values, service: service.exports };
}

function assertRecoverableFailure(result: LoginResult) {
  assert.equal(result.ok, false);
  assert.equal(result.user, undefined);
  assert.match(result.error ?? '', /로그인 서버|연결/);
  assert.match(result.error ?? '', /다시|재시도/);
  assert.match(result.error ?? '', /업데이트/);
  assert.doesNotMatch(result.error ?? '', /등록되지|비밀번호가 일치|private IPC detail/);
}

test('renderer settles an IPC rejection into a retryable failure without directory fallback', async () => {
  const { window, service } = await harness();
  const api = window.electronAPI!;
  const originalLogin = api.loginCanonicalSession;
  let directoryReads = 0;
  window.electronAPI = new Proxy(api, {
    get(target, key, receiver) {
      if (key === 'usersRead' || key === 'supabaseReadUsers') {
        directoryReads++;
        throw new Error('Login must not read the renderer directory');
      }
      return Reflect.get(target, key, receiver);
    },
  });
  api.loginCanonicalSession = async () => { throw new Error('private IPC detail'); };
  const failed = await service.login('배한솔', '1234');
  assertRecoverableFailure(failed);
  assert.match(failed.error ?? '', /종료|재시작/);
  assert.equal(directoryReads, 0);

  api.loginCanonicalSession = originalLogin;
  const retry = await service.login('배한솔', '1234');
  assert.equal(retry.ok, true);
  assert.equal(retry.user?.name, '배한솔');
  assert.equal(directoryReads, 0);
});

test('renderer settles a missing bridge or login method into update guidance', async () => {
  const { window, service } = await harness();
  window.electronAPI = undefined;
  assertRecoverableFailure(await service.login('배한솔', '1234'));
  window.electronAPI = {} as ElectronAPI;
  assertRecoverableFailure(await service.login('배한솔', '1234'));
});

test('normal installed preview keeps successful login and credential rejection unchanged', async () => {
  const { service } = await harness();
  const denied = await service.login('배한솔', 'wrong-preview-password');
  assert.equal(denied.ok, false);
  assert.equal(denied.error, '이름 또는 비밀번호가 일치하지 않습니다.');
  const accepted = await service.login('배한솔', '1234');
  assert.equal(accepted.ok, true);
  assert.equal(accepted.user?.id, '1');
  assert.equal('password' in accepted.user!, false);
});

test('installed preview rejects an unavailable login server before reading its user directory', async () => {
  const { window, service, values } = await harness();
  const api = window.electronAPI!;
  await api.usersRead();
  const users = await api.readSettings('__users') as unknown[];
  let directoryReads = 0;
  await api.writeSettings('__users', new Proxy(users, {
    get(target, key, receiver) {
      directoryReads++;
      return Reflect.get(target, key, receiver);
    },
  }));
  const storageBefore = [...values];
  window.__bflowMockSetLoginServerAvailable?.(false);
  const unavailable = await service.login('배한솔', '1234');
  assertRecoverableFailure(unavailable);
  assert.match(unavailable.error ?? '', /프리뷰|모의/);
  assert.equal(directoryReads, 0, 'no mock credential or current-user directory lookup while unavailable');
  assert.deepEqual([...values], storageBefore);

  window.__bflowMockSetLoginServerAvailable?.(true);
  const retry = await service.login('배한솔', '1234');
  assert.equal(retry.ok, true);
  assert.equal(retry.user?.id, '1');
  assert.ok(directoryReads > 0, 'recovery resumes the normal installed mock credential path');
});

test('unavailable new login preserves the current session and remembered restoration', async () => {
  const { window, service, values } = await harness();
  assert.equal((await service.login('장삐쭈', '1234', true)).ok, true);
  const before = await window.electronAPI!.ensureCanonicalSession();
  const rememberedStorage = [...values];
  window.__bflowMockSetLoginServerAvailable?.(false);
  const rawFailure = await window.electronAPI!.loginCanonicalSession({ name: '배한솔', password: '1234', rememberMe: false });
  assert.equal(rawFailure.ok, false);
  assert.deepEqual(rawFailure.payload, before.payload, 'failed raw IPC response retains the current canonical payload');
  assertRecoverableFailure(await service.login('배한솔', '1234', false));
  assert.deepEqual([...values], rememberedStorage, 'failed login cannot clear remember-me or overwrite data');
  const current = await window.electronAPI!.ensureCanonicalSession();
  assert.deepEqual(current.payload.user, before.payload.user);
  assert.equal(current.payload.epoch, before.payload.epoch);

  const reopened = await harness('http:', rememberedStorage);
  reopened.window.__bflowMockSetLoginServerAvailable?.(false);
  assert.equal((await reopened.service.loadSession()).user?.id, '2', 'existing remembered restoration is unchanged');
  assert.deepEqual([...reopened.values], rememberedStorage);

  window.__bflowMockSetLoginServerAvailable?.(true);
  assert.equal((await service.login('배한솔', '1234', false)).ok, true);
  assert.equal((await window.electronAPI!.ensureCanonicalSession()).payload.user?.id, '1');
});

test('unavailable raw login returns a detached current snapshot without looking up an active user', async () => {
  const { window } = await harness();
  const api = window.electronAPI!;
  const current = await api.loginCanonicalSession({ name: '장삐쭈', password: '1234' });
  assert.equal(current.ok, true);
  const users = await api.readSettings('__users') as unknown[];
  let directoryReads = 0;
  await api.writeSettings('__users', new Proxy(users, {
    get(target, key, receiver) {
      directoryReads++;
      return Reflect.get(target, key, receiver);
    },
  }));
  window.__bflowMockSetLoginServerAvailable?.(false);
  const failed = await api.loginCanonicalSession({ name: '배한솔', password: '1234' });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.payload, current.payload);
  assert.equal(directoryReads, 0);

  failed.payload.user!.name = 'response-only mutation';
  failed.payload.session!.userName = 'response-only mutation';
  const retry = await api.loginCanonicalSession({ name: '배한솔', password: '1234' });
  assert.deepEqual(retry.payload, current.payload, 'a caller cannot alter canonical state through a returned snapshot');
  assert.equal(directoryReads, 0);
});

test('failed login snapshots track successful switch, logout, and remembered restoration', async () => {
  const { window, values } = await harness();
  const api = window.electronAPI!;
  await api.loginCanonicalSession({ name: '장삐쭈', password: '1234', rememberMe: true });
  const switched = await api.loginCanonicalSession({ name: '허혜원', password: '1234', rememberMe: true });
  assert.equal(switched.payload.user?.id, '3');
  const rememberedStorage = [...values];
  window.__bflowMockSetLoginServerAvailable?.(false);
  const afterSwitch = await api.loginCanonicalSession({ name: '배한솔', password: '1234' });
  assert.equal(afterSwitch.ok, false);
  assert.deepEqual(afterSwitch.payload, switched.payload);

  const loggedOut = await api.logoutCanonicalSession();
  assert.equal(loggedOut.payload.user, null);
  const afterLogout = await api.loginCanonicalSession({ name: '배한솔', password: '1234' });
  assert.equal(afterLogout.ok, false);
  assert.deepEqual(afterLogout.payload, loggedOut.payload);

  const reopened = await harness('http:', rememberedStorage);
  reopened.window.__bflowMockSetLoginServerAvailable?.(false);
  const restored = await reopened.window.electronAPI!.restoreCanonicalSession();
  assert.equal(restored.payload.user?.id, '3');
  const afterRestore = await reopened.window.electronAPI!.loginCanonicalSession({ name: '배한솔', password: '1234' });
  assert.equal(afterRestore.ok, false);
  assert.deepEqual(afterRestore.payload, restored.payload);
});

test('packaged file protocol never installs the preview API or availability hook', async () => {
  const { window, document, values } = await harness('file:');
  assert.equal(window.electronAPI, undefined);
  assert.equal(window.__bflowMockSetLoginServerAvailable, undefined);
  assert.equal(document.documentElement.dataset.devElectronApi, undefined);
  assert.deepEqual([...values], []);
});
