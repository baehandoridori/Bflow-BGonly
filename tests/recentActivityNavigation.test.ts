import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatActivityGroupLabel,
  formatActivitySceneLabel,
  resolveActivitySceneNavigation,
} from '../src/components/widgets/activity/feedNavigation.ts';
import type { Activity, Episode } from '../src/types/index.ts';

const baseActivity = {
  id: 'activity-1',
  userId: 'user-1',
  userName: '한솔',
  actionType: 'stage_done',
  actionGroup: 'stage',
  sceneId: 'scene-uuid-1',
  sceneLabel: 'EP02 B #b018',
  episodeNumber: 2,
  department: 'bg',
  detail: null,
  createdAt: '2026-05-09T00:00:00.000Z',
} satisfies Activity;

const episodes = [
  {
    episodeNumber: 2,
    title: 'EP.02',
    parts: [
      {
        id: 'part-uuid-1',
        partId: 'B',
        department: 'bg',
        sheetName: 'EP02_B_BG',
        scenes: [
          {
            id: 'scene-uuid-1',
            no: 18,
            sceneId: 'b018',
            memo: '',
            storyboardUrl: '',
            guideUrl: '',
            assignee: '한솔',
            layoutId: '',
            lo: false,
            done: true,
            review: false,
            png: false,
          },
        ],
      },
    ],
  },
] satisfies Episode[];

test('recent activity labels replace EP prefix with the custom Korean episode title', () => {
  assert.equal(
    formatActivitySceneLabel(baseActivity.sceneLabel, baseActivity.episodeNumber, { 2: '쾅 뉴럴링크' }),
    '쾅 뉴럴링크 B #b018',
  );
  assert.equal(
    formatActivitySceneLabel(baseActivity.sceneLabel, baseActivity.episodeNumber, {}),
    'EP02 B #b018',
  );
  assert.equal(formatActivitySceneLabel(null, 2, { 2: '쾅 뉴럴링크' }), '');
});

test('recent activity group labels use the custom Korean episode title when available', () => {
  assert.equal(formatActivityGroupLabel(baseActivity, { 2: '쾅 뉴럴링크' }), '쾅 뉴럴링크');
  assert.equal(formatActivityGroupLabel(baseActivity, {}), 'EP02');
});

test('recent activity scene navigation resolves UUID activity targets to the scene deep link target', () => {
  assert.deepEqual(resolveActivitySceneNavigation(baseActivity, episodes), {
    episodeNumber: 2,
    partId: 'B',
    sheetName: 'EP02_B_BG',
    sceneId: 'b018',
  });

  assert.equal(
    resolveActivitySceneNavigation({ ...baseActivity, sceneId: 'missing-scene' }, episodes),
    null,
  );
});
