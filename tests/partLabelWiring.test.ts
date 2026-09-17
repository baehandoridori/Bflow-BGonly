import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  formatPartDisplayName,
  formatPartOriginSuffix,
  hasPartLabel,
  normalizePartLabel,
} from '../src/utils/partDisplayName.ts';
import {
  applyPartLabelToSheets,
  getCombinedPartLabel,
  rollbackFailedPartLabelSheets,
} from '../src/utils/partMemoHelpers.ts';

const readRepoFile = (...segments: string[]) =>
  readFile(path.join(process.cwd(), ...segments), 'utf-8');

test('part display name falls back to the built-in A파트 form when no alias is set', () => {
  assert.equal(formatPartDisplayName('A', ''), 'A파트');
  assert.equal(formatPartDisplayName('A', undefined), 'A파트');
  assert.equal(formatPartDisplayName('A', '   '), 'A파트');
  assert.equal(hasPartLabel('  '), false);
  assert.equal(formatPartOriginSuffix('A', ''), '');
});

test('part display name uses the alias and keeps the original part id available', () => {
  assert.equal(formatPartDisplayName('A', 'sc_000~099'), 'sc_000~099');
  assert.equal(formatPartDisplayName('B', '  오프닝  '), '오프닝');
  assert.equal(hasPartLabel('오프닝'), true);
  assert.equal(formatPartOriginSuffix('B', '오프닝'), 'B파트');
  assert.equal(normalizePartLabel('  오프닝 '), '오프닝');
});

test('grouped BG/ACT parts share one alias without duplicating it', () => {
  assert.equal(
    getCombinedPartLabel({ EP01_A_BG: 'sc_000~099', EP01_A_ACT: 'sc_000~099' }, ['EP01_A_BG', 'EP01_A_ACT']),
    'sc_000~099',
  );
  assert.equal(getCombinedPartLabel({}, ['EP01_A_BG']), '');
});

test('saving an empty alias clears the sheet entry so the part falls back to A파트', () => {
  const applied = applyPartLabelToSheets({ EP01_A_BG: '오프닝' }, ['EP01_A_BG'], '   ');
  assert.deepEqual(applied, {});
  assert.equal(formatPartDisplayName('A', applied.EP01_A_BG), 'A파트');
});

test('a failed alias save rolls the sheet back to the previous alias', () => {
  const previous = { EP01_A_BG: '오프닝', EP01_A_ACT: '오프닝' };
  const optimistic = applyPartLabelToSheets(previous, ['EP01_A_BG', 'EP01_A_ACT'], 'sc_000~099');
  const rolledBack = rollbackFailedPartLabelSheets(optimistic, previous, ['EP01_A_ACT'], 'sc_000~099');

  assert.equal(rolledBack.EP01_A_BG, 'sc_000~099');
  assert.equal(rolledBack.EP01_A_ACT, '오프닝');
});

test('scene view exposes part rename through the part context menu', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');

  assert.match(scenesView, /partLabels/);
  assert.match(scenesView, /getPartLabelText/);
  assert.match(scenesView, /savePartLabel/);
  assert.match(scenesView, /이름 편집/);
  assert.match(scenesView, /formatPartDisplayName/);
  assert.match(scenesView, /formatPartOriginSuffix/);
});

test('tree navigation shows the alias while keeping the original part id visible', async () => {
  const treeNav = await readRepoFile('src', 'components', 'scenes', 'EpisodeTreeNav.tsx');

  assert.match(treeNav, /partLabels: Record<string, string>/);
  assert.match(treeNav, /getCombinedPartLabel/);
  assert.match(treeNav, /formatPartDisplayName\(group\.partId, partLabel\)/);
  assert.match(treeNav, /formatPartDisplayName\(part\.partId, partLabel\)/);
  assert.match(treeNav, /원래 파트 \$\{group\.partId\}/);
});

test('aliases are stored as part metadata, never as a part id rewrite', async () => {
  const hook = await readRepoFile('src', 'hooks', 'usePartMemos.ts');

  assert.match(hook, /readPartMetadataValue\('part-label', sheetName\)/);
  assert.match(hook, /writeMetadata\('part-label', sheetName, normalizedLabel\)/);
  // partId 자체를 바꾸는 경로가 생기면 과거 댓글·리테이크 주소가 깨진다.
  assert.doesNotMatch(hook, /supabaseRenamePart|updatePartId/);
});

test('spotlight finds parts by alias and by the original A파트 form', async () => {
  const spotlight = await readRepoFile('src', 'components', 'spotlight', 'SpotlightSearch.tsx');

  assert.match(spotlight, /readMetadata\('part-label'/);
  assert.match(spotlight, /const partAliasText = partLabels\[part\.sheetName\] \?\? '';/);
  assert.match(spotlight, /fuzzyScore\(q, partOriginLabel\)/);
});

test('dev preview seeds part aliases for grouped parts', async () => {
  const mockApi = await readRepoFile('src', 'mocks', 'devElectronAPI.ts');

  assert.match(mockApi, /type: 'part-label'/);
  assert.match(mockApi, /key: 'EP05_A_BG', value: 'sc_000~099'/);
  assert.match(mockApi, /key: 'EP05_A_ACT', value: 'sc_000~099'/);
});
