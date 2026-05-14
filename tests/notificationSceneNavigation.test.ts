import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSceneShortcutVisibilityClass,
  resolveNotificationSceneTarget,
  shouldShowSceneShortcut,
} from '../src/utils/notificationSceneNavigation.ts';
import type { Episode } from '../src/types/index.ts';

const episodes = [
  {
    episodeNumber: 2,
    title: 'EP.02',
    parts: [
      {
        id: 'part-bg-uuid',
        partId: 'B',
        department: 'bg',
        sheetName: 'EP02_B_BG',
        scenes: [
          {
            id: 'scene-bg-uuid',
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
      {
        id: 'part-act-uuid',
        partId: 'B',
        department: 'acting',
        sheetName: 'EP02_B_ACT',
        scenes: [
          {
            id: 'scene-act-uuid',
            no: 18,
            sceneId: 'b018_act',
            memo: '',
            storyboardUrl: '',
            guideUrl: '',
            assignee: '다은',
            layoutId: '',
            lo: false,
            done: false,
            review: false,
            png: false,
          },
        ],
      },
    ],
  },
] satisfies Episode[];

test('mention notification resolves target by DB part UUID and comment scene sort order when scene UUID is missing', () => {
  assert.deepEqual(
    resolveNotificationSceneTarget(
      {
        commentPartId: 'part-act-uuid',
        commentSceneId: '18',
        commentId: 'comment-1',
      },
      episodes,
    ),
    {
      episodeNumber: 2,
      partId: 'B',
      sheetName: 'EP02_B_ACT',
      sceneUuid: 'scene-act-uuid',
      sceneName: 'b018_act',
    },
  );
});

test('mention notification resolves legacy EP:part:sceneName metadata without relying on global sceneId reuse', () => {
  assert.deepEqual(
    resolveNotificationSceneTarget(
      {
        sceneName: 'EP02:B:b018_act',
      },
      episodes,
    ),
    {
      episodeNumber: 2,
      partId: 'B',
      sheetName: 'EP02_B_ACT',
      sceneUuid: 'scene-act-uuid',
      sceneName: 'b018_act',
    },
  );
});

test('comment and mention scene shortcuts stay visible even when metadata is incomplete', () => {
  assert.equal(shouldShowSceneShortcut('mention', undefined), true);
  assert.equal(shouldShowSceneShortcut('comment', {}), true);
  assert.equal(getSceneShortcutVisibilityClass(true), 'opacity-100');
});
