import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMergedScenes,
  buildAllModeBulkTogglePlans,
  getSyncedMergedDetail,
  buildUnifiedSceneId,
  buildUnifiedSceneIdFromMerged,
  getMergedCommentBadgeCounts,
  matchesMergedSceneIdentity,
} from '../src/utils/mergedSceneHelpers.ts';

test('buildUnifiedSceneId canonicalizes the merged scene to the part-based scene id', () => {
  assert.equal(buildUnifiedSceneId('A', 'ac001'), 'a001');
  assert.equal(buildUnifiedSceneId('A', 'a1'), 'a001');
  assert.equal(buildUnifiedSceneId('C', 'c023'), 'c023');
  assert.equal(buildUnifiedSceneId('A', 'v2a001'), 'a001');
  assert.equal(buildUnifiedSceneId('A', 'v2a002'), 'a002');
});

test('buildUnifiedSceneIdFromMerged prefers the shared canonical scene id for mixed raw ids', () => {
  assert.equal(buildUnifiedSceneIdFromMerged('A', {
    sceneId: 'ac001',
    bgScene: { no: 3, sceneId: 'ac001' },
    actScene: { no: 7, sceneId: 'a001' },
    bgSceneIndex: 2,
    actSceneIndex: 5,
  }), 'a001');
});

test('matchesMergedSceneIdentity accepts both raw department ids and the unified id', () => {
  const merged = {
    sceneId: 'a001',
    bgScene: { no: 3, sceneId: 'ac001' },
    actScene: { no: 7, sceneId: 'a001' },
    bgSceneIndex: 2,
    actSceneIndex: 5,
  };

  assert.equal(matchesMergedSceneIdentity(merged, 'a001'), true);
  assert.equal(matchesMergedSceneIdentity(merged, 'ac001'), true);
  assert.equal(matchesMergedSceneIdentity(merged, 'x999'), false);
});

test('all-view bulk toggle resolves ACT updates with the real ACT sceneId', () => {
  const mergedScenes = [
    {
      sceneId: 'a001',
      bgScene: {
        no: 3,
        sceneId: 'ac001',
      },
      actScene: {
        no: 7,
        sceneId: 'a001',
      },
      bgSceneIndex: 2,
      actSceneIndex: 5,
    },
  ];

  const plans = buildAllModeBulkTogglePlans(
    new Set(['bg:a001', 'act:a001']),
    mergedScenes,
    'EP01_A_BG',
    'EP01_A_ACT',
  );

  assert.deepEqual(plans, [
    {
      sheetName: 'EP01_A_BG',
      updates: [{ sceneId: 'ac001', sceneIndex: 2 }],
    },
    {
      sheetName: 'EP01_A_ACT',
      updates: [{ sceneId: 'a001', sceneIndex: 5 }],
    },
  ]);
});

test('all-view comment badges use each department scene number independently', () => {
  const counts = getMergedCommentBadgeCounts(
    {
      sceneId: 'a001',
      bgScene: {
        no: 3,
        sceneId: 'ac001',
      },
      actScene: {
        no: 7,
        sceneId: 'a001',
      },
      bgSceneIndex: 2,
      actSceneIndex: 5,
    },
    'EP01_A_BG',
    'EP01_A_ACT',
    {
      'EP01_A_BG:3': 2,
      'EP01_A_ACT:7': 4,
      'EP01_A_ACT:3': 0,
    },
  );

  assert.deepEqual(counts, { bg: 2, act: 4, total: 6 });
});

test('buildMergedScenes merges matching BG and ACT scenes into one canonical scene id', () => {
  const mergedScenes = buildMergedScenes({
    bgScenes: [
      { no: 3, sceneId: 'ac001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    actScenes: [
      { no: 7, sceneId: 'a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    bgPartScenes: [
      { no: 3, sceneId: 'ac001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    actPartScenes: [
      { no: 7, sceneId: 'a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    mergedScenePartId: 'A',
    sortKey: 'no',
    sortDir: 'asc',
  });

  assert.equal(mergedScenes.length, 1);
  assert.equal(mergedScenes[0].sceneId, 'a001');
  assert.equal(mergedScenes[0].bgScene?.sceneId, 'ac001');
  assert.equal(mergedScenes[0].actScene?.sceneId, 'a001');
});

test('getSyncedMergedDetail keeps the modal target on the latest merged scene object', () => {
  const latest = {
    sceneId: 'a001',
    bgScene: { no: 3, sceneId: 'ac001' },
    actScene: { no: 7, sceneId: 'a001' },
    bgSceneIndex: 2,
    actSceneIndex: 5,
  };

  const synced = getSyncedMergedDetail(
    {
      sceneId: 'a001',
      bgScene: { no: 1, sceneId: 'ac001' },
      actScene: { no: 2, sceneId: 'a001' },
      bgSceneIndex: 0,
      actSceneIndex: 1,
    },
    [latest],
  );

  assert.equal(synced, latest);
  assert.equal(getSyncedMergedDetail(latest, []), null);
});
