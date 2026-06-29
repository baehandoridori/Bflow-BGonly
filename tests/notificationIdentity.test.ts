import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupeNotificationsByIdentity,
  getNotificationIdentity,
  prependNotificationDeduped,
} from '../src/utils/notificationIdentity.ts';

test('notification identity uses source row ids for catch-up domains', () => {
  assert.equal(
    getNotificationIdentity({
      type: 'acting_feedback',
      metadata: { feedbackNotificationId: 'feedback-row-1' },
    }),
    'acting_feedback:feedback-row-1',
  );
  assert.equal(
    getNotificationIdentity({
      type: 'scene_assignment',
      metadata: { assignmentNotificationId: 'assignment-row-1' },
    }),
    'scene_assignment:assignment-row-1',
  );
  assert.equal(
    getNotificationIdentity({
      type: 'comment_reaction',
      metadata: { reactionNotificationId: 'reaction-row-1' },
    }),
    'comment_reaction:reaction-row-1',
  );
});

test('comment and revision comment notifications dedupe by comment source id', () => {
  assert.equal(
    getNotificationIdentity({
      type: 'mention',
      metadata: { commentId: 'comment-1' },
    }),
    'scene_comment:comment-1',
  );
  assert.equal(
    getNotificationIdentity({
      type: 'revision',
      metadata: { revisionId: 'revision-1', revisionAction: 'comment', commentId: 'comment-2' },
    }),
    'revision_comment:revision-1:comment-2',
  );
});

test('revision event id keeps separate assignee completion notifications distinct', () => {
  assert.equal(
    getNotificationIdentity({
      type: 'revision',
      metadata: {
        revisionId: 'revision-1',
        revisionAction: 'assignee_done',
        revisionEventId: 'user-a:2026-06-29T07:00:00.000Z',
      },
    }),
    'revision:revision-1:assignee_done:user-a:2026-06-29T07:00:00.000Z',
  );
  assert.notEqual(
    getNotificationIdentity({
      type: 'revision',
      metadata: {
        revisionId: 'revision-1',
        revisionAction: 'assignee_done',
        revisionEventId: 'user-a:2026-06-29T07:00:00.000Z',
      },
    }),
    getNotificationIdentity({
      type: 'revision',
      metadata: {
        revisionId: 'revision-1',
        revisionAction: 'assignee_done',
        revisionEventId: 'user-b:2026-06-29T07:05:00.000Z',
      },
    }),
  );
});

test('prependNotificationDeduped preserves read state and local id for duplicate source notifications', () => {
  const existing = {
    id: 'local-existing',
    type: 'acting_feedback',
    title: 'old title',
    metadata: { feedbackNotificationId: 'feedback-row-1', sceneName: 's001' },
    isRead: true,
    createdAt: '2026-06-04T00:00:00.000Z',
  };
  const incoming = {
    id: 'local-incoming',
    type: 'acting_feedback',
    title: 'new title',
    metadata: { feedbackNotificationId: 'feedback-row-1', sheetName: 'EP01_A_ACT' },
    isRead: false,
    createdAt: '2026-06-04T00:01:00.000Z',
  };

  const next = prependNotificationDeduped([existing], incoming, 50);

  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'local-existing');
  assert.equal(next[0].title, 'new title');
  assert.equal(next[0].isRead, true);
  assert.equal(next[0].createdAt, '2026-06-04T00:00:00.000Z');
  assert.deepEqual(next[0].metadata, {
    feedbackNotificationId: 'feedback-row-1',
    sceneName: 's001',
    sheetName: 'EP01_A_ACT',
  });
});

test('dedupeNotificationsByIdentity compacts persisted duplicates while keeping unrelated scene changes', () => {
  const list = [
    {
      id: 'newer',
      type: 'mention',
      title: 'newer',
      metadata: { commentId: 'comment-1' },
      isRead: false,
      createdAt: '2026-06-04T00:01:00.000Z',
    },
    {
      id: 'older',
      type: 'mention',
      title: 'older',
      metadata: { commentId: 'comment-1', commentSceneId: '18' },
      isRead: true,
      createdAt: '2026-06-04T00:00:00.000Z',
    },
    {
      id: 'stage-a',
      type: 'scene_change',
      title: 'same scene changed',
      metadata: { sceneId: 'scene-1' },
      isRead: false,
      createdAt: '2026-06-04T00:02:00.000Z',
    },
    {
      id: 'stage-b',
      type: 'scene_change',
      title: 'same scene changed again',
      metadata: { sceneId: 'scene-1' },
      isRead: false,
      createdAt: '2026-06-04T00:03:00.000Z',
    },
  ];

  const next = dedupeNotificationsByIdentity(list, 50);

  assert.equal(next.length, 3);
  assert.equal(next[0].id, 'newer');
  assert.equal(next[0].isRead, true);
  assert.equal(next[1].id, 'stage-a');
  assert.equal(next[2].id, 'stage-b');
});
