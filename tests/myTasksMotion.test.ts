import test from 'node:test';
import assert from 'node:assert/strict';

import { clampStaggerDelay } from '../src/components/widgets/my-tasks/motionUtils.ts';

test('reduce면 항상 0', () => {
  assert.equal(clampStaggerDelay(5, true), 0);
  assert.equal(clampStaggerDelay(100, true), 0);
});

test('index 0/음수면 0', () => {
  assert.equal(clampStaggerDelay(0, false), 0);
  assert.equal(clampStaggerDelay(-3, false), 0);
});

test('index에 비례(0.025씩)', () => {
  assert.equal(clampStaggerDelay(2, false), 0.05);
  assert.equal(clampStaggerDelay(4, false), 0.1);
});

test('상한 0.3', () => {
  assert.equal(clampStaggerDelay(12, false), 0.3); // 12*0.025=0.3
  assert.equal(clampStaggerDelay(13, false), 0.3); // clamp
  assert.equal(clampStaggerDelay(1000, false), 0.3);
});
