import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  PART_METADATA_TYPES,
  buildPartMetadataMaps,
  pickPartMetadataMaps,
} from '../src/utils/partMemoHelpers.ts';

const readRepoFile = (...segments: string[]) =>
  readFile(path.join(process.cwd(), ...segments), 'utf-8');

test('bulk part metadata keeps only the three part types and skips empty values', () => {
  const maps = buildPartMetadataMaps([
    { type: PART_METADATA_TYPES.memo, key: 'EP01_A_BG', value: '메모' },
    { type: PART_METADATA_TYPES.reelWorker, key: 'EP01_A_BG', value: '배한솔' },
    { type: PART_METADATA_TYPES.label, key: 'EP01_A_ACT', value: '오프닝' },
    { type: PART_METADATA_TYPES.memo, key: 'EP01_B_BG', value: '' },
    { type: PART_METADATA_TYPES.label, key: 'EP01_C_BG', value: null },
    { type: 'scene-completion', key: 'EP01_A_BG', value: '{"completedBy":"x"}' },
    { type: 'episode-title', key: '1', value: '첫 화' },
  ]);

  assert.deepEqual(maps.memos, { EP01_A_BG: '메모' });
  assert.deepEqual(maps.reelWorkers, { EP01_A_BG: '배한솔' });
  assert.deepEqual(maps.labels, { EP01_A_ACT: '오프닝' });
});

test('picking part metadata narrows every map to the visible sheet names', () => {
  const maps = buildPartMetadataMaps([
    { type: PART_METADATA_TYPES.memo, key: 'EP01_A_BG', value: 'A 메모' },
    { type: PART_METADATA_TYPES.memo, key: 'EP02_A_BG', value: '다른 화 메모' },
    { type: PART_METADATA_TYPES.reelWorker, key: 'EP02_A_BG', value: '장삐쭈' },
    { type: PART_METADATA_TYPES.label, key: 'EP01_A_BG', value: 'sc_000~099' },
  ]);

  const picked = pickPartMetadataMaps(maps, ['EP01_A_BG', 'EP01_B_BG']);
  assert.deepEqual(picked, {
    memos: { EP01_A_BG: 'A 메모' },
    reelWorkers: {},
    labels: { EP01_A_BG: 'sc_000~099' },
  });
});

// 2026-10-02 사고 재발 방지: 파트마다 단건 조회(readMetadata)를 다시 부르면 안 된다.
test('spotlight reads part metadata in one bulk call only while it is open', async () => {
  const spotlight = await readRepoFile('src', 'components', 'spotlight', 'SpotlightSearch.tsx');

  assert.doesNotMatch(spotlight, /readMetadata\(/);
  assert.match(spotlight, /readPartMetadataMaps\(\)/);
  assert.match(spotlight, /if \(!isOpen\) return;\s*let cancelled = false;\s*readPartMetadataMaps\(\)/);
  assert.doesNotMatch(spotlight, /\}, \[episodes\]\);/);
});

test('scene view part memos are read in one bulk call, not per part', async () => {
  const hook = await readRepoFile('src', 'hooks', 'usePartMemos.ts');

  assert.doesNotMatch(hook, /readMetadata\(/);
  assert.match(hook, /pickPartMetadataMaps\(await readPartMetadataMaps\(\), sheetNamesToLoad\)/);
  assert.match(hook, /\}, \[visibleSheetNamesKey\]\);/);
});
