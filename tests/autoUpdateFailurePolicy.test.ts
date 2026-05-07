import test from 'node:test';
import assert from 'node:assert/strict';

import { isStaleSwapFailureForCurrentVersion } from '../electron/autoUpdate/failurePolicy.ts';

test('manual repair treats older leftover pending as stale cleanup state', () => {
  assert.equal(isStaleSwapFailureForCurrentVersion('1.22.12', '1.22.11'), true);
});

test('same-version pending is stale and must not suppress future updates', () => {
  assert.equal(isStaleSwapFailureForCurrentVersion('1.22.12', '1.22.12'), true);
});

test('newer pending still represents a real failed update attempt', () => {
  assert.equal(isStaleSwapFailureForCurrentVersion('1.22.12', '1.22.13'), false);
});

test('unknown pending version is handled conservatively as a real failure', () => {
  assert.equal(isStaleSwapFailureForCurrentVersion('1.22.12', null), false);
});
