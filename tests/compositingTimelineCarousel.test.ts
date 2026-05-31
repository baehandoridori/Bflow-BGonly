import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampTimelineRatio,
  getTimelineCarouselSelection,
} from '../src/utils/compositingTimelineCarousel.ts';

test('timeline carousel clamps pointer ratio into the timeline range', () => {
  assert.equal(clampTimelineRatio(-0.5), 0);
  assert.equal(clampTimelineRatio(1.5), 1);
  assert.equal(clampTimelineRatio(0.42), 0.42);
});

test('timeline carousel snaps to the nearest scene index', () => {
  assert.deepEqual(getTimelineCarouselSelection(60, 0).selectedIndex, 0);
  assert.deepEqual(getTimelineCarouselSelection(60, 1).selectedIndex, 59);
  assert.deepEqual(getTimelineCarouselSelection(60, 0.5).selectedIndex, 30);
  assert.equal(getTimelineCarouselSelection(60, 0.5).floatingIndex, 29.5);
});

test('timeline carousel keeps enough neighboring scene slots for smooth handoff', () => {
  assert.deepEqual(getTimelineCarouselSelection(60, 0.5).visibleIndices, [28, 29, 30, 31, 32]);
  assert.deepEqual(getTimelineCarouselSelection(60, 0).visibleIndices, [0, 1, 2]);
  assert.deepEqual(getTimelineCarouselSelection(60, 1).visibleIndices, [57, 58, 59]);
});

test('timeline carousel handles empty and single-scene parts', () => {
  assert.deepEqual(getTimelineCarouselSelection(0, 0.5), {
    selectedIndex: -1,
    floatingIndex: -1,
    pointerRatio: 0,
    snapRatio: 0,
    visibleIndices: [],
  });
  assert.deepEqual(getTimelineCarouselSelection(1, 0.92), {
    selectedIndex: 0,
    floatingIndex: 0,
    pointerRatio: 0.92,
    snapRatio: 0,
    visibleIndices: [0],
  });
});
