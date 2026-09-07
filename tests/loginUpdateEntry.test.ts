import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build, transformSync } from 'esbuild';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { ElectronAPI, UpdateInfo } from '../src/types/index.ts';

type Props = {
  children?: ReactNode;
  role?: string;
  disabled?: boolean;
  'aria-label'?: string;
  onClick?: (event: { stopPropagation(): void }) => void | Promise<void>;
  onKeyDown?: (event: { key: string; stopPropagation(): void }) => void;
};
type Element = ReactElement<Props>;
const appVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
const bundle = build({
  stdin: {
    contents: "export { LoginScreen } from './src/components/auth/LoginScreen.tsx'; export { UpdateCenterModal } from './src/components/update/UpdateCenterModal.tsx';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', write: false,
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  external: ['react', 'react/jsx-runtime', 'framer-motion', 'lucide-react', '@/services/*', '@/stores/*', '@/themes', '@/hooks/*', '@/components/effects/*'],
});
const previewBundle = build({
  stdin: {
    contents: "export { installDevElectronAPI } from './src/mocks/devElectronAPI.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false,
});

/** Install the same complete browser API as main.tsx, without replacing updater methods. */
async function installPreviewApi() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const window = { localStorage, electronAPI: undefined as ElectronAPI | undefined };
  const document = { documentElement: { dataset: {} } };
  const module = { exports: {} as { installDevElectronAPI(): void } };
  new Function('module', 'exports', 'window', 'document', 'navigator', 'BroadcastChannel', 'fetch', (await previewBundle).outputFiles[0].text)(
    module, module.exports, window, document, {}, undefined,
    () => { throw new Error('The preview updater must not make external requests'); },
  );
  module.exports.installDevElectronAPI();
  assert.ok(window.electronAPI, 'installDevElectronAPI installs the real browser API');
  return window.electronAPI;
}

function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement(node) ? text((node.props as Props).children) : '';
}
function findButton(tree: ReactNode, label: string): Element {
  const found = elements(tree).find((element) => element.type === 'button'
    && (element.props['aria-label']?.includes(label) || text(element).includes(label)));
  assert.ok(found, `${label} button is available without signing in`);
  return found;
}

async function harness(preview = true) {
  const nodeRequire = createRequire(import.meta.url);
  const react = nodeRequire('react');
  const slots = new Map<string, unknown[]>();
  let currentSlots: unknown[] = [], cursor = 0;
  let effects: Array<() => void> = [];
  const calls = { login: 0, check: 0, apply: 0 };
  const api = await installPreviewApi();
  let pendingApply = Promise.resolve();
  // Observe calls without replacing the installed updater's responses or behavior.
  if (api.checkForUpdates) {
    const check = api.checkForUpdates;
    api.checkForUpdates = () => { calls.check++; return check(); };
  }
  if (api.applyUpdateNow) {
    const apply = api.applyUpdateNow;
    api.applyUpdateNow = () => { calls.apply++; return pendingApply = apply(); };
  }
  const state = {
    updateInfo: await api.getUpdateState?.() ?? null,
    updateCenterOpen: false,
    setUpdateCenterOpen(open: boolean) { state.updateCenterOpen = open; },
    setUpdateInfo(info: UpdateInfo | null) { state.updateInfo = info; },
  };
  api.onUpdateState?.((info) => state.setUpdateInfo(info));
  const store = Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state });
  const module = { exports: {} as {
    LoginScreen(props: { mode?: 'login' | 'splash' }): ReactNode;
    UpdateCenterModal(): ReactNode;
  } };
  const document = {
    documentElement: { dataset: { devElectronApi: preview ? 'installed' : undefined } },
    activeElement: null, addEventListener() {}, removeEventListener() {},
  };
  new Function('require', 'module', 'exports', 'window', 'document', 'HTMLElement', (await bundle).outputFiles[0].text)(
    (name: string) => {
      if (name === 'react') return {
        ...react,
        useState(initial: unknown) {
          const index = cursor++, values = currentSlots;
          if (!(index in values)) values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
          return [values[index], (next: unknown) => {
            values[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(values[index]) : next;
          }];
        },
        useRef(initial: unknown) { const index = cursor++; return currentSlots[index] ??= { current: initial }; },
        useCallback(fn: unknown) { return fn; },
        useMemo(factory: () => unknown) { return factory(); },
        useEffect(effect: () => void) { effects.push(effect); },
      };
      if (name === '@/stores/useAppStore') return { useAppStore: store };
      if (name === '@/stores/useAuthStore') return { useAuthStore: () => ({ currentUser: null, setCurrentUser() {} }) };
      if (name === '@/services/userService') return { login() { calls.login++; return Promise.resolve({ ok: false }); } };
      if (name.startsWith('@/')) return {};
      return nodeRequire(name);
    }, module, module.exports,
    {
      location: { search: '' }, setTimeout() { return 0; }, clearTimeout() {},
      electronAPI: api,
    }, document, class HTMLElement {},
  );
  function render(name: 'login' | 'modal', mode: 'login' | 'splash' = 'login') {
    if (!slots.has(name)) slots.set(name, []);
    currentSlots = slots.get(name)!; cursor = 0;
    const tree = name === 'login' ? module.exports.LoginScreen({ mode }) : module.exports.UpdateCenterModal();
    const pending = effects; effects = []; pending.forEach((effect) => effect());
    return tree;
  }
  return { state, calls, api, render, waitForApply: () => pendingApply };
}

test('signed-out screen exposes its current version and opens the existing update center without logging in or checking automatically', async () => {
  const h = await harness();
  assert.equal(h.render('modal'), null);
  const entry = findButton(h.render('login'), '업데이트 내역');
  assert.ok(text(entry).includes(`v${appVersion}`));
  let stopped = false;
  await entry.props.onClick!({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true, 'the click must not advance the background landing screen');
  assert.equal(h.state.updateCenterOpen, true);
  assert.ok(elements(h.render('modal')).some((element) => element.props.role === 'dialog'));
  assert.deepEqual(h.calls, { login: 0, check: 0, apply: 0 });
});

test('signed-out user can explicitly refresh and apply a prepared update through the shared modal', async () => {
  const h = await harness();
  await findButton(h.render('login'), '업데이트 내역').props.onClick!({ stopPropagation() {} });
  await findButton(h.render('modal'), '새로고침').props.onClick!({ stopPropagation() {} });
  assert.equal(h.calls.check, 1);
  assert.match(h.state.updateInfo?.latestVersion ?? '', /-preview$/);
  assert.notEqual(h.state.updateInfo?.latestVersion, appVersion);
  assert.equal(h.state.updateInfo?.preview, true);
  const readyTree = h.render('modal');
  assert.match(text(readyTree), /프리뷰 전용/);
  assert.doesNotMatch(text(readyTree), /설치 파일이 로컬에 준비되었습니다/);
  const apply = findButton(readyTree, '모의 업데이트');
  assert.equal(apply.props.disabled, false);
  await apply.props.onClick!({ stopPropagation() {} });
  assert.equal(h.state.updateInfo?.status, 'applying');
  assert.doesNotMatch(text(h.render('modal')), /업데이트 설치 창을 여는 중입니다/);
  await h.waitForApply();
  assert.equal(h.state.updateInfo?.status, 'up-to-date');
  assert.equal(h.state.updateInfo?.currentVersion, appVersion, 'preview never changes the actual running app version');
  assert.match(text(h.render('modal')), /프리뷰 적용 완료/);
  assert.deepEqual(h.calls, { login: 0, check: 1, apply: 1 });
});

test('installed preview API supports explicit prepare, ready subscriptions, apply, retry, and unsubscribe without a session', async () => {
  const api = await installPreviewApi();
  assert.equal(typeof api.checkForUpdates, 'function', 'the installed browser API must implement the update read path');
  assert.equal((await api.ensureCanonicalSession()).payload?.user, null);
  const states: string[] = [], readyVersions: string[] = [];
  const unsubscribeState = api.onUpdateState!((info) => { if (info) states.push(info.status); });
  const unsubscribeReady = api.onUpdateReady!((version, info) => {
    readyVersions.push(version);
    assert.equal(info?.preview, true);
    assert.equal(info?.ready, true);
  });
  assert.equal((await api.getUpdateState!())?.ready, false);
  await api.applyUpdateNow!();
  assert.equal(states.length, 0, 'apply before prepare must not invent an update');
  const ready = await api.checkForUpdates!();
  assert.equal(ready?.status, 'ready');
  assert.match(ready?.latestVersion ?? '', /-preview$/);
  assert.notEqual(ready?.latestVersion, appVersion);
  assert.deepEqual(readyVersions, [ready?.latestVersion]);
  assert.equal(ready?.preview, true);
  const applying = api.applyUpdateNow!();
  assert.equal((await api.getUpdateState!())?.status, 'applying');
  await api.checkForUpdates!();
  assert.equal((await api.getUpdateState!())?.status, 'applying', 'refresh cannot reopen ready state during apply');
  await applying;
  assert.equal((await api.getUpdateState!())?.status, 'up-to-date');
  assert.ok(states.includes('ready') && states.includes('applying') && states.includes('up-to-date'));
  unsubscribeState(); unsubscribeReady();
  const before = { stateCount: states.length, readyCount: readyVersions.length };
  assert.equal((await api.retryUpdate!())?.status, 'ready');
  assert.deepEqual({ stateCount: states.length, readyCount: readyVersions.length }, before, 'unsubscribed listeners receive no later updates');
});

test('App preview toast describes simulation and refuses a stale apply action after completion', async () => {
  const api = await installPreviewApi();
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('    const cleanup = window.electronAPI?.onUpdateReady?.(');
  const end = source.indexOf('\n    return () => { cleanup?.(); };', start);
  assert.ok(start >= 0 && end > start, 'the App ready subscription is present');
  const subscription = transformSync(source.slice(start, end), {
    loader: 'ts', target: 'es2022', define: { __APP_VERSION__: JSON.stringify(appVersion) },
  }).code;
  const notifications: Array<{ kind: string; title: string; description: string; duration: number; action?: { label: string; onClick(): void } }> = [];
  const toast = (kind: string) => (title: string, options: { description: string; duration: number; action?: { label: string; onClick(): void } }) => {
    notifications.push({ kind, title, ...options });
  };
  let visibleUpdate: UpdateInfo | null = null;
  const observeState = api.onUpdateState!((info) => { visibleUpdate = info; });
  const visible = () => visibleUpdate as UpdateInfo | null;
  const unsubscribe = new Function('window', 'setUpdateInfo', 'sonnerToast', 'useAppStore', `${subscription}\nreturn cleanup;`)(
    { electronAPI: api }, (info: UpdateInfo) => { visibleUpdate = info; },
    { success: toast('success'), loading: toast('loading'), info: toast('info') },
    { getState: () => ({ updateInfo: visibleUpdate }) },
  ) as () => void;
  try {
    await api.checkForUpdates!();
    assert.match(notifications[0].title, /프리뷰/);
    assert.match(notifications[0].description, /실제 설치.*없/);
    assert.equal(notifications[0].action?.label, '모의 업데이트');
    const completed = new Promise<void>((resolve) => {
      const unsubscribeState = api.onUpdateState!((info) => {
        if (info?.status === 'up-to-date') { unsubscribeState(); resolve(); }
      });
    });
    notifications[0].action!.onClick();
    assert.match(notifications[1].description, /실제 앱.*종료되지 않/);
    await completed;
    assert.notEqual(notifications[1].kind, 'loading', 'preview must not leave an indefinite installer loading toast after its simulated completion');
    assert.ok(Number.isFinite(notifications[1].duration));
    assert.equal(visible()?.status, 'up-to-date');
    notifications[0].action!.onClick();
    assert.equal(visible()?.status, 'up-to-date', 'an obsolete ready action must not restore a completed preview to applying');
    assert.equal(notifications.length, 2, 'an obsolete ready action must not announce another apply');
  } finally {
    unsubscribe();
    observeState();
  }
});

test('version entry is also reachable during the signed-out landing animation and isolates keyboard activation', async () => {
  const h = await harness(false);
  const entry = findButton(h.render('login'), '업데이트 내역');
  let stopped = false;
  entry.props.onKeyDown!({ key: 'Enter', stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
});

test('authenticated splash does not expose the signed-out update entry', async () => {
  const h = await harness(false);
  const tree = h.render('login', 'splash');
  assert.equal(elements(tree).some((element) => element.type === 'button'
    && element.props['aria-label']?.includes('업데이트 내역')), false);
});

test('App mounts the shared update dialog in the signed-out return branch', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const signedOutReturn = source.slice(source.indexOf('// 로그인 화면 (비로그인 상태)'), source.indexOf('// 스플래시 랜딩 (로그인 상태에서도 앱 시작 시 표시)'));
  assert.match(signedOutReturn, /<LoginScreen\b/);
  assert.match(signedOutReturn, /<UpdateCenterModal\s*\/>/, 'the real dialog must be mounted alongside the login screen');
});
