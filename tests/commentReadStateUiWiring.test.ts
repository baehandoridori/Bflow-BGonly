import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const commentPanel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');
const resizable = readFileSync('src/components/scenes/CommentPanelResizable.tsx', 'utf8');
const sceneDetailModal = readFileSync('src/components/scenes/SceneDetailModal.tsx', 'utf8');
const unifiedSceneDetailModal = readFileSync('src/components/scenes/UnifiedSceneDetailModal.tsx', 'utf8');
const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');
const compositingView = readFileSync('src/views/CompositingView.tsx', 'utf8');
const feedbackHubPreviewApp = readFileSync('src/views/FeedbackHubPreviewApp.tsx', 'utf8');
const indexCss = readFileSync('src/index.css', 'utf8');

function getCommentPanelResizableUsage(source: string): string {
  const usage = source.match(/<CommentPanelResizable\b[\s\S]*?\/>/);
  assert.ok(usage);
  return usage[0];
}

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

test('SceneDetailModal passes revision scene key as comment read-state thread key', () => {
  const usage = getCommentPanelResizableUsage(sceneDetailModal);

  assert.match(usage, /sceneKey=\{sceneKey\}/);
  assert.match(usage, /sceneThreadKey=\{revisionSceneKey\}/);
});

test('UnifiedSceneDetailModal passes revision scene key as comment read-state thread key', () => {
  const usage = getCommentPanelResizableUsage(unifiedSceneDetailModal);

  assert.match(usage, /sceneKey=\{primaryCommentKey\}/);
  assert.match(usage, /sceneThreadKey=\{revisionSceneKey\}/);
});

test('Scene detail comment panels expose /re quick revision context', () => {
  assert.match(commentPanel, /parseRevisionSlashCommand/);
  assert.match(commentPanel, /리비전 빠른 등록/);
  assert.match(commentPanel, /알람 보낼 담당자/);
  assert.match(commentPanel, /createRevision\(\{/);
  assert.match(resizable, /quickRevision\?: CommentPanelQuickRevisionContext/);
  assert.match(sceneDetailModal, /quickRevision=\{\{/);
  assert.match(sceneDetailModal, /context: department/);
  assert.match(unifiedSceneDetailModal, /context: selectedDepartment === 'bg' \|\| selectedDepartment === 'acting' \? selectedDepartment : 'all'/);
});

test('ScenesView maps legacy comment keys to canonical thread keys for read badges', () => {
  assert.match(scenesView, /buildSceneThreadKeyFromCommentKey/);
  assert.match(scenesView, /setCommentThreadKeyByCommentKey/);
  assert.match(scenesView, /commentThreadKeyByCommentKey\[key\] \?\? key/);
  assert.match(scenesView, /getLatestOtherUserCommentCreatedAt\(list,\s*currentUser\?\.id \?\? ''\)/);
  assert.doesNotMatch(scenesView, /isCommentKeyUnread\(commentLatestAtByKey\[key\], commentReadAtByKey\[key\]\)/);
});

test('Scene view unread comment badges use quiet pulse styling', () => {
  assert.match(indexCss, /@keyframes comment-unread-badge-pulse/);
  assert.match(indexCss, /\.comment-unread-badge/);
  assert.match(scenesView, /comment-unread-badge/);
  assert.match(sceneDetailModal + unifiedSceneDetailModal + commentPanel, /sceneThreadKey/);
});

test('Feedback hub uses shared comment read state instead of notification-only read markers', () => {
  assert.match(compositingView, /getCommentReadStateForUser/);
  assert.match(compositingView, /buildSceneThreadKeyFromRevisionKey/);
  assert.match(compositingView, /commentReadAtByThreadKey/);
  assert.match(compositingView, /COMMENT_READ_STATE_EVENT/);
  assert.match(compositingView, /isCommentKeyUnread/);
  assert.match(feedbackHubPreviewApp, /primeCommentReadStateForUser/);
  assert.match(feedbackHubPreviewApp, /COMMENT_READ_STATE_EVENT/);
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

test('CommentPanel reruns scroll and observer setup after the unread divider mounts', () => {
  assert.match(commentPanel, /setUnreadDividerNode/);
  assert.match(commentPanel, /unreadDividerElement/);
  assert.match(commentPanel, /\[firstUnreadCommentId,\s*unreadDividerElement\]/);
  assert.match(commentPanel, /\[firstUnreadCommentId,\s*latestOtherUserCommentAt,\s*markUnreadCommentsRead,\s*unreadDividerElement\]/);
});
