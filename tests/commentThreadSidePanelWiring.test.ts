import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const commentPanel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');
const commentPanelResizable = readFileSync('src/components/scenes/CommentPanelResizable.tsx', 'utf8');
const unifiedSceneDetailModal = readFileSync('src/components/scenes/UnifiedSceneDetailModal.tsx', 'utf8');

test('CommentPanel opens a separate side thread when replying', () => {
  assert.match(commentPanel, /const \[activeThreadRootId, setActiveThreadRootId\] = useState<string \| null>\(null\)/);
  assert.match(commentPanel, /const openThreadReply = useCallback/);
  assert.match(commentPanel, /const threadRootId = threadTarget\.parentCommentId/);
  assert.match(commentPanel, /setActiveThreadRootId\(threadRootId\)/);
  assert.match(commentPanel, /onThreadPanelOpenChange\?\.\(activeThreadRoot != null\)/);
  assert.doesNotMatch(commentPanel, /onThreadPanelOpenChange\?\.\(activeThreadRootId != null\)/);
  assert.match(commentPanel, /data-comment-thread-side-panel/);
  assert.match(commentPanel, /스레드/);
  assert.match(commentPanel, /스레드 닫기/);
  assert.match(commentPanel, /스레드 다시 열기/);
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
  assert.match(commentPanelResizable, /const \[threadWidth, setThreadWidth\] = useState/);
  assert.match(commentPanelResizable, /const renderedWidth = effectiveWidth \+ \(threadPanelOpen \? effectiveThreadWidth \+ COMMENT_THREAD_PANEL_GAP_WIDTH : 0\)/);
  assert.match(commentPanelResizable, /threadWidth=\{effectiveThreadWidth\}/);
  assert.match(commentPanelResizable, /onThreadResizeMouseDown=\{handleThreadResizeMouseDown\}/);
  assert.match(commentPanelResizable, /data-comment-panel-resize-edge="inner"/);
  assert.match(commentPanelResizable, /data-comment-panel-resize-edge="outer"/);
});

test('reply buttons use the side thread opener for parent comments and replies', () => {
  assert.match(commentPanel, /onClick=\{\(\) => openThreadReply\(comment\)\}/);
  assert.match(commentPanel, /onClick=\{\(\) => openThreadReply\(reply\)\}/);
  assert.doesNotMatch(commentPanel, /onClick=\{\(\) => setReplyTarget\(comment\)\}/);
  assert.doesNotMatch(commentPanel, /onClick=\{\(\) => setReplyTarget\(reply\)\}/);
});

test('UnifiedSceneDetailModal keeps the comment side panel visible with reference panels', () => {
  assert.match(unifiedSceneDetailModal, /primaryCommentKey && \(/);
  assert.doesNotMatch(unifiedSceneDetailModal, /primaryCommentKey && !referencePanel &&/);
  assert.match(unifiedSceneDetailModal, /overflow-x-auto/);
});
