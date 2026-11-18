import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { episodeNumberMetadata, nextEpisodeNumberFrom, parkedEpisodeNumber, sheetNamePrefix } from '../src/shared/episodeNumberReuse.ts';

test('다음 번호는 진행 중 + 보관함 중 가장 큰 번호 + 1', () => {
  assert.equal(nextEpisodeNumberFrom([9, 10, 11, 12], [1, 2, 3, 4, 5, 6, 7, 8]), 13);
  assert.equal(nextEpisodeNumberFrom([9, 10], [11]), 12); // 보관한 11과 겹치지 않게
  assert.equal(nextEpisodeNumberFrom([], []), 1);
  assert.equal(nextEpisodeNumberFrom([], [3]), 4);
});

test('지운 에피소드를 비켜 둘 번호: 먼저 -n, 이미 쓰면 가장 작은 수보다 하나 작게', () => {
  assert.equal(parkedEpisodeNumber(13, []), -13);
  assert.equal(parkedEpisodeNumber(13, [-2]), -13);
  assert.equal(parkedEpisodeNumber(13, [-13]), -14);
  assert.equal(parkedEpisodeNumber(13, [-13, -40]), -41);
  assert.equal(parkedEpisodeNumber(5, [-13]), -5);
});

test('번호로 묶인 메타데이터 줄만 고르고, 옛 제목 · 메모는 따로 돌려준다', () => {
  const rows = [
    { id: 'a', type: 'episode-title', key: '13', value: '이상하다...' },
    { id: 'b', type: 'episode-memo', key: '13', value: '메모' },
    { id: 'c', type: 'episode-title', key: '130', value: '다른 편' },
    { id: 'd', type: 'part-memo', key: 'EP13_A_BG', value: 'x' },
    { id: 'e', type: 'part-label', key: 'EP13_B_ACT', value: 'y' },
    { id: 'f', type: 'part-reel-worker', key: 'EP130_A_BG', value: 'z' },
    { id: 'g', type: 'part-memo', key: 'EP1x_A_BG', value: 'w' },
    { id: 'h', type: 'scene-completion', key: '13', value: '{}' },
  ];
  assert.deepEqual(episodeNumberMetadata(rows, 13), { deleteIds: ['a', 'b', 'd', 'e'], title: '이상하다...', memo: '메모' });
  assert.deepEqual(episodeNumberMetadata([{ id: 'p', type: 'part-memo', key: 'EP05_A_BG' }], 5), { deleteIds: ['p'], title: null, memo: null });
  assert.equal(sheetNamePrefix(5), 'EP05_');
  assert.equal(sheetNamePrefix(13), 'EP13_');
});

test('에피소드 추가는 번호를 먼저 비우고, 화면은 보관함 번호까지 본다', () => {
  const main = fs.readFileSync(new URL('../electron/supabase.ts', import.meta.url), 'utf8');
  const add = main.slice(main.indexOf('export async function addEpisode('));
  const freeAt = add.indexOf('await freeEpisodeNumber(episodeNumber)');
  assert.ok(freeAt > 0 && freeAt < add.indexOf('.insert({ episode_number: episodeNumber })'));
  const free = main.slice(main.indexOf('async function freeEpisodeNumber('), main.indexOf('export async function addEpisode('));
  assert.match(free, /holder\.status !== 'deleted'/, '진행 중 · 보관함 번호는 건드리지 않는다');
  assert.match(free, /\.eq\('status', 'deleted'\)/, '지운 줄만 번호를 옮긴다');
  assert.match(free, /from\('metadata'\)\.delete\(\)/, '메타데이터는 key 를 바꾸지 않고 지운다 (type+key 캐시)');
  assert.doesNotMatch(free, /from\('scenes'\)|from\('parts'\)/, '지운 에피소드의 파트 · 씬은 그대로 둔다');
  const view = fs.readFileSync(new URL('../src/views/ScenesView.tsx', import.meta.url), 'utf8');
  assert.match(view, /nextEpisodeNumberFrom\(\s*episodes\.map\(\(ep\) => ep\.episodeNumber\),\s*archivedEpisodes\.map/);
  assert.match(view, /else delete next\[nextEpisodeNumber\]/);
});
