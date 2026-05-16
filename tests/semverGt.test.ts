import test from 'node:test';
import assert from 'node:assert/strict';

import { semverGt } from '../src/utils/semver.ts';

test('major upgrade', () => {
  assert.equal(semverGt('2.0.0', '1.99.99'), true);
});

test('minor upgrade', () => {
  assert.equal(semverGt('1.26.0', '1.25.11'), true);
});

test('patch upgrade', () => {
  assert.equal(semverGt('1.25.12', '1.25.11'), true);
});

test('equal → false', () => {
  assert.equal(semverGt('1.25.0', '1.25.0'), false);
});

test('downgrade (major) → false', () => {
  assert.equal(semverGt('1.25.0', '2.0.0'), false);
});

test('downgrade (minor) → false', () => {
  assert.equal(semverGt('1.25.0', '1.26.0'), false);
});

test('downgrade (patch) → false', () => {
  assert.equal(semverGt('1.25.10', '1.25.11'), false);
});

test('미명시 patch 는 0 으로 취급', () => {
  assert.equal(semverGt('1.26', '1.26.0'), false);
  assert.equal(semverGt('1.26.1', '1.26'), true);
});

test('비숫자/잘못된 형식 → 0 으로 fallback', () => {
  assert.equal(semverGt('abc.def', '0.0.1'), false);
  assert.equal(semverGt('1.0.0', 'abc'), true);
});
