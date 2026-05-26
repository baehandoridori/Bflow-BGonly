import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findPartById,
  getCanonicalPartIds,
  normalizePartIdKey,
  partIdMatches,
} from '../src/utils/partId.ts';

test('part id matching is case-insensitive for BG and ACT pairing', () => {
  assert.equal(normalizePartIdKey(' A '), 'a');
  assert.equal(partIdMatches('A', 'a'), true);
  assert.equal(partIdMatches('B', 'a'), false);
});

test('canonical part list merges uppercase BG and lowercase ACT into one visible part', () => {
  const parts = [
    { partId: 'A', department: 'bg' as const },
    { partId: 'a', department: 'acting' as const },
    { partId: 'B', department: 'bg' as const },
    { partId: 'b', department: 'acting' as const },
  ];

  assert.deepEqual(getCanonicalPartIds(parts), ['A', 'B']);
});

test('findPartById locates lowercase ACT part when selected part is uppercase', () => {
  const parts = [
    { partId: 'A', department: 'bg' as const, sheetName: 'EP05_A_BG' },
    { partId: 'a', department: 'acting' as const, sheetName: 'EP05_A_ACT' },
  ];

  assert.equal(findPartById(parts, 'A', 'bg')?.sheetName, 'EP05_A_BG');
  assert.equal(findPartById(parts, 'A', 'acting')?.sheetName, 'EP05_A_ACT');
});
