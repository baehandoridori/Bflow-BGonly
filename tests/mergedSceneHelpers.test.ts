import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMergedScenes,
  buildMergedSceneKey,
  buildAllModeBulkTogglePlans,
  buildMergedRevisionSceneId,
  getSyncedMergedDetail,
  filterMergedScenesBySourceScenes,
  buildUnifiedSceneId,
  buildUnifiedSceneIdFromMerged,
  getMergedCommentBadgeCounts,
  matchesMergedSceneIdentity,
} from '../src/utils/mergedSceneHelpers.ts';
import { buildUnifiedRevisionSceneKey } from '../src/utils/revisionSceneKey.ts';

test('buildUnifiedSceneId canonicalizes the merged scene to the part-based scene id', () => {
  assert.equal(buildUnifiedSceneId('A', 'ac001'), 'a001');
  assert.equal(buildUnifiedSceneId('A', 'a1'), 'a001');
  assert.equal(buildUnifiedSceneId('C', 'c023'), 'c023');
  assert.equal(buildUnifiedSceneId('A', 'v2a001'), 'v2a001');
  assert.equal(buildUnifiedSceneId('A', 'v2a002'), 'v2a002');
});

test('buildUnifiedSceneIdFromMerged prefers the shared canonical scene id for mixed raw ids', () => {
  assert.equal(buildUnifiedSceneIdFromMerged('A', {
    sceneId: 'ac001',
    mergedKey: buildMergedSceneKey('A', {
      sceneId: 'ac001',
      bgScene: { no: 3, sceneId: 'ac001' },
      actScene: { no: 7, sceneId: 'a001' },
      bgSceneIndex: 2,
      actSceneIndex: 5,
    }),
    bgScene: { no: 3, sceneId: 'ac001' },
    actScene: { no: 7, sceneId: 'a001' },
    bgSceneIndex: 2,
    actSceneIndex: 5,
  }), 'a001');
});

test('matchesMergedSceneIdentity accepts both raw department ids and the unified id', () => {
  const merged = {
    sceneId: 'a001',
    mergedKey: 'a|scene:1',
    bgScene: { no: 3, sceneId: 'ac001' },
    actScene: { no: 7, sceneId: 'a001' },
    bgSceneIndex: 2,
    actSceneIndex: 5,
  };

  assert.equal(matchesMergedSceneIdentity(merged, 'a001'), true);
  assert.equal(matchesMergedSceneIdentity(merged, 'ac001'), true);
  assert.equal(matchesMergedSceneIdentity(merged, 'v2a001'), false);
  assert.equal(matchesMergedSceneIdentity(merged, 'x999'), false);
});

test('all-view bulk toggle resolves ACT updates with the real ACT sceneId', () => {
  const mergedScenes = [
    {
      sceneId: 'a001',
      mergedKey: 'a|scene:1',
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
    new Set(['bg:a|scene:1', 'act:a|scene:1']),
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

test('all-view bulk selection keeps resolving after adding the counterpart department scene', () => {
  const bgScene = { no: 3, sceneId: 'ac001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false };
  const actScene = { no: 7, sceneId: 'a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false };

  const beforeAdd = buildMergedScenes({
    bgScenes: [bgScene],
    actScenes: [],
    bgPartScenes: [bgScene],
    actPartScenes: [],
    mergedScenePartId: 'A',
    sortKey: 'no',
    sortDir: 'asc',
  });
  const selectedSceneIds = new Set([`bg:${beforeAdd[0].mergedKey}`, `act:${beforeAdd[0].mergedKey}`]);

  const afterAdd = buildMergedScenes({
    bgScenes: [bgScene],
    actScenes: [actScene],
    bgPartScenes: [bgScene],
    actPartScenes: [actScene],
    mergedScenePartId: 'A',
    sortKey: 'no',
    sortDir: 'asc',
  });

  assert.equal(beforeAdd[0].mergedKey, 'a|scene:1');
  assert.equal(afterAdd[0].mergedKey, beforeAdd[0].mergedKey);
  assert.deepEqual(
    buildAllModeBulkTogglePlans(selectedSceneIds, afterAdd, 'EP01_A_BG', 'EP01_A_ACT'),
    [
      {
        sheetName: 'EP01_A_BG',
        updates: [{ sceneId: 'ac001', sceneIndex: 0 }],
      },
      {
        sheetName: 'EP01_A_ACT',
        updates: [{ sceneId: 'a001', sceneIndex: 0 }],
      },
    ],
  );
});

test('all-view comment badges use each department scene number independently', () => {
  const counts = getMergedCommentBadgeCounts(
    {
      sceneId: 'a001',
      mergedKey: 'a|scene:1',
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
  assert.equal(mergedScenes[0].mergedKey, 'a|scene:1');
  assert.equal(mergedScenes[0].bgScene?.sceneId, 'ac001');
  assert.equal(mergedScenes[0].actScene?.sceneId, 'a001');
});

test('buildMergedScenes keeps a unique mergedKey for base and versioned scene ids', () => {
  const bgPartScenes = [
    { no: 1, sceneId: 'a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    { no: 2, sceneId: 'v2a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
  ];
  const mergedScenes = buildMergedScenes({
    bgScenes: bgPartScenes,
    actScenes: [],
    bgPartScenes,
    actPartScenes: [],
    mergedScenePartId: 'A',
    sortKey: 'no',
    sortDir: 'asc',
  });

  assert.equal(mergedScenes.length, 2);
  assert.equal(mergedScenes[0].sceneId, 'a001');
  assert.equal(mergedScenes[1].sceneId, 'v2a001');
  assert.notEqual(mergedScenes[0].mergedKey, mergedScenes[1].mergedKey);

  const plans = buildAllModeBulkTogglePlans(
    new Set([
      `bg:${mergedScenes[0].mergedKey}`,
      `bg:${mergedScenes[1].mergedKey}`,
    ]),
    mergedScenes,
    'EP01_A_BG',
    'EP01_A_ACT',
  );

  assert.deepEqual(plans, [
    {
      sheetName: 'EP01_A_BG',
      updates: [
        { sceneId: 'a001', sceneIndex: 0 },
        { sceneId: 'v2a001', sceneIndex: 1 },
      ],
    },
  ]);
});

test('buildMergedScenes disambiguates duplicate normalized scene aliases in one part', () => {
  const bgPartScenes = [
    { no: 1, sceneId: 'ac001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    { no: 2, sceneId: 'a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
  ];
  const mergedScenes = buildMergedScenes({
    bgScenes: bgPartScenes,
    actScenes: [],
    bgPartScenes,
    actPartScenes: [],
    mergedScenePartId: 'A',
    sortKey: 'no',
    sortDir: 'asc',
  });

  assert.equal(mergedScenes.length, 2);
  assert.equal(mergedScenes[0].sceneId, 'a001');
  assert.equal(mergedScenes[1].sceneId, 'a001');
  assert.notEqual(mergedScenes[0].mergedKey, mergedScenes[1].mergedKey);
  assert.match(mergedScenes[0].mergedKey, /^a\|scene:1\|/);
  assert.match(mergedScenes[1].mergedKey, /^a\|scene:1\|/);

  const plans = buildAllModeBulkTogglePlans(
    new Set([
      `bg:${mergedScenes[0].mergedKey}`,
      `bg:${mergedScenes[1].mergedKey}`,
    ]),
    mergedScenes,
    'EP01_A_BG',
    'EP01_A_ACT',
  );

  assert.deepEqual(plans, [
    {
      sheetName: 'EP01_A_BG',
      updates: [
        { sceneId: 'ac001', sceneIndex: 0 },
        { sceneId: 'a001', sceneIndex: 1 },
      ],
    },
  ]);
});

test('filtered merged scene lists preserve full-list disambiguated keys', () => {
  const acScene = { no: 1, sceneId: 'ac001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false };
  const aScene = { no: 2, sceneId: 'a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false };
  const fullMergedScenes = buildMergedScenes({
    bgScenes: [acScene, aScene],
    actScenes: [],
    bgPartScenes: [acScene, aScene],
    actPartScenes: [],
    mergedScenePartId: 'A',
    sortKey: 'no',
    sortDir: 'asc',
  });

  const visibleMergedScenes = filterMergedScenesBySourceScenes(fullMergedScenes, [acScene], []);

  assert.equal(visibleMergedScenes.length, 1);
  assert.equal(visibleMergedScenes[0].mergedKey, fullMergedScenes[0].mergedKey);
  assert.notEqual(visibleMergedScenes[0].mergedKey, 'a|scene:1');
  assert.deepEqual(
    buildAllModeBulkTogglePlans(
      new Set([`bg:${visibleMergedScenes[0].mergedKey}`]),
      fullMergedScenes,
      'EP01_A_BG',
      'EP01_A_ACT',
    ),
    [
      {
        sheetName: 'EP01_A_BG',
        updates: [{ sceneId: 'ac001', sceneIndex: 0 }],
      },
    ],
  );
});

test('merged revision ids stay shared normally but split disambiguated alias rows', () => {
  const sharedMerged = buildMergedScenes({
    bgScenes: [
      { no: 1, sceneId: 'ac001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    actScenes: [
      { no: 2, sceneId: 'a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    bgPartScenes: [
      { no: 1, sceneId: 'ac001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    actPartScenes: [
      { no: 2, sceneId: 'a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    mergedScenePartId: 'A',
    sortKey: 'no',
    sortDir: 'asc',
  });
  assert.equal(
    buildUnifiedRevisionSceneKey('EP01_A_BG', buildMergedRevisionSceneId(sharedMerged[0])),
    'EP01:A:1',
  );

  const acScene = { no: 1, sceneId: 'ac001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false };
  const aScene = { no: 2, sceneId: 'a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false };
  const duplicateAliasMerged = buildMergedScenes({
    bgScenes: [acScene, aScene],
    actScenes: [],
    bgPartScenes: [acScene, aScene],
    actPartScenes: [],
    mergedScenePartId: 'A',
    sortKey: 'no',
    sortDir: 'asc',
  });
  const firstRevisionKey = buildUnifiedRevisionSceneKey('EP01_A_BG', buildMergedRevisionSceneId(duplicateAliasMerged[0]));
  const secondRevisionKey = buildUnifiedRevisionSceneKey('EP01_A_BG', buildMergedRevisionSceneId(duplicateAliasMerged[1]));

  assert.notEqual(firstRevisionKey, secondRevisionKey);
  assert.match(firstRevisionKey, /^EP01:A:merged-/);
  assert.match(secondRevisionKey, /^EP01:A:merged-/);
});

test('buildMergedScenes does not merge versioned ids with the base scene number', () => {
  const mergedScenes = buildMergedScenes({
    bgScenes: [
      { no: 1, sceneId: 'a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    actScenes: [
      { no: 2, sceneId: 'v2a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    bgPartScenes: [
      { no: 1, sceneId: 'a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    actPartScenes: [
      { no: 2, sceneId: 'v2a001', assignee: '', memo: '', layoutId: '', storyboardUrl: '', guideUrl: '', lo: false, done: false, review: false, png: false },
    ],
    mergedScenePartId: 'A',
    sortKey: 'no',
    sortDir: 'asc',
  });

  assert.equal(mergedScenes.length, 2);
  assert.equal(mergedScenes[0].sceneId, 'a001');
  assert.equal(mergedScenes[0].actScene, null);
  assert.equal(mergedScenes[1].sceneId, 'v2a001');
  assert.equal(mergedScenes[1].bgScene, null);
});

test('getSyncedMergedDetail keeps the modal target on the latest merged scene object', () => {
  const latest = {
    sceneId: 'a001',
    mergedKey: 'a|scene:1',
    bgScene: { no: 3, sceneId: 'ac001' },
    actScene: { no: 7, sceneId: 'a001' },
    bgSceneIndex: 2,
    actSceneIndex: 5,
  };

  const synced = getSyncedMergedDetail(
    {
      sceneId: 'a001',
      mergedKey: 'a|scene:1',
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
