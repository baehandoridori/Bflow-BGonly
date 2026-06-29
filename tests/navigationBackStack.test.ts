import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendNavigationBackSnapshot,
  createNavigationBackSnapshot,
  getNavigationBackLabel,
  NAVIGATION_BACK_STACK_LIMIT,
  type NavigationBackSourceState,
} from '../src/utils/navigationBackStack.ts';

const baseState: NavigationBackSourceState = {
  currentView: 'scenes',
  selectedEpisode: 2,
  selectedPart: 'B',
  selectedDepartment: 'all',
  dashboardDeptFilter: 'all',
  episodeDashboardEp: null,
  selectedAssignee: '한솔',
  searchQuery: 'b018',
  sortKey: 'progress',
  sortDir: 'desc',
  statusFilter: 'in-progress',
  sceneViewMode: 'sheet',
  sceneGroupMode: 'layout',
  settingsTab: null,
};

test('navigation back snapshot captures the scene section and active filters', () => {
  assert.deepEqual(createNavigationBackSnapshot(baseState), {
    ...baseState,
    label: 'EP02 B파트',
  });
});

test('navigation back labels describe non-scene views without losing dashboard episode mode', () => {
  assert.equal(getNavigationBackLabel({ ...baseState, currentView: 'assignee' }), '인원별 현황');
  assert.equal(
    getNavigationBackLabel({
      ...baseState,
      currentView: 'dashboard',
      selectedEpisode: null,
      selectedPart: null,
      episodeDashboardEp: 5,
    }),
    'EP05 대시보드',
  );
});

test('navigation back stack deduplicates adjacent snapshots and keeps a bounded history', () => {
  const first = createNavigationBackSnapshot(baseState);
  const duplicate = createNavigationBackSnapshot({ ...baseState });
  const changed = createNavigationBackSnapshot({ ...baseState, selectedPart: 'C' });

  assert.equal(appendNavigationBackSnapshot([first], duplicate).length, 1);
  assert.deepEqual(appendNavigationBackSnapshot([first], changed), [first, changed]);

  let stack = [] as ReturnType<typeof createNavigationBackSnapshot>[];
  for (let i = 0; i < NAVIGATION_BACK_STACK_LIMIT + 3; i++) {
    stack = appendNavigationBackSnapshot(stack, createNavigationBackSnapshot({
      ...baseState,
      selectedEpisode: i + 1,
    }));
  }

  assert.equal(stack.length, NAVIGATION_BACK_STACK_LIMIT);
  assert.equal(stack[0].selectedEpisode, 4);
  assert.equal(stack[stack.length - 1].selectedEpisode, NAVIGATION_BACK_STACK_LIMIT + 3);
});
