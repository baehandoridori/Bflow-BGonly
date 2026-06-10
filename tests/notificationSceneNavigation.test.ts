import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNotificationSceneModalRequest,
  departmentFromNotificationSheetName,
  getSceneShortcutVisibilityClass,
  resolveNotificationSceneDepartmentFilter,
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
          {
            id: 'scene-act-duplicate-uuid',
            no: 19,
            sceneId: 'b018',
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

test('feedback catch-up resolves by sheet name when scene UUID is missing and scene names are reused', () => {
  assert.deepEqual(
    resolveNotificationSceneTarget(
      {
        sheetName: 'EP02_B_BG',
        sceneName: 'b018',
      },
      episodes,
    ),
    {
      episodeNumber: 2,
      partId: 'B',
      sheetName: 'EP02_B_BG',
      sceneUuid: 'scene-bg-uuid',
      sceneName: 'b018',
    },
  );
});

test('comment and mention scene shortcuts render on hover even when metadata is incomplete', () => {
  assert.equal(shouldShowSceneShortcut('mention', undefined), true);
  assert.equal(shouldShowSceneShortcut('comment', {}), true);
  assert.equal(shouldShowSceneShortcut('acting_feedback', { sceneName: 'b018' }), true);
  assert.equal(shouldShowSceneShortcut('scene_assignment', { sceneName: 'b018' }), true);
  assert.equal(
    getSceneShortcutVisibilityClass(),
    'opacity-0 group-hover/noti:opacity-100 group-focus-within/noti:opacity-100',
  );
});

test('notification sheet names infer department for current and legacy BG parts', () => {
  assert.equal(departmentFromNotificationSheetName('EP02_B_ACT'), 'acting');
  assert.equal(departmentFromNotificationSheetName('EP02_B_BG'), 'bg');
  assert.equal(departmentFromNotificationSheetName('EP02_B'), 'bg');
  assert.equal(departmentFromNotificationSheetName('ep02_b_act'), 'acting');
  assert.equal(departmentFromNotificationSheetName('ep02_b_bg'), 'bg');
  assert.equal(departmentFromNotificationSheetName('ep02_b'), 'bg');
  assert.equal(departmentFromNotificationSheetName(''), null);
  assert.equal(departmentFromNotificationSheetName('ARCHIVE'), null);
});

test('comment and mention scene shortcuts request the detail modal and focused comment', () => {
  const target = resolveNotificationSceneTarget(
    {
      commentPartId: 'part-act-uuid',
      commentSceneId: '18',
      commentId: 'comment-1',
    },
    episodes,
  );
  assert.ok(target);
  assert.deepEqual(
    buildNotificationSceneModalRequest('mention', { commentId: 'comment-1' }, target),
    {
      sceneUuid: 'scene-act-uuid',
      sceneName: 'b018_act',
      episodeNumber: 2,
      partId: 'B',
      initialTab: 'detail',
      focusCommentId: 'comment-1',
      forceDeptFilter: 'all',
    },
  );
});

test('legacy comment shortcuts still open the detail modal when comment id is missing', () => {
  const target = resolveNotificationSceneTarget(
    {
      commentPartId: 'part-act-uuid',
      commentSceneId: '18',
    },
    episodes,
  );
  assert.ok(target);
  assert.deepEqual(
    buildNotificationSceneModalRequest('comment', {}, target),
    {
      sceneUuid: 'scene-act-uuid',
      sceneName: 'b018_act',
      episodeNumber: 2,
      partId: 'B',
      initialTab: 'detail',
      focusCommentId: undefined,
      forceDeptFilter: 'all',
    },
  );
});

test('revision comment shortcuts request the revisions tab with a nested comment focus target', () => {
  const target = resolveNotificationSceneTarget(
    {
      sceneId: 'scene-bg-uuid',
      revisionId: 'revision-1',
      revisionAction: 'comment',
      commentId: 'revision-comment-1',
    },
    episodes,
  );
  assert.ok(target);
  assert.deepEqual(
    buildNotificationSceneModalRequest(
      'revision',
      {
        revisionId: 'revision-1',
        revisionAction: 'comment',
        commentId: 'revision-comment-1',
      },
      target,
    ),
    {
      sceneUuid: 'scene-bg-uuid',
      sceneName: 'b018',
      episodeNumber: 2,
      partId: 'B',
      initialTab: 'revisions',
      focusRevisionId: 'revision-1',
      focusRevisionCommentId: 'revision-comment-1',
    },
  );
});

test('scene shortcuts preserve department filter except comment modal jumps', () => {
  const target = resolveNotificationSceneTarget(
    {
      sceneId: 'scene-act-uuid',
      revisionId: 'revision-1',
      revisionAction: 'comment',
    },
    episodes,
  );
  assert.ok(target);
  const modalRequest = buildNotificationSceneModalRequest('revision', { revisionId: 'revision-1' }, target);

  assert.equal(resolveNotificationSceneDepartmentFilter('revision', modalRequest, target), undefined);
  assert.equal(resolveNotificationSceneDepartmentFilter('acting_feedback', null, target), undefined);
  assert.equal(resolveNotificationSceneDepartmentFilter('scene_assignment', null, target), undefined);
  assert.equal(
    resolveNotificationSceneDepartmentFilter(
      'mention',
      buildNotificationSceneModalRequest('mention', { commentId: 'comment-1' }, target),
      target,
    ),
    'all',
  );
});
