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
const commentPanelCss = readFileSync('src/styles/comment-panel.css', 'utf8');
const electronBroadcast = readFileSync('electron/broadcast.ts', 'utf8');
const electronSupabase = readFileSync('electron/supabase.ts', 'utf8');
const attachmentImageLightbox = readFileSync('src/components/scenes/AttachmentImageLightbox.tsx', 'utf8');
const imageContextMenu = readFileSync('src/components/scenes/ImageContextMenu.tsx', 'utf8');
const revisionPanel = readFileSync('src/components/scenes/RevisionPanel.tsx', 'utf8');
const revisionDetailPanel = readFileSync('src/views/compositing/RevisionDetailPanel.tsx', 'utf8');
const revisionItem = readFileSync('src/views/compositing/RevisionItem.tsx', 'utf8');
const revisionRecipientPicker = readFileSync('src/components/scenes/RevisionRecipientPicker.tsx', 'utf8');

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
  assert.match(commentPanel, /리테이크 빠른 등록/);
  assert.match(commentPanel, /알람 보낼 담당자/);
  assert.match(commentPanel, /createRevision\(\{/);
  assert.match(resizable, /quickRevision\?: CommentPanelQuickRevisionContext/);
  assert.match(sceneDetailModal, /quickRevision=\{\{/);
  assert.match(sceneDetailModal, /context: department/);
  assert.match(unifiedSceneDetailModal, /context: selectedDepartment === 'bg' \|\| selectedDepartment === 'acting' \? selectedDepartment : 'all'/);
});

test('quick revision recipient picker preserves manual unchecked users while typing', () => {
  assert.match(commentPanel, /const quickRevisionDefaultRecipientIds = useMemo/);
  assert.doesNotMatch(commentPanel, /users,\s*\n\s*quickRevision,\s*\n\s*\]/);
  assert.match(revisionRecipientPicker, /const defaultCheckedKey = useMemo\(\(\) => defaultCheckedIds\.join\('\|'\), \[defaultCheckedIds\]\)/);
  assert.match(revisionRecipientPicker, /\}, \[defaultCheckedKey\]\);/);
});

test('revision activity rows use theme-aware contrast in light mode', () => {
  assert.match(commentPanel, /comment-inline-event-resolve/);
  assert.match(commentPanel, /comment-inline-event-label/);
  assert.doesNotMatch(commentPanel, /text-emerald-100/);
  assert.doesNotMatch(commentPanel, /text-sky-100/);
  assert.match(commentPanelCss, /\[data-color-mode="light"\] \.comment-inline-event-resolve/);
  assert.match(commentPanelCss, /\.comment-inline-event-label/);
});

test('quick revision can register a pasted attachment as the revision image', () => {
  assert.match(commentPanel, /imageUrl:\s*revisionImageUrl/);
  assert.match(commentPanel, /const prevAttached = attachedImages;[\s\S]*setAttachedImages\(\[\]\);[\s\S]*attachedImagesRef\.current = \[\];[\s\S]*await createRevision\(\{/);
  assert.match(commentPanel, /\[리테이크 빠른 등록 실패 \+ unmount\]/);
  assert.match(commentPanel, /setAttachedImages\(prevAttached\);[\s\S]*attachedImagesRef\.current = prevAttached/);
  assert.match(commentPanel, /첨부 이미지가 리테이크 이미지로 함께 등록됩니다/);
  assert.match(commentPanel, /quickRevisionActive \? files\.slice\(0, 1\) : files/);
  assert.doesNotMatch(commentPanel, /빠른 리테이크는 텍스트만 등록합니다/);
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
  // 3단계: 멘션 자체구현 → 공통 엔티티 감지(useMentionAutocomplete/MentionDropdown/EntityText)로 통합.
  assert.match(revisionCommentThread, /extractMentions/);
  assert.match(revisionCommentThread, /mentions:\s*extractMentions\(draft,\s*users\.map/);
  assert.match(revisionCommentThread, /useMentionAutocomplete/);
  assert.match(revisionCommentThread, /MentionDropdown/);
  assert.match(revisionCommentThread, /EntityText/);
  assert.match(revisionCommentThread, /sendMentionWebhook/);
});

test('comment and revision images share enlarge, copy, and download actions', () => {
  assert.match(attachmentImageLightbox, /ImageContextMenu/);
  assert.match(attachmentImageLightbox, /downloadImage/);
  assert.match(attachmentImageLightbox, /copyImageToClipboard/);
  assert.match(attachmentImageLightbox, /copyImageUrl/);
  assert.match(attachmentImageLightbox, /actions=\{\['download', 'copy', 'copy-url'\]\}/);
  assert.match(imageContextMenu, /actions\?: ContextAction\[\]/);
  assert.match(commentPanel, /AttachmentImageLightbox/);
  assert.match(revisionCommentThread, /AttachmentImageLightbox/);
  assert.match(revisionCommentThread, /onImageClick/);
  assert.doesNotMatch(revisionCommentThread, /href=\{url\}/);
  assert.match(revisionPanel, /openRevisionImage/);
  assert.match(revisionDetailPanel, /openRevisionImage/);
  assert.match(revisionItem, /openRevisionImage/);
});

test('revision comment notifications include explicitly mentioned users', () => {
  assert.match(app, /const mentionedNames = Array\.isArray\(newComment\.mentions\) \? newComment\.mentions : \[\]/);
  assert.match(app, /const mentionedUserIds = useAuthStore\.getState\(\)\.users/);
  assert.match(app, /buildRevisionNotificationUserIds\(\{/);
  assert.match(app, /mentionedUserIds/);
  assert.match(app, /리테이크 댓글 멘션/);
});

test('revision comment broadcasts keep revision context and avoid general comment notification fallback', () => {
  assert.match(electronBroadcast, /revisionId\?: string \| null/);
  assert.match(electronBroadcast, /revisionId: revisionId \?\? null/);
  assert.match(electronSupabase, /broadcastCommentAdded\(sceneId, userName, userId, text, mentions, commentId, safeParent, partUuid, revisionId\)/);
  assert.match(app, /const dispatchRevisionCommentNotification = useCallback/);
  assert.match(app, /revisionId: commentRevisionId/);
  assert.match(app, /if \(commentRevisionId\) \{/);
  assert.match(app, /window\.dispatchEvent\(new Event\('bflow:comments-invalidated'\)\)/);
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
  assert.match(commentPanel, /buildCommentReplyTarget\(comments,\s*target\)/);
  assert.match(commentPanel, /next\.delete\(threadRootId\)/);
});

test('CommentPanel uses a Slack-style flat thread for reply-to-reply flows', () => {
  assert.match(commentPanel, /buildCommentReplyTarget\(comments,\s*replyTarget\)/);
  assert.match(commentPanel, /parentCommentId:\s*replyThreadTarget\.parentCommentId/);
  assert.match(commentPanel, /openContextualThreadReply\(reply\)/);
  assert.match(commentPanel, /openThreadReply\(target\)/);
  assert.match(commentPanel, /replyInputThreadTarget\.isReplyToReply/);
  assert.match(commentPanel, /스레드에 댓글 추가/);
  assert.match(commentPanel, /선택한 메시지/);
  assert.doesNotMatch(commentPanel, /getReplyMentionDisplay\(reply\.text,\s*userNames\)/);
  assert.doesNotMatch(commentPanel, /<span className="text-accent">@\{replyMentionDisplay\.mentionName\}<\/span>에게/);
});

test('CommentPanel exposes reply buttons next to reaction controls for parent comments and replies', () => {
  assert.match(commentPanel, /ThreadReplyButton/);
  assert.match(commentPanel, /aria-label=\{`답글 달기: \$\{comment\.userName\}`\}/);
  assert.match(commentPanel, /aria-label=\{`답글 달기: \$\{reply\.userName\}`\}/);
  assert.match(commentPanel, /이 스레드에 답글/);
  assert.match(commentPanel, /openContextualThreadReply\(comment\)/);
  assert.match(commentPanel, /openContextualThreadReply\(reply\)/);
  assert.match(commentPanel, /openRevisionThread\(target\.revisionId, true, target\)/);
  assert.match(commentPanel, /replyThreadTarget\.isReplyToReply/);
});

test('CommentPanel thread collapse control is large enough to scan', () => {
  assert.match(commentPanel, /답글 \{replies\.length\}개 \{threadCollapsed \? '펼치기' : '접기'\}/);
  assert.match(commentPanel, /text-\[12px\][\s\S]{0,120}font-semibold/);
});

test('CommentPanelResizable lets users resize from both the inner divider and outer outline', () => {
  assert.match(resizable, /data-comment-panel-resize-edge="inner"/);
  assert.match(resizable, /data-comment-panel-resize-edge="outer"/);
  assert.match(resizable, /aria-label="댓글 패널 안쪽 경계로 너비 조절"/);
  assert.match(resizable, /aria-label="댓글 패널 바깥쪽 경계로 너비 조절"/);
  assert.match(resizable, /onMouseDown\(e, effectiveWidth, 'inner'\)/);
  assert.match(resizable, /onMouseDown\(e, effectiveWidth, 'outer'\)/);
  assert.match(resizable, /right-0 top-0 bottom-0/);
});

test('CommentPanel reruns scroll and observer setup after the unread divider mounts', () => {
  assert.match(commentPanel, /setUnreadDividerNode/);
  assert.match(commentPanel, /unreadDividerElement/);
  assert.match(commentPanel, /\[firstUnreadCommentId,\s*unreadDividerElement\]/);
  assert.match(commentPanel, /\[firstUnreadCommentId,\s*latestOtherUserCommentAt,\s*markUnreadCommentsRead,\s*unreadDividerElement\]/);
});
