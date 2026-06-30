import test from 'node:test';
import assert from 'node:assert/strict';

import { currentStageInfo } from '../src/components/widgets/my-tasks/stageInfo.ts';

function scene(lo: boolean, done: boolean, review: boolean, png: boolean) {
  return { lo, done, review, png };
}

test('전무: doneCount 0, currentStageKey null', () => {
  assert.deepEqual(currentStageInfo(scene(false, false, false, false)), {
    doneCount: 0, total: 4, currentStageKey: null,
  });
});

test('전부: doneCount 4, currentStageKey png', () => {
  assert.deepEqual(currentStageInfo(scene(true, true, true, true)), {
    doneCount: 4, total: 4, currentStageKey: 'png',
  });
});

test('연속 lo+done: doneCount 2, currentStageKey done', () => {
  assert.deepEqual(currentStageInfo(scene(true, true, false, false)), {
    doneCount: 2, total: 4, currentStageKey: 'done',
  });
});

test('비연속 lo+png: doneCount 2, currentStageKey png(마지막 연속 체크)', () => {
  assert.deepEqual(currentStageInfo(scene(true, false, false, true)), {
    doneCount: 2, total: 4, currentStageKey: 'png',
  });
});

test('단일 png: doneCount 1, currentStageKey png', () => {
  assert.deepEqual(currentStageInfo(scene(false, false, false, true)), {
    doneCount: 1, total: 4, currentStageKey: 'png',
  });
});

test('단일 lo: doneCount 1, currentStageKey lo', () => {
  assert.deepEqual(currentStageInfo(scene(true, false, false, false)), {
    doneCount: 1, total: 4, currentStageKey: 'lo',
  });
});
