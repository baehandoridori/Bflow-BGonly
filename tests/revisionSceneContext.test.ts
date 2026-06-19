import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRevisionSceneContext } from '../src/utils/revisionSceneContext.ts';

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
