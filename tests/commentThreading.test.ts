import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCommentReplyTarget,
  orderCommentsForThreadedMainFlow,
} from '../src/utils/commentThreading.ts';

type TestComment = {
  id: string;
  userName: string;
  text: string;
  createdAt?: string;
  revisionId?: string | null;
  parentCommentId?: string | null;
};

const root: TestComment = { id: 'root-1', userName: '강선영', text: '원댓글' };
const reply: TestComment = {
  id: 'reply-1',
  userName: '김어진',
  text: '@강선영 첫 답글',
  parentCommentId: root.id,
};
const nestedReply: TestComment = {
  id: 'reply-2',
  userName: '허혜원',
  text: '@김어진 이어서 확인했습니다',
  parentCommentId: reply.id,
};

test('top-level comment replies are stored under that comment', () => {
  const target = buildCommentReplyTarget([root, reply], root);

  assert.equal(target.parentCommentId, root.id);
  assert.equal(target.rootComment?.id, root.id);
  assert.equal(target.replyToComment?.id, root.id);
  assert.equal(target.isReplyToReply, false);
});

test('reply-to-reply is flattened into the top-level thread root', () => {
  const target = buildCommentReplyTarget([root, reply], reply);

  assert.equal(target.parentCommentId, root.id);
  assert.equal(target.rootComment?.id, root.id);
  assert.equal(target.replyToComment?.id, reply.id);
  assert.equal(target.isReplyToReply, true);
});

test('deep legacy nested replies still resolve to the top-level thread root', () => {
  const target = buildCommentReplyTarget([root, reply, nestedReply], nestedReply);

  assert.equal(target.parentCommentId, root.id);
  assert.equal(target.rootComment?.id, root.id);
  assert.equal(target.replyToComment?.id, nestedReply.id);
  assert.equal(target.isReplyToReply, true);
});

test('orphan reply can start a visible new thread from itself', () => {
  const orphan: TestComment = {
    id: 'orphan-1',
    userName: '이다은',
    text: '@삭제된댓글 이어진 답글',
    parentCommentId: 'missing-root',
  };

  const target = buildCommentReplyTarget([orphan], orphan);

  assert.equal(target.parentCommentId, orphan.id);
  assert.equal(target.rootComment?.id, orphan.id);
  assert.equal(target.isReplyToReply, false);
});

test('retake comments stay adjacent in the main comment flow by revision thread', () => {
  const rows: TestComment[] = [
    { id: 'retake-a-1', userName: '강선영', text: '첫 리테이크 댓글', revisionId: 'revision-a', createdAt: '2026-07-07T09:00:00.000Z' },
    { id: 'general-1', userName: '김어진', text: '일반 댓글', createdAt: '2026-07-07T09:01:00.000Z' },
    { id: 'retake-b-1', userName: '허혜원', text: '다른 리테이크 댓글', revisionId: 'revision-b', createdAt: '2026-07-07T09:02:00.000Z' },
    { id: 'retake-a-2', userName: '이다은', text: '같은 리테이크 후속 댓글', revisionId: 'revision-a', createdAt: '2026-07-07T09:03:00.000Z' },
    { id: 'retake-b-2', userName: '배한솔', text: '다른 리테이크 후속 댓글', revisionId: 'revision-b', createdAt: '2026-07-07T09:04:00.000Z' },
  ];

  assert.deepEqual(
    orderCommentsForThreadedMainFlow(rows).map((comment) => comment.id),
    ['retake-a-1', 'retake-a-2', 'general-1', 'retake-b-1', 'retake-b-2'],
  );
});
