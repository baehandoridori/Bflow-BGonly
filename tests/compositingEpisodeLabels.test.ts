import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const readRepoFile = (...segments: string[]) =>
  readFile(path.join(process.cwd(), ...segments), 'utf-8');

test('compositing dashboard surfaces use episode display names instead of raw episode numbers', async () => {
  const dashboard = await readRepoFile('src', 'views', 'CompositingDashboardView.tsx');
  const header = await readRepoFile('src', 'views', 'compositing-dashboard', 'DashHeader.tsx');
  const timeline = await readRepoFile('src', 'views', 'compositing-dashboard', 'timeline', 'TimelinePanel.tsx');
  const modal = await readRepoFile('src', 'views', 'compositing-dashboard', 'modal', 'CompositingSceneModal.tsx');

  assert.match(dashboard, /currentEpisodeDisplayName/);
  assert.doesNotMatch(dashboard, /EP\{String\(episodeNumber\)\.padStart\(2, '0'\)\}/);

  assert.match(header, /getEpisodeDisplayName/);
  assert.match(header, /episodeLabel = getEpisodeDisplayName\(ep\)/);
  assert.doesNotMatch(header, /EP\{String\(ep\.episodeNumber\)\.padStart\(2, '0'\)\}/);

  assert.match(timeline, /getEpisodeDisplayName/);
  assert.match(timeline, /episodeLabelByNumber/);
  assert.doesNotMatch(timeline, /EP\.\{String\(scene\.episodeNumber\)\.padStart\(2, '0'\)\}/);

  assert.match(modal, /getEpisodeDisplayName\(ep\)/);
  assert.doesNotMatch(modal, /const episodeTitle = ep\?\.title/);
});

test('dev preview metadata includes a real episode title for compositing label checks', async () => {
  const devApi = await readRepoFile('src', 'mocks', 'devElectronAPI.ts');

  assert.match(devApi, /type: 'episode-title'/);
  assert.match(devApi, /value: '쾅 뉴럴링크'/);
  assert.match(devApi, /sheetsReadAllMetadata: async \(\) => \(\{ ok: true, data: getMockMetadataRows\(\) \}\)/);
  assert.match(devApi, /supabaseReadAllMetadata: async \(\) => getMockMetadataRows\(\)/);
});
