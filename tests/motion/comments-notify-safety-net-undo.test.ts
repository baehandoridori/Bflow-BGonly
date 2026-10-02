/**
 * 움직임 폴리싱 20번 `safety-net` 중 '되돌리기' — 알림 창 '전체 삭제'와 댓글 휴지통.
 * 판단·움직임 값(src/utils/undoDelete.ts)은 동작으로, 화면 배선·CSS 는 소스 가드로 본다.
 * 실제 화면 확인(미리보기): 전체 삭제 → 줄 0.15초 옅어짐 + 빈 창 + '알림을 모두 지웠어요 · 되돌리기'(막대 5초) → 되돌리기 → 그대로 복원 +
 * 줄 0.18초 나타남(알림 창은 열린 채). 댓글 휴지통 → 오른쪽 12px 밀려남 + 아래 말풍선 미끄러짐 + '댓글을 지웠어요 · 되돌리기' →
 * 되돌리기면 제자리 복원(서버 호출 없음), 5초 뒤·씬 이동·창 숨김이면 그때 서버에서 지움. 동작 줄이기에서 이동 없음.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COMMENT_DELETE_EXIT_KEYFRAMES,
  COMMENT_DELETE_EXIT_MS,
  COMMENT_REFLOW_ANIMATION_ID,
  COMMENT_REFLOW_EASING,
  COMMENT_REFLOW_MS,
  NOTIFICATION_CLEAR_FADE_MS,
  NOTIFICATION_RESTORE_FADE_MS,
  RESTORE_FADE_TTL_MS,
  UNDO_WINDOW_MS,
  commentRestoreFade,
  createUndoWindow,
  insertCommentByTime,
  markNotificationRestoreFade,
  measureFlipRows,
  mergeRestoredList,
  takeNotificationRestoreFade,
  withoutPendingDeletes,
  type UndoOutcome,
} from '../../src/utils/undoDelete.ts';
import { EASE, EASE_CSS } from '../../src/utils/motion.ts';

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');

/** 테스트용 시계 — setTimer/clearTimer 를 넘겨 시간을 직접 민다. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

function track() {
  const calls: string[] = [];
  const settled: UndoOutcome[] = [];
  return {
    calls,
    settled,
    onUndo: () => { calls.push('undo'); },
    onExpire: () => { calls.push('expire'); },
    onSettle: (outcome: UndoOutcome) => { settled.push(outcome); },
  };
}

/* ─── 되돌리기 창 ─────────────────────────────────────────────── */

test('되돌리기 창: 5초를 다 채워야 확정되고, 확정은 한 번뿐', () => {
  assert.equal(UNDO_WINDOW_MS, 5000);
  const clock = fakeClock();
  const t = track();
  const win = createUndoWindow({ ...t, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  assert.equal(win.outcome, null);
  clock.advance(4999);
  assert.deepEqual(t.calls, [], '4.999초에는 아직');
  clock.advance(1);
  assert.deepEqual(t.calls, ['expire']);
  assert.deepEqual(t.settled, ['expired']);
  assert.equal(win.outcome, 'expired');
  // 확정 뒤에는 되돌릴 수 없고, 다시 확정해도 서버 삭제가 두 번 나가지 않는다.
  assert.equal(win.undo(), false);
  assert.equal(win.expire(), false);
  assert.deepEqual(t.calls, ['expire']);
  assert.deepEqual(t.settled, ['expired']);
});

test('되돌리기 창: 5초 안에 되돌리면 확정하지 않고 시계도 멈춘다', () => {
  const clock = fakeClock();
  const t = track();
  const win = createUndoWindow({ ...t, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  clock.advance(3000);
  assert.equal(win.undo(), true);
  assert.equal(clock.pending, 0, '시계 정리');
  clock.advance(10_000);
  assert.deepEqual(t.calls, ['undo'], '되돌린 뒤 5초가 지나도 지우지 않는다');
  assert.deepEqual(t.settled, ['undone']);
  assert.equal(win.outcome, 'undone');
  assert.equal(win.expire(), false, '되돌린 뒤 씬을 옮겨도 지우지 않는다');
  assert.deepEqual(t.calls, ['undo']);
});

test('되돌리기 창: 씬 이동·창 숨김이면 기다리지 않고 바로 확정(한 번만)', () => {
  const clock = fakeClock();
  const t = track();
  const win = createUndoWindow({ ...t, durationMs: 5000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  clock.advance(800);
  assert.equal(win.expire(), true);
  assert.deepEqual(t.calls, ['expire']);
  assert.equal(clock.pending, 0);
  clock.advance(5000);
  assert.deepEqual(t.calls, ['expire'], '원래 5초 타이머가 다시 지우지 않는다');
  assert.deepEqual(t.settled, ['expired']);
});

test('되돌리기 창: 길이를 바꿀 수 있고, 되돌리기 처리에서 오류가 나도 카드는 닫힌다', () => {
  const clock = fakeClock();
  const t = track();
  createUndoWindow({ ...t, durationMs: 1200, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  clock.advance(1200);
  assert.deepEqual(t.calls, ['expire']);

  const settled: UndoOutcome[] = [];
  const win = createUndoWindow({
    onUndo: () => { throw new Error('boom'); },
    onExpire: () => {},
    onSettle: (outcome) => { settled.push(outcome); },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  assert.throws(() => win.undo(), /boom/);
  assert.deepEqual(settled, ['undone']);
  assert.equal(win.undo(), false);
});

/* ─── 알림 '전체 삭제' 되돌리기 ───────────────────────────────── */

test('알림 되돌리기 목록: 그 사이 온 새 알림은 위에, 지운 알림은 원래 순서대로 아래, 같은 id 는 새 쪽', () => {
  const snapshot = [{ id: 'a', v: 'old' }, { id: 'b', v: 'old' }, { id: 'c', v: 'old' }];
  assert.deepEqual(mergeRestoredList([], snapshot), snapshot, '새 알림이 없으면 그대로');
  const current = [{ id: 'n1', v: 'new' }, { id: 'b', v: 'new' }];
  assert.deepEqual(mergeRestoredList(current, snapshot), [
    { id: 'n1', v: 'new' },
    { id: 'b', v: 'new' },
    { id: 'a', v: 'old' },
    { id: 'c', v: 'old' },
  ]);
});

test('알림 되돌리기 표시: 한 번만 쓰이고 1초가 지나면 무시한다(그 뒤에 연 창은 그냥 피어난다)', () => {
  assert.equal(RESTORE_FADE_TTL_MS, 1000);
  assert.equal(takeNotificationRestoreFade(10_000), false, '표시가 없으면 false');
  markNotificationRestoreFade(10_000);
  assert.equal(takeNotificationRestoreFade(10_400), true);
  assert.equal(takeNotificationRestoreFade(10_401), false, '한 번 쓰면 끝');
  markNotificationRestoreFade(20_000);
  assert.equal(takeNotificationRestoreFade(21_001), false, '1초 넘게 지난 표시는 버린다');
  assert.equal(takeNotificationRestoreFade(21_002), false);
});

test('알림 전체 삭제·되돌리기 박자: 옅어짐 150ms, 다시 나타남 180ms', () => {
  assert.equal(NOTIFICATION_CLEAR_FADE_MS, 150);
  assert.equal(NOTIFICATION_RESTORE_FADE_MS, 180);
});

/* ─── 댓글 지연 삭제 ─────────────────────────────────────────── */

test('댓글: 지우는 중인 댓글은 다시 불러온 목록에서 빠진다', () => {
  const list = [{ id: '1' }, { id: '2' }, { id: '3' }];
  assert.deepEqual(withoutPendingDeletes(list, new Set(['2'])), [{ id: '1' }, { id: '3' }]);
  assert.deepEqual(withoutPendingDeletes(list, new Map()), list);
});

test('댓글: 되돌린 댓글은 시간 순서 제자리로, 이미 있으면 그대로', () => {
  const c = (id: string, at: string) => ({ id, createdAt: `2026-10-03T10:${at}:00.000Z` });
  const list = [c('a', '00'), c('b', '10'), c('d', '30')];
  assert.deepEqual(insertCommentByTime(list, c('x', '20')).map((x) => x.id), ['a', 'b', 'x', 'd'], '가운데');
  assert.deepEqual(insertCommentByTime(list, c('x', '40')).map((x) => x.id), ['a', 'b', 'd', 'x'], '맨 끝');
  assert.deepEqual(insertCommentByTime(list, c('x', '00')).map((x) => x.id), ['a', 'x', 'b', 'd'], '같은 시각이면 그 뒤');
  assert.deepEqual(insertCommentByTime([c('b', '10')], c('x', '05')).map((x) => x.id), ['x', 'b'], '맨 앞');
  assert.equal(insertCommentByTime(list, c('b', '10')), list, '이미 있으면 같은 목록(다시 그리지 않음)');
  assert.deepEqual(list.map((x) => x.id), ['a', 'b', 'd'], '원본은 그대로');
});

test('댓글 휴지통 박자: 오른쪽 12px 로 밀리며 150ms, 아래 말풍선은 220ms out 으로 올라온다', () => {
  assert.equal(COMMENT_DELETE_EXIT_MS, 150);
  assert.deepEqual(COMMENT_DELETE_EXIT_KEYFRAMES, [
    { opacity: 1, transform: 'translateX(0px)' },
    { opacity: 0, transform: 'translateX(12px)' },
  ]);
  assert.equal(COMMENT_REFLOW_MS, 220);
  assert.equal(COMMENT_REFLOW_EASING, EASE_CSS.out);
  assert.equal(COMMENT_REFLOW_ANIMATION_ID, 'comment-reflow');
});

test('되돌린 말풍선: 떠오르지 않고 제자리에서 180ms 에 나타난다(동작 줄이기면 120ms)', () => {
  const full = commentRestoreFade(false);
  assert.deepEqual(full.initial, { opacity: 0 });
  assert.deepEqual(full.animate, { opacity: 1 });
  assert.equal(JSON.stringify(full).includes('transform'), false, '이동 없음');
  assert.deepEqual(full.transition, { duration: 0.18, ease: EASE.out });
  assert.deepEqual(full.exit, { opacity: 0, transition: { duration: 0.12, ease: EASE.in } });
  const reduced = commentRestoreFade(true);
  assert.deepEqual(reduced.initial, { opacity: 0 });
  assert.equal((reduced.transition as { duration: number }).duration, 0.12);
  assert.equal(commentRestoreFade(false), full, '렌더마다 새로 만들지 않는다');
});

test('줄 위치 재기: 숨은 줄은 빼고, 답글은 바깥 말풍선을 부모로 적는다', () => {
  type Fake = {
    key: string;
    top: number;
    hidden?: boolean;
    parent?: Fake | null;
  };
  const attr = 'data-comment-flip';
  const toElement = (fake: Fake): unknown => ({
    getAttribute: (name: string) => (name === attr ? fake.key : null),
    getClientRects: () => (fake.hidden ? [] : [{}]),
    getBoundingClientRect: () => ({ top: fake.top }),
    parentElement: {
      closest: (selector: string) => (selector === `[${attr}]` && fake.parent ? toElement(fake.parent) : null),
    },
  });
  const parent: Fake = { key: 'c:p', top: 100 };
  const fakes: Fake[] = [
    parent,
    { key: 'c:r1', top: 140, parent },
    { key: 'c:gone', top: 0, hidden: true },
    { key: 'e:evt', top: 220 },
  ];
  const root = {
    querySelectorAll: (selector: string) => {
      assert.equal(selector, `[${attr}]`);
      return fakes.map(toElement);
    },
  };
  assert.deepEqual(measureFlipRows(root as unknown as ParentNode, attr), [
    { key: 'c:p', top: 100, parentKey: null },
    { key: 'c:r1', top: 140, parentKey: 'c:p' },
    { key: 'e:evt', top: 220, parentKey: null },
  ]);
  assert.deepEqual(measureFlipRows(null, attr), []);
});

/* ─── 화면 배선(소스 가드) ─────────────────────────────────────── */

const store = read('src/stores/useNotificationStore.ts');
const panel = read('src/components/NotificationPanel.tsx');
const toast = read('src/components/common/UndoToast.tsx');
const comments = read('src/components/scenes/CommentPanel.tsx');
const css = read('src/styles/motion-comments-notify.css');

/** `start` 로 시작하는 블록 본문(중괄호 짝 맞춤). */
function bodyOf(source: string, start: string): string {
  const at = source.indexOf(start);
  assert.ok(at >= 0, `없음: ${start}`);
  const open = source.indexOf('{', at + start.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`닫히지 않음: ${start}`);
}

test('저장소: 전체 삭제는 지운 알림을 돌려주고, 되돌리기는 같은 계정일 때만 로컬 목록에 그대로 되살린다', () => {
  assert.match(store, /clearAll: \(\) => AppNotification\[\];/);
  const clear = bodyOf(store, 'clearAll: () => {');
  assert.match(clear, /const removed = get\(\)\.notifications;/);
  assert.match(clear, /get\(\)\.notifications\.forEach\(syncDomainRead\);/, '서버 쪽 읽음 처리는 지금처럼 지울 때');
  assert.match(clear, /return removed;/);
  const restore = bodyOf(store, 'restoreNotifications: (snapshot, userId) =>');
  assert.match(restore, /if \(snapshot\.length === 0 \|\| !userId \|\| activeUserId !== userId\) return false;/);
  assert.match(restore, /dedupeNotificationsByIdentity\(mergeRestoredList\(notifications, snapshot\), MAX_NOTIFICATIONS\)/);
  assert.match(restore, /persistToDisk\(activeUserId, next\);/);
  assert.doesNotMatch(restore, /syncDomainRead|isRead: false/, '읽음 표시·서버 읽음은 건드리지 않는다');
});

test('알림 창: 전체 삭제 → 줄 옅어짐 뒤 비우고 되돌리기 카드, 되돌리면 다시 나타남, 카드를 눌러도 창은 열린 채', () => {
  assert.match(panel, /onClick=\{handleClearAll\}/);
  assert.doesNotMatch(panel, /onClick=\{clearAll\}/);
  const clear = bodyOf(panel, 'const handleClearAll = useCallback(() =>');
  assert.match(clear, /if \(clearingRef\.current\) return;/, '두 번 눌러도 한 번');
  assert.match(clear, /const removed = state\.clearAll\(\);/);
  assert.match(clear, /message: '알림을 모두 지웠어요',/);
  assert.match(clear, /markNotificationRestoreFade\(\);\s*useNotificationStore\.getState\(\)\.restoreNotifications\(removed, userId\);/);
  assert.match(clear, /\[\{ opacity: 1 \}, \{ opacity: 0 \}\],\s*\{ duration: NOTIFICATION_CLEAR_FADE_MS, easing: EASE_CSS\.in, fill: 'forwards' \}/);
  assert.match(clear, /window\.setTimeout\(commit, NOTIFICATION_CLEAR_FADE_MS\);/);
  assert.match(panel, /takeNotificationRestoreFade\(\)[\s\S]{0,260}?\{ duration: NOTIFICATION_RESTORE_FADE_MS, easing: EASE_CSS\.out \}/);
  assert.match(panel, /closest\?\.\(`\.\$\{UNDO_TOAST_CLASS\}`\)\) return;/);
});

test('되돌리기 카드: 되돌리기 버튼 → undo, 닫기·스스로 닫힘 → 바로 확정, 막대 길이는 창 길이', () => {
  assert.match(toast, /label: '되돌리기',\s*onClick: \(\) => \{\s*closedByToast = true;\s*undoWindow\.undo\(\);/);
  assert.match(toast, /onDismiss: \(\) => \{\s*closedByToast = true;\s*undoWindow\.expire\(\);/);
  assert.match(toast, /onAutoClose: \(\) => \{\s*closedByToast = true;\s*undoWindow\.expire\(\);/);
  assert.match(toast, /if \(!closedByToast && toastId !== null\) sonnerToast\.dismiss\(toastId\);/, '창이 먼저 정해지면 카드도 닫는다');
  assert.match(toast, /className: UNDO_TOAST_CLASS,/);
  assert.match(toast, /duration: durationMs \+ 1000,/);
  assert.match(toast, /'--bflow-undo-ms': `\$\{durationMs\}ms`/);
});

test('댓글 패널: 휴지통은 바로 지우지 않고 5초 되돌리기, 확정 때만 서버 삭제', () => {
  const del = bodyOf(comments, 'const handleDelete = (commentId: string) =>');
  assert.doesNotMatch(del, /deleteComment\(/, '누른 순간 서버에서 지우지 않는다');
  assert.match(del, /if \(pendingDeletesRef\.current\.has\(commentId\)\) return;/);
  assert.match(del, /COMMENT_DELETE_EXIT_KEYFRAMES,\s*\{ duration: COMMENT_DELETE_EXIT_MS, easing: EASE_CSS\.in, fill: 'forwards' \},\s*reduceMotionRef\.current,/);
  assert.match(del, /setTimeout\(\(\) => collapseDeletedComment\(commentId, element\), COMMENT_DELETE_EXIT_MS\)/);
  assert.match(del, /message: '댓글을 지웠어요',\s*onUndo: \(\) => restoreDeletedComment\(commentId\),\s*onExpire: \(\) => commitDeletedComment\(commentId\),/);
  const commit = bodyOf(comments, 'const commitDeletedComment = (commentId: string) =>');
  // (리뷰 반영: 앱 종료가 기다릴 수 있게 요청을 모아 둔다 — comments-notify-review-fix.test.ts)
  assert.match(commit, /if \(!entry \|\| entry\.phase !== 'waiting'\) return;\s*entry\.phase = 'deleting';\s*\/\/[^\n]*\s*const deletion: Promise<void> = deleteComment\(entry\.targetKey, commentId\)/);
  assert.match(commit, /sonnerToast\.error\('댓글을 지우지 못했어요/);
  assert.match(commit, /settleDeleteVisual\(entry\);\s*reinsertComment\(entry\.comment\);/, '실패하면 제자리로');
  const restore = bodyOf(comments, 'const restoreDeletedComment = (commentId: string) =>');
  assert.doesNotMatch(restore, /deleteComment|addComment/, '되돌리기는 화면만(서버에는 아직 그대로)');
  const reinsert = bodyOf(comments, 'const reinsertComment = (comment: SceneCommentWithSource) =>');
  assert.match(reinsert, /knownCommentIdsRef\.current\.add\(comment\.id\);[\s\S]*?setComments\(\(current\) => insertCommentByTime\(current, comment\)\);/, '새 댓글로 치지 않아 바닥으로 끌려가지 않는다');
  assert.match(reinsert, /restoredCommentIdsRef\.current\.add\(comment\.id\);/);
  // 실시간 재조회가 지우는 중인 댓글을 되살리지 않게(보내는 중 말풍선을 합친 뒤에 뺀다)
  assert.match(comments, /const list = withoutPendingDeletes\(mergedList, pendingDeletesRef\.current\);/);
});

test('댓글 패널: 다른 씬·패널 닫기·창 숨김·새로고침·종료 대기면 바로 서버에서 지운다', () => {
  assert.match(comments, /if \(document\.visibilityState === 'hidden'\) flushAll\(\);/);
  assert.match(comments, /window\.addEventListener\('pagehide', flushAll\);/);
  assert.match(comments, /window\.addEventListener\('beforeunload', flushAll\);/);
  // 앱 종료는 대기 작업이 없어도 오는 신호로 받는다(리뷰 반영 — 예전 '저장 중' 신호는 대기 작업이 있을 때만 왔다)
  assert.match(comments, /commentDeleteFlushers\.add\(flushAll\);\s*hookCommentDeleteQuitFlush\(\);/);
  assert.doesNotMatch(comments, /onSavingBeforeQuit/);
  assert.match(comments, /entry\.undoWindow\?\.expire\(\);\s*\}\s*\};\s*\}, \[primaryStorageKey, secondarySceneKey\]\);/);
});

test('댓글 패널: 지운 자리는 다음 그림 직전에 비우고 아래 말풍선은 FLIP 으로 올라온다, 되돌린 말풍선은 제자리 등장', () => {
  assert.match(comments, /hide\.forEach\(\(element\) => \{ element\.style\.display = 'none'; \}\);/);
  assert.match(comments, /notificationRowShifts\(before, measureFlipRows\(root, 'data-comment-flip'\)\)/);
  assert.match(comments, /\{ duration: COMMENT_REFLOW_MS, easing: COMMENT_REFLOW_EASING \},\s*reduceMotionRef\.current,/);
  assert.match(comments, /reflowBeforeRef\.current = reduceMotionRef\.current\s*\? null/, '동작 줄이기면 미끄러짐 없음');
  assert.equal([...comments.matchAll(/data-comment-flip=\{`c:\$\{(comment|reply)\.id\}`\}/g)].length, 2);
  assert.match(comments, /data-comment-flip=\{`e:\$\{node\.event\.id\}`\}/);
  assert.equal([...comments.matchAll(/\{\.\.\.\(restoredCommentIdsRef\.current\.has\((comment|reply)\.id\) \? commentRestore : \{\}\)\}/g)].length, 2);
  // 보내지 못한 말풍선 '지우기'는 서버에 없는 것이라 되돌리기 대상이 아니다(그대로 바로 지운다)
  const discard = bodyOf(comments, 'const discardUnsentComment = (commentId: string) =>');
  assert.doesNotMatch(discard, /showUndoToast|pendingDeletesRef/);
});

test('CSS: 되돌리기 카드 막대는 transform 으로만 5초 줄고, 동작 줄이기면 옅어지기만', () => {
  const block = css.slice(css.indexOf('/* ─── 20. safety-net'));
  assert.ok(block.length > 0);
  assert.match(block, /\.bflow-undo-countdown \{[\s\S]*?transform-origin: left center;[\s\S]*?animation: bflow-undo-countdown var\(--bflow-undo-ms, 5000ms\) linear forwards;/);
  assert.match(block, /@keyframes bflow-undo-countdown \{\s*from \{ transform: scaleX\(1\); \}\s*to \{ transform: scaleX\(0\); \}\s*\}/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-sonner-toast\] \.bflow-undo-countdown \{\s*animation: bflow-undo-countdown-calm var\(--bflow-undo-ms, 5000ms\) linear forwards !important;/);
  assert.match(block, /@keyframes bflow-undo-countdown-calm \{\s*from \{ opacity: 1; \}\s*to \{ opacity: 0\.15; \}\s*\}/);
  assert.doesNotMatch(block, /transition:\s*(width|height|top|left|box-shadow|background)|backdrop-filter/);
});
