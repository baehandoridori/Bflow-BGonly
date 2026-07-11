import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { canAccessPlayground, resolveAllowedView } from '../src/features/playground/featureFlag.ts';
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

test('playground access is fail-closed to 배한솔 only', () => {
  assert.equal(canAccessPlayground('배한솔'), true);
  for (const blocked of ['다른 사용자', '', ' 배한솔 ', null, undefined, 1234]) {
    assert.equal(canAccessPlayground(blocked), false);
    assert.equal(resolveAllowedView('playground', blocked), 'dashboard');
  }
  assert.equal(resolveAllowedView('playground', '배한솔'), 'playground');
  assert.equal(resolveAllowedView('not-a-view', '배한솔'), 'dashboard');
});

test('playground view follows authenticated user transitions', () => {
  const userNames: unknown[] = [undefined, '배한솔', '다른 사용자'];
  assert.deepEqual(
    userNames.map((userName) => resolveAllowedView('playground', userName)),
    ['dashboard', 'playground', 'dashboard'],
  );
});

test('playground has a stable navigation label', () => {
  assert.equal(getNavigationBackLabel(baseState), '배플레이그라운드');
});

test('sidebar, app and layout wire one global playground route', () => {
  const featureFlag = readFileSync('src/features/playground/featureFlag.ts', 'utf8');
  const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const layout = readFileSync('src/components/layout/MainLayout.tsx', 'utf8');
  assert.doesNotMatch(featureFlag, /VITE_ENABLE_PLAYGROUND_PREVIEW|import\.meta\.env/);
  assert.match(sidebar, /id:\s*'playground'.*배플레이그라운드/);
  assert.match(sidebar, /canAccessPlayground\(currentUserName\)/);
  assert.match(app, /lazy\(\(\) => import\('@\/views\/PlaygroundView'\)\)/);
  assert.match(app, /case 'playground':/);
  assert.match(
    app,
    /resolveAllowedView\(\s*savedPrefs\.defaultView,\s*useAuthStore\.getState\(\)\.currentUser\?\.name,\s*\)/,
  );
  assert.match(app, /resolveAllowedView\(currentView, currentUser\?\.name\)/);
  assert.match(
    layout,
    /const immersive = currentView === 'playground' && canAccessPlayground\(currentUserName\);/,
  );
});

test('profile cannot save Playground as a default view', () => {
  const profile = readFileSync('src/components/settings/ProfileSection.tsx', 'utf8');
  const viewOptions = /const VIEW_OPTIONS[\s\S]*?=\s*\[([\s\S]*?)\];/.exec(profile)?.[1];
  assert.ok(viewOptions, 'VIEW_OPTIONS definition must remain inspectable');
  // Playground is deliberately absent: stale/manual defaults are discarded fail-closed before auth.
  assert.doesNotMatch(viewOptions, /value:\s*'playground'/);
});
