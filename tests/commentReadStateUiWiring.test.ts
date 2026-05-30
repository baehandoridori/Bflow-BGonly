import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const commentPanel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');
const resizable = readFileSync('src/components/scenes/CommentPanelResizable.tsx', 'utf8');

test('CommentPanel renders unread divider and observes visibility before marking read', () => {
  assert.match(commentPanel, /새 댓글/);
  assert.match(commentPanel, /IntersectionObserver/);
  assert.match(commentPanel, /markSceneThreadReadForUser/);
  assert.match(commentPanel, /getLatestOtherUserCommentCreatedAt/);
});

test('CommentPanelResizable passes canonical sceneThreadKey to CommentPanel', () => {
  assert.match(resizable, /sceneThreadKey\?: string/);
  assert.match(resizable, /sceneThreadKey=\{sceneThreadKey/);
});

test('CommentPanel does not mark canonical read state while merely loading comments', () => {
  assert.doesNotMatch(commentPanel, /markCommentKeysSeen/);
});

test('CommentPanel can place the unread divider before a nested unread reply', () => {
  assert.match(commentPanel, /orderedVisibleComments/);
  assert.match(commentPanel, /replyShowUnreadDivider/);
  assert.match(commentPanel, /reply\.id === firstUnreadCommentId/);
  assert.match(commentPanel, /next\.delete\(target\.parentCommentId!\)/);
});
