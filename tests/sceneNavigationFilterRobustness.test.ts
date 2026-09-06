import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const readRepoFile = (...segments: string[]) =>
  readFile(path.join(process.cwd(), ...segments), 'utf-8');

test('all-view modal routing searches unfiltered merged scenes', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');
  const useUnifiedScenes = await readRepoFile('src', 'hooks', 'useUnifiedScenes.ts');

  assert.match(scenesView, /const target = allMergedScenes\.find/);
  assert.doesNotMatch(scenesView, /const target = mergedScenes\.find/);
  assert.match(useUnifiedScenes, /getSyncedMergedDetail\(prev, allMergedScenes\)/);
});

test('scene department tabs keep dashboard department filter in sync', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');

  assert.match(scenesView, /setSelectedDepartment\('all'\); setDashboardDeptFilter\('all'\);/);
  assert.match(scenesView, /setSelectedDepartment\(dept\); setDashboardDeptFilter\(dept\);/);
});

test('scene jumps from other views clear stale scene filters', async () => {
  const assigneeView = await readRepoFile('src', 'views', 'AssigneeView.tsx');
  const teamView = await readRepoFile('src', 'views', 'TeamView.tsx');
  const calendarView = await readRepoFile('src', 'views', 'CalendarView.tsx');
  const scheduleView = await readRepoFile('src', 'views', 'ScheduleView.tsx');
  const action = await readRepoFile('src', 'utils', 'sceneNavigationAction.ts');

  for (const source of [assigneeView, teamView, calendarView, scheduleView]) {
    assert.match(source, /navigateToSceneView\(\{/);
  }
  assert.match(action, /app\.pushNavigationBackTarget\(\)/);
  assert.match(action, /app\.setSelectedAssignee\(null\)/);
  assert.match(action, /app\.setSearchQuery\(''\)/);
  assert.match(action, /app\.setStatusFilter\('all'\)/);
});

test('external scene jumps surface a global navigation back button', async () => {
  const header = await readRepoFile('src', 'components', 'layout', 'Header.tsx');
  const app = await readRepoFile('src', 'App.tsx');
  const activityFeed = await readRepoFile('src', 'components', 'widgets', 'activity', 'ActivityFeed.tsx');
  const sceneJumpButton = await readRepoFile('src', 'views', 'compositing', 'SceneJumpButton.tsx');

  assert.match(header, /navigationBackStack\[s\.navigationBackStack\.length - 1\]/);
  assert.match(header, /goBackNavigation/);
  assert.match(header, /돌아가기/);
  assert.match(app, /app\.pushNavigationBackTarget\(\)/);
  assert.match(activityFeed, /navigateToSceneView\(\{/);
  assert.match(sceneJumpButton, /navigateToSceneView\(\{/);
});

test('notification navigation only applies an explicit modal department filter before opening scenes', async () => {
  const action = await readRepoFile('src', 'utils', 'notificationSceneAction.ts');
  const sceneAction = await readRepoFile('src', 'utils', 'sceneNavigationAction.ts');
  const helper = await readRepoFile('src', 'utils', 'notificationHelper.ts');
  const panel = await readRepoFile('src', 'components', 'NotificationPanel.tsx');

  assert.match(action, /resolveNotificationSceneDepartmentFilter\(type,\s*modalRequest,\s*target\)/);
  assert.match(action, /department: targetDeptFilter/);
  assert.match(sceneAction, /app\.setSelectedDepartment\(department\)/);
  assert.match(sceneAction, /app\.setDashboardDeptFilter\(department\)/);
  assert.match(helper, /navigateNotificationToScene\(payload\.type,\s*payload\.metadata\)/);
  assert.match(panel, /navigateNotificationToScene\(n\.type,\s*n\.metadata\)/);
});

test('all-view status filter is applied after BG and ACT are merged', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');

  assert.match(scenesView, /function mergedMatchesStatusFilter/);
  assert.match(scenesView, /searchFilteredMergedScenes\.filter\(\(merged\) => mergedMatchesStatusFilter\(merged, statusFilter, selectedAssignee\)\)/);
  assert.match(scenesView, /filterAndSortScenes\(bgPart\.scenes, \{ applyStatusFilter: selectedDepartment !== 'all' \}\)/);
});

test('pending scene modal requests wait for scene data before clearing an unmatched request', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');

  assert.match(scenesView, /let matchedPendingSceneRequest = false;/);
  assert.match(scenesView, /matchedPendingSceneRequest = true;[\s\S]*?setPendingReq\(null\);/);
  assert.match(scenesView, /if \(allMergedScenes\.length === 0\) \{\s*return;\s*\}/);
  assert.match(scenesView, /if \(!currentPart \|\| currentPart\.scenes\.length === 0\) \{\s*return;\s*\}/);
  assert.match(scenesView, /if \(!matchedPendingSceneRequest\) \{[\s\S]*?setPendingReq\(null\);/);
});

test('compositing revision scene jump preserves the current scene department filter', async () => {
  const jumpButton = await readRepoFile('src', 'views', 'compositing', 'SceneJumpButton.tsx');
  const detailPanel = await readRepoFile('src', 'views', 'compositing', 'RevisionDetailPanel.tsx');

  assert.doesNotMatch(jumpButton, /department\?: 'bg' \| 'acting';/);
  assert.doesNotMatch(jumpButton, /forceDeptFilter/);
  assert.doesNotMatch(detailPanel, /department=\{revision\.department/);
  assert.match(jumpButton, /if \(openRetakeScene\) \{\s*openRetakeScene\(\{ sceneKey, sceneUuid, focusRevisionId \}\);\s*return;/);
  assert.match(detailPanel, /focusRevisionId=\{revision\.id\}/);
});

test('board-hosted scene department tabs stay local and nested editors can claim Escape', async () => {
  const modal = await readRepoFile('src', 'components', 'scenes', 'UnifiedSceneDetailModal.tsx');
  const host = await readRepoFile('src', 'views', 'compositing-dashboard', 'modal', 'CompositingSceneModal.tsx');

  assert.match(host, /localDepartmentSelection=\{!!sceneTarget\}/);
  assert.match(modal, /localDepartmentSelection = false/);
  assert.match(modal, /if \(localDepartmentSelection\) \{\s*setLocalDepartment\(next\);\s*return;\s*\}/);
  assert.match(modal, /if \(e\.defaultPrevented\) return;/);
});

test('spotlight scene navigation syncs dashboard department filter', async () => {
  const spotlight = await readRepoFile('src', 'components', 'spotlight', 'SpotlightSearch.tsx');

  assert.match(spotlight, /setDashboardDeptFilter/);
  assert.match(spotlight, /if \(opts\.department !== undefined\) \{\s*setSelectedDepartment\(opts\.department\);\s*setDashboardDeptFilter\(opts\.department\);/);
});

test('episode scene-list navigation resets department filters to all', async () => {
  const episodeView = await readRepoFile('src', 'views', 'EpisodeView.tsx');

  assert.match(episodeView, /setSelectedDepartment\('all'\);/);
  assert.match(episodeView, /setDashboardDeptFilter\('all'\);/);
});
