import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const readRepoFile = (...segments: string[]) =>
  readFile(path.join(process.cwd(), ...segments), 'utf-8');

test('scene part navigation surfaces part reel workers alongside part memos', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');
  const treeNav = await readRepoFile('src', 'components', 'scenes', 'EpisodeTreeNav.tsx');

  assert.match(scenesView, /partReelWorkers/);
  assert.match(scenesView, /getPartReelWorkerText/);
  assert.match(scenesView, /savePartReelWorker/);
  assert.match(scenesView, /릴 담당 편집/);
  assert.match(scenesView, /릴 담당을 입력하세요/);
  assert.match(scenesView, /릴 담당 \$\{reelWorker\}/);
  assert.match(treeNav, /partReelWorkers: Record<string, string>/);
  assert.match(treeNav, /getCombinedPartReelWorker/);
  assert.match(treeNav, /릴 담당 \{/);
});

test('spotlight can find parts by reel worker metadata', async () => {
  const spotlight = await readRepoFile('src', 'components', 'spotlight', 'SpotlightSearch.tsx');

  assert.match(spotlight, /partReelWorkers/);
  assert.match(spotlight, /readMetadata\('part-reel-worker'/);
  assert.match(spotlight, /fuzzyScore\(q, partReelWorkerText\)/);
  assert.match(spotlight, /id: `part-reel-worker-\$\{part\.sheetName\}`/);
  assert.match(spotlight, /릴 담당/);
});

test('dev preview seeds reel worker metadata for grouped parts', async () => {
  const mockApi = await readRepoFile('src', 'mocks', 'devElectronAPI.ts');

  assert.match(mockApi, /type: 'part-reel-worker'/);
  assert.match(mockApi, /key: 'EP05_A_BG'/);
  assert.match(mockApi, /key: 'EP05_A_ACT'/);
});
