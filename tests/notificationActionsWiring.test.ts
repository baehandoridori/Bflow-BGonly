import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const notificationPanel = readFileSync('src/components/NotificationPanel.tsx', 'utf8');
const notificationHelper = readFileSync('src/utils/notificationHelper.ts', 'utf8');
const notificationDomainRead = readFileSync('src/utils/notificationDomainRead.ts', 'utf8');
const notificationSceneAction = readFileSync('src/utils/notificationSceneAction.ts', 'utf8');
const notificationStore = readFileSync('src/stores/useNotificationStore.ts', 'utf8');
const appStore = readFileSync('src/stores/useAppStore.ts', 'utf8');
const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');
const sceneDetailModal = readFileSync('src/components/scenes/SceneDetailModal.tsx', 'utf8');
const unifiedSceneDetailModal = readFileSync('src/components/scenes/UnifiedSceneDetailModal.tsx', 'utf8');
const revisionCommentThread = readFileSync('src/components/scenes/RevisionCommentThread.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const myTasksWidget = readFileSync('src/components/widgets/MyTasksWidget.tsx', 'utf8');

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
  assert.match(app, /markLocalFeedbackJumpAsRead\(payload\)/);
  assert.match(app, /navigateNotificationToScene\(payload\.kind === 'assignment' \? 'scene_assignment' : 'acting_feedback'/);
});

test('widget popup scene-row jumps defer to the pending scene-modal path so a cold-start main window opens the detail modal after data loads', () => {
  assert.match(app, /import \{ navigateToSceneView \} from '@\/utils\/sceneNavigationAction'/);
  assert.match(app, /onWidgetNavigateMain\?\.\s*\(\(payload\) => \{/);
  // 코덱스 4차 P2: 즉시 해석(navigateNotificationToScene) 대신 modalRequest 대기 경로로 라우팅.
  assert.match(app, /navigateToSceneView\(\{[\s\S]*?modalRequest:\s*\{[\s\S]*?initialTab:\s*'detail'[\s\S]*?\}/);
});

test('toast shortcut actions mark the local notification as read before navigating', () => {
  assert.match(notificationHelper, /const notificationId = store\.addNotification\(/);
  assert.match(notificationHelper, /markAsRead\(notificationId\)/);
  assert.match(notificationHelper, /hasNotificationActionTarget\(payload\.type,\s*payload\.metadata\)/);
  assert.match(notificationHelper, /retakeHubSetId/);
  assert.match(notificationStore, /const storedNotification = identity/);
  assert.match(notificationStore, /return storedNotification\?\.id \?\? notification\.id/);
});

test('all notification click paths mark domain read state before navigating', () => {
  assert.match(notificationSceneAction, /export \{ markNotificationDomainRead \} from '@\/utils\/notificationDomainRead'/);
  assert.match(notificationDomainRead, /markCommentReactionRead\(reactionNotificationId\)/);
  assert.match(notificationDomainRead, /markFeedbackNotificationRead\(feedbackNotificationId\)/);
  assert.match(notificationDomainRead, /markAssignmentNotificationRead\(assignmentNotificationId\)/);
  assert.match(notificationDomainRead, /calendarNotificationsMarkRead\?\.\(\[calendarNotificationId\]\)/);
});

test('calendar date entry points store a durable schedule request instead of racing a custom event', () => {
  assert.match(notificationPanel, /CalendarDays/);
  assert.match(notificationPanel, /case 'calendar': return \{ icon: CalendarDays, color: '#74B9FF', label: '일정' \}/);
  assert.match(notificationPanel, /if \(n\.type === 'calendar'\) \{[\s\S]*?navigateToScheduleDate\(date \? \{ date \} : undefined\)/);
  assert.match(myTasksWidget, /navigateToScheduleDate\(todo\.startDate \? \{ date: todo\.startDate, todoId: todo\.id \} : undefined\)/);
  assert.match(app, /onWidgetNavigateToDate\?\.\(\(payload\) => \{[\s\S]*?navigateToScheduleDate\([\s\S]*?date: payload\.date, todoId: payload\.todoId/);
  assert.doesNotMatch(notificationPanel, /bflow:navigate-to-date/);
  assert.doesNotMatch(myTasksWidget, /bflow:navigate-to-date/);
  assert.doesNotMatch(app, /bflow:navigate-to-date/);
});

test('calendar catch-up keeps IPC rows snake_case and filters by recipient, actor, and muted calendar', () => {
  assert.match(app, /const calendarCatchupDoneRef = useRef<string \| null>\(null\)/);
  assert.match(
    app,
    /const muted = useCalendarStore\.getState\(\)\.mutedCalendarIds;[\s\S]*?calendarNotificationsCatchup\?\.\(\{\s*excludedCalendarIds: muted,\s*\}\)/,
    'the renderer forwards only its local muted calendar IDs; the main process still owns the recipient identity',
  );
  assert.match(app, /r\.recipient_id !== me\.id/);
  assert.match(app, /r\.actor_id === me\.id/);
  assert.match(app, /muted\.includes\(r\.calendar_id\)/);
  assert.match(app, /calendarNotificationId: r\.id/);
  assert.match(app, /calendarId: r\.calendar_id \?\? undefined/);
  assert.match(app, /eventDate: r\.event_date \?\? undefined/);
  assert.match(app, /buildCalendarNotificationText\(/);
  assert.match(app, /releaseCatchupRunOnError\(calendarCatchupDoneRef, me\.id\)/);
});

test('manual read and deletion paths also sync durable domain read state', () => {
  assert.match(notificationStore, /import \{ markNotificationDomainRead \} from '\.\.\/utils\/notificationDomainRead'/);
  assert.match(notificationStore, /function syncDomainRead\(notification: AppNotification\)/);
  assert.match(notificationStore, /markAsRead: \(id\) => \{[\s\S]*if \(target && !target\.isRead\) syncDomainRead\(target\)/);
  assert.match(notificationStore, /markAllAsRead: \(\) => \{[\s\S]*current\.filter\(\(n\) => !n\.isRead\)\.forEach\(syncDomainRead\)/);
  assert.match(notificationStore, /removeNotification: \(id\) => \{[\s\S]*if \(target\) syncDomainRead\(target\)/);
  assert.match(notificationStore, /clearAll: \(\) => \{[\s\S]*get\(\)\.notifications\.forEach\(syncDomainRead\)/);
  assert.doesNotMatch(notificationPanel, /markCommentReactionRead/);
});

test('comment reaction upserts preserve local read state across realtime races', () => {
  assert.match(notificationStore, /const incomingReactionIsNewer =/);
  assert.match(notificationStore, /incomingReactionAt > existingReactionAt/);
  assert.match(notificationStore, /const existingRead = n\.isRead === true \|\| \(existingReaction\?\.isRead === true && !incomingReactionIsNewer\)/);
  assert.match(notificationStore, /\{ \.\.\.n, isRead: existingRead \}/);
});

test('special native feedback toasts respect the OS notification setting', () => {
  assert.match(app, /if \(notiSettingsRef\.current\.osNotification !== false\) \{\s*window\.electronAPI\.notifyFeedbackToast/);
});

test('notification action labels describe the actual destination', () => {
  assert.match(notificationPanel, /getNotificationSceneActionLabel\(n\.type,\s*n\.metadata\)/);
  assert.match(notificationHelper, /getNotificationSceneActionLabel\(payload\.type,\s*payload\.metadata\)/);
  assert.match(notificationSceneAction, /return '댓글 보기'/);
  assert.match(notificationSceneAction, /return '리테이크 댓글'/);
  assert.match(notificationSceneAction, /return '리테이크 보기'/);
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
