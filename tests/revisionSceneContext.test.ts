import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRevisionSceneContext, parseCommentSceneContext } from '../src/utils/revisionSceneContext.ts';

test('EP01:A:1 → {1, A}', () => {
  assert.deepEqual(parseRevisionSceneContext('EP01:A:1'), { episodeNumber: 1, partId: 'A' });
});
test('EP12:B:a005 → {12, B}', () => {
  assert.deepEqual(parseRevisionSceneContext('EP12:B:a005'), { episodeNumber: 12, partId: 'B' });
});
test('전반(scene 없음) EP03:C → {3, C}', () => {
  assert.deepEqual(parseRevisionSceneContext('EP03:C'), { episodeNumber: 3, partId: 'C' });
});
test('빈/형식 불일치 → null', () => {
  assert.equal(parseRevisionSceneContext(''), null);
  assert.equal(parseRevisionSceneContext(null), null);
  assert.equal(parseRevisionSceneContext('EP01'), null);
  assert.equal(parseRevisionSceneContext('::'), null);
});
test('EP 형식 엄격 검증 — EP00/접두어없음/중간글자 → null', () => {
  assert.equal(parseRevisionSceneContext('EP00:A:1'), null); // episode 0 없음
  assert.equal(parseRevisionSceneContext('3:A:1'), null);    // EP 접두어 없음
  assert.equal(parseRevisionSceneContext('EP1A:B:1'), null); // 중간 글자 섞임
});

// ─── 4a-2: 댓글 sceneKey 컨텍스트 (부서 보존) ───
test('parseCommentSceneContext: EP01_A_BG:3 → {1, A, bg}', () => {
  assert.deepEqual(parseCommentSceneContext('EP01_A_BG:3'), { episodeNumber: 1, partId: 'A', department: 'bg' });
});
test('parseCommentSceneContext: EP12_C_ACT:7 → {12, C, acting}', () => {
  assert.deepEqual(parseCommentSceneContext('EP12_C_ACT:7'), { episodeNumber: 12, partId: 'C', department: 'acting' });
});
test('parseCommentSceneContext: legacy(부서 접미어 없음)은 bg', () => {
  assert.deepEqual(parseCommentSceneContext('EP02_A:5'), { episodeNumber: 2, partId: 'A', department: 'bg' });
});
test('parseCommentSceneContext: 소문자 partId 원본 보존(강제 대문자화 안 함)', () => {
  assert.deepEqual(parseCommentSceneContext('EP05_a_ACT:1'), { episodeNumber: 5, partId: 'a', department: 'acting' });
});
test('parseCommentSceneContext: 형식 불일치 → null', () => {
  assert.equal(parseCommentSceneContext(''), null);
  assert.equal(parseCommentSceneContext(null), null);
  assert.equal(parseCommentSceneContext('foo:3'), null);
});
