import test from 'node:test';
import assert from 'node:assert/strict';

import { filterSceneCandidates, isAssignedToMe } from '../src/components/widgets/my-tasks/quickAddUtils.ts';
import type { FlatScene, SceneKey } from '../src/components/widgets/my-tasks/types.ts';

function flat(sceneId: string, opts: { ep?: number; part?: string; assignee?: string } = {}): FlatScene {
  const part = opts.part ?? 'a';
  const ep = opts.ep ?? 1;
  const sheetName = `EP${String(ep).padStart(2, '0')}_${part}`;
  return {
    scene: { sceneId, assignee: opts.assignee ?? '', lo: false, done: false, review: false, png: false },
    sheetName,
    sceneIndex: 0,
    episodeNumber: ep,
    partId: part,
    department: 'bg',
    key: `${sheetName}:${sceneId}`,
  } as unknown as FlatScene;
}

const NONE: Set<SceneKey> = new Set();

test('isAssignedToMe: 콤마 분리 다중 담당 매칭', () => {
  assert.equal(isAssignedToMe('배한솔', '배한솔'), true);
  assert.equal(isAssignedToMe('배한솔, 이혜민', '이혜민'), true);
  assert.equal(isAssignedToMe(' 이혜민 ,배한솔', '배한솔'), true);
  assert.equal(isAssignedToMe('이혜민', '배한솔'), false);
  assert.equal(isAssignedToMe('', '배한솔'), false);
  assert.equal(isAssignedToMe(undefined, '배한솔'), false);
  assert.equal(isAssignedToMe('배한솔', ''), false);
});

test('빈 쿼리는 후보 없음', () => {
  const r = filterSceneCandidates([flat('a001')], '', '배한솔', NONE);
  assert.equal(r.length, 0);
});

test('sceneId 부분일치 매칭', () => {
  const cands = [flat('a001'), flat('a002'), flat('b010')];
  const r = filterSceneCandidates(cands, 'a00', '배한솔', NONE);
  assert.deepEqual(r.map((c) => c.flat.scene.sceneId), ['a001', 'a002']);
});

test('숫자 입력은 끝자리 번호 접두 매칭(a001 vs "1")', () => {
  const cands = [flat('a001'), flat('a010'), flat('a100')];
  const r = filterSceneCandidates(cands, '1', '배한솔', NONE);
  // 끝자리(선행 0 제거): a001→'1', a010→'10', a100→'100' 모두 '1' 로 시작
  assert.deepEqual(r.map((c) => c.flat.scene.sceneId).sort(), ['a001', 'a010', 'a100']);
});

test('내 담당 우선 정렬 + isMine 플래그', () => {
  const cands = [
    flat('a001', { assignee: '이혜민' }),
    flat('a002', { assignee: '배한솔, 이혜민' }),
    flat('a003', { assignee: '배한솔' }),
  ];
  const r = filterSceneCandidates(cands, 'a00', '배한솔', NONE);
  // 내 담당(a002, a003) 이 앞으로, 그 안에서는 번호순
  assert.deepEqual(r.map((c) => c.flat.scene.sceneId), ['a002', 'a003', 'a001']);
  assert.deepEqual(r.map((c) => c.isMine), [true, true, false]);
});

test('existingKeys 는 alreadyAdded 로 표시되되 후보에서 빠지지 않는다', () => {
  const f = flat('a001');
  const existing = new Set<SceneKey>([f.key]);
  const r = filterSceneCandidates([f], 'a001', '배한솔', existing);
  assert.equal(r.length, 1);
  assert.equal(r[0].alreadyAdded, true);
});

test('에피소드 → 번호 정렬(담당 동일)', () => {
  const cands = [
    flat('a010', { ep: 2 }),
    flat('a002', { ep: 1 }),
    flat('a001', { ep: 2 }),
  ];
  const r = filterSceneCandidates(cands, 'a0', '배한솔', NONE);
  assert.deepEqual(
    r.map((c) => `${c.flat.episodeNumber}:${c.flat.scene.sceneId}`),
    ['1:a002', '2:a001', '2:a010'],
  );
});

test('숫자 섞인 일반 메모는 씬으로 오매칭되지 않는다(P2)', () => {
  const cands = [flat('a001'), flat('a010'), flat('a100')];
  // 공백·한글이 섞인 일반 메모 → 끝자리 숫자 매칭이 적용되지 않아 씬 후보 0
  assert.deepEqual(filterSceneCandidates(cands, '회의 1차', '배한솔', NONE), []);
  assert.deepEqual(filterSceneCandidates(cands, '10시 확인', '배한솔', NONE), []);
  // 순수 숫자 입력은 여전히 끝자리 번호로 씬 매칭
  assert.equal(filterSceneCandidates(cands, '1', '배한솔', NONE).length, 3);
});

test('추가 가능한 씬이 추가됨 항목보다 먼저 와서 limit에 안 잘린다(P3)', () => {
  // a001~a008: 이미 추가됨(내 담당), a009: 추가 가능
  const cands = Array.from({ length: 9 }, (_, i) =>
    flat(`a${String(i + 1).padStart(3, '0')}`, { assignee: '배한솔' }),
  );
  const added = new Set<SceneKey>(cands.slice(0, 8).map((f) => f.key));
  const r = filterSceneCandidates(cands, 'a00', '배한솔', added, 8);
  // 추가 가능한 a009 가 상위(맨 앞)에 와서 limit(8) 안에 살아남아야 함
  assert.equal(r[0].flat.scene.sceneId, 'a009');
  assert.equal(r[0].alreadyAdded, false);
});

test('0 패딩 정확 입력은 해당 씬을 정확 매칭·최우선한다(P2)', () => {
  const cands = [flat('a001', { assignee: '배한솔' }), flat('a010'), flat('a100')];
  const added = new Set<SceneKey>([cands[0].key]); // a001 이미 추가됨
  const r = filterSceneCandidates(cands, '001', '배한솔', added);
  // a001 이 exact 로 맨 앞(이미 추가됐어도) — a010/a100 로 대체되지 않음
  assert.equal(r[0].flat.scene.sceneId, 'a001');
  assert.equal(r[0].exact, true);
  assert.equal(r[0].alreadyAdded, true);
  assert.ok(r.slice(1).every((c) => !c.exact));
});

test('순수 숫자(0 패딩 아님)는 정확 매칭이 아니라 접두 매칭', () => {
  const cands = [flat('a001'), flat('a010'), flat('a100')];
  const r = filterSceneCandidates(cands, '1', '배한솔', NONE);
  // '1' 은 a001 의 raw '001' 과 달라 exact 아님 → 전부 접두 매칭
  assert.ok(r.every((c) => !c.exact));
});

test('전체 sceneId 입력은 exact', () => {
  const cands = [flat('a001'), flat('a010')];
  const r = filterSceneCandidates(cands, 'a001', '배한솔', NONE);
  assert.equal(r[0].flat.scene.sceneId, 'a001');
  assert.equal(r[0].exact, true);
});

test('limit 적용', () => {
  const cands = Array.from({ length: 20 }, (_, i) => flat(`a${String(i + 1).padStart(3, '0')}`));
  const r = filterSceneCandidates(cands, 'a', '배한솔', NONE, 8);
  assert.equal(r.length, 8);
});
