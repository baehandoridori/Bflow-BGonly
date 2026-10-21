import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildSpotlightSceneGroups } from '../src/utils/spotlightSceneGroups.ts';

function scene(sceneId: string, no: number, flags: Partial<Record<'lo' | 'done' | 'review' | 'png', boolean>> = {}) {
  return { id: `id-${sceneId}-${no}`, no, sceneId, assignee: '', lo: false, done: false, review: false, png: false, ...flags };
}

const episode = {
  episodeNumber: 8,
  parts: [
    { partId: 'A', department: 'bg' as const, sheetName: 'EP08_A_BG', scenes: [scene('a001', 1), scene('a002', 2), scene('a003', 3)] },
    { partId: 'A', department: 'acting' as const, sheetName: 'EP08_A_ACT', scenes: [scene('A001', 1), scene('A002', 2)] },
    { partId: 'B', department: 'acting' as const, sheetName: 'EP08_B_ACT', scenes: [scene('b010', 1)] },
  ],
};

test('같은 씬의 BG·ACT 는 한 줄로 묶인다(대소문자가 달라도)', () => {
  const groups = buildSpotlightSceneGroups(episode);
  const a001 = groups.filter((g) => g.sceneId.toLowerCase() === 'a001');
  assert.equal(a001.length, 1, 'a001(BG)·A001(ACT) 가 한 줄');
  assert.equal(a001[0].bgScene?.sceneId, 'a001');
  assert.equal(a001[0].actScene?.sceneId, 'A001');
  assert.equal(a001[0].bgSheetName, 'EP08_A_BG');
  assert.equal(a001[0].actSheetName, 'EP08_A_ACT');
  assert.equal(a001[0].highlightSceneId, 'a001', '강조는 BG 표기로 — 통합 카드가 BG·ACT 둘 다 맞춰 본다');
});

test('한쪽 부서에만 있는 씬도 한 번만 나온다', () => {
  const groups = buildSpotlightSceneGroups(episode);
  const a003 = groups.filter((g) => g.sceneId === 'a003');
  assert.equal(a003.length, 1);
  assert.equal(a003[0].actScene, null);
  const b010 = groups.filter((g) => g.sceneId === 'b010');
  assert.equal(b010.length, 1);
  assert.equal(b010[0].bgScene, null);
  assert.equal(b010[0].partId, 'B');
  assert.equal(groups.length, 4, 'a001·a002·a003·b010');
  assert.equal(new Set(groups.map((g) => g.key)).size, groups.length, '키가 겹치지 않는다');
});

test('검색이 통합 보기로 이동하고 묶음을 미리 만들어 둔다', async () => {
  const src = await readFile(new URL('../src/components/spotlight/SpotlightSearch.tsx', import.meta.url), 'utf8');
  assert.match(src, /buildSpotlightSceneGroups/);
  assert.match(src, /department: 'all',\s*sceneId: group\.highlightSceneId/, '씬 결과는 통합 보기(all)로 연다');
  assert.match(src, /const sceneGroupsByEpisode = useMemo\(/, '묶음은 글자 칠 때마다가 아니라 데이터가 바뀔 때만 만든다');
});
