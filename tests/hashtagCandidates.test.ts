import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHashtagCandidates } from '../src/utils/hashtagCandidates.ts';
import { serializeHashTag } from '../src/utils/hashEntity.ts';

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
  // context 는 에피소드 '이름'(v1.43.1) — ep1 은 커스텀 제목 없어 ep.title('EP.01'), ep2 는 커스텀 '친모2'.
  assert.ok(scenes.some((s) => s.label === 'a001' && s.context === 'EP.01 A'));
  assert.ok(scenes.some((s) => s.label === 'a001' && s.context === '친모2 A'));
  assert.ok(scenes.some((s) => s.label === 'a012' && s.context === 'EP.01 A'));
});
test('씬 후보 tag 에 정확한 타깃', () => {
  const c = buildHashtagCandidates(EPISODES, TITLES, 'a012');
  const sc = c.find((x) => x.kind === 'scene' && x.label === 'a012');
  assert.deepEqual(sc?.tag, { kind: 'scene', label: 'a012', episodeNumber: 1, partId: 'A', sceneId: 'a012' });
});
test('BG/ACT 같은 (ep,partId,sceneId) → scene 후보 1개 병합, uuid 미탑재', () => {
  // 새 에피소드: 같은 partId 'A' 에 BG·ACT 파트가 함께 생겨 같은 sceneId(a001) row 가 2개.
  // 부서는 다르나(서로 다른 uuid) #씬은 통합 1개로 병합되고, 직렬화에 uuid(5번째 seg)가 없어야 한다.
  const eps = [
    { episodeNumber: 1, title: 'EP.01', parts: [
      { partId: 'A', scenes: [{ sceneId: 'a001', id: 'uuid-bg' }] },   // BG 파트
      { partId: 'A', scenes: [{ sceneId: 'a001', id: 'uuid-acting' }] }, // ACT 파트(같은 partId·sceneId)
    ] },
  ];
  const c = buildHashtagCandidates(eps, {}, 'a001');
  const scenes = c.filter((x) => x.kind === 'scene' && x.label === 'a001');
  assert.equal(scenes.length, 1); // 통합 1개
  assert.deepEqual(scenes[0].tag, { kind: 'scene', label: 'a001', episodeNumber: 1, partId: 'A', sceneId: 'a001' });
  // 직렬화 payload 는 'bscene:1:A:a001' — `:` 분할 시 4세그(5번째 uuid 없음).
  const serialized = serializeHashTag(scenes[0].tag);
  const payload = serialized.slice(serialized.indexOf('(') + 1, serialized.lastIndexOf(')'));
  assert.equal(payload, 'bscene:1:A:a001');
  assert.equal(payload.split(':').length, 4);
});
test('BG/ACT 같은 (ep,partId) → part 후보도 1개 병합(중복 제거)', () => {
  // all-mode: 같은 partId 'A' 가 BG·ACT 2 row 로 와도 #A파트 후보는 1개여야 한다.
  const eps = [
    { episodeNumber: 1, title: 'EP.01', parts: [
      { partId: 'A', scenes: [{ sceneId: 'a001', id: 'uuid-bg' }] },     // BG 파트
      { partId: 'A', scenes: [{ sceneId: 'a001', id: 'uuid-acting' }] }, // ACT 파트(같은 partId)
    ] },
  ];
  const parts = buildHashtagCandidates(eps, {}, 'A파트').filter((x) => x.kind === 'part' && x.label === 'A파트');
  assert.equal(parts.length, 1);
});
test('빈 쿼리에서도 같은 (ep,partId) 파트 중복 미발생', () => {
  const eps = [
    { episodeNumber: 1, title: 'EP.01', parts: [
      { partId: 'A', scenes: [{ sceneId: 'a001' }] },
      { partId: 'A', scenes: [{ sceneId: 'a002' }] }, // 같은 partId 두 번째 row
    ] },
  ];
  const parts = buildHashtagCandidates(eps, {}, '').filter((x) => x.kind === 'part');
  assert.equal(parts.length, 1);
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
