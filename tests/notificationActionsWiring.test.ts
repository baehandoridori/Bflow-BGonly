import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const notificationPanel = readFileSync('src/components/NotificationPanel.tsx', 'utf8');
const notificationHelper = readFileSync('src/utils/notificationHelper.ts', 'utf8');
const notificationSceneAction = readFileSync('src/utils/notificationSceneAction.ts', 'utf8');
const appStore = readFileSync('src/stores/useAppStore.ts', 'utf8');
const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');
const sceneDetailModal = readFileSync('src/components/scenes/SceneDetailModal.tsx', 'utf8');
const unifiedSceneDetailModal = readFileSync('src/components/scenes/UnifiedSceneDetailModal.tsx', 'utf8');
const revisionCommentThread = readFileSync('src/components/scenes/RevisionCommentThread.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

test('notification panel and toast actions share one scene navigation path', () => {
  assert.match(notificationPanel, /navigateNotificationToScene\(n\.type,\s*n\.metadata\)/);
  assert.match(notificationHelper, /navigateNotificationToScene\(payload\.type,\s*payload\.metadata\)/);
  assert.match(notificationSceneAction, /navigateToSceneView\(\{/);
  assert.match(notificationSceneAction, /episodeNumber: target\.episodeNumber/);
  assert.match(notificationSceneAction, /partId: target\.partId/);
  assert.match(notificationSceneAction, /highlightSceneId: target\.sceneName/);
  assert.match(notificationSceneAction, /modalRequest/);
});

test('native feedback toast jumps use the same notification scene navigation path', () => {
  assert.match(app, /import \{ navigateNotificationToScene \} from '@\/utils\/notificationSceneAction'/);
  assert.doesNotMatch(app, /const jumpToFeedbackScene = /);
  assert.match(app, /onFeedbackJumpToScene\?\.\s*\(\(payload\) => \{/);
  assert.match(app, /navigateNotificationToScene\(payload\.kind === 'assignment' \? 'scene_assignment' : 'acting_feedback'/);
});

test('all notification click paths mark domain read state before navigating', () => {
  assert.match(notificationSceneAction, /markCommentReactionRead\(reactionNotificationId\)/);
  assert.match(notificationSceneAction, /markFeedbackNotificationRead\(feedbackNotificationId\)/);
  assert.match(notificationSceneAction, /markAssignmentNotificationRead\(assignmentNotificationId\)/);
});

test('notification action labels describe the actual destination', () => {
  assert.match(notificationPanel, /getNotificationSceneActionLabel\(n\.type,\s*n\.metadata\)/);
  assert.match(notificationHelper, /getNotificationSceneActionLabel\(payload\.type,\s*payload\.metadata\)/);
  assert.match(notificationSceneAction, /return '댓글 보기'/);
  assert.match(notificationSceneAction, /return '리비전 댓글'/);
  assert.match(notificationSceneAction, /return '리비전 보기'/);
  assert.match(notificationSceneAction, /return '씬 보기'/);
});

test('revision comment notification routes into the revision comment thread', () => {
  assert.match(app, /commentId: newComment\.id \?\? undefined/);
  assert.match(appStore, /focusRevisionCommentId\?: string/);
  assert.match(scenesView, /focusRevisionCommentId: detail\.focusRevisionCommentId/);
  assert.match(sceneDetailModal, /commentId: focusRevisionCommentId/);
  assert.match(unifiedSceneDetailModal, /commentId: focusRevisionCommentId/);
  assert.match(revisionCommentThread, /setFocusedCommentId\(detail\.commentId\)/);
  assert.match(revisionCommentThread, /commentRefs\.current\.get\(focusedCommentId\)/);
  assert.match(revisionCommentThread, /comment-target-pulse/);
});
