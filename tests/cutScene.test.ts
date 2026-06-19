import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCutScene } from '../src/utils/cutScene.ts';

const EPISODES = [
  { episodeNumber: 1, parts: [
    { partId: 'A', scenes: [{ no: 5, sceneId: 'a005' }, { no: 12, sceneId: 'a012' }] },
    { partId: 'B', scenes: [{ no: 5, sceneId: 'b005' }] },
  ] },
];

test('같은 EP·파트에서 cut 번호로 씬 찾기', () => {
  assert.deepEqual(resolveCutScene(EPISODES, 1, 'A', 5), { no: 5, sceneId: 'a005' });
});
test('파트로 BG/ACT 동일 번호 구분', () => {
  assert.deepEqual(resolveCutScene(EPISODES, 1, 'B', 5), { no: 5, sceneId: 'b005' });
});
test('없는 컷이면 null', () => {
  assert.equal(resolveCutScene(EPISODES, 1, 'A', 99), null);
});
test('없는 에피소드/파트면 null', () => {
  assert.equal(resolveCutScene(EPISODES, 9, 'A', 5), null);
  assert.equal(resolveCutScene(EPISODES, 1, 'Z', 5), null);
});
test('같은 partId 가 부서별(BG/ACT) 별도 Part 로 나뉘어도 모든 파트를 순회', () => {
  const eps = [{ episodeNumber: 1, parts: [
    { partId: 'A', scenes: [{ no: 1, sceneId: 'a001' }] },       // BG
    { partId: 'A', scenes: [{ no: 9, sceneId: 'a009-act' }] },   // ACT (같은 partId, 다른 부서)
  ] }];
  // 컷9 가 두 번째 'A' 파트에만 있어도 찾아야 한다(첫 파트 .find 로 끝내면 안 됨).
  assert.deepEqual(resolveCutScene(eps, 1, 'A', 9), { no: 9, sceneId: 'a009-act' });
  assert.deepEqual(resolveCutScene(eps, 1, 'A', 1), { no: 1, sceneId: 'a001' });
});
test('Scene.no 가 문자열이어도 숫자 비교', () => {
  const eps = [{ episodeNumber: 2, parts: [{ partId: 'A', scenes: [{ no: '7', sceneId: 'a007' }] }] }];
  assert.deepEqual(resolveCutScene(eps, 2, 'A', 7), { no: '7', sceneId: 'a007' });
});
