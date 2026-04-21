import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCanonicalSceneId, normalizeSceneIdKey } from '../src/utils/sceneIdKey.ts';

test('normalizeSceneIdKey collapses only part-prefixed scene ids inside the same part', () => {
  assert.equal(normalizeSceneIdKey('ac001', 'A'), '1');
  assert.equal(normalizeSceneIdKey('a001', 'A'), '1');
  assert.equal(normalizeSceneIdKey('001', 'A'), '1');
  assert.equal(normalizeSceneIdKey('v2a001', 'A'), 'v2a001');
  assert.equal(normalizeSceneIdKey('bg3-001', 'A'), 'bg3-001');
});

test('buildCanonicalSceneId preserves versioned ids while still normalizing shared scene numbers', () => {
  assert.equal(buildCanonicalSceneId('A', 'ac001'), 'a001');
  assert.equal(buildCanonicalSceneId('A', '001'), 'a001');
  assert.equal(buildCanonicalSceneId('A', 'v2a001'), 'v2a001');
});
