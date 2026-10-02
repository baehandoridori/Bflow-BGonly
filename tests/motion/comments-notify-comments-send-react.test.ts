/**
 * 움직임 폴리싱 19번 `comments-send-react` — 댓글 보내기·이모지 반응의 손맛.
 * 판단·움직임 묶음(src/utils/commentSendReact.ts)은 동작으로, 화면 배선·CSS 는 소스 가드로 본다.
 * 실제 화면 확인(미리보기): 보낸 말풍선이 아래에서 떠오름(본문·답글·스레드 창), 느린 저장 0.4초 뒤 흐림+시계,
 * 실패 시 말풍선 유지+빨간 테두리+다시 보내기·지우기, 새 반응 칩만 톡·숫자 굴림·취소 칩 쏙, 이모지 창 피어남·위로 펼침,
 * 동작 줄이기에서 이동·확대 없음.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { EASE } from '../../src/utils/motion.ts';
import {
  COMMENT_BUBBLE_RISE_MS,
  COMMENT_SLOW_SEND_MS,
  REACTION_CHIP_LEAVE_MS,
  REACTION_CHIP_REST,
  commentBubbleRise,
  commentSendBubbleClass,
  emojiPickerPlacement,
  freshReactionEmojis,
  mergeUnsentComments,
  reactionChipExit,
  reactionCountRollDirection,
  visibleCommentSendStatus,
} from '../../src/utils/commentSendReact.ts';

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const panel = read('src/components/scenes/CommentPanel.tsx');
const chip = read('src/components/scenes/ReactionChip.tsx');
const picker = read('src/components/scenes/EmojiPicker.tsx');
const css = read('src/styles/motion-comments-notify.css');
const sendReactCss = css.slice(css.indexOf('/* ─── 19. comments-send-react'));

/** 함수 본문(여는 중괄호부터 짝이 맞는 닫는 중괄호까지). */
function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} 없음`);
  const open = source.indexOf('{', start + signature.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`${signature} 본문이 닫히지 않음`);
}

test('사양 박자: 0.4초 넘을 때만 보내는 중, 떠오름 220ms, 칩 빠짐 140ms', () => {
  assert.equal(COMMENT_SLOW_SEND_MS, 400);
  assert.equal(COMMENT_BUBBLE_RISE_MS, 220);
  assert.equal(REACTION_CHIP_LEAVE_MS, 140);
});

test('말풍선 상태 클래스: 보내는 중 0.4초 전·저장됨은 표시 없음, 느림은 흐림, 실패는 빨간 테두리', () => {
  assert.equal(visibleCommentSendStatus('sending'), null);
  assert.equal(visibleCommentSendStatus(null), null);
  assert.equal(visibleCommentSendStatus(undefined), null);
  assert.equal(visibleCommentSendStatus('slow'), 'slow');
  assert.equal(visibleCommentSendStatus('failed'), 'failed');
  // 기본 클래스는 늘 붙어 있어야 흐림이 풀릴 때도 전환이 돈다
  assert.equal(commentSendBubbleClass(null), 'comment-send-bubble');
  assert.equal(commentSendBubbleClass('sending'), 'comment-send-bubble');
  assert.equal(commentSendBubbleClass('slow'), 'comment-send-bubble comment-send-bubble--slow');
  assert.equal(commentSendBubbleClass('failed'), 'comment-send-bubble comment-send-bubble--failed');
});

test('다시 불러와도 보내는 중·보내지 못한 내 댓글은 남고, 서버에 이미 있으면 저장된 것으로 본다', () => {
  const server = [
    { id: 'a', createdAt: '2026-10-03T09:00:00.000Z' },
    { id: 'c', createdAt: '2026-10-03T09:02:00.000Z' },
  ];
  // 아직 서버에 없는 b 는 시간 순서 자리에 끼워진다
  const merged = mergeUnsentComments(server, [{ id: 'b', createdAt: '2026-10-03T09:01:00.000Z' }]);
  assert.deepEqual(merged.list.map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(merged.saved, []);
  // 서버에 이미 있으면 서버 쪽을 쓰고 saved 로 알린다(중복 없음)
  const savedCase = mergeUnsentComments(server, [{ id: 'c', createdAt: '2026-10-03T09:02:00.000Z' }]);
  assert.deepEqual(savedCase.list.map((c) => c.id), ['a', 'c']);
  assert.deepEqual(savedCase.saved, ['c']);
  assert.equal(savedCase.list[1], server[1]);
  // 끼울 게 없으면 서버 목록 그대로(새 배열)
  const none = mergeUnsentComments(server, []);
  assert.deepEqual(none.list, server);
  assert.notEqual(none.list, server);
});

test('말풍선 떠오름: 아래 8px → 제자리 220ms out 곡선, transform 문자열 + 끝은 none, 나갈 땐 옅어지기만', () => {
  const full = commentBubbleRise(false);
  assert.deepEqual(full.initial, { opacity: 0, transform: 'translateY(8px)' });
  assert.deepEqual(full.animate, { opacity: 1, transform: 'translateY(0px)', transitionEnd: { transform: 'none' } });
  assert.deepEqual(full.transition, { duration: 0.22, ease: EASE.out });
  assert.equal(full.exit.opacity, 0);
  assert.equal('transform' in full.exit, false, '지우는 순간의 움직임은 safety-net 몫 — 여기선 옅어지기만');
  // 같은 객체를 돌려준다(렌더마다 새로 만들지 않음 — framer 가 다시 돌지 않게)
  assert.equal(commentBubbleRise(false), full);
  // 동작 줄이기: opacity 만 120ms, 이동 없음
  const reduced = commentBubbleRise(true);
  assert.equal(JSON.stringify(reduced).includes('transform'), false);
  assert.deepEqual(reduced.initial, { opacity: 0 });
  assert.equal((reduced.transition as { duration: number }).duration, 0.12);
});

test('반응 칩: 반응을 다 불러온 뒤 새로 생긴 칩만 톡 — 패널을 열 때 이미 있던 칩은 가만히', () => {
  // 반응을 처음 받는 그림(armed 아님): 모두 이미 있던 칩
  assert.deepEqual([...freshReactionEmojis(false, new Set(), ['👍', '❤️'])], []);
  // 그 뒤 새 칩만
  assert.deepEqual([...freshReactionEmojis(true, new Set(['👍', '❤️']), ['👍', '❤️', '🎉'])], ['🎉']);
  // 숫자만 바뀐 칩·그대로인 칩은 톡 하지 않는다
  assert.deepEqual([...freshReactionEmojis(true, new Set(['👍']), ['👍'])], []);
  // 취소로 빠졌다가 다시 누르면 다시 새 칩
  assert.deepEqual([...freshReactionEmojis(true, new Set([]), ['👍'])], ['👍']);
});

test('반응 숫자: 늘면 위로, 줄면 아래로, 같으면 굴리지 않음', () => {
  assert.equal(reactionCountRollDirection(2, 3), 'up');
  assert.equal(reactionCountRollDirection(3, 2), 'down');
  assert.equal(reactionCountRollDirection(2, 2), null);
});

test('취소 칩: 0.6배로 줄며 옅어진 뒤 빠짐(제자리에서 출발), 동작 줄이기면 옅어지기만', () => {
  const full = reactionChipExit(false);
  assert.equal(full.opacity, 0);
  assert.deepEqual(full.transform, ['scale(1)', 'scale(0.6)'], "'none' 에서 출발하면 framer 가 scale(0) 에서 출발 — 제자리 값을 명시");
  assert.deepEqual(full.transition, { duration: 0.14, ease: EASE.in });
  const reduced = reactionChipExit(true);
  assert.equal('transform' in reduced, false);
  assert.equal(reduced.opacity, 0);
  // 머무는 모습: 다시 들어올 때 크기를 제자리로, 끝은 none
  assert.deepEqual(REACTION_CHIP_REST, { opacity: 1, transform: 'scale(1)', transitionEnd: { transform: 'none' } });
});

test('이모지 창 자리: 버튼 위가 기본, 펼쳐도 아래 가장자리(버튼 쪽)는 그대로 — 위로 튀지 않음', () => {
  const anchor = { top: 600, bottom: 620, left: 300, width: 24 };
  const collapsed = emojiPickerPlacement({ anchor, viewportWidth: 1600, viewportHeight: 900, width: 220 });
  assert.equal(collapsed.side, 'above');
  assert.equal(collapsed.bottom, 900 - (600 - 8));
  assert.equal(collapsed.top, undefined);
  assert.equal(collapsed.maxHeight, 600 - 8 - 8);
  assert.equal(collapsed.originX, 12);
  // 더 보기(280 폭): 같은 쪽·같은 아래 가장자리 — 높이 추정으로 위치를 다시 계산하지 않는다
  const expanded = emojiPickerPlacement({ anchor, viewportWidth: 1600, viewportHeight: 900, width: 280 });
  assert.equal(expanded.side, 'above');
  assert.equal(expanded.bottom, collapsed.bottom);
  // 위 공간이 펼친 창(320)보다 좁아도 펼칠 때 아래로 뒤집히지 않는다 — 버튼 위에 붙은 채 창 안에서 스크롤
  const tightAnchor = { top: 200, bottom: 220, left: 300, width: 24 };
  const tightCollapsed = emojiPickerPlacement({ anchor: tightAnchor, viewportWidth: 1600, viewportHeight: 900, width: 220 });
  const tightExpanded = emojiPickerPlacement({ anchor: tightAnchor, viewportWidth: 1600, viewportHeight: 900, width: 280 });
  assert.equal(tightCollapsed.side, 'above');
  assert.equal(tightExpanded.side, 'above');
  assert.equal(tightExpanded.bottom, tightCollapsed.bottom);
  assert.equal(tightExpanded.maxHeight, 200 - 8 - 8);
  // 위에 접힌 창(80)도 안 들어가면 아래 — 위 가장자리를 버튼 바로 아래에 고정
  const nearTop = emojiPickerPlacement({ anchor: { top: 90, bottom: 110, left: 300, width: 24 }, viewportWidth: 1600, viewportHeight: 900, width: 220 });
  assert.equal(nearTop.side, 'below');
  assert.equal(nearTop.top, 118);
  assert.equal(nearTop.maxHeight, 900 - 118 - 8);
  // 오른쪽 끝: 화면 안으로 당기고, 피어나는 기준점은 여전히 버튼 가운데
  const right = emojiPickerPlacement({ anchor: { top: 600, bottom: 620, left: 1580, width: 20 }, viewportWidth: 1600, viewportHeight: 900, width: 220 });
  assert.equal(right.left, 1600 - 220 - 8);
  assert.equal(right.originX, 1590 - right.left);
  // 기준 버튼이 없으면 왼쪽 위
  assert.equal(emojiPickerPlacement({ anchor: null, viewportWidth: 1600, viewportHeight: 900, width: 220 }).side, 'below');
});

test('패널 배선: 본문·답글·스레드 창 모두 아래에서 떠오르고, 처음 불러온 목록·펼칠 때는 그대로', () => {
  assert.doesNotMatch(panel, /y: -6/, '위에서 내려오던 등장(framer 개별 y 값) 제거');
  assert.match(panel, /const bubbleRise = commentBubbleRise\(reduceMotion\);/);
  // 활동 줄·본문 댓글·답글 묶음(첫 답글)·답글·스레드 창 메시지
  assert.equal([...panel.matchAll(/\{\.\.\.bubbleRise\}/g)].length, 5);
  assert.match(panel, /<AnimatePresence initial=\{false\}>\s*\{replies\.length > 0 && \(\s*<motion\.div key="replies" \{\.\.\.bubbleRise\}/);
  assert.match(panel, /<motion\.div\s+key=\{`evt:\$\{node\.event\.id\}`\}[\s\S]{0,200}?\{\.\.\.bubbleRise\}/);
  // 답글: 접힘 조건 안의 AnimatePresence initial={false} — 펼칠 때·처음 그릴 때는 움직이지 않음
  assert.match(panel, /\{!threadCollapsed && \(\s*<AnimatePresence initial=\{false\}>\s*\{replies\.map\(\(reply, ri\) => \{/);
  assert.match(panel, /<motion\.div\s+ref=\{\(el\) => \{ commentRefs\.current\.set\(reply\.id, el\); \}\}[\s\S]{0,160}?\{\.\.\.bubbleRise\}/);
  // 스레드 창
  assert.match(panel, /<AnimatePresence initial=\{false\}>\s*\{activeThreadMessagesForPanel\.map\(\(message, index\) => \{/);
  assert.match(panel, /<motion\.div\s+key=\{message\.id\}[\s\S]{0,200}?\{\.\.\.bubbleRise\}/);
});

test('패널 배선: 0.4초 넘을 때만 보내는 중, 실패하면 말풍선 유지 + 다시 보내기(같은 저장 길)·지우기', () => {
  // 보내기 시작에서 0.4초 타이머 → slow, 저장되면 표시 지움
  const begin = bodyOf(panel, 'const beginCommentSend = (draft: UnsentCommentDraft) =>');
  assert.match(begin, /setTimeout\(\(\) => \{[\s\S]*?entry\.status = 'slow';\s*setCommentSendStatus\(id, 'slow'\);[\s\S]*?\}, COMMENT_SLOW_SEND_MS\)/);
  assert.match(begin, /if \(!entry \|\| entry\.status !== 'sending' \|\| !mountedRef\.current\) return;/);
  // 본문 입력칸: 롤백(목록 되돌리기·입력칸 복원) 대신 실패 표시. 남길 자리가 없을 때만 첨부 정리 + 알림
  const submit = bodyOf(panel, 'const handleSubmit = async () =>');
  assert.match(submit, /beginCommentSend\(sendDraft\);\s*try \{[\s\S]*?await addComment\(targetSceneKey, comment\);\s*finishCommentSend\(comment\.id\);/);
  assert.match(submit, /if \(failCommentSend\(comment\.id\)\) return;[\s\S]*?storageService\.deleteImage\(a\.uploadedUrl\)[\s\S]*?notifyLostComment\(\);/);
  assert.doesNotMatch(submit, /setComments\(comments\)/, '실패해도 말풍선을 지우지 않는다');
  assert.doesNotMatch(submit, /setInput\(prevInput\)/, '같은 글이 입력칸과 말풍선에 두 번 보이지 않게');
  assert.match(submit, /webhookSceneKey: primaryStorageKey,/);
  assert.match(submit, /markReadOnSuccess: !!prevReplyTarget,/);
  // 스레드 창: 같은 방식
  const threadSubmit = bodyOf(panel, 'const handleThreadSubmit = async () =>');
  assert.match(threadSubmit, /beginCommentSend\(sendDraft\);[\s\S]*?await addComment\(targetSceneKey, comment\);\s*finishCommentSend\(comment\.id\);[\s\S]*?afterCommentDelivered\(sendDraft\);/);
  assert.match(threadSubmit, /webhookSceneKey: targetSceneKey,/);
  // 다시 보내기: 같은 댓글(같은 id)을 같은 키로 addComment — 저장 뒤 할 일도 처음과 같은 afterCommentDelivered
  const retry = bodyOf(panel, 'const retryUnsentComment = async (commentId: string) =>');
  assert.match(retry, /if \(!entry \|\| entry\.status !== 'failed'\) return;/);
  assert.match(retry, /beginCommentSend\(draft\);\s*try \{\s*await addComment\(draft\.targetSceneKey, draft\.comment\);\s*finishCommentSend\(commentId\);\s*afterCommentDelivered\(draft\);/);
  assert.match(retry, /if \(!failCommentSend\(commentId\)\) \{\s*cleanupDraftImages\(draft\.attached, '\[댓글 다시 보내기 실패\]'\);/);
  // 지우기: 서버에 없는 말풍선만 목록에서 빼고 올린 첨부 정리(서버 호출 없음)
  const discard = bodyOf(panel, 'const discardUnsentComment = (commentId: string) =>');
  assert.match(discard, /cleanupDraftImages\(entry\.attached, '\[보내지 못한 댓글 지우기\]'\)/);
  assert.doesNotMatch(discard, /deleteComment\(/);
  // 저장 뒤 할 일 한 곳: 다시 불러오기·읽음·미리보기 정리·슬랙 멘션
  const after = bodyOf(panel, 'const afterCommentDelivered = (draft: UnsentCommentDraft) =>');
  assert.match(after, /if \(draft\.markReadOnSuccess\) markUnreadCommentsRead\(\);/);
  assert.match(after, /URL\.revokeObjectURL\(item\.previewUrl\)/);
  assert.match(after, /notifyCommentMentions\(draft\.comment, draft\.webhookSceneKey\);/);
  assert.equal([...panel.matchAll(/sendMentionWebhook\(\{/g)].length, 1, '멘션 알림은 한 곳에서만');
  // 실시간 재조회가 보내는 중·실패 말풍선을 지우지 않게, 서버에 있으면 저장된 것으로
  assert.match(panel, /const \{ list, saved \} = mergeUnsentComments\(deduped, unsent\.map\(\(entry\) => entry\.comment\)\);/);
  assert.match(panel, /setComments\(list\);/);
  // 씬 이동·패널 닫기에서 실패 말풍선의 첨부 정리
  assert.match(panel, /forgetUnsentComments\('\[보내지 못한 댓글 scene 변경\]'\);\s*\}, \[primaryStorageKey\]\);/);
  assert.match(panel, /useEffect\(\(\) => \(\) => forgetUnsentComments\('\[보내지 못한 댓글 패널 unmount\]'\), \[\]\);/);
});

test('패널 배선: 실패 말풍선은 세 곳 모두 반응 줄 대신 안내, 수정·삭제 버튼 숨김, 느릴 때만 시계', () => {
  assert.match(panel, /<span className="font-semibold text-status-low">보내지 못했어요<\/span>/);
  assert.match(panel, />\s*다시 보내기\s*</);
  assert.match(panel, />\s*지우기\s*</);
  assert.equal([...panel.matchAll(/<CommentSendFailedNotice/g)].length, 3, '본문·답글·스레드 창');
  assert.equal([...panel.matchAll(/onRetry=\{\(\) => \{ void retryUnsentComment\((comment|reply|message)\.id\); \}\}/g)].length, 3);
  assert.equal([...panel.matchAll(/onDiscard=\{\(\) => discardUnsentComment\((comment|reply|message)\.id\)\}/g)].length, 3);
  assert.match(panel, /\{!isEditing && sendStatus !== 'failed' && \(/);
  assert.match(panel, /\{!replyIsEditing && replySendStatus !== 'failed' && \(/);
  assert.match(panel, /\{!isEditing && sendStatus === 'slow' && <CommentSendClock \/>\}/);
  assert.match(panel, /\{!replyIsEditing && replySendStatus === 'slow' && <CommentSendClock \/>\}/);
  assert.match(panel, /\{messageSendStatus === 'slow' && <CommentSendClock \/>\}/);
  assert.equal([...panel.matchAll(/commentSendBubbleClass\((sendStatus|replySendStatus|messageSendStatus)\)/g)].length, 3);
});

test('패널 배선: 반응을 처음 다 불러온 뒤에만 새 칩 톡, 취소 칩은 AnimatePresence 로 쏙', () => {
  assert.match(panel, /fetchReactionsBulk\(ids\)\.then\(\(map\) => \{\s*if \(seq !== loadSeqRef\.current\) return;\s*setReactionsByCommentId\(map\);\s*setReactionsReady\(true\);/);
  assert.match(panel, /setLoadStatus\('loading'\);\s*setReactionsReady\(false\);/);
  assert.equal([...panel.matchAll(/animateNew=\{reactionsReady\}\s*reduceMotion=\{reduceMotion\}/g)].length, 3);
  const area = bodyOf(panel, '}: ReactionsAreaProps) {');
  assert.match(area, /const freshEmojis = freshReactionEmojis\(armedRef\.current, seenEmojisRef\.current, emojis\);/);
  assert.match(area, /useEffect\(\(\) => \{\s*seenEmojisRef\.current = new Set\(emojis\);\s*armedRef\.current = animateNew;\s*\}\);/);
  assert.match(area, /<AnimatePresence initial=\{false\}>\s*\{groups\.map\(\(g\) => \(\s*<motion\.span key=\{g\.emoji\} className="inline-flex" initial=\{false\} animate=\{REACTION_CHIP_REST\} exit=\{chipExit\}>/);
  assert.match(area, /pop=\{freshEmojis\.has\(g\.emoji\)\}/);
  assert.doesNotMatch(area, /transition-all/);
});

test('반응 칩: 톡은 처음 그릴 때만, 숫자는 값마다 새 칸으로 한 번, 색만 전환', () => {
  assert.match(chip, /const \[popOnMount\] = useState\(pop\);/);
  assert.match(chip, /popOnMount && 'reaction-chip-pop'/);
  assert.match(chip, /<span key=\{group\.count\} className=\{cn\('reaction-count', roll && `reaction-count--\$\{roll\}`\)\}>/);
  assert.match(chip, /setRoll\(reactionCountRollDirection\(shownCount, group\.count\)\);/);
  assert.doesNotMatch(chip, /['"`][^'"`\n]*\btransition-all\b/, '클래스에 transition-all 없음');
  assert.match(chip, /transition-colors duration-150/);
  // 툴팁: 가운데 맞춤 transform 은 바깥, 움직임은 안쪽
  assert.match(chip, /-translate-x-1\/2 mb-1 pointer-events-none">\s*<div className="reaction-tooltip /);
});

test('이모지 창: 버튼 쪽에서 피어나고, 높이 추정으로 위치를 다시 계산하지 않는다', () => {
  assert.doesNotMatch(picker, /const height = showAll \? 320 : 80/);
  assert.match(picker, /const placement = emojiPickerPlacement\(\{/);
  assert.match(picker, /placement\.side === 'above' \? \{ bottom: placement\.bottom \} : \{ top: placement\.top \}/);
  assert.match(picker, /transformOrigin: `\$\{placement\.originX\}px \$\{placement\.side === 'above' \? '100%' : '0%'\}`/);
  assert.match(picker, /className="emoji-picker-pop /);
  assert.match(picker, /<div className="emoji-picker-extra mt-1 grid grid-cols-7 gap-1">/);
  assert.match(picker, /maxHeight: placement\.maxHeight/);
});

test('CSS: transform·opacity 만, 사양 박자·곡선, 흐림 없음', () => {
  assert.ok(sendReactCss.length > 200, '19번 CSS 묶음');
  // 느림: 흐림 .6, 전환 200ms(기본 클래스에 있어 풀릴 때도 돈다)
  assert.match(sendReactCss, /\.comment-send-bubble \{\s*position: relative;\s*transition: opacity 200ms var\(--ease-std\);\s*\}\s*\.comment-send-bubble--slow \{\s*opacity: 0\.6;\s*\}/);
  // 실패: 미리 그린 1.5px #E17055 층이 opacity 로만 200ms
  assert.match(sendReactCss, /\.comment-send-bubble--failed::after \{[\s\S]*?border: 1\.5px solid #E17055;[\s\S]*?animation: comment-send-fade-in 200ms var\(--ease-out\) backwards;/);
  // 새 칩 톡: 190ms 2048 곡선, 0.4 → 70% 1.07 → 1
  assert.match(sendReactCss, /\.reaction-chip-pop \{\s*animation: reaction-chip-pop 190ms cubic-bezier\(0\.18, 0\.88, 0\.34, 1\.28\) backwards;/);
  assert.match(sendReactCss, /0% \{ opacity: 0; transform: scale\(0\.4\); \}\s*70% \{ opacity: 1; transform: scale\(1\.07\); \}\s*100% \{ opacity: 1; transform: scale\(1\); \}/);
  // 숫자 굴림 150ms, 70%
  assert.match(sendReactCss, /\.reaction-count--up \{\s*animation: reaction-count-up 150ms var\(--ease-out\) backwards;/);
  assert.match(sendReactCss, /@keyframes reaction-count-up \{\s*from \{ opacity: 0; transform: translateY\(70%\); \}/);
  assert.match(sendReactCss, /@keyframes reaction-count-down \{\s*from \{ opacity: 0; transform: translateY\(-70%\); \}/);
  // 이모지 창 140ms 0.92배
  assert.match(sendReactCss, /\.emoji-picker-pop \{\s*animation: emoji-picker-in 140ms var\(--ease-out\) backwards;/);
  assert.match(sendReactCss, /@keyframes emoji-picker-in \{\s*from \{ opacity: 0; transform: scale\(0\.92\); \}/);
  // 키프레임은 opacity·transform 만, 무한 반복·흐림 없음
  const keyframeBlocks = [...sendReactCss.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)];
  assert.ok(keyframeBlocks.length >= 6, `키프레임 ${keyframeBlocks.length}개`);
  for (const block of keyframeBlocks) {
    const props = [...block[1].matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    for (const prop of props) assert.ok(prop === 'opacity' || prop === 'transform', `${block[0].split('{')[0]}: ${prop}`);
  }
  assert.doesNotMatch(sendReactCss, /infinite/);
  assert.doesNotMatch(sendReactCss, /backdrop-filter|box-shadow|filter:/);
  // 전환은 opacity 하나뿐(색·크기 전환 없음)
  const transitions = [...sendReactCss.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(transitions, ['opacity 200ms var(--ease-std)']);
});
