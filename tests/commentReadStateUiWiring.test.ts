import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const commentPanel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');
const revisionCommentThread = readFileSync('src/components/scenes/RevisionCommentThread.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
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

test('SceneDetailModal passes canonical thread key as comment read-state thread key', () => {
  const usage = getCommentPanelResizableUsage(sceneDetailModal);

  assert.match(sceneDetailModal, /buildSceneThreadKeyFromRevisionKey/);
  assert.match(sceneDetailModal, /const sceneThreadKey = buildSceneThreadKeyFromRevisionKey\(revisionSceneKey\)/);
  assert.match(usage, /sceneKey=\{sceneKey\}/);
  assert.match(usage, /sceneThreadKey=\{sceneThreadKey\}/);
});

test('UnifiedSceneDetailModal passes canonical thread key as comment read-state thread key', () => {
  const usage = getCommentPanelResizableUsage(unifiedSceneDetailModal);

  assert.match(unifiedSceneDetailModal, /buildSceneThreadKeyFromRevisionKey/);
  assert.match(unifiedSceneDetailModal, /const sceneThreadKey = revisionSceneKey \? buildSceneThreadKeyFromRevisionKey\(revisionSceneKey\) : ''/);
  assert.match(usage, /sceneKey=\{primaryCommentKey\}/);
  assert.match(usage, /sceneThreadKey=\{sceneThreadKey\}/);
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

test('quick revision can register a pasted attachment as the revision image', () => {
  assert.match(commentPanel, /imageUrl:\s*revisionImageUrl/);
  assert.match(commentPanel, /첨부 이미지가 리비전 이미지로 함께 등록됩니다/);
  assert.match(commentPanel, /quickRevisionActive \? files\.slice\(0, 1\) : files/);
  assert.doesNotMatch(commentPanel, /빠른 리비전은 텍스트만 등록합니다/);
  assert.doesNotMatch(commentPanel, /disabled=\{quickRevisionActive\}/);
  assert.doesNotMatch(commentPanel, /&& !quickRevisionHasAttachments/);
});

test('revision comment thread supports image paste and file attachments', () => {
  assert.match(revisionCommentThread, /attachedImages/);
  assert.match(revisionCommentThread, /storageService\.uploadImage/);
  assert.match(revisionCommentThread, /resizeBlob/);
  assert.match(revisionCommentThread, /onPaste=\{handlePaste\}/);
  assert.match(revisionCommentThread, /images:\s*uploadedImageUrls/);
  assert.match(revisionCommentThread, /comment\.images/);
});

test('revision comment thread supports user mentions like the main comment panel', () => {
  assert.match(revisionCommentThread, /extractMentions/);
  assert.match(revisionCommentThread, /mentions:\s*extractMentions\(draft,\s*users\.map/);
  assert.match(revisionCommentThread, /showMentions/);
  assert.match(revisionCommentThread, /mentionFilter/);
  assert.match(revisionCommentThread, /insertMention/);
  assert.match(revisionCommentThread, /PathLinkifiedText/);
  assert.match(revisionCommentThread, /sendMentionWebhook/);
});

test('revision comment notifications include explicitly mentioned users', () => {
  assert.match(app, /const mentionedNames = Array\.isArray\(newComment\.mentions\) \? newComment\.mentions : \[\]/);
  assert.match(app, /const mentionedUserIds = useAuthStore\.getState\(\)\.users/);
  assert.match(app, /const targets = new Set\(\[\.\.\.revisionNotifyIds, \.\.\.mentionedUserIds\]\)/);
  assert.match(app, /리비전 댓글 멘션/);
});

test('single scene detail comment panel exposes the same activity inline events as unified detail', () => {
  const usage = getCommentPanelResizableUsage(sceneDetailModal);

  assert.match(sceneDetailModal, /import type \{ CommentInlineEvent \}/);
  assert.match(sceneDetailModal, /const inlineEvents: CommentInlineEvent\[\]/);
  assert.match(sceneDetailModal, /describeActivity\(a\)/);
  assert.match(sceneDetailModal, /'revision_add', 'revision_in_progress', 'revision_resolve', 'revision_delete'/);
  assert.match(usage, /inlineEvents=\{inlineEvents\}/);
  assert.match(unifiedSceneDetailModal, /const inlineEvents: CommentInlineEvent\[\]/);
});

test('ScenesView maps legacy comment keys to canonical thread keys for read badges', () => {
  assert.match(scenesView, /buildSceneThreadKeyFromCommentKey/);
  assert.match(scenesView, /setCommentThreadKeyByCommentKey/);
  assert.match(scenesView, /commentThreadKeyByCommentKey\[key\] \?\? key/);
  assert.match(scenesView, /currentUser\?\.id\s*\?\s*getLatestOtherUserCommentCreatedAt\(list,\s*currentUser\.id\)\s*:\s*getLatestCommentCreatedAt\(list\)/);
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
