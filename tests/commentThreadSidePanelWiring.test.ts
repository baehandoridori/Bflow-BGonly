import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const commentPanel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');
const commentPanelResizable = readFileSync('src/components/scenes/CommentPanelResizable.tsx', 'utf8');
const sceneDetailModal = readFileSync('src/components/scenes/SceneDetailModal.tsx', 'utf8');
const unifiedSceneDetailModal = readFileSync('src/components/scenes/UnifiedSceneDetailModal.tsx', 'utf8');
const revisionCommentThread = readFileSync('src/components/scenes/RevisionCommentThread.tsx', 'utf8');
const settingsService = readFileSync('src/services/settingsService.ts', 'utf8');

test('CommentPanel opens a separate side thread when replying', () => {
  assert.match(commentPanel, /const \[activeThreadRootId, setActiveThreadRootId\] = useState<string \| null>\(null\)/);
  assert.match(commentPanel, /const activeThreadRootIdRef = useRef<string \| null>\(activeThreadRootId\);\s*activeThreadRootIdRef\.current = activeThreadRootId/);
  assert.match(commentPanel, /const openThreadReply = useCallback/);
  assert.match(commentPanel, /const threadRootId = threadTarget\.parentCommentId/);
  assert.match(commentPanel, /setActiveThreadRootId\(threadRootId\)/);
  assert.match(commentPanel, /onThreadPanelOpenChange\?\.\(activeThreadOpen\)/);
  assert.doesNotMatch(commentPanel, /onThreadPanelOpenChange\?\.\(activeThreadRootId != null\)/);
  assert.match(commentPanel, /comments\s*\n\s*\.filter\(\(c\) => c\.parentCommentId === activeThreadRoot\.id\)/);
  assert.doesNotMatch(commentPanel, /activeThreadRoot \? repliesByParent\.get\(activeThreadRoot\.id\)/);
  assert.match(commentPanel, /data-comment-thread-side-panel/);
  assert.match(commentPanel, /스레드/);
  assert.match(commentPanel, /스레드 닫기/);
  assert.match(commentPanel, /스레드 다시 열기/);
});

test('main list and side thread reaction pickers are surface-specific', () => {
  assert.match(commentPanel, /type CommentReactionPickerSurface = 'main' \| 'thread'/);
  assert.match(commentPanel, /const \[reactionPicker, setReactionPicker\] = useState<CommentReactionPickerTarget \| null>\(null\)/);
  assert.match(commentPanel, /reactionPicker\?\.surface === 'main' && reactionPicker\.commentId === comment\.id/);
  assert.match(commentPanel, /reactionPicker\?\.surface === 'main' && reactionPicker\.commentId === reply\.id/);
  assert.match(commentPanel, /reactionPicker\?\.surface === 'thread' && reactionPicker\.commentId === message\.id/);
  assert.match(commentPanel, /setReactionPicker\(\{ commentId: comment\.id, surface: 'main' \}\)/);
  assert.match(commentPanel, /setReactionPicker\(\{ commentId: message\.id, surface: 'thread' \}\)/);
  assert.doesNotMatch(commentPanel, /pickerForCommentId/);
});

test('thread side panel has a draggable split handle and variable width', () => {
  assert.match(commentPanel, /data-comment-thread-resize-handle/);
  assert.match(commentPanel, /aria-label="댓글과 스레드 사이 경계로 너비 조절"/);
  assert.match(commentPanel, /onMouseDown=\{onThreadResizeMouseDown\}/);
  assert.match(commentPanel, /onDoubleClick=\{onThreadResizeDoubleClick\}/);
  assert.match(commentPanel, /style=\{\{ width: threadWidth \}\}/);
});

test('CommentPanelResizable owns thread split width while keeping whole-panel resize handles', () => {
  assert.match(commentPanelResizable, /COMMENT_THREAD_PANEL_DEFAULT_WIDTH/);
  assert.match(commentPanelResizable, /computeCommentThreadPanelResizeWidth/);
  assert.match(commentPanelResizable, /getCommentThreadPanelMaxWidthForMainWidth/);
  assert.match(commentPanelResizable, /const \[threadWidth, setThreadWidth\] = useState/);
  assert.match(commentPanelResizable, /스레드 핸들은 댓글 목록과 스레드 사이 폭 배분만 바꾼다/);
  assert.match(commentPanelResizable, /const threadFrameWidth = threadPanelOpen \? COMMENT_THREAD_PANEL_DEFAULT_WIDTH \+ COMMENT_THREAD_PANEL_GAP_WIDTH : 0/);
  assert.match(commentPanelResizable, /const renderedWidth = effectiveWidth \+ threadFrameWidth/);
  assert.match(commentPanelResizable, /threadWidth=\{effectiveThreadWidth\}/);
  assert.match(commentPanelResizable, /onThreadResizeMouseDown=\{handleThreadResizeMouseDown\}/);
  assert.match(commentPanelResizable, /data-comment-panel-resize-edge="inner"/);
  assert.match(commentPanelResizable, /data-comment-panel-resize-edge="outer"/);
});

test('CommentPanelResizable persists the last thread split width', () => {
  assert.match(settingsService, /commentThreadPanelWidthPx\?: number/);
  assert.match(commentPanelResizable, /loadPreferences, savePreferences/);
  assert.match(commentPanelResizable, /prefs\?\.commentThreadPanelWidthPx/);
  assert.match(commentPanelResizable, /commentThreadPanelWidthPx: clamped/);
  assert.match(commentPanelResizable, /const \{ commentThreadPanelWidthPx: _omit, \.\.\.rest \} = prefs/);
  assert.match(commentPanelResizable, /setThreadWidthPersistent\(nextWidth\)/);
  assert.match(commentPanelResizable, /setThreadWidthPersistent\(null\)/);
});

test('reply buttons use the context-aware side thread opener for parent comments and replies', () => {
  assert.match(commentPanel, /const openContextualThreadReply = useCallback/);
  assert.match(commentPanel, /if \(target\.revisionId\) \{/);
  assert.match(commentPanel, /openRevisionThread\(target\.revisionId, true, target\)/);
  assert.match(commentPanel, /onClick=\{\(\) => openContextualThreadReply\(comment\)\}/);
  assert.match(commentPanel, /onClick=\{\(\) => openContextualThreadReply\(reply\)\}/);
  assert.doesNotMatch(commentPanel, /onClick=\{\(\) => setReplyTarget\(comment\)\}/);
  assert.doesNotMatch(commentPanel, /onClick=\{\(\) => setReplyTarget\(reply\)\}/);
});

test('side thread has its own composer and main composer stays top-level', () => {
  assert.match(commentPanel, /const \[threadInput, setThreadInput\] = useState\(''\)/);
  assert.match(commentPanel, /const \[threadSubmitting, setThreadSubmitting\] = useState\(false\)/);
  assert.match(commentPanel, /const \[threadMentionTarget, setThreadMentionTarget\] = useState<SceneCommentWithSource \| null>\(null\)/);
  assert.match(commentPanel, /const \[threadAttachedImages, setThreadAttachedImages\] = useState<AttachedImage\[\]>\(\[\]\)/);
  assert.match(commentPanel, /const sceneKeyRef = useRef\(sceneKey\);\s*sceneKeyRef\.current = sceneKey/);
  assert.match(commentPanel, /const threadInputValueRef = useRef\(''\)/);
  assert.match(commentPanel, /const threadSubmitRequestRef = useRef<string \| null>\(null\)/);
  assert.match(commentPanel, /const threadAttachedImagesRef = useRef<AttachedImage\[\]>\(\[\]\)/);
  assert.match(commentPanel, /const threadInputRef = useRef<HTMLTextAreaElement>\(null\)/);
  assert.match(commentPanel, /const threadFileInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(commentPanel, /useEffect\(\(\) => \{ threadAttachedImagesRef\.current = threadAttachedImages; \}, \[threadAttachedImages\]\)/);
  assert.match(commentPanel, /setThreadMentionTarget\(target\)/);
  assert.match(commentPanel, /threadInputRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(commentPanel, /setReplyTarget\(target\)/);
  assert.doesNotMatch(commentPanel, /requestAnimationFrame\(\(\) => inputRef\.current\?\.focus\(\)\)/);
  assert.match(commentPanel, /const handleThreadPaste = \(e: React\.ClipboardEvent\) =>/);
  assert.match(commentPanel, /const handleThreadDrop = \(e: React\.DragEvent\) =>/);
  assert.match(commentPanel, /dragCounter\.current = 0/);
  assert.match(commentPanel, /setDraggingOver\(false\)/);
  assert.match(commentPanel, /const handleThreadFileChange = \(e: React\.ChangeEvent<HTMLInputElement>\) =>/);
  assert.match(commentPanel, /const threadUploadedImageUrls = threadAttachedImages\.map/);
  assert.match(commentPanel, /const handleThreadSubmit = async \(\) =>/);
  assert.match(commentPanel, /const submittedThreadAttached = threadAttachedImages/);
  assert.match(commentPanel, /const submittedThreadImageUrls = threadUploadedImageUrls/);
  assert.match(commentPanel, /const submitRequestId = comment\.id/);
  assert.match(commentPanel, /threadSubmitRequestRef\.current = submitRequestId/);
  assert.match(commentPanel, /const threadMentionTargetInCurrentThread =/);
  assert.match(commentPanel, /const mentionTargetName = threadMentionTargetInCurrentThread/);
  assert.match(commentPanel, /mentions\.push\(mentionTargetName\)/);
  assert.match(commentPanel, /images: submittedThreadImageUrls/);
  assert.match(commentPanel, /setThreadAttachedImages\(\[\]\)/);
  assert.match(commentPanel, /threadAttachedImagesRef\.current = \[\]/);
  assert.match(commentPanel, /activeThreadRootIdRef\.current === threadRoot\?\.id/);
  assert.match(commentPanel, /threadSubmitRequestRef\.current === submitRequestId/);
  assert.match(commentPanel, /threadSubmitRequestRef\.current = null/);
  assert.match(commentPanel, /current\.filter\(\(c\) => c\.id !== comment\.id\)/);
  assert.match(commentPanel, /threadAttachedImagesRef\.current\.length === 0/);
  assert.match(commentPanel, /setThreadAttachedImages\(submittedThreadAttached\)/);
  assert.match(commentPanel, /cleanupSubmittedThreadDraft\(\)/);
  assert.match(commentPanel, /parentCommentId: activeRevisionThreadId \? null : threadRoot!\.id/);
  assert.match(commentPanel, /data-comment-thread-attachments/);
  assert.match(commentPanel, /data-comment-thread-input/);
  assert.match(commentPanel, /onPaste=\{handleThreadPaste\}/);
  assert.match(commentPanel, /onDrop=\{handleThreadDrop\}/);
  assert.match(commentPanel, /placeholder=\{activeRevisionThreadId \? '리테이크에 댓글 입력\.\.\. \(Ctrl\+V \/ 드래그로 이미지\)' : '스레드에 댓글 입력\.\.\. \(Ctrl\+V \/ 드래그로 이미지\)'\}/);
  assert.match(commentPanel, /onChange=\{handleThreadFileChange\}/);
  assert.match(commentPanel, /threadFileInputRef\.current\?\.click\(\)/);
  assert.match(commentPanel, /onClick=\{handleThreadSubmit\}/);
  assert.match(commentPanel, /onClick=\{handleSubmit\}/);
});

test('retake side thread composer supports explicit user mentions', () => {
  assert.match(commentPanel, /const threadMention = useMentionAutocomplete\(\{/);
  assert.match(commentPanel, /onChange: \(next\) => \{ setThreadInput\(next\); threadInputValueRef\.current = next; \}/);
  assert.match(commentPanel, /inputRef:\s*threadInputRef/);
  assert.match(commentPanel, /threadMention\.active/);
  assert.match(commentPanel, /onPick=\{threadMention\.select\}/);
  assert.match(commentPanel, /threadMention\.refresh\(\)/);
  assert.match(commentPanel, /if \(threadMention\.onKeyDown\(event\)\) return/);
});

test('피드백 51~54 작업 5: 답글 작성기 # 자동완성 — threadMention 의 해시 짝 배선', () => {
  assert.match(commentPanel, /const threadHash = useHashtagAutocomplete\(\{/);
  // threadHash 에만 매치하는 형태로 고정 — 메인 hash 는 `inputRef,` 축약형이라 이 연속이 없다.
  assert.match(commentPanel, /inputRef: threadInputRef,\s*extraCandidates: extraHashCandidates,/);
  assert.match(commentPanel, /threadHash\.active/);
  assert.match(commentPanel, /onPick=\{threadHash\.select\}/);
  assert.match(commentPanel, /threadHash\.refresh\(\)/);
  assert.match(commentPanel, /if \(threadHash\.onKeyDown\(event\)\) return/);
  assert.match(commentPanel, /threadHash\.close\(\)/);
});

test('CommentPanel mounted ref is restored after development remount checks', () => {
  assert.match(commentPanel, /const mountedRef = useRef\(true\)/);
  assert.match(commentPanel, /useEffect\(\(\) => \{\s*mountedRef\.current = true;\s*return \(\) => \{ mountedRef\.current = false; \};\s*\}, \[\]\)/);
  assert.doesNotMatch(commentPanel, /useEffect\(\(\) => \(\) => \{ mountedRef\.current = false; \}, \[\]\)/);
});

test('retake activity rows can open the detail card or the comment-side retake thread', () => {
  assert.match(commentPanel, /revisionId\?: string/);
  assert.match(commentPanel, /revisionAction\?: 'add' \| 'status' \| 'delete'/);
  assert.match(commentPanel, /const \[activeRevisionThreadId, setActiveRevisionThreadId\] = useState<string \| null>\(null\)/);
  assert.match(commentPanel, /const revisionExists = useCallback/);
  assert.match(commentPanel, /const openRevisionDetail = useCallback/);
  assert.match(commentPanel, /bflow:jump-to-revision/);
  assert.match(commentPanel, /const openRevisionThread = useCallback/);
  assert.match(commentPanel, /if \(!revisionExists\(revisionId\)\) return/);
  assert.match(commentPanel, /setActiveRevisionThreadId\(revisionId\)/);
  assert.match(commentPanel, /setActiveThreadRootId\(null\)/);
  assert.match(commentPanel, /const canOpenRevision = revisionExists\(node\.event\.revisionId\) && node\.event\.revisionAction !== 'delete'/);
  assert.match(commentPanel, /상세모달에서 열기/);
  assert.match(commentPanel, /댓글에서 열기/);
  assert.match(commentPanel, /openRevisionThread\(node\.event\.revisionId, true\)/);
});

test('retake side thread stores replies as revision comments instead of fake parent comments', () => {
  assert.match(commentPanel, /const activeRevisionThreadComments = useMemo/);
  assert.match(commentPanel, /comments\s*\n\s*\.filter\(\(c\) => c\.revisionId === activeRevisionThreadId\)/);
  assert.match(commentPanel, /const activeThreadOpen = activeThreadRoot != null \|\| activeRevisionThreadId != null/);
  assert.match(commentPanel, /const activeRevisionThreadAvailable = !activeRevisionThreadId \|\| !!activeRevisionThread/);
  assert.match(commentPanel, /&& activeRevisionThreadAvailable/);
  assert.match(commentPanel, /revisionId: activeRevisionThreadId \?\? threadRoot\?\.revisionId \?\? null/);
  assert.match(commentPanel, /parentCommentId: activeRevisionThreadId \? null : threadRoot!\.id/);
  assert.match(commentPanel, /data-retake-thread-root/);
  assert.match(commentPanel, /리테이크 스레드/);
  assert.match(commentPanel, /placeholder=\{activeRevisionThreadId \? '리테이크에 댓글 입력\.\.\. \(Ctrl\+V \/ 드래그로 이미지\)' : '스레드에 댓글 입력\.\.\. \(Ctrl\+V \/ 드래그로 이미지\)'\}/);
});

test('retake comments always keep their re badge in main and side thread views', () => {
  assert.match(commentPanel, /let prevRevisionId: string \| null = null/);
  assert.match(commentPanel, /prevRevisionId = null/);
  assert.match(commentPanel, /const commentRevisionId = comment\.revisionId \?\? null/);
  assert.match(commentPanel, /const isGroupedWithPrev = prevUserId === comment\.userId && !prevRevisionId && !commentRevisionId/);
  assert.match(commentPanel, /const replyRevisionId = reply\.revisionId \?\? commentRevisionId/);
  assert.match(commentPanel, /const replyIsGrouped = ri > 0 && replies\[ri - 1\]\.userId === reply\.userId && !prevReplyRevisionId && !replyRevisionId/);
  assert.match(commentPanel, /revisionId=\{commentRevisionId\}/);
  assert.match(commentPanel, /revisionId=\{replyRevisionId\}/);
  assert.match(commentPanel, /onJump=\{openRevisionDetail\}/);
  assert.match(commentPanel, /const messageRevisionId = message\.revisionId \?\? activeRevisionThreadId/);
  assert.match(commentPanel, /revisionId=\{messageRevisionId\}/);
  assert.match(revisionCommentThread, /import \{ RevisionCommentBadge \} from '\.\/RevisionCommentBadge';/);
  assert.match(revisionCommentThread, /revisionId=\{c\.revisionId \?\? revisionId\}/);
  assert.match(revisionCommentThread, /<RevisionCommentBadge revisionId=\{revisionId\} \/>/);
});

test('main comment flow keeps comments from the same retake thread visually adjacent', () => {
  assert.match(commentPanel, /orderCommentsForThreadedMainFlow/);
  assert.match(commentPanel, /const isRetakeThreadFollowup = !!commentRevisionId && prevRevisionId === commentRevisionId/);
  assert.match(commentPanel, /isRetakeThreadFollowup && 'comment-retake-thread-followup'/);
  assert.match(commentPanel, /const commentSortKeys = buildThreadedCommentMainFlowKeys\(comments\)/);
  assert.match(commentPanel, /commentSortKeys\.get\(a\.comment\.id\)/);
});

test('side thread submit state is released by request id', () => {
  assert.match(commentPanel, /threadSubmitRequestRef\.current = submitRequestId/);
  assert.match(commentPanel, /try\s*\{\s*setThreadSubmitting\(true\);[\s\S]*?threadSubmitRequestRef\.current = submitRequestId[\s\S]*?onCountChange\?\.\(next\.length\)[\s\S]*?await addComment\(targetSceneKey, comment\)/);
  assert.match(commentPanel, /mountedRef\.current\s*&&\s*\(\s*threadSubmitRequestRef\.current === submitRequestId/);
  assert.match(commentPanel, /threadSubmitRequestRef\.current === submitRequestId \|\| threadSubmitRequestRef\.current == null/);
  assert.doesNotMatch(
    commentPanel,
    /finally\s*\{\s*if \(\s*[\s\S]*activeRevisionThreadIdRef\.current === revisionThreadId[\s\S]*threadSubmitRequestRef\.current === submitRequestId/,
  );
});

test('retake card thread submit keeps optimistic work inside the loading guard', () => {
  assert.match(revisionCommentThread, /let newComment: SceneComment \| null = null/);
  assert.match(revisionCommentThread, /try\s*\{\s*setSubmitting\(true\);[\s\S]*?setAllComments\(prev => \[\.\.\.prev, newComment!\]\)[\s\S]*?await addComment\(sceneKey, newComment\)/);
  assert.match(revisionCommentThread, /const failedComment = newComment[\s\S]*?if \(!failedComment\)[\s\S]*?setDraft\(prevDraft\)[\s\S]*?return/);
  assert.match(revisionCommentThread, /finally\s*\{\s*if \(mountedRef\.current\) \{\s*setSubmitting\(false\);/);
});

test('retake-only filter keeps retake activity cards visible', () => {
  assert.match(commentPanel, /const visibleInlineEvents = useMemo/);
  assert.match(commentPanel, /isRetakeInlineEvent/);
  assert.match(commentPanel, /reOnly \? \(inlineEvents \?\? \[\]\)\.filter\(isRetakeInlineEvent\)/);
  assert.match(commentPanel, /mergeFeed\(mainFlowComments, visibleInlineEvents\)/);
});

test('comment feed avoids layout-measure animations while thread composer is typing', () => {
  assert.match(commentPanel, /const mainFeedNodes = useMemo\(/);
  assert.match(commentPanel, /mergeFeed\(mainFlowComments, visibleInlineEvents\)/);
  assert.match(commentPanel, /return mainFeedNodes\.map\(\(node\) =>/);
  assert.doesNotMatch(commentPanel, /layout="position"/);
});

test('UnifiedSceneDetailModal keeps the comment side panel visible with reference panels', () => {
  assert.match(unifiedSceneDetailModal, /primaryCommentKey && \(/);
  assert.doesNotMatch(unifiedSceneDetailModal, /primaryCommentKey && !referencePanel &&/);
  assert.match(unifiedSceneDetailModal, /overflow-x-auto/);
});

test('scene detail modal wrappers allow horizontal overflow for opened thread panels', () => {
  assert.match(sceneDetailModal, /relative flex gap-3 items-stretch max-w-full max-h-full overflow-x-auto overflow-y-hidden pb-1/);
  assert.match(unifiedSceneDetailModal, /flex gap-3 items-stretch max-w-full max-h-full overflow-x-auto overflow-y-hidden pb-1/);
});
