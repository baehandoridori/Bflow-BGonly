import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHashtagCandidates } from '../src/utils/hashtagCandidates.ts';

const EPISODES = [
  { episodeNumber: 1, title: 'EP.01', parts: [
    { partId: 'A', scenes: [{ sceneId: 'a001' }, { sceneId: 'a012' }] },
    { partId: 'B', scenes: [{ sceneId: 'b001' }] },
  ] },
  { episodeNumber: 2, title: 'EP.02', parts: [
    { partId: 'A', scenes: [{ sceneId: 'a001' }] },
  ] },
];
const TITLES: Record<number, string> = { 2: '친모2' };

test('a0 → 씬 후보, EP/파트로 중복 구분', () => {
  const c = buildHashtagCandidates(EPISODES, TITLES, 'a0');
  const scenes = c.filter((x) => x.kind === 'scene');
  assert.ok(scenes.some((s) => s.label === 'a001' && s.context === 'EP01 A'));
  assert.ok(scenes.some((s) => s.label === 'a001' && s.context === 'EP02 A'));
  assert.ok(scenes.some((s) => s.label === 'a012' && s.context === 'EP01 A'));
});
test('씬 후보 tag 에 정확한 타깃', () => {
  const c = buildHashtagCandidates(EPISODES, TITLES, 'a012');
  const sc = c.find((x) => x.kind === 'scene' && x.label === 'a012');
  assert.deepEqual(sc?.tag, { kind: 'scene', label: 'a012', episodeNumber: 1, partId: 'A', sceneId: 'a012' });
});
test('친모 → 커스텀 제목 화 후보', () => {
  const c = buildHashtagCandidates(EPISODES, TITLES, '친모');
  assert.ok(c.some((x) => x.kind === 'episode' && x.label === '친모2' && x.tag.episodeNumber === 2));
});
test('A파트 → 파트 후보', () => {
  const c = buildHashtagCandidates(EPISODES, TITLES, 'A파트');
  const p = c.find((x) => x.kind === 'part' && x.label === 'A파트');
  assert.ok(p);
  assert.equal(p?.context, 'EP.01');
});
test('빈 쿼리는 화/파트/씬 섞여 나오고 limit 제한', () => {
  const c = buildHashtagCandidates(EPISODES, TITLES, '', 3);
  assert.equal(c.length, 3);
});
