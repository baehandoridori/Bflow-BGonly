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
test('resolveSceneById: sceneId 도 대소문자 무관 (BG d001 / ACT D001)', () => {
  // 실제 데이터는 대문자 D001 인데 소문자 d001 로 점프해도 찾아야 한다(부서별 케이스 차이).
  const eps = [
    { episodeNumber: 1, parts: [{ partId: 'D', scenes: [{ no: 1, sceneId: 'D001' }] }] },
  ];
  assert.deepEqual(resolveSceneById(eps, 1, 'D', 'd001'), { no: 1, sceneId: 'D001' });
});

// ─── 4c PR1(코덱스 6차): 같은 파트 내 sceneId 중복 row 를 uuid 로 정확히 구분 ───
const DUP_EPISODES = [
  { episodeNumber: 1, parts: [
    { partId: 'A', scenes: [
      { no: 1, sceneId: 'a001', id: 'uuid-first' },
      { no: 2, sceneId: 'a001', id: 'uuid-second' },
    ] },
  ] },
];
test('resolveSceneById: uuid 로 같은 sceneId 두 번째 row 를 정확히 찾음', () => {
  assert.deepEqual(
    resolveSceneById(DUP_EPISODES, 1, 'A', 'a001', 'uuid-second'),
    { no: 2, sceneId: 'a001', id: 'uuid-second' },
  );
});
test('resolveSceneById: uuid 미제공 시 첫 매치(첫 row) 폴백', () => {
  assert.deepEqual(
    resolveSceneById(DUP_EPISODES, 1, 'A', 'a001'),
    { no: 1, sceneId: 'a001', id: 'uuid-first' },
  );
});
test('resolveSceneById: uuid 미발견 시 sceneId 폴백', () => {
  assert.deepEqual(
    resolveSceneById(DUP_EPISODES, 1, 'A', 'a001', 'uuid-nope'),
    { no: 1, sceneId: 'a001', id: 'uuid-first' },
  );
});

// ─── 4c PR1(코덱스 7차): 같은 partId 의 BG/ACT 가 같은 sceneId 면 uuid 로 정확한 부서 row ───
const DEPT_DUP_EPISODES = [
  { episodeNumber: 1, parts: [
    { partId: 'A', department: 'bg', scenes: [{ no: 1, sceneId: 'a001', id: 'uuid-bg' }] },
    { partId: 'A', department: 'acting', scenes: [{ no: 1, sceneId: 'a001', id: 'uuid-act' }] },
  ] },
];
test('resolveSceneById: BG/ACT 같은 sceneId 에서 uuid 로 ACT row 정확 — 첫 파트(BG) sceneId 폴백에 안 걸림', () => {
  assert.deepEqual(
    resolveSceneById(DEPT_DUP_EPISODES, 1, 'A', 'a001', 'uuid-act'),
    { no: 1, sceneId: 'a001', id: 'uuid-act', department: 'acting' },
  );
});
test('resolveSceneById: uuid 미제공 시 첫 부서 파트(BG) 폴백', () => {
  assert.deepEqual(
    resolveSceneById(DEPT_DUP_EPISODES, 1, 'A', 'a001'),
    { no: 1, sceneId: 'a001', id: 'uuid-bg', department: 'bg' },
  );
});
