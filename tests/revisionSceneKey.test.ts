import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUnifiedRevisionSceneKey,
  normalizeRevisionSceneKey,
} from '../src/utils/revisionSceneKey.ts';

test('normalized revision keys merge ac001 and a001 inside the same part', () => {
  assert.equal(buildUnifiedRevisionSceneKey('EP01_A_BG', 'ac001'), 'EP01:A:1');
  assert.equal(buildUnifiedRevisionSceneKey('EP01_A_ACT', 'a001'), 'EP01:A:1');
});

test('legacy stored revision keys are normalized to the shared scene key', () => {
  assert.equal(normalizeRevisionSceneKey('EP01:A:ac001'), 'EP01:A:1');
  assert.equal(normalizeRevisionSceneKey('EP01:A:a001'), 'EP01:A:1');
});

test('revision keys ignore digits in the prefix and use the trailing scene number', () => {
  assert.equal(buildUnifiedRevisionSceneKey('EP01_A_BG', 'v2a001'), 'EP01:A:1');
  assert.equal(buildUnifiedRevisionSceneKey('EP01_A_BG', 'v2a002'), 'EP01:A:2');
  assert.equal(normalizeRevisionSceneKey('EP01:A:v2a010'), 'EP01:A:10');
});
