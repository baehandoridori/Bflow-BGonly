import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetCommentReadStateServiceForTests,
  getCommentReadStateForUser,
  getLatestOtherUserCommentCreatedAt,
  isCommentKeyUnread,
  markSceneThreadReadForUser,
  primeCommentReadStateForUser,
} from '../src/services/commentReadStateService.ts';

test('comment read state treats comments newer than the seen timestamp as unread', () => {
  const latest = '2026-05-29T09:30:00.000Z';

  assert.equal(isCommentKeyUnread(latest, undefined), true);
  assert.equal(isCommentKeyUnread(latest, '2026-05-29T09:29:59.000Z'), true);
  assert.equal(isCommentKeyUnread(latest, '2026-05-29T09:30:00.000Z'), false);
  assert.equal(isCommentKeyUnread(latest, '2026-05-29T09:31:00.000Z'), false);
});

test('latest other-user comment ignores invalid, empty, and own rows', () => {
  const latest = getLatestOtherUserCommentCreatedAt([
    { userId: 'me', createdAt: '2026-05-29T11:00:00.000Z' },
    { userId: 'other', createdAt: 'bad-date' },
    { userId: 'other', createdAt: '2026-05-29T09:00:00.000Z' },
    { userId: 'other', createdAt: '2026-05-29T10:00:00.000Z' },
    { userId: 'other', createdAt: '' },
  ], 'me');

  assert.equal(latest, '2026-05-29T10:00:00.000Z');
});

test('prime and mark update the per-user cache optimistically', async () => {
  __resetCommentReadStateServiceForTests();
  primeCommentReadStateForUser('me', { 'EP05:A:a001': '2026-05-29T09:00:00.000Z' });

  await markSceneThreadReadForUser({
    userId: 'me',
    sceneThreadKey: 'EP05:A:a001',
    readAt: '2026-05-29T10:00:00.000Z',
  });

  const state = await getCommentReadStateForUser('me');
  assert.equal(state['EP05:A:a001'], '2026-05-29T10:00:00.000Z');
});

test('mark ignores older read timestamps', async () => {
  __resetCommentReadStateServiceForTests();
  primeCommentReadStateForUser('me', { 'EP05:A:a001': '2026-05-29T10:00:00.000Z' });

  await markSceneThreadReadForUser({
    userId: 'me',
    sceneThreadKey: 'EP05:A:a001',
    readAt: '2026-05-29T09:59:00.000Z',
  });

  const state = await getCommentReadStateForUser('me');
  assert.equal(state['EP05:A:a001'], '2026-05-29T10:00:00.000Z');
});
