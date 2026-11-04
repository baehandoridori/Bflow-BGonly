import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const commentPanel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');
const commentPanelResizable = readFileSync('src/components/scenes/CommentPanelResizable.tsx', 'utf8');
const sceneDetailModal = readFileSync('src/components/scenes/SceneDetailModal.tsx', 'utf8');
const unifiedSceneDetailModal = readFileSync('src/components/scenes/UnifiedSceneDetailModal.tsx', 'utf8');
const revisionCommentThread = readFileSync('src/components/scenes/RevisionCommentThread.tsx', 'utf8');
const settingsService = readFileSync('src/services/settingsService.ts', 'utf8');
const commentFeedParts = readFileSync('src/components/scenes/comments/CommentFeedParts.tsx', 'utf8');

test('CommentPanel opens a separate side thread when replying', () => {
  assert.match(commentPanel, /const \[activeThreadRootId, setActiveThreadRootId\] = useState<string \| null>\(null\)/);
  // 움직임 폴리싱 19번: 실패한 스레드 메시지는 입력칸으로 되돌리지 않고 말풍선으로 남는다 — 되돌릴 스레드를 확인하던 ref 는 없다.
  assert.doesNotMatch(commentPanel, /activeThreadRootIdRef/);
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
  // v1.147.0(씬 댓글 B안 §5.2·§5.4): 본문·스레드 창의 모든 행을 renderCommentRow 하나가 그린다 —
  //   이모지 창은 그 행의 surface 와 id 가 모두 같을 때만 열린다(같은 댓글이 양쪽에 보여도 한쪽만).
  assert.match(commentPanel, /pickerOpen=\{reactionPicker\?\.surface === opts\.surface && reactionPicker\.commentId === comment\.id\}/);
  assert.match(commentPanel, /onPickerOpen=\{\(\) => setReactionPicker\(\{ commentId: comment\.id, surface: opts\.surface \}\)\}/);
  assert.match(commentPanel, /onOpenEmoji=\{\(\) => setReactionPicker\(\{ commentId: comment\.id, surface: opts\.surface \}\)\}/);
  assert.match(commentPanel, /renderCommentRow\(root, \{\s*surface: 'main',/);
  assert.match(commentPanel, /renderCommentRow\(activeThreadRoot, \{ surface: 'thread', grouped: false \}\)/);
  assert.match(commentPanel, /renderCommentRow\(reply, \{\s*surface: 'thread',/);
  assert.match(commentPanel, /renderCommentRow\(row\.comment, \{ surface: 'thread', grouped \}\)/);
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

test('main list reply action uses the context-aware side thread opener; the thread pane offers @name instead of reply', () => {
  assert.match(commentPanel, /const openContextualThreadReply = useCallback/);
  assert.match(commentPanel, /if \(target\.revisionId\) \{/);
  assert.match(commentPanel, /openRevisionThread\(target\.revisionId, true, target\)/);
  // v1.147.0(§5.2·§5.4): 행 도구 줄의 첫 단추 — 본문은 '답글'(문맥 맞춘 스레드 열기), 스레드 창은 답글 단추 없이 남의 글에 '@이름' 넣기.
  assert.match(
    commentPanel,
    /const primary = opts\.surface === 'thread'\s*\?\s*\(isOwn \? null : \{ kind: 'mention' as const, onClick: \(\) => insertIntoComposer\('thread', `@\$\{comment\.userName\} `\) \}\)\s*:\s*\{ kind: 'reply' as const, onClick: \(\) => openContextualThreadReply\(comment\) \}/,
  );
  assert.match(commentPanel, /<CommentRowToolbar\s+userName=\{comment\.userName\}\s+primary=\{primary\}/);
  assert.match(commentFeedParts, /primary\?\.kind === 'reply' && \(/);
  assert.match(commentFeedParts, /primary\?\.kind === 'mention' && \(/);
  // 답글 줄이 본문에서 사라졌다 — 답글마다 따로 달던 답글 단추도 없다.
  assert.doesNotMatch(commentPanel, /openContextualThreadReply\(reply\)/);
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
  // v1.146.0(§6.1): 보이지 않는 자동 멘션 없음 — 사용자가 친 @이름만 멘션. 특정 사람 답글은 입력창에 '@이름 ' 을 보이게 넣는다.
  assert.doesNotMatch(commentPanel, /mentions\.push\(mentionTargetName\)/);
  assert.doesNotMatch(commentPanel, /mentions\.push\(replyThreadTarget\.replyToComment\.userName\)/);
  // 답글 상대 '@이름' 을 입력창에 넣지 않는다 — 넣으면 진짜 멘션이 되어 답글 상대에게 슬랙까지 간다(로컬 리뷰).
  assert.doesNotMatch(commentPanel, /prefillThreadMention/);
  assert.match(commentPanel, /images: submittedThreadImageUrls/);
  assert.match(commentPanel, /setThreadAttachedImages\(\[\]\)/);
  assert.match(commentPanel, /threadAttachedImagesRef\.current = \[\]/);
  assert.match(commentPanel, /threadSubmitRequestRef\.current === submitRequestId/);
  assert.match(commentPanel, /threadSubmitRequestRef\.current = null/);
  // 움직임 폴리싱 19번: 실패하면 말풍선을 남겨 '다시 보내기·지우기'(지우기가 목록에서 뺀다). 남길 자리가 없을 때만 첨부 정리.
  assert.match(commentPanel, /const keptForRetry = sceneKeyRef\.current === panelSceneKey && failCommentSend\(comment\.id\)/);
  // 첨부는 서버에서 같은 id 를 지운 뒤에만 정리(저장됐는데 응답만 끊긴 댓글의 그림을 깨지 않게).
  assert.match(commentPanel, /attached: submittedThreadAttached,/);
  assert.match(commentPanel, /void dropUnsentComment\(sendDraft, '\[스레드 댓글 전송 실패\]'\)/);
  assert.match(commentPanel, /current\.filter\(\(c\) => c\.id !== commentId\)/);
  assert.doesNotMatch(commentPanel, /setThreadAttachedImages\(submittedThreadAttached\)/);
  assert.match(commentPanel, /parentCommentId: activeRevisionThreadId \? null : threadRoot!\.id/);
  assert.match(commentPanel, /data-comment-thread-attachments/);
  assert.match(commentPanel, /data-comment-thread-input/);
  assert.match(commentPanel, /onPaste=\{handleThreadPaste\}/);
  assert.match(commentPanel, /onDrop=\{handleThreadDrop\}/);
  // v1.147.0(§5.4): 짧은 안내 — 이미지 첨부는 아래 도구 줄의 📎(Ctrl+V·끌어 놓기도 그대로).
  assert.match(commentPanel, /placeholder=\{activeRevisionThreadId \? '리테이크에 댓글…' : '답글 남기기…'\}/);
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

test('retake root cards can open the detail card or the comment-side retake thread', () => {
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
  // v1.147.0(§5.3): 리테이크는 본문에 카드 하나(RetakeRootCard). 카드에서 리테이크 스레드(댓글이 없으면 입력창에 바로)와
  //   상세 모달을 연다 — 지운 리테이크는 상세를 열지 않는다. 활동 한 줄 아래 따로 붙던 '상세모달에서 열기/댓글에서 열기'는 없다.
  assert.match(commentPanel, /const canOpen = !!card\.revision;/);
  assert.match(commentPanel, /onOpenThread=\{canOpen \? \(\) => openRevisionThread\(item\.revisionId, item\.comments\.length === 0\) : undefined\}/);
  assert.match(commentPanel, /onOpenDetail=\{canOpen && card\.status !== 'deleted' \? \(\) => openRevisionDetail\(item\.revisionId\) : undefined\}/);
  assert.match(commentPanel, /onOpenDetail=\{revision \? \(\) => openRevisionDetail\(activeRevisionThreadId\) : undefined\}/);
  assert.doesNotMatch(commentPanel, /상세모달에서 열기|댓글에서 열기/);
  assert.doesNotMatch(commentPanel, /canOpenRevision/);
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
  assert.match(commentPanel, /placeholder=\{activeRevisionThreadId \? '리테이크에 댓글…' : '답글 남기기…'\}/);
});

test('retake comments live under their retake card — one card in the main list, the same card heads the side thread (no per-row re badge)', () => {
  // v1.147.0(§5.3·§5.4): 리테이크 댓글은 본문에 행으로 따로 그리지 않고 revision_id 마다 카드 하나에 모인다 —
  //   어느 리테이크인지는 카드가 말해 주므로 행마다 붙던 re 배지(RevisionCommentBadge)는 없다.
  assert.doesNotMatch(commentPanel, /<RevisionCommentBadge/);
  assert.doesNotMatch(commentPanel, /prevRevisionId|commentRevisionId|replyRevisionId|messageRevisionId/);
  assert.match(commentPanel, /if \(item\.kind === 'retake'\) \{\s*const card = retakeCardData\(item\.revisionId, item\.events\);/);
  assert.match(commentPanel, /data-retake-root=\{item\.revisionId\}/);
  // 스레드 창: 같은 카드(동작 단추 포함)가 맨 위, 아래는 활동 줄과 리테이크 댓글 행이 시간순.
  assert.match(commentPanel, /<div className="cmt-thread-root" data-retake-thread-root>\s*<RetakeRootCard\s+inThread/);
  assert.match(commentPanel, /availableRetakeActions\(\{ status: card\.status, myState, canFinal: canFinalResolveRevision\(currentUser, revision\) \}\)/);
  assert.match(commentPanel, /\.map\(\(id\) => \(\{ id, busy: retakeActionBusy, onClick: \(\) => \{ void runRetakeAction\(id, revision\); \} \}\)\)/);
  assert.match(commentPanel, /\{activeRevisionTimeline\.map\(\(row, index\) => \{/);
  // 리테이크 탭 카드의 댓글도 행마다 배지 대신 카드가 맥락 — '스레드 열기'는 이 패널의 스레드 창으로.
  assert.doesNotMatch(revisionCommentThread, /RevisionCommentBadge/);
  assert.match(revisionCommentThread, /revisionId=\{c\.revisionId \?\? revisionId\}/);
  assert.match(revisionCommentThread, /window\.dispatchEvent\(new CustomEvent\('bflow:open-revision-thread', \{ detail \}\)\)/);
  assert.match(commentPanel, /window\.addEventListener\('bflow:open-revision-thread', onOpen\)/);
});

test('main comment flow folds comments from the same retake thread into one retake card', () => {
  // v1.147.0(§5.2·§5.3): 목록은 순수 함수 buildCommentFeed 가 만든다(동작은 tests/commentFeedModel.test.ts) —
  //   같은 리테이크 댓글을 나란히 붙이던 'followup' 줄 모양·정렬 키 대신 카드 하나.
  assert.match(commentPanel, /const feed = useMemo\(\(\) => buildCommentFeed\(\{/);
  assert.match(commentPanel, /\{feed\.items\.map\(\(item\) => \{/);
  assert.doesNotMatch(commentPanel, /isRetakeThreadFollowup|comment-retake-thread-followup/);
  assert.doesNotMatch(commentPanel, /commentSortKeys/);
  // 첫 안 읽은 댓글은 여전히 본문 흐름 순서로 찾는다.
  assert.match(commentPanel, /orderCommentsForThreadedMainFlow\(comments\)/);
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

test("the retake filter tab replaces the 're만' toggle — the feed model keeps retake cards for it", () => {
  // v1.147.0(§5.1): '전체 · 안 읽음 · 리테이크 · @나' 탭(feedFilter) 하나가 're만'·'활동 감추기' 토글을 대신한다.
  //   어떤 항목이 남는지는 buildCommentFeed 가 정한다(tests/commentFeedModel.test.ts).
  assert.match(commentPanel, /const \[feedFilter, setFeedFilter\] = useState<CommentFeedFilter>\('all'\)/);
  assert.match(commentPanel, /<CommentFilterTabs\s+filter=\{feedFilter\}\s+counts=\{feedCounts\}\s+onChange=\{setFeedFilter\}/);
  assert.match(commentPanel, /buildCommentFeed\(\{\s*comments,\s*events: inlineEvents \?\? \[\],\s*filter: feedFilter,/);
  assert.match(commentPanel, /feedFilter === 'retake' \? '리테이크가 없어요'/);
  assert.doesNotMatch(commentPanel, /reOnly|hideActivity|visibleInlineEvents|isRetakeInlineEvent|mergeFeed\(/);
  assert.doesNotMatch(commentPanel, /re만\s*<\/button>|활동 감추기\s*<\/button>/);
});

test('comment feed avoids layout-measure animations while thread composer is typing', () => {
  // 목록 항목은 댓글·활동·탭·읽음이 바뀔 때만 다시 만든다 — 스레드 입력창 글자는 의존에 없다.
  assert.match(
    commentPanel,
    /const feed = useMemo\(\(\) => buildCommentFeed\(\{[\s\S]{0,200}?\}\), \[comments, inlineEvents, feedFilter, isCommentUnread, currentUser\?\.name\]\);/,
  );
  assert.match(commentPanel, /\{feed\.items\.map\(\(item\) => \{/);
  assert.doesNotMatch(commentPanel, /mainFeedNodes/);
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
