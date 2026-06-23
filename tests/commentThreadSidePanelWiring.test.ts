import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const commentPanel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');
const commentPanelResizable = readFileSync('src/components/scenes/CommentPanelResizable.tsx', 'utf8');
const sceneDetailModal = readFileSync('src/components/scenes/SceneDetailModal.tsx', 'utf8');
const unifiedSceneDetailModal = readFileSync('src/components/scenes/UnifiedSceneDetailModal.tsx', 'utf8');
const settingsService = readFileSync('src/services/settingsService.ts', 'utf8');

test('CommentPanel opens a separate side thread when replying', () => {
  assert.match(commentPanel, /const \[activeThreadRootId, setActiveThreadRootId\] = useState<string \| null>\(null\)/);
  assert.match(commentPanel, /const openThreadReply = useCallback/);
  assert.match(commentPanel, /const threadRootId = threadTarget\.parentCommentId/);
  assert.match(commentPanel, /setActiveThreadRootId\(threadRootId\)/);
  assert.match(commentPanel, /onThreadPanelOpenChange\?\.\(activeThreadRoot != null\)/);
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

test('reply buttons use the side thread opener for parent comments and replies', () => {
  assert.match(commentPanel, /onClick=\{\(\) => openThreadReply\(comment\)\}/);
  assert.match(commentPanel, /onClick=\{\(\) => openThreadReply\(reply\)\}/);
  assert.doesNotMatch(commentPanel, /onClick=\{\(\) => setReplyTarget\(comment\)\}/);
  assert.doesNotMatch(commentPanel, /onClick=\{\(\) => setReplyTarget\(reply\)\}/);
});

test('side thread has its own composer and main composer stays top-level', () => {
  assert.match(commentPanel, /const \[threadInput, setThreadInput\] = useState\(''\)/);
  assert.match(commentPanel, /const \[threadSubmitting, setThreadSubmitting\] = useState\(false\)/);
  assert.match(commentPanel, /const \[threadMentionTarget, setThreadMentionTarget\] = useState<SceneCommentWithSource \| null>\(null\)/);
  assert.match(commentPanel, /const threadInputValueRef = useRef\(''\)/);
  assert.match(commentPanel, /const threadInputRef = useRef<HTMLTextAreaElement>\(null\)/);
  assert.match(commentPanel, /setThreadMentionTarget\(target\)/);
  assert.match(commentPanel, /threadInputRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(commentPanel, /setReplyTarget\(target\)/);
  assert.doesNotMatch(commentPanel, /requestAnimationFrame\(\(\) => inputRef\.current\?\.focus\(\)\)/);
  assert.match(commentPanel, /const handleThreadSubmit = async \(\) =>/);
  assert.match(commentPanel, /const threadMentionTargetInCurrentThread =/);
  assert.match(commentPanel, /const mentionTargetName = threadMentionTargetInCurrentThread/);
  assert.match(commentPanel, /mentions\.push\(mentionTargetName\)/);
  assert.match(commentPanel, /if \(threadInputValueRef\.current\.length === 0\)/);
  assert.match(commentPanel, /parentCommentId: threadRoot\.id/);
  assert.match(commentPanel, /data-comment-thread-input/);
  assert.match(commentPanel, /placeholder="스레드에 댓글 입력\.\.\."/);
  assert.match(commentPanel, /onClick=\{handleThreadSubmit\}/);
  assert.match(commentPanel, /onClick=\{handleSubmit\}/);
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
