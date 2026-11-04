import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const commentPanel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');
const revisionCommentThread = readFileSync('src/components/scenes/RevisionCommentThread.tsx', 'utf8');
const useImageAttachmentsHook = readFileSync('src/hooks/useImageAttachments.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const notificationDecision = readFileSync('src/utils/sceneCommentNotification.ts', 'utf8');
const resizable = readFileSync('src/components/scenes/CommentPanelResizable.tsx', 'utf8');
const sceneDetailModal = readFileSync('src/components/scenes/SceneDetailModal.tsx', 'utf8');
const unifiedSceneDetailModal = readFileSync('src/components/scenes/UnifiedSceneDetailModal.tsx', 'utf8');
const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');
const compositingView = readFileSync('src/views/CompositingView.tsx', 'utf8');
const feedbackHubPreviewApp = readFileSync('src/views/FeedbackHubPreviewApp.tsx', 'utf8');
const indexCss = readFileSync('src/index.css', 'utf8');
const commentFeedCss = readFileSync('src/styles/comment-feed.css', 'utf8');
const commentFeedParts = readFileSync('src/components/scenes/comments/CommentFeedParts.tsx', 'utf8');
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
  assert.match(commentPanel, /알림 받을 사람/);
  assert.match(commentPanel, /리테이크 담당자/);
  assert.match(commentPanel, /createRevision\(\{/);
  assert.match(resizable, /quickRevision\?: CommentPanelQuickRevisionContext/);
  assert.match(sceneDetailModal, /quickRevision=\{\{/);
  assert.match(sceneDetailModal, /context: department/);
  assert.match(unifiedSceneDetailModal, /context: selectedDepartment === 'bg' \|\| selectedDepartment === 'acting' \? selectedDepartment : 'all'/);
});

test('quick revision separates notification recipients from required retake assignees', () => {
  assert.match(commentPanel, /const \[quickRevisionAssigneeIds, setQuickRevisionAssigneeIds\] = useState<string\[\]>\(\[\]\)/);
  assert.match(commentPanel, /quickRevisionAssigneeIds\.length > 0/);
  assert.match(commentPanel, /assigneeIds:\s*quickRevisionAssigneeIds/);
  assert.doesNotMatch(commentPanel, /assigneeIds:\s*quickRevisionNotifyIds/);
  assert.match(commentPanel, /enableAssignee/);
  assert.match(commentPanel, /onAssigneesChange=\{setQuickRevisionAssigneeIds\}/);
  assert.match(commentPanel, /리테이크 담당자를 선택해 주세요/);
});

test('quick revision recipient picker preserves manual unchecked users while typing', () => {
  assert.match(commentPanel, /const quickRevisionDefaultRecipientIds = useMemo/);
  assert.doesNotMatch(commentPanel, /users,\s*\n\s*quickRevision,\s*\n\s*\]/);
  assert.match(revisionRecipientPicker, /const defaultCheckedKey = useMemo\(\(\) => defaultCheckedIds\.join\('\|'\), \[defaultCheckedIds\]\)/);
  assert.match(revisionRecipientPicker, /\}, \[defaultCheckedKey\]\);/);
});

test('revision activity lines use theme-aware contrast in light mode', () => {
  // v1.147.0(§5.3): 리테이크 활동은 색 카드(comment-inline-event-*) 대신 한 줄(CommentActivityLine) — 단계 색은 data-phase 로
  //   상태 토큰을 쓰고, 링크 보라는 라이트 모드에서 한 단계 어두운 값으로 바뀐다(고정 밝은 글자색 없음).
  assert.doesNotMatch(commentPanel, /comment-inline-event-/);
  assert.match(commentPanel, /<CommentActivityLine\s+inset\s+text=\{[\s\S]{0,300}?phase=\{retakeActivityPhase\(row\.event\)\}/);
  assert.match(commentFeedParts, /<div className=\{inset \? 'cmt-activity is-inset' : 'cmt-activity'\} data-phase=\{phase \?\? 'other'\}>/);
  assert.doesNotMatch(commentPanel, /text-emerald-100/);
  assert.doesNotMatch(commentPanel, /text-sky-100/);
  assert.match(commentFeedCss, /\.cmt-activity\[data-phase='open'\] \{ color: rgb\(var\(--comment-link-rgb\)\); \}/);
  assert.match(commentFeedCss, /\.cmt-activity\[data-phase='resolved'\] \{ color: var\(--status-done\); \}/);
  assert.match(commentFeedCss, /\[data-color-mode="light"\] \{[\s\S]{0,400}?--comment-link-rgb: 91 75 214;/);
});

test('quick revision can register a pasted attachment as the revision image', () => {
  assert.match(commentPanel, /imageUrl:\s*revisionImageUrl/);
  assert.match(commentPanel, /const prevAttached = attachedImages;[\s\S]*setAttachedImages\(\[\]\);[\s\S]*attachedImagesRef\.current = \[\];[\s\S]*await createRevision\(\{/);
  assert.match(commentPanel, /\[리테이크 빠른 등록 실패 \+ unmount\]/);
  assert.match(commentPanel, /setAttachedImages\(prevAttached\);[\s\S]*attachedImagesRef\.current = prevAttached/);
  assert.match(commentPanel, /첨부 이미지가 리테이크 이미지로 함께 등록됩니다/);
  // v1.146.1(§8): 첨부는 공용 한 벌 — 빠른 리테이크는 '한 장만'(새로 넣으면 바꾼다, 규칙은 tests/imageAttachments.test.ts).
  assert.match(commentPanel, /useImageAttachments\(\{\s*setImages: setAttachedImages, sheetName, sceneId, mountedRef, single: quickRevisionActive/);
  assert.doesNotMatch(commentPanel, /빠른 리테이크는 텍스트만 등록합니다/);
  assert.doesNotMatch(commentPanel, /disabled=\{quickRevisionActive\}/);
  assert.doesNotMatch(commentPanel, /&& !quickRevisionHasAttachments/);
});

test('revision comment thread supports image paste and file attachments', () => {
  assert.match(revisionCommentThread, /attachedImages/);
  // v1.146.1(§8): 올리기·줄이기는 댓글 패널과 같은 공용 훅(hooks/useImageAttachments).
  assert.match(revisionCommentThread, /useImageAttachments\(\{\s*setImages: setAttachedImages, sheetName, sceneId, mountedRef/);
  assert.match(useImageAttachmentsHook, /storageService\.uploadImage/);
  assert.match(useImageAttachmentsHook, /resizeBlob\(file, 800, 0\.8\)/);
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
  // v1.146.0(§6.2): 댓글 패널과 같은 슬랙 함수(직접 부른 @이름 + 리테이크 요청자).
  assert.match(revisionCommentThread, /startMentionDelivery\(\{/);
  assert.match(revisionCommentThread, /revision\?\.requesterId && revision\.requesterId !== currentUser\.id \? \[revision\.requesterId\] : \[\]/);
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
  // v1.146.0(§6.1): 리테이크 댓글 판정도 함수 하나(decideSceneCommentNotification) — 직접 멘션은 리테이크 대상과 상관없이 멘션.
  //   동작은 tests/sceneCommentNotification.test.ts 가 본다.
  assert.match(app, /notifyIncomingSceneComment\(normalizeSceneCommentFromRealtimeRow\(payload\.new\), getNotiSettings, \{ source: 'realtime' \}\)/);
  assert.match(app, /notifyIncomingSceneComment\(normalizeSceneCommentFromAddedBroadcast\(data\.payload\), getNotiSettings\)/);
  assert.doesNotMatch(app, /dispatchRevisionCommentNotification/);
});

test('revision comment broadcasts keep revision context and avoid general comment notification fallback', () => {
  assert.match(electronBroadcast, /revisionId\?: string \| null/);
  assert.match(electronBroadcast, /revisionId: revisionId \?\? null/);
  assert.match(electronSupabase, /broadcastCommentAdded\(sceneId, userName, userId, text, mentions, commentId, safeParent, partUuid, revisionId, \{ images, createdAt, sceneUuid, parentAuthorId \}\)/);
  // v1.146.0: 리테이크 맥락 판정은 정리 함수가 revisionId 를 그대로 싣고 판정 함수가 일반 자동 알림과 섞지 않는다.
  assert.match(notificationDecision, /revisionId: asText\(p\.revisionId\)/);
  assert.match(notificationDecision, /리테이크 댓글 — 일반 댓글 자동 알림\(담당·참여자\)과 섞지 않는다/);
  // v1.145.0: 받은 댓글은 캐시에 끼워 넣고 그 시트만 알린다(전체 무효화 신호 없음).
  assert.match(app, /applyCommentBroadcast\('comment-added', data\.payload\)/);
  assert.doesNotMatch(app, /window\.dispatchEvent\(new Event\('bflow:comments-invalidated'\)\)/);
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
  // 움직임 폴리싱 4번: 줄은 처음 잡은 자리(읽음 처리 뒤에도 유지)에, 아직 안 잡았으면 첫 안 읽은 댓글(답글 포함)에 붙는다.
  // (리뷰 반영: 처음 자리를 잡을 때 한 번만 정한다 — 정한 뒤엔 실시간으로 온 댓글에 새 줄을 만들지 않는다.)
  assert.match(commentPanel, /const dividerCommentId = listReady && readStateReady \? unreadDividerCommentId\(unreadDividerSlot, firstUnreadCommentId\) : null;/);
  // v1.147.0(§5.2): 본문에는 답글을 그리지 않는다 — 안 읽은 답글·리테이크 댓글이면 그것을 품은 원댓글 줄·리테이크 카드
  //   (항목의 anchorIds) 바로 앞에 줄을 붙인다. 접힌 답글을 펼치던 처리(collapsedThreads)는 없다.
  assert.match(
    commentPanel,
    /const dividerItemKey = useMemo\(\(\) => \{\s*if \(!dividerCommentId \|\| feedFilter !== 'all'\) return null;\s*for \(const item of feed\.items\) \{\s*if \(\(item\.kind === 'comment' \|\| item\.kind === 'retake'\) && item\.anchorIds\.includes\(dividerCommentId\)\) return item\.key;/,
  );
  assert.match(commentPanel, /const divider = item\.key === dividerItemKey/);
  // 읽음 감시·처음 자리도 같은 품은 항목(data-comment-anchors)을 찾는다.
  assert.match(commentPanel, /data-comment-anchors=\{anchors\}/);
  assert.match(commentPanel, /findMainListComment\(root, firstUnreadCommentId, true\)/);
  assert.match(commentPanel, /buildCommentReplyTarget\(comments,\s*target\)/);
  assert.doesNotMatch(commentPanel, /replyShowUnreadDivider|reply\.id === dividerCommentId/);
  assert.doesNotMatch(commentPanel, /collapsedThreads|next\.delete\(threadRootId\)/);
});

test('CommentPanel uses a Slack-style flat thread for reply-to-reply flows', () => {
  // v1.146.1(§8): 본문 입력칸의 '답글 모드'는 켜는 곳이 없어 지웠다 — 답글은 스레드 창에서만, 답글의 답글도 루트 아래로.
  assert.doesNotMatch(commentPanel, /replyTarget|replyDraftTarget|isReplyToReply/);
  assert.match(commentPanel, /parentCommentId: null,/);
  assert.match(commentPanel, /parentCommentId: activeRevisionThreadId \? null : threadRoot!\.id/);
  assert.match(commentPanel, /buildCommentReplyTarget\(comments, target\)/);
  // v1.147.0(§5.4): 스레드 창 안에는 답글 단추가 없다 — 답글의 답글도 같은 스레드 입력창에, 특정 사람은 '@이름' 넣기(보이는 멘션)로.
  assert.doesNotMatch(commentPanel, /openContextualThreadReply\(reply\)/);
  assert.match(commentPanel, /kind: 'mention' as const, onClick: \(\) => insertIntoComposer\('thread', `@\$\{comment\.userName\} `\)/);
  assert.match(commentPanel, /openThreadReply\(target\)/);
  assert.doesNotMatch(commentPanel, /getReplyMentionDisplay\(reply\.text,\s*userNames\)/);
  assert.doesNotMatch(commentPanel, /<span className="text-accent">@\{replyMentionDisplay\.mentionName\}<\/span>에게/);
});

test('CommentPanel hover toolbar puts the reply action next to quick reactions for root comments', () => {
  // v1.147.0(§5.2): 행마다 따로 그리던 답글 단추(ThreadReplyButton) 대신 호버 도구 줄(CommentRowToolbar) —
  //   빠른 반응 ✅👍👀 · 이모지 더보기 · '답글'(본문) / '@이름'(스레드 창) · ⋯ 메뉴.
  assert.doesNotMatch(commentPanel, /ThreadReplyButton/);
  assert.doesNotMatch(commentPanel, /이 스레드에 답글/);
  assert.match(commentPanel, /onQuickReact=\{\(emoji\) => handleReactionToggle\(comment\.id, emoji\)\}/);
  assert.match(commentFeedParts, /\{QUICK_REACTIONS\.map\(\(r\) => \(/);
  assert.match(commentFeedParts, /aria-label=\{`답글 달기: \$\{userName\}`\}/);
  assert.match(commentPanel, /openContextualThreadReply\(comment\)/);
  assert.match(commentPanel, /openRevisionThread\(target\.revisionId, true, target\)/);
});

test('CommentPanel replaces the inline reply collapse toggle with a scannable reply summary that opens the thread pane', () => {
  // v1.147.0(§5.2): 본문에 답글을 펼치고 접던 토글은 없다 — 원댓글 아래 '답글 N개 · 마지막 HH:MM · 새 N' 요약 줄이 스레드 창을 연다.
  assert.doesNotMatch(commentPanel, /threadCollapsed|collapsedThreads|toggleThread/);
  assert.doesNotMatch(commentPanel, /'펼치기' : '접기'/);
  assert.match(commentPanel, /\{opts\.replySummary && opts\.onOpenThread && \(\s*<CommentThreadSummaryButton\s+summary=\{opts\.replySummary\}\s+onOpen=\{opts\.onOpenThread\}\s+failedCount=/);
  assert.match(commentPanel, /replySummary: item\.replySummary,[\s\S]{0,80}?onOpenThread: \(\) => openThreadReply\(root\),/);
  assert.match(commentFeedParts, /<span className="cmt-thread-count">\{noun\} \{summary\.count\}개<\/span>/);
  assert.match(commentFeedParts, /<span className="cmt-thread-last">마지막 \{formatTimeShort\(summary\.lastAt\)\}<\/span>/);
  assert.match(commentFeedParts, /\{summary\.newCount > 0 && <span className="cmt-thread-new">새 \{summary\.newCount\}<\/span>\}/);
  // 훑어보기 쉬운 크기: 답글 수는 12px 굵게.
  assert.match(commentFeedCss, /\.cmt-thread-count \{ font-size: 12px; font-weight: 700;/);
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
  // 움직임 폴리싱 4번: 처음 자리는 화면에 그리기 전(useLayoutEffect)에 줄 가운데로 잡고, 줄이 늦게 붙어 높이가 바뀌면
  // 크기 감시(ResizeObserver)가 같은 자리 잡기를 다시 부른다(예전 150ms 뒤 scrollIntoView 대신).
  assert.match(commentPanel, /else if \(pin\.target === 'divider'\) anchorNode = unreadDividerRef\.current;/);
  assert.match(commentPanel, /new ResizeObserver\(\(\) => \{[\s\S]{0,200}?applyOpenPin\(\);/);
  assert.doesNotMatch(commentPanel, /unreadDividerElement\.scrollIntoView/);
  // 읽음 감시는 줄이 붙은 뒤 다시 설정된다.
  assert.match(commentPanel, /\[listReady,\s*readStateReady,\s*firstUnreadCommentId,\s*latestOtherUserCommentAt,\s*markUnreadCommentsRead,\s*unreadDividerElement,\s*dividerCommentId,\s*comments\]/);
});
