import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  canAccessPlayground,
  isExplicitPlaygroundPreviewMode,
  resolveAllowedView,
} from '../src/features/playground/featureFlag.ts';
import { resolveHeaderTitle } from '../src/components/layout/headerTitle.ts';
import { getNavigationBackLabel, type NavigationBackSourceState } from '../src/utils/navigationBackStack.ts';

const baseState: NavigationBackSourceState = {
  currentView: 'playground',
  selectedEpisode: null,
  selectedPart: null,
  selectedDepartment: 'all',
  dashboardDeptFilter: 'all',
  episodeDashboardEp: null,
  selectedAssignee: null,
  searchQuery: '',
  sortKey: 'no',
  sortDir: 'asc',
  statusFilter: 'all',
  sceneViewMode: 'sheet',
  sceneGroupMode: 'layout',
  settingsTab: null,
};

const canonicalHansol = {
  id: 'fcc4b438-2696-4e88-a03f-d6f34e73e08f',
  name: '배한솔',
};

test('playground production access requires the exact canonical Hansol identity', () => {
  assert.equal(canAccessPlayground(canonicalHansol, false), true);
  assert.equal(canAccessPlayground({ ...canonicalHansol, name: '배한솔' }, false), true);

  const blocked = [
    { ...canonicalHansol, id: 'another-user-id' },
    { ...canonicalHansol, id: ` ${canonicalHansol.id}` },
    { ...canonicalHansol, name: '다른 사용자' },
    { ...canonicalHansol, name: ' 배한솔 ' },
    { id: canonicalHansol.id },
    { name: canonicalHansol.name },
    null,
    undefined,
  ];
  for (const user of blocked) {
    assert.equal(canAccessPlayground(user, false), false);
    assert.equal(resolveAllowedView('playground', user, false), 'dashboard');
  }

  assert.equal(resolveAllowedView('playground', canonicalHansol, false), 'playground');
  assert.equal(resolveAllowedView('not-a-view', canonicalHansol, false), 'dashboard');
});

test('preview Hansol identity is allowed only in an explicit preview context', () => {
  const previewHansol = { id: '1', name: '배한솔' };
  assert.equal(canAccessPlayground(previewHansol, false), false);
  assert.equal(canAccessPlayground(previewHansol, true), true);
  assert.equal(canAccessPlayground({ id: '1', name: '다른 사용자' }, true), false);
  assert.equal(canAccessPlayground({ id: 1, name: '배한솔' }, true), false);
});

test('runtime preview detection requires both the installed mock marker and preview=1', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

  const setPreviewContext = (search: string, marker?: string) => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { search } },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement: { dataset: { devElectronApi: marker } } },
    });
  };

  try {
    setPreviewContext('?preview=1', 'installed');
    assert.equal(isExplicitPlaygroundPreviewMode(), true);
    setPreviewContext('?preview=feedback-hub', 'installed');
    assert.equal(isExplicitPlaygroundPreviewMode(), false);
    setPreviewContext('?preview=1');
    assert.equal(isExplicitPlaygroundPreviewMode(), false);
    setPreviewContext('', 'installed');
    assert.equal(isExplicitPlaygroundPreviewMode(), false);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('playground view follows authenticated user transitions', () => {
  const users = [undefined, canonicalHansol, { id: 'another-user-id', name: '배한솔' }];
  assert.deepEqual(
    users.map((user) => resolveAllowedView('playground', user, false)),
    ['dashboard', 'playground', 'dashboard'],
  );
});

test('an unauthorized stale playground view is synchronously presented only as dashboard', () => {
  const safeView = resolveAllowedView(
    'playground',
    { id: 'another-user-id', name: '배한솔' },
    false,
  );
  const immersive = safeView === 'playground';
  assert.equal(safeView, 'dashboard');
  assert.equal(immersive, false, 'the immersive Playground shell must stay disabled');
  assert.equal(resolveHeaderTitle(safeView, null, {}), '전체 현황 대시보드');

  const app = readFileSync('src/App.tsx', 'utf8');
  const layout = readFileSync('src/components/layout/MainLayout.tsx', 'utf8');
  const header = readFileSync('src/components/layout/Header.tsx', 'utf8');
  assert.match(app, /switch \(safeCurrentView\)/);
  assert.match(app, /<MainLayout activeView=\{safeCurrentView\} onRefresh=\{loadData\}>/);
  assert.match(layout, /const immersive = activeView === 'playground';/);
  assert.match(layout, /<Header activeView=\{activeView\} onRefresh=\{onRefresh\} \/>/);
  assert.match(header, /resolveHeaderTitle\(activeView, episodeDashboardEp, episodeTitles\)/);
  assert.doesNotMatch(header, /const \{\s*currentView[\s,}]/);
});

test('the isolated feedback preview supplies its restricted active view to MainLayout', () => {
  const preview = readFileSync('src/views/FeedbackHubPreviewApp.tsx', 'utf8');
  assert.match(preview, /<MainLayout activeView=\{currentView\} onRefresh=\{seedFeedbackHubPreview\}>/);
});

test('playground has a stable navigation label', () => {
  assert.equal(getNavigationBackLabel(baseState), '배플레이그라운드');
});

test('sidebar, app and layout wire one global playground route', () => {
  const featureFlag = readFileSync('src/features/playground/featureFlag.ts', 'utf8');
  const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const layout = readFileSync('src/components/layout/MainLayout.tsx', 'utf8');
  const header = readFileSync('src/components/layout/Header.tsx', 'utf8');
  const playground = readFileSync('src/views/PlaygroundView.tsx', 'utf8');
  assert.doesNotMatch(featureFlag, /VITE_ENABLE_PLAYGROUND_PREVIEW|import\.meta\.env/);
  assert.match(featureFlag, /document\.documentElement\.dataset\.devElectronApi === 'installed'/);
  assert.match(featureFlag, /new URLSearchParams\(window\.location\.search\)\.get\('preview'\) === '1'/);
  assert.match(sidebar, /id:\s*'playground'.*배플레이그라운드/);
  assert.match(sidebar, /canAccessPlayground\(currentUser\)/);
  assert.match(app, /lazy\(\(\) => import\('@\/views\/PlaygroundView'\)\)/);
  assert.match(app, /case 'playground':/);
  assert.match(
    app,
    /resolveAllowedView\(\s*savedPrefs\.defaultView,\s*useAuthStore\.getState\(\)\.currentUser,\s*\)/,
  );
  assert.match(app, /resolveAllowedView\(currentView, currentUser\)/);
  assert.match(app, /<PlaygroundView authorizedHansol=\{canAccessPlayground\(currentUser\)\} \/>/);
  assert.match(app, /<MainLayout activeView=\{safeCurrentView\} onRefresh=\{loadData\}>/);
  assert.match(layout, /activeView:\s*ViewMode/);
  assert.match(layout, /const immersive = activeView === 'playground';/);
  assert.match(layout, /<Header activeView=\{activeView\} onRefresh=\{onRefresh\} \/>/);
  assert.match(header, /activeView:\s*ViewMode/);
  assert.doesNotMatch(layout, /canAccessPlayground|useAuthStore/);
  assert.match(playground, /authorizedHansol:\s*boolean/);
  assert.match(playground, /authorizedHansol=\{authorizedHansol\}/);
  assert.doesNotMatch(playground, /currentUser\?\.name\.trim\(\) === '배한솔'/);
});

test('profile cannot save Playground as a default view', () => {
  const profile = readFileSync('src/components/settings/ProfileSection.tsx', 'utf8');
  const viewOptions = /const VIEW_OPTIONS[\s\S]*?=\s*\[([\s\S]*?)\];/.exec(profile)?.[1];
  assert.ok(viewOptions, 'VIEW_OPTIONS definition must remain inspectable');
  // Playground is deliberately absent: stale/manual defaults are discarded fail-closed before auth.
  assert.doesNotMatch(viewOptions, /value:\s*'playground'/);
});

test('main window forwards only Windows browser Back and cleans the exact instance listener', () => {
  const main = readFileSync('electron/main.ts', 'utf8');
  assert.match(main, /const windowForPlaygroundBack = mainWindow;/);
  assert.match(main, /windowForPlaygroundBack\.on\('app-command', handlePlaygroundAppCommand\)/);
  assert.match(main, /command !== 'browser-backward'/);
  assert.match(main, /windowForPlaygroundBack\.webContents\.send\('playground:native-back'\)/);
  assert.match(main, /windowForPlaygroundBack\.once\('closed',[\s\S]*?removeListener\('app-command', handlePlaygroundAppCommand\)/);
  assert.doesNotMatch(main, /popupWin\.on\('app-command'/);
});

test('preload native Back subscription has a disposer and is represented by type and preview mock', () => {
  const preload = readFileSync('electron/preload.ts', 'utf8');
  const types = readFileSync('src/types/index.ts', 'utf8');
  const mock = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
  assert.match(preload, /onPlaygroundNativeBack:\s*\(callback:[\s\S]*?ipcRenderer\.on\('playground:native-back', handler\)[\s\S]*?removeListener\('playground:native-back', handler\)/);
  assert.match(types, /onPlaygroundNativeBack\?:\s*\(callback:\s*\(\) => void\) => \(\) => void/);
  assert.match(mock, /onPlaygroundNativeBack:\s*noop/);
});

test('Playground owns one local Back controller for visible and native Back actions', () => {
  const view = readFileSync('src/views/PlaygroundView.tsx', 'utf8');
  const nativeBack = readFileSync('src/features/playground/nativeBackBridge.ts', 'utf8');
  const marketNav = readFileSync('src/views/playground/market/MarketNav.tsx', 'utf8');
  const marketRouter = readFileSync('src/views/playground/market/MarketRouter.tsx', 'utf8');
  assert.match(view, /historyRef\s*=\s*useRef\(createPlaygroundHistory\(initialPlaygroundRoute\)\)/);
  assert.match(view, /const requestBack = \(\) =>/);
  assert.match(view, /requestBackRef\.current\(\)/);
  assert.match(view, /subscribePlaygroundNativeBack\([\s\S]*?return dispose/);
  assert.match(nativeBack, /window\.electronAPI\?\.onPlaygroundNativeBack\?\.\(listener\)/);
  assert.match(view, /onBack=\{requestBack\}/);
  assert.match(marketRouter, /onBack:\s*\(\) => void/);
  assert.match(marketNav, /onClick=\{onBack\}/);
  assert.doesNotMatch(view, /navigationBackStack/);
  assert.doesNotMatch(marketRouter, /navigationBackStack/);
});

test('dot navigation commits history only after coverage and market restore targets real scrollers', () => {
  const view = readFileSync('src/views/PlaygroundView.tsx', 'utf8');
  const router = readFileSync('src/views/playground/market/MarketRouter.tsx', 'utf8');
  const rows = readFileSync('src/views/playground/market/MarketRows.tsx', 'utf8');
  const account = readFileSync('src/views/playground/market/MarketAccountView.tsx', 'utf8');
  assert.match(view, /onCovered=\{\(\) => \{[\s\S]*?commitNavigation\(action\)/);
  assert.match(view, /data-market-page-scroll-container/);
  assert.match(router, /data-market-page-scroll-container/);
  assert.match(router, /data-market-scroll-container/);
  assert.match(router, /market-page-title/);
  assert.match(rows, /id=\{`stock-card-open-\$\{stock\.id\}`\}/);
  assert.match(account, /id=\{`account-holding-open-\$\{holding\.stockId\}`\}/);
});

test('all shared market action dialogs register one top Back interceptor', () => {
  const provider = readFileSync('src/views/playground/PlaygroundBackProvider.tsx', 'utf8');
  const dialog = readFileSync('src/views/playground/market/MarketActionDialog.tsx', 'utf8');
  assert.match(provider, /usePlaygroundBackInterceptor/);
  assert.match(dialog, /usePlaygroundBackInterceptor\(open,/);
});

test('persistent market openers have stable focus restoration ids', () => {
  const nav = readFileSync('src/views/playground/market/MarketNav.tsx', 'utf8');
  const home = readFileSync('src/views/playground/market/MarketHome.tsx', 'utf8');
  const stock = readFileSync('src/views/playground/market/StockDetailView.tsx', 'utf8');
  const account = readFileSync('src/views/playground/market/MarketAccountView.tsx', 'utf8');
  const orderPanel = readFileSync('src/views/playground/market/MarketOrderPanel.tsx', 'utf8');
  for (const id of ['market-nav-home', 'market-nav-browse', 'market-nav-account']) {
    assert.match(nav, new RegExp(`id=["']${id}["']`));
  }
  assert.match(home, /id=\{`market-news-open-\$\{item\.id\}`\}/);
  assert.match(home, /id="beginner-mission-open"/);
  assert.match(stock, /id="stock-open-market-home"/);
  assert.match(stock, /id="stock-open-account"/);
  assert.match(account, /id="account-browse-stocks"/);
  assert.match(
    orderPanel,
    /<button(?:(?!<\/button>)[\s\S])*id="order-open-account"(?:(?!<\/button>)[\s\S])*onClick=\{controller\.onOpenAccount\}/,
  );
});
