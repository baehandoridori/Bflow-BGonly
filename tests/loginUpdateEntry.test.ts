import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { UpdateInfo } from '../src/types/index.ts';

type Props = {
  children?: ReactNode;
  role?: string;
  disabled?: boolean;
  'aria-label'?: string;
  onClick?: (event: { stopPropagation(): void }) => void | Promise<void>;
  onKeyDown?: (event: { key: string; stopPropagation(): void }) => void;
};
type Element = ReactElement<Props>;
const bundle = build({
  stdin: {
    contents: "export { LoginScreen } from './src/components/auth/LoginScreen.tsx'; export { UpdateCenterModal } from './src/components/update/UpdateCenterModal.tsx';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', write: false,
  define: { __APP_VERSION__: JSON.stringify('1.117.1') },
  external: ['react', 'react/jsx-runtime', 'framer-motion', 'lucide-react', '@/services/*', '@/stores/*', '@/themes', '@/hooks/*', '@/components/effects/*'],
});

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
  const ready: UpdateInfo = {
    currentVersion: '1.117.1', latestVersion: '1.117.2', status: 'ready', ready: true,
    buildAt: '2026-09-07T00:00:00.000Z', releaseNotes: [],
  };
  const state = {
    updateInfo: null as UpdateInfo | null,
    updateCenterOpen: false,
    setUpdateCenterOpen(open: boolean) { state.updateCenterOpen = open; },
    setUpdateInfo(info: UpdateInfo | null) { state.updateInfo = info; },
  };
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
      electronAPI: {
        async checkForUpdates() { calls.check++; return ready; },
        applyUpdateNow() { calls.apply++; },
      },
    }, document, class HTMLElement {},
  );
  function render(name: 'login' | 'modal', mode: 'login' | 'splash' = 'login') {
    if (!slots.has(name)) slots.set(name, []);
    currentSlots = slots.get(name)!; cursor = 0;
    const tree = name === 'login' ? module.exports.LoginScreen({ mode }) : module.exports.UpdateCenterModal();
    const pending = effects; effects = []; pending.forEach((effect) => effect());
    return tree;
  }
  return { state, calls, ready, render };
}

test('signed-out screen exposes its current version and opens the existing update center without logging in or checking automatically', async () => {
  const h = await harness();
  assert.equal(h.render('modal'), null);
  const entry = findButton(h.render('login'), '업데이트 내역');
  assert.match(text(entry), /v1\.117\.1/);
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
  assert.equal(h.state.updateInfo?.latestVersion, '1.117.2');
  const apply = findButton(h.render('modal'), '즉시 업데이트');
  assert.equal(apply.props.disabled, false);
  await apply.props.onClick!({ stopPropagation() {} });
  assert.equal(h.state.updateInfo?.status, 'applying');
  assert.deepEqual(h.calls, { login: 0, check: 1, apply: 1 });
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
