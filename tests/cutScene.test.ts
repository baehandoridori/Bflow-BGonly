import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSceneById } from '../src/utils/cutScene.ts';

const EPISODES = [
  { episodeNumber: 1, parts: [
    { partId: 'A', scenes: [{ no: 5, sceneId: 'a005' }, { no: 12, sceneId: 'a012' }] },
    { partId: 'B', scenes: [{ no: 5, sceneId: 'b005' }] },
  ] },
];

// ─── 4c: sceneId 직접 매칭(#씬 태그 점프) ───
test('resolveSceneById: ep·partId·sceneId 로 씬 찾기', () => {
  assert.deepEqual(resolveSceneById(EPISODES, 1, 'A', 'a012'), { no: 12, sceneId: 'a012' });
});
test('resolveSceneById: 다른 파트 sceneId 는 안 잡힘', () => {
  assert.deepEqual(resolveSceneById(EPISODES, 1, 'B', 'b005'), { no: 5, sceneId: 'b005' });
  assert.equal(resolveSceneById(EPISODES, 1, 'A', 'b005'), null);
});
test('resolveSceneById: 화 간 sceneId 중복은 ep 로 한정', () => {
  const eps = [
    { episodeNumber: 1, parts: [{ partId: 'A', scenes: [{ no: 1, sceneId: 'a001' }] }] },
    { episodeNumber: 2, parts: [{ partId: 'A', scenes: [{ no: 1, sceneId: 'a001' }] }] },
  ];
  assert.deepEqual(resolveSceneById(eps, 2, 'A', 'a001'), { no: 1, sceneId: 'a001' });
});
test('resolveSceneById: 없으면 null, partId 대소문자 무관', () => {
  assert.equal(resolveSceneById(EPISODES, 1, 'A', 'zzz'), null);
  assert.deepEqual(resolveSceneById(EPISODES, 1, 'a', 'a005'), { no: 5, sceneId: 'a005' });
});
