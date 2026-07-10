import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isPlaygroundPreviewEnabled, resolveAllowedView } from '../src/features/playground/featureFlag.ts';
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

test('playground preview is on in dev and opt-in only in production', () => {
  assert.equal(isPlaygroundPreviewEnabled({ DEV: true }), true);
  assert.equal(isPlaygroundPreviewEnabled({ DEV: false }), false);
  assert.equal(isPlaygroundPreviewEnabled({ DEV: false, VITE_ENABLE_PLAYGROUND_PREVIEW: 'true' }), true);
  assert.equal(resolveAllowedView('playground', { DEV: false }), 'dashboard');
  assert.equal(resolveAllowedView('playground', { DEV: true }), 'playground');
  assert.equal(resolveAllowedView('not-a-view', { DEV: true }), 'dashboard');
});

test('playground has a stable navigation label', () => {
  assert.equal(getNavigationBackLabel(baseState), '배플레이그라운드');
});

test('sidebar, app and layout wire one global playground route', () => {
  const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const layout = readFileSync('src/components/layout/MainLayout.tsx', 'utf8');
  assert.match(sidebar, /id:\s*'playground'.*배플레이그라운드/);
  assert.match(app, /lazy\(\(\) => import\('@\/views\/PlaygroundView'\)\)/);
  assert.match(app, /case 'playground':/);
  assert.match(app, /resolveAllowedView\(savedPrefs\.defaultView\)/);
  assert.match(app, /resolveAllowedView\(currentView\)/);
  assert.match(layout, /currentView === 'playground'/);
});
