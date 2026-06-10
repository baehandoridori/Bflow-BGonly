import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const readRepoFile = (...segments: string[]) =>
  readFile(path.join(process.cwd(), ...segments), 'utf-8');

test('dashboard department filter keeps scene department mode in sync, including all', async () => {
  const dashboard = await readRepoFile('src', 'views', 'Dashboard.tsx');

  assert.match(dashboard, /const handleDeptSelect = useCallback\(\(filter: typeof dashboardFilter\) => \{/);
  assert.match(dashboard, /setDashboardFilter\(filter\);\s*setSelectedDepartment\(filter\);/);
  assert.doesNotMatch(dashboard, /if \(filter !== 'all'\) \{\s*setSelectedDepartment\(filter\);/);
});

test('dashboard episode switches reset scene department mode to all', async () => {
  const dashboard = await readRepoFile('src', 'views', 'Dashboard.tsx');

  assert.match(dashboard, /const handleEpSelect = useCallback\(\(epNum: number\) => \{[\s\S]*?setDashboardFilter\('all'\);[\s\S]*?setSelectedDepartment\('all'\);/);
  assert.match(dashboard, /const handleBackToMain = useCallback\(\(\) => \{[\s\S]*?setDashboardFilter\('all'\);[\s\S]*?setSelectedDepartment\('all'\);/);
});
