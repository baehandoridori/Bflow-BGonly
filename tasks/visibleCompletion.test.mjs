import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAllViewCompletionState,
  getSingleViewCompletionState,
} from '../src/utils/visibleCompletion.ts';

function createScene(overrides = {}) {
  return {
    lo: true,
    done: true,
    review: true,
    png: true,
    completedBy: undefined,
    completedAt: undefined,
    ...overrides,
  };
}

test('single view completes when every visible scene is fully done', () => {
  const state = getSingleViewCompletionState([
    createScene({ completedBy: '한솔', completedAt: '2026-04-21T01:00:00.000Z' }),
    createScene({ completedBy: '연차', completedAt: '2026-04-21T02:00:00.000Z' }),
  ]);

  assert.equal(state.isComplete, true);
  assert.deepEqual(state.completedMeta, {
    completedBy: '연차',
    completedAt: '2026-04-21T02:00:00.000Z',
  });
});

test('all view does not complete when any visible merged scene is missing one side', () => {
  const state = getAllViewCompletionState([
    {
      bgScene: createScene({ completedBy: 'BG 담당', completedAt: '2026-04-21T01:00:00.000Z' }),
      actScene: null,
    },
  ]);

  assert.equal(state.isComplete, false);
  assert.equal(state.completedMeta, null);
});

test('all view completes only when every visible merged scene has both sides fully done', () => {
  const state = getAllViewCompletionState([
    {
      bgScene: createScene({ completedBy: 'BG 담당', completedAt: '2026-04-21T01:00:00.000Z' }),
      actScene: createScene({ completedBy: '액팅 담당', completedAt: '2026-04-21T03:30:00.000Z' }),
    },
    {
      bgScene: createScene({ completedBy: '배경 팀', completedAt: '2026-04-21T02:00:00.000Z' }),
      actScene: createScene({ completedBy: '마지막 담당', completedAt: '2026-04-21T04:00:00.000Z' }),
    },
  ]);

  assert.equal(state.isComplete, true);
  assert.deepEqual(state.completedMeta, {
    completedBy: '마지막 담당',
    completedAt: '2026-04-21T04:00:00.000Z',
  });
});
