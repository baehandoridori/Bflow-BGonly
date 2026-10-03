/**
 * 움직임 폴리싱 comments-notify 갈래 리뷰 반영.
 * - 20번 되돌리기: 스레드 칸을 거친 댓글도 본문 말풍선이 밀려나고 아래 줄이 미끄러진다 / 묶음의 마지막 답글을 지우면 답글 묶음도
 *   같은 그림에서 숨겨 미끄러짐 뒤 한 번 더 툭 당겨지지 않는다 / 앱 종료(트레이 '종료'·'지금 업데이트') 때 서버 삭제를 끝낸 뒤 꺼진다.
 * - 4번 처음 자리: '새 댓글' 줄은 처음 자리를 잡을 때 한 번만 정한다 / 읽음은 읽음 기록 시각으로 본다 /
 *   상대 부서 키만 바뀌면 목록을 다시 '불러오는 중'으로 돌리지 않는다.
 * 순수 판단은 동작으로(electron/rendererQuitFlush.ts), 화면 배선은 소스 가드(CRLF 정규화)로 본다.
 * 실제 화면 확인(미리보기): 스레드 칸을 열었다 닫은 뒤 답글 삭제, 유일한 답글 삭제, 안 읽은 댓글 없이 연 패널에 실시간 댓글,
 * 종료 신호 흉내(onBeforeQuitFlush 를 콘솔에서 잡아 호출).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  QUIT_FLUSHED_CHANNEL,
  QUIT_FLUSH_CHANNEL,
  QUIT_FLUSH_TIMEOUT_MS,
  createQuitFlushRegistry,
  waitForRendererQuitFlush,
} from '../../electron/rendererQuitFlush.ts';

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const panel = read('src/components/scenes/CommentPanel.tsx');
const main = read('electron/main.ts');
const preload = read('electron/preload.ts');
const types = read('src/types/index.ts');
const mock = read('src/mocks/devElectronAPI.ts');
const css = read('src/styles/motion-comments-notify.css');

function fakeClock() {
  const timers = new Map<number, () => void>();
  let next = 1;
  return {
    setTimer: (fn: () => void) => { const id = next++; timers.set(id, fn); return id; },
    clearTimer: (handle: unknown) => { timers.delete(handle as number); },
    fire() { const fns = [...timers.values()]; timers.clear(); fns.forEach((fn) => fn()); },
    get pending() { return timers.size; },
  };
}

function fakeAckBus() {
  const listeners = new Set<(senderId: number, token: unknown) => void>();
  return {
    subscribeAck: (listener: (senderId: number, token: unknown) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    ack: (senderId: number, token: unknown) => [...listeners].forEach((listener) => listener(senderId, token)),
    get listening() { return listeners.size; },
  };
}

test('종료 신호: 채널·시간 상수', () => {
  assert.equal(QUIT_FLUSH_CHANNEL, 'app:before-quit-flush');
  assert.equal(QUIT_FLUSHED_CHANNEL, 'app:before-quit-flushed');
  assert.equal(QUIT_FLUSH_TIMEOUT_MS, 3000);
});

test('종료 신호: 모든 창이 같은 표로 답하면 끝난다(다른 표·모르는 창·같은 창 두 번은 세지 않는다)', async () => {
  const clock = fakeClock();
  const bus = fakeAckBus();
  const sent: Array<[number, string, string]> = [];
  const targets = [1, 2].map((id) => ({ id, send: (channel: string, token: string) => { sent.push([id, channel, token]); } }));
  let result: string | null = null;
  const done = waitForRendererQuitFlush({ targets, token: 'q1', subscribeAck: bus.subscribeAck, ...clock }).then((r) => { result = r; });
  assert.deepEqual(sent, [[1, QUIT_FLUSH_CHANNEL, 'q1'], [2, QUIT_FLUSH_CHANNEL, 'q1']]);
  bus.ack(1, 'old-token');
  bus.ack(2, 'old-token');
  bus.ack(9, 'q1');
  await Promise.resolve();
  assert.equal(result, null, '다른 표·모르는 창의 답은 세지 않는다');
  bus.ack(1, 'q1');
  bus.ack(1, 'q1');
  await Promise.resolve();
  assert.equal(result, null, '창 2 가 아직 답하지 않았다');
  bus.ack(2, 'q1');
  await done;
  assert.equal(result, 'flushed');
  assert.equal(clock.pending, 0, '시계를 치운다');
  assert.equal(bus.listening, 0, '더 듣지 않는다');
});

test('종료 신호: 답이 없으면 시간이 다 됐을 때 이어 간다(종료가 막히지 않는다)', async () => {
  const clock = fakeClock();
  const bus = fakeAckBus();
  const done = waitForRendererQuitFlush({
    targets: [{ id: 1, send: () => {} }],
    token: 'q2',
    subscribeAck: bus.subscribeAck,
    ...clock,
  });
  clock.fire();
  assert.equal(await done, 'timeout');
  assert.equal(bus.listening, 0);
});

test('종료 신호: 창이 없거나 이미 닫혀 보내지 못하면 기다리지 않는다', async () => {
  const bus = fakeAckBus();
  assert.equal(await waitForRendererQuitFlush({ targets: [], token: 'q3', subscribeAck: bus.subscribeAck }), 'none');
  const clock = fakeClock();
  const result = await waitForRendererQuitFlush({
    targets: [{ id: 1, send: () => { throw new Error('destroyed'); } }],
    token: 'q4',
    subscribeAck: bus.subscribeAck,
    ...clock,
  });
  assert.equal(result, 'flushed');
  assert.equal(clock.pending, 0);
});

test('창 쪽 모음: 맡긴 일을 모두 끝낸 뒤(실패해도) 끝나고, 맡긴 일이 없으면 곧바로 끝난다', async () => {
  const registry = createQuitFlushRegistry();
  await registry.run();
  const order: string[] = [];
  let release: () => void = () => {};
  const slow = new Promise<void>((resolve) => { release = resolve; });
  registry.add(() => slow.then(() => { order.push('slow'); }));
  registry.add(() => { throw new Error('boom'); });
  registry.add(() => Promise.reject(new Error('reject')));
  const off = registry.add(() => { order.push('removed'); });
  off();
  let finished = false;
  const running = registry.run().then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false, '느린 일을 기다린다');
  release();
  await running;
  assert.equal(finished, true);
  assert.deepEqual(order, ['slow'], '뺀 일은 하지 않는다');
});

test('메인: 대기 작업과 상관없이 모든 창에 종료 신호를 보내고, 두 갈래 모두 답(또는 시간 끝)을 기다린 뒤 끝낸다', () => {
  const beforeQuit = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf("process.on('exit'"));
  assert.match(main, /import \{ QUIT_FLUSHED_CHANNEL, waitForRendererQuitFlush \} from '\.\/rendererQuitFlush';/);
  const flushAt = beforeQuit.indexOf('const rendererFlush = waitForRendererQuitFlush({');
  const pendingIfEnd = beforeQuit.indexOf("mainWindow.webContents.send('app:saving-before-quit', totalPending);\n    }\n  }");
  assert.ok(flushAt > pendingIfEnd && pendingIfEnd > 0, "'저장 중' 조건(totalPending > 0) 밖에서 만든다");
  assert.match(beforeQuit, /targets: \[mainWindow, \.\.\.widgetWindows\.values\(\)\]\s*\.filter\(\(win\): win is BrowserWindow => !!win && !win\.isDestroyed\(\)\)/);
  assert.match(beforeQuit, /ipcMain\.on\(QUIT_FLUSHED_CHANNEL, handler\);\s*return \(\) => \{ ipcMain\.removeListener\(QUIT_FLUSHED_CHANNEL, handler\); \};/);
  assert.equal([...beforeQuit.matchAll(/calendarNotificationDrain\.waitForNotificationIdle\(15000\),\n\s*rendererFlush,\n\s*\]\);/g)].length, 2, '대기 작업이 있을 때·없을 때 모두');
  // 기다린 뒤에 업데이트 적용·종료(순서 유지)
  assert.ok(beforeQuit.lastIndexOf('rendererFlush,') < beforeQuit.indexOf('if (updateRelaunchScheduled && await hasPendingInstallerUpdate())'));
});

test('preload: 종료 신호를 받으면 화면이 맡긴 일을 끝낸 뒤 같은 표로 답한다', () => {
  assert.match(preload, /import \{ QUIT_FLUSH_CHANNEL, QUIT_FLUSHED_CHANNEL, createQuitFlushRegistry \} from '\.\/rendererQuitFlush';/);
  assert.match(preload, /ipcRenderer\.on\(QUIT_FLUSH_CHANNEL, \(_event: unknown, token: unknown\) => \{\s*void quitFlushRegistry\.run\(\)\.then\(\(\) => ipcRenderer\.send\(QUIT_FLUSHED_CHANNEL, token\)\);\s*\}\);/);
  assert.match(preload, /onBeforeQuitFlush: \(callback: \(\) => Promise<void> \| void\) => quitFlushRegistry\.add\(callback\),/);
  assert.match(types, /onBeforeQuitFlush\?: \(callback: \(\) => Promise<void> \| void\) => \(\) => void;/);
  assert.match(mock, /onBeforeQuitFlush: noop,/);
});

test('댓글 패널: 종료 신호에 기다리던 삭제를 바로 확정하고 서버 삭제(패널이 막 닫히며 확정한 것 포함)가 끝날 때까지 기다린다', () => {
  assert.match(panel, /const off = window\.electronAPI\?\.onBeforeQuitFlush\?\.\(\(\) => \{\s*commentDeleteFlushers\.forEach\(\(flush\) => flush\(\)\);\s*return Promise\.allSettled\(\[\.\.\.commentDeletesInFlight\]\)\.then\(\(\) => undefined\);\s*\}\);/);
  const commit = panel.slice(panel.indexOf('const commitDeletedComment = (commentId: string) => {'), panel.indexOf('const handleDelete = (commentId: string) => {'));
  assert.match(commit, /const deletion: Promise<void> = deleteComment\(entry\.targetKey, commentId\)\.then\(/);
  assert.match(commit, /\}\)\.finally\(\(\) => \{\s*commentDeletesInFlight\.delete\(deletion\);\s*\}\);\s*commentDeletesInFlight\.add\(deletion\);/);
  assert.match(panel, /commentDeleteFlushers\.add\(flushAll\);\s*hookCommentDeleteQuitFlush\(\);/);
  assert.match(panel, /commentDeleteFlushers\.delete\(flushAll\);/);
});

test('댓글 패널: 지울 말풍선은 본문 목록에서 직접 찾는다(스레드 칸과 같이 쓰는 commentRefs 아님)', () => {
  const handleDelete = panel.slice(panel.indexOf('const handleDelete = (commentId: string) => {'), panel.indexOf('// 기다리지 않고 바로 지운다'));
  assert.match(handleDelete, /const element = findMainListComment\(scrollRef\.current, commentId\);/);
  assert.doesNotMatch(handleDelete, /commentRefs\.current\.get/);
  // 알림에서 찾아온 댓글로 데려갈 때도 본문 말풍선 먼저
  assert.match(panel, /const el = findMainListComment\(scrollRef\.current, focusCommentId\) \?\? commentRefs\.current\.get\(focusCommentId\);/);
  // 스레드 칸 메시지에는 data-comment-id 가 없다(본문 목록만 찾힌다)
  const threadPane = panel.slice(panel.indexOf('commentRefs.current.set(message.id, el)') - 400, panel.indexOf('commentRefs.current.set(message.id, el)') + 400);
  assert.doesNotMatch(threadPane, /data-comment-id=/);
});

test('댓글 패널: 묶음의 마지막 답글을 지우면 답글 묶음도 같은 그림에서 숨기고, 다시 들어오면 보인다', () => {
  assert.match(panel, /<motion\.div\s+key="replies"\s+data-reply-group=\{comment\.id\}\s+\{\.\.\.bubbleRise\}\s+\{\.\.\.\(replies\.every\(\(reply\) => restoredCommentIdsRef\.current\.has\(reply\.id\)\) \? commentRestore : \{\}\)\}/);
  const collapse = panel.slice(panel.indexOf('const collapseDeletedComment = '), panel.indexOf('/** 밀려나던 말풍선을 제자리로'));
  assert.match(collapse, /const group = element\.closest<HTMLElement>\('\[data-reply-group\]'\);/);
  assert.match(collapse, /\.some\(\(row\) => row !== element && row\.style\.display !== 'none'\);/);
  assert.match(collapse, /if \(group && !othersLeft\) \{\s*reflowHideRef\.current\.push\(group\);\s*hiddenReplyGroupsRef\.current\.push\(group\);\s*\}/);
  // 숨김(다음 그림 직전) 뒤에 FLIP 을 잰다 — 숨긴 묶음은 잰 위치에 들어가지 않는다
  const flip = panel.slice(panel.indexOf("hide.forEach((element) => { element.style.display = 'none'; });"), panel.indexOf('notificationRowShifts(before, measureFlipRows('));
  assert.match(flip, /hiddenReplyGroupsRef\.current = hiddenReplyGroupsRef\.current\.filter\(\(group\) => \{\s*if \(!group\.isConnected\) return false;[\s\S]*?if \(!visible\) return true;\s*group\.style\.display = '';\s*return false;\s*\}\);/);
});

test("댓글 패널: '새 댓글' 줄은 처음 자리를 잡을 때 한 번만 정하고, 읽음은 읽음 기록 시각으로 본다", () => {
  assert.match(panel, /const \[unreadDividerSlot, setUnreadDividerSlot\] = useState<UnreadDividerSlot>\(UNREAD_DIVIDER_UNCAPTURED\);/);
  assert.match(panel, /setUnreadDividerSlot\(\(slot\) => captureUnreadDivider\(\s*slot,\s*firstUnreadComment \? \{ id: firstUnreadComment\.id, createdAt: firstUnreadComment\.createdAt \} : null,\s*\)\);/);
  assert.match(panel, /const unreadDividerRead = isUnreadDividerRead\(unreadDivider, lastReadAt\);/);
  assert.doesNotMatch(panel, /nextUnreadDivider/);
});

test('19번 CSS: 동작 줄이기에서 칩 톡·숫자 굴림·툴팁·이모지 창은 이동·확대 없는 opacity 키프레임으로', () => {
  const block = css.slice(css.indexOf('/* ─── 19. comments-send-react'), css.indexOf('/* ─── 18. notification-journey'));
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\s*\.reaction-chip-pop,\s*\.reaction-count--up,\s*\.reaction-count--down,\s*\.reaction-tooltip,\s*\.emoji-picker-pop \{\s*animation-name: comment-send-fade-in;\s*\}\s*\}/);
  assert.match(block, /@keyframes comment-send-fade-in \{\s*from \{ opacity: 0; \}\s*to \{ opacity: 1; \}\s*\}/);
});

test('댓글 패널: 씬·캐릭터가 바뀔 때만 처음부터 다시, 상대 부서 키만 바뀌면 조용히 다시 불러온다', () => {
  assert.match(panel, /if \(loadIdentityRef\.current !== primaryStorageKey\) \{\s*loadIdentityRef\.current = primaryStorageKey;\s*setLoadStatus\('loading'\);[\s\S]*?setUnreadDividerSlot\(UNREAD_DIVIDER_UNCAPTURED\);\s*setNewBelowCount\(0\);\s*loadComments\(\);\s*return;\s*\}\s*loadComments\(\{ absorbNew: true \}\);\s*\}, \[loadComments, primaryStorageKey\]\);/);
  assert.match(panel, /if \(options\?\.absorbNew\) list\.forEach\(\(c\) => knownCommentIdsRef\.current\.add\(c\.id\)\);/);
});
