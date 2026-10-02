/**
 * 움직임 폴리싱 4번 `comment-open-calm` — 댓글 칸을 열 때 차분하게.
 * 판단(src/utils/commentOpenCalm.ts)은 동작으로, 화면 배선·CSS 는 소스 가드로 본다.
 * 실제 화면 확인(미리보기): 새 댓글 줄 가운데에서 시작·4초 뒤 옅어짐, 느린 조회 0.15초 뒤 회색 자리, 실패 안내·다시 불러오기,
 * 위로 읽는 중 새 댓글 알약, 내가 보낸 댓글 따라가기, 늦게 커지는 내용에도 바닥 유지, 동작 줄이기에서 빛 띠·부드러운 스크롤 없음.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COMMENT_NEAR_BOTTOM_PX,
  COMMENT_OPEN_PIN_WINDOW_MS,
  COMMENT_READ_STATE_WAIT_MS,
  COMMENT_SKELETON_DELAY_MS,
  COMMENT_STICK_BOTTOM_PX,
  COMMENT_UNREAD_DIVIDER_FADE_DELAY_MS,
  commentArrivalAction,
  commentListDistanceFromBottom,
  commentLoadStatusAfter,
  commentOpenPinTarget,
  UNREAD_DIVIDER_UNCAPTURED,
  captureUnreadDivider,
  commentOpenScrollTop,
  isUnreadDividerRead,
  newCommentsPillLabel,
  splitNewCommentIds,
  unreadDividerCommentId,
} from '../../src/utils/commentOpenCalm.ts';

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const panel = read('src/components/scenes/CommentPanel.tsx');
const service = read('src/services/commentService.ts');
const css = read('src/styles/motion-comments-notify.css');

test('사양 수치: 회색 자리 0.15초 · 새 댓글 줄 4초 · 바닥 근처 80px · 바닥에 붙음 8px · 처음 자리 지키기 1초', () => {
  assert.equal(COMMENT_SKELETON_DELAY_MS, 150);
  assert.equal(COMMENT_UNREAD_DIVIDER_FADE_DELAY_MS, 4000);
  assert.equal(COMMENT_NEAR_BOTTOM_PX, 80);
  assert.equal(COMMENT_STICK_BOTTOM_PX, 8);
  assert.equal(COMMENT_OPEN_PIN_WINDOW_MS, 1000);
  assert.equal(COMMENT_READ_STATE_WAIT_MS, 1500);
});

test('불러오기 상태: 실패는 처음 조회일 때만 오류, 이미 보여 준 목록은 재조회 실패로 지우지 않는다', () => {
  assert.equal(commentLoadStatusAfter('loading', 'success'), 'ready');
  assert.equal(commentLoadStatusAfter('loading', 'failure'), 'error');
  assert.equal(commentLoadStatusAfter('error', 'success'), 'ready');
  assert.equal(commentLoadStatusAfter('error', 'failure'), 'error');
  assert.equal(commentLoadStatusAfter('ready', 'failure'), 'ready');
});

test('처음 자리: 기준이 없으면 맨 아래, 있으면 그 가운데를 화면 가운데에(범위 안으로 자름)', () => {
  const box = { scrollHeight: 1800, clientHeight: 500 };
  assert.equal(commentOpenScrollTop(box, null), 1300);
  // 줄(높이 30)이 내용 900px 에 있으면 900 + 15 - 250 = 665
  assert.equal(commentOpenScrollTop(box, { top: 900, height: 30 }), 665);
  // 맨 위 근처 줄은 0 으로, 맨 아래 근처 줄(새 댓글이 몇 개 안 됨)은 맨 아래로
  assert.equal(commentOpenScrollTop(box, { top: 40, height: 30 }), 0);
  assert.equal(commentOpenScrollTop(box, { top: 1700, height: 30 }), 1300);
  // 넘치지 않는 목록
  assert.equal(commentOpenScrollTop({ scrollHeight: 300, clientHeight: 500 }, null), 0);
  assert.equal(commentListDistanceFromBottom({ scrollTop: 1250, scrollHeight: 1800, clientHeight: 500 }), 50);
  assert.equal(commentListDistanceFromBottom({ scrollTop: 1400, scrollHeight: 1800, clientHeight: 500 }), 0);
});

test('처음 자리 우선순위: 알림에서 찾아온 댓글 > 새 댓글 줄 > 맨 아래', () => {
  assert.equal(commentOpenPinTarget({ focusCommentId: 'c1', dividerCommentId: 'c2' }), 'focus');
  assert.equal(commentOpenPinTarget({ focusCommentId: null, dividerCommentId: 'c2' }), 'divider');
  assert.equal(commentOpenPinTarget({ focusCommentId: null, dividerCommentId: null }), 'bottom');
});

test('새 항목이 생기면: 바닥이면 붙이고, 내가 보냈거나 바닥 근처면 따라가고, 위를 읽는 중이면 알약', () => {
  assert.equal(commentArrivalAction({ mineAdded: 0, othersBelow: 1, distanceFromBottom: 0 }), 'stick');
  assert.equal(commentArrivalAction({ mineAdded: 0, othersBelow: 1, distanceFromBottom: 8 }), 'stick');
  assert.equal(commentArrivalAction({ mineAdded: 1, othersBelow: 0, distanceFromBottom: 900 }), 'follow');
  assert.equal(commentArrivalAction({ mineAdded: 0, othersBelow: 1, distanceFromBottom: 79 }), 'follow');
  // 위를 읽는 중 — 끌어내리지 않는다
  assert.equal(commentArrivalAction({ mineAdded: 0, othersBelow: 2, distanceFromBottom: 80 }), 'pill');
  assert.equal(commentArrivalAction({ mineAdded: 0, othersBelow: 2, distanceFromBottom: 600 }), 'pill');
  // 활동 줄만 늘었거나 새 댓글이 화면 안·위쪽이면 아무것도 하지 않는다
  assert.equal(commentArrivalAction({ mineAdded: 0, othersBelow: 0, distanceFromBottom: 600 }), 'none');
});

test('새로 생긴 댓글: 이미 본 id 는 빼고 내 것/팀원 것으로 나눈다', () => {
  const known = new Set(['a', 'b']);
  const list = [
    { id: 'a', userId: 'u1' },
    { id: 'b', userId: 'u2' },
    { id: 'c', userId: 'u1' },
    { id: 'd', userId: 'u2' },
    { id: 'e', userId: 'u3' },
  ];
  assert.deepEqual(splitNewCommentIds(known, list, 'u1'), { mine: ['c'], others: ['d', 'e'] });
  assert.deepEqual(splitNewCommentIds(new Set(list.map((c) => c.id)), list, 'u1'), { mine: [], others: [] });
  assert.deepEqual(splitNewCommentIds(known, list, null), { mine: [], others: ['c', 'd', 'e'] });
});

test("'새 댓글' 줄: 처음 자리를 잡을 때 한 번만 정하고, 읽음 처리 뒤에도 그 자리를 지킨다", () => {
  // 정하기 전(처음 그리는 순간)엔 지금 첫 안 읽은 댓글에 붙는다
  assert.equal(unreadDividerCommentId(UNREAD_DIVIDER_UNCAPTURED, 'c5'), 'c5');
  const captured = captureUnreadDivider(UNREAD_DIVIDER_UNCAPTURED, { id: 'c5', createdAt: '2026-10-03T10:00:00.000Z' });
  assert.deepEqual(captured, { captured: true, divider: { id: 'c5', createdAt: '2026-10-03T10:00:00.000Z', fading: false } });
  // 읽음 처리로 첫 안 읽은 댓글이 사라져도(null) 줄은 그대로
  assert.equal(captureUnreadDivider(captured, null), captured);
  assert.equal(unreadDividerCommentId(captured, null), 'c5');
  // 그 뒤 새 댓글이 와도 처음 줄을 옮기지 않는다(옮기면 한 줄 당겨진다)
  assert.equal(captureUnreadDivider(captured, { id: 'c9', createdAt: '2026-10-03T10:05:00.000Z' }), captured);
  assert.equal(unreadDividerCommentId(captured, 'c9'), 'c5');
});

test("'새 댓글' 줄: 안 읽은 댓글 없이 연 패널엔 그 뒤 실시간으로 온 팀원 댓글에도 줄을 만들지 않는다(옅어진 빈 틈이 남았다)", () => {
  const none = captureUnreadDivider(UNREAD_DIVIDER_UNCAPTURED, null);
  assert.deepEqual(none, { captured: true, divider: null });
  // 실시간으로 온 팀원 댓글이 첫 안 읽은 댓글이 돼도 줄은 없다 — 알약·바닥 따라가기와 말풍선 노출 기반 읽음 처리로 둔다
  assert.equal(captureUnreadDivider(none, { id: 'o9', createdAt: '2026-10-03T10:05:00.000Z' }), none);
  assert.equal(unreadDividerCommentId(none, 'o9'), null);
});

test("'새 댓글' 줄: 읽음 기록이 줄이 붙은 댓글에 닿았을 때만 옅어지기 시작한다(그 댓글이 읽기 전에 지워져도 그대로)", () => {
  const divider = { id: 'c5', createdAt: '2026-10-03T10:00:00.000Z', fading: false };
  assert.equal(isUnreadDividerRead(divider, null), false, '읽음 기록 없음');
  assert.equal(isUnreadDividerRead(divider, '2026-10-03T09:59:59.000Z'), false, '아직 안 읽음');
  // 줄이 붙은 c5 가 읽기 전에 실시간으로 지워져 첫 안 읽은 댓글이 c6 으로 바뀌어도 읽음 기록은 그대로 → 옅어지지 않는다
  assert.equal(isUnreadDividerRead(divider, '2026-10-03T09:59:59.000Z'), false);
  assert.equal(isUnreadDividerRead(divider, '2026-10-03T10:00:00.000Z'), true, '읽음 → 4초 타이머 시작');
  assert.equal(isUnreadDividerRead(divider, '2026-10-03T10:05:00+00:00'), true, '줄 아래 새 댓글까지 읽어도 그대로 읽음');
  assert.equal(isUnreadDividerRead({ ...divider, fading: true }, '2026-10-03T10:05:00.000Z'), false, '이미 옅어짐');
  assert.equal(isUnreadDividerRead(null, '2026-10-03T10:05:00.000Z'), false);
  assert.equal(isUnreadDividerRead({ ...divider, createdAt: 'not-a-date' }, '2026-10-03T10:05:00.000Z'), false);
});

test("알약 글자: '새 댓글 N개'", () => {
  assert.equal(newCommentsPillLabel(1), '새 댓글 1개');
  assert.equal(newCommentsPillLabel(3), '새 댓글 3개');
  assert.equal(newCommentsPillLabel(0), '새 댓글 1개');
});

test('댓글 조회: 패널만 실패를 예외로 받고(다른 호출자는 그대로 빈 목록), 실패 결과는 캐시하지 않는다', () => {
  assert.match(service, /export interface CommentReadOptions \{\s*throwOnError\?: boolean;\s*\}/);
  assert.match(service, /export async function loadPartComments\(sheetName: string, options: CommentReadOptions = \{\}\)/);
  assert.match(service, /export async function getComments\(sceneKey: string, options: CommentReadOptions = \{\}\)[\s\S]{0,200}loadPartComments\(sheetName, options\)/);
  assert.match(service, /export async function getCommentsForCharacter\(characterId: string, options: CommentReadOptions = \{\}\)/);
  assert.match(service, /if \(options\.throwOnError\) throw new CommentLoadError\(\);\s*return \[\];/);
  const failAt = service.indexOf('if (supabaseFailed && !fallbackLoaded) {');
  const cacheAt = service.indexOf('sheetPartCache.set(sheetName, store);');
  assert.ok(failAt > 0 && cacheAt > failAt, '실패 판정이 캐시 저장보다 먼저');
  assert.match(service.slice(failAt, failAt + 160), /if \(options\.throwOnError\) throw new CommentLoadError\(\);\s*return \{\};/);
  assert.match(service, /if \(result\.ok\) \{\s*fallbackLoaded = true;/);
});

test('패널 배선: 불러오는 중·실패·없음 구분, 처음 자리는 그리기 전에, 부드러운 스크롤은 동작 줄이기 분기', () => {
  assert.match(panel, /const \[loadStatus, setLoadStatus\] = useState<CommentLoadStatus>\('loading'\);/);
  assert.match(panel, /const readOptions = \{ throwOnError: true \};/);
  assert.match(panel, /getCommentsForCharacter\(characterId, readOptions\)/);
  assert.match(panel, /getComments\(sceneKey, readOptions\)/);
  // 씬을 빠르게 넘기면 늦게 온 옛 결과(성공·실패 모두)는 버린다
  assert.match(panel, /Promise\.all\(\[primaryPromise, secondaryPromise\]\)\.then\(\(\[a, b\]\) => \{\s*if \(seq !== loadSeqRef\.current\) return;/);
  assert.match(panel, /\}\)\.catch\(\(err\) => \{\s*if \(seq !== loadSeqRef\.current\) return;/);
  assert.match(panel, /setLoadStatus\(\(prev\) => commentLoadStatusAfter\(prev, 'failure'\)\);/);
  assert.match(panel, /const listReady = loadStatus === 'ready' && \(readStateReady \|\| readStateWaitExpired\);/);
  // 읽음 기록만 늦으면 1.5초 뒤 줄 없이 먼저 보여 주고, 줄·읽음 처리는 기록이 온 뒤에만
  assert.match(panel, /window\.setTimeout\(\(\) => setReadStateWaitExpired\(true\), COMMENT_READ_STATE_WAIT_MS\)/);
  assert.match(panel, /const dividerCommentId = listReady && readStateReady \?/);
  assert.match(panel, /if \(!listReady \|\| !readStateReady \|\| !firstUnreadCommentId \|\| !latestOtherUserCommentAt\) return;/);
  // 불러오지 못한 채 보낸 댓글은 저장 뒤 다시 불러와 기존 댓글과 함께 보인다
  // (19번 comments-send-react 부터 저장 뒤 할 일은 '다시 보내기'와 같은 afterCommentDelivered 로 모였다)
  assert.match(panel, /await addComment\(targetSceneKey, comment\);\s*finishCommentSend\(comment\.id\);\s*\/\/[^\n]*\s*afterCommentDelivered\(sendDraft\);/);
  assert.match(panel, /const afterCommentDelivered = \(draft: UnsentCommentDraft\) => \{\s*\/\/[^\n]*\s*if \(loadStatusRef\.current === 'error'\) loadComments\(\);/);
  assert.match(panel, /\{loadStatus === 'error' \? \(\s*<CommentLoadFailedNotice onRetry=\{retryLoadComments\} \/>\s*\) : !listReady \? \(\s*<CommentListSkeleton \/>\s*\) : \(/);
  assert.match(panel, /댓글을 불러오지 못했어요/);
  assert.match(panel, /다시 불러오기/);
  // 처음 자리: useLayoutEffect 에서 scrollTop 직접(위에서 미끄러지는 smooth 스크롤 없음)
  assert.match(panel, /useLayoutEffect\(\(\) => \{\s*if \(!listReady\) return;[\s\S]{0,400}?if \(!openPinStartedRef\.current\) \{/);
  assert.match(panel, /el\.scrollTop = commentOpenScrollTop\(el, anchorNode \? measureCommentAnchor\(el, anchorNode\) : null\);/);
  assert.doesNotMatch(panel, /scrollRef\.current\?\.scrollTo\(\{ top: scrollRef\.current\.scrollHeight, behavior: 'smooth' \}\)/);
  // scrollIntoView 는 바깥 상자까지 움직인다 — 가까운 스크롤 상자만
  assert.doesNotMatch(panel, /\.scrollIntoView\(/);
  // 부드러운 스크롤은 전부 동작 줄이기 분기를 거친다(JS 의 smooth 는 전역 동작 줄이기 CSS 가 막지 못한다)
  const smoothUses = [...panel.matchAll(/'smooth'/g)].length;
  const guardedUses = [...panel.matchAll(/reduceMotionRef\.current \? 'auto' : 'smooth'/g)].length;
  assert.ok(guardedUses >= 3, '처음 자리 잡기·바닥 따라가기·섹션 이어 주기');
  assert.equal(smoothUses - guardedUses, 2, "남는 'smooth' 는 resolved === 'smooth' 분기 한 곳(비교·호출)뿐");
  assert.match(panel, /if \(resolved === 'smooth'\) \{\s*el\.scrollTo\(\{ top: el\.scrollHeight, behavior: 'smooth' \}\);/);
  assert.match(panel, /const resolved = behavior \?\? \(reduceMotionRef\.current \? 'auto' : 'smooth'\);/);
  assert.match(panel, /centerInScrollParent\(el, reduceMotionRef\.current \? 'auto' : 'smooth'\);/);
  // 위를 읽는 중 새 댓글: 알약(누르면 바닥까지)
  assert.match(panel, /\{listReady && newBelowCount > 0 && \([\s\S]{0,300}?className="comment-new-pill[\s\S]{0,300}?\{newCommentsPillLabel\(newBelowCount\)\}/);
  // '새 댓글' 줄: 옅어져도 자리는 그대로(조건부 렌더가 아니라 클래스)
  assert.match(panel, /\{showUnreadDivider && \(\s*<UnreadCommentsDivider nodeRef=\{setUnreadDividerNode\} fading=\{unreadDividerFading\} \/>/);
  assert.match(panel, /\{replyShowUnreadDivider && \(\s*<UnreadCommentsDivider nodeRef=\{setUnreadDividerNode\} fading=\{unreadDividerFading\} \/>/);
  assert.match(panel, /fading && 'comment-unread-divider--fading'/);
});

test('CSS: transform·opacity 만, 빛 띠는 동작 줄이기가 아닐 때만, 사양 박자', () => {
  // 회색 자리: 0.15초 기다렸다 나타남(동작 줄이기에서도 delay 는 남는다)
  assert.match(css, /\.comment-skeleton \{[\s\S]*?animation: comment-skeleton-in var\(--motion-base\) var\(--ease-out\) 150ms backwards;/);
  assert.match(css, /background: rgb\(var\(--color-text-primary\) \/ 0\.04\);/);
  // 빛 띠: transform 1200ms ease-in-out 반복, no-preference 미디어 안에서만
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.comment-skeleton-bubble::after \{[\s\S]*?animation: comment-skeleton-sweep 1200ms ease-in-out infinite;/);
  assert.match(css, /@keyframes comment-skeleton-sweep \{\s*from \{ transform: translateX\(-100%\); \}\s*to \{ transform: translateX\(100%\); \}\s*\}/);
  // 도착 180ms, 빈 안내 4px, 줄 300ms, 알약 160ms 8px
  assert.match(css, /\.comment-list-arrive \{\s*animation: comment-list-arrive var\(--motion-base\) var\(--ease-out\) backwards;/);
  assert.match(css, /@keyframes comment-empty-arrive \{\s*from \{ opacity: 0; transform: translateY\(4px\); \}/);
  assert.match(css, /\.comment-unread-divider \{\s*transition: opacity 300ms var\(--ease-std\);\s*\}\s*\.comment-unread-divider--fading \{\s*opacity: 0;\s*\}/);
  assert.match(css, /\.comment-new-pill \{\s*animation: comment-new-pill-in 160ms var\(--ease-out\) backwards;/);
  assert.match(css, /@keyframes comment-new-pill-in \{\s*from \{ opacity: 0; transform: translateY\(8px\); \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.comment-empty-arrive,\s*\.comment-new-pill \{\s*animation-name: comment-fade-only;/);
  // 키프레임은 opacity·transform 만(높이·위치·그림자·배경·흐림 애니메이션 금지)
  const keyframeBlocks = [...css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)];
  assert.ok(keyframeBlocks.length >= 6, `키프레임 ${keyframeBlocks.length}개`);
  for (const block of keyframeBlocks) {
    const props = [...block[1].matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    assert.ok(props.length > 0);
    for (const prop of props) assert.ok(prop === 'opacity' || prop === 'transform', `${block[0].split('{')[0]}: ${prop}`);
  }
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.equal(COMMENT_SKELETON_DELAY_MS, Number(/comment-skeleton-in var\(--motion-base\) var\(--ease-out\) (\d+)ms/.exec(css)?.[1]));
});
