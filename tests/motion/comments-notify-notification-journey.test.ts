/**
 * 움직임 폴리싱 18번 `notification-journey` — 알림이 와서 → 열고 → 건너뛰어 → 도착하기까지.
 * 판단·움직임 값(src/utils/notificationArrival.ts)은 동작으로, 화면 배선·CSS 는 소스 가드로 본다.
 * 실제 화면 확인(미리보기): 멘션 실시간 도착 → 종 딩동 + 배지 톡 + 숫자 굴림, 자동 알림 → 배지만, 5개 한꺼번에 → 1회,
 * 쌓인 알림 불러오기 → 반응 없음, 알림 창 0.14초 피어남, 읽음 막대 접힘, 지운 줄 밀려남 + 아래 줄 미끄러짐,
 * 알림 카드 색 막대·아이콘, 돌아가기 밀려 나옴·제목 비켜섬, 리테이크 허브 도착 줄 빛 2회, 동작 줄이기에서 이동 없음.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ARRIVAL_RING_MS,
  BADGE_POP_EASING,
  BADGE_POP_KEYFRAMES,
  BADGE_POP_MS,
  BADGE_POP_THROTTLE_MS,
  BADGE_ROLL_MS,
  BELL_RING_DEGREES,
  BELL_RING_KEYFRAMES,
  BELL_RING_MS,
  BELL_RING_ORIGIN,
  BELL_RING_THROTTLE_MS,
  HIGHLIGHT_SCROLL_ONCE_MS,
  INITIAL_BELL_CLOCK,
  LIVE_ARRIVAL_TTL_MS,
  NOTIFICATION_ROW_EXIT_KEYFRAMES,
  NOTIFICATION_ROW_EXIT_MS,
  NOTIFICATION_ROW_SHIFT_MS,
  arrivalRingKeyframes,
  badgeRollKeyframes,
  claimHighlightScroll,
  highlightScrollKey,
  decideBellReaction,
  isCallingMeNotification,
  markLiveNotificationArrival,
  mergeLiveArrival,
  notificationRowShifts,
  notificationToastClassName,
  playArrivalRing,
  subscribeLiveNotificationArrival,
  takeLiveNotificationArrival,
} from '../../src/utils/notificationArrival.ts';

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const panel = read('src/components/NotificationPanel.tsx');
const helper = read('src/utils/notificationHelper.ts');
const header = read('src/components/layout/Header.tsx');
const hubRow = read('src/views/retake-hub/RetakeHubItemRow.tsx');
const scenesView = read('src/views/ScenesView.tsx');
const unifiedCard = read('src/components/scenes/UnifiedSceneCard.tsx');
const retakeHook = read('src/hooks/useRetakeNotifications.ts');
const app = read('src/App.tsx');
const indexCss = read('src/index.css');
const css = read('src/styles/motion-comments-notify.css');
const journeyCss = css.slice(css.indexOf('/* ─── 18. notification-journey'));

/** 함수 본문(매개변수 괄호가 닫힌 뒤 여는 중괄호부터 짝이 맞는 닫는 중괄호까지). signature 는 '(' 로 끝난다. */
function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} 없음`);
  let paren = 0;
  let close = start + signature.length - 1;
  for (; close < source.length; close += 1) {
    if (source[close] === '(') paren += 1;
    else if (source[close] === ')') {
      paren -= 1;
      if (paren === 0) break;
    }
  }
  const open = source.indexOf('{', close);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`${signature} 본문이 닫히지 않음`);
}

/* ─── 종·배지: 누구에게 반응하나 ─────────────────────────────── */

test('나를 직접 부른 알림(멘션·담당 배정·피드백 요청)만 종을 흔든다', () => {
  for (const type of ['mention', 'acting_feedback', 'scene_assignment']) assert.equal(isCallingMeNotification(type), true, type);
  for (const type of ['comment', 'comment_reaction', 'scene_change', 'revision', 'calendar', 'milestone', 'system']) {
    assert.equal(isCallingMeNotification(type), false, type);
  }
});

test('같은 계정의 신호는 하나로 묶이고, 하나라도 나를 부르면 종을 흔든다', () => {
  const first = mergeLiveArrival(null, 'comment', 'me', 1000);
  assert.deepEqual(first, { callsMe: false, at: 1000, userId: 'me' });
  const merged = mergeLiveArrival(first, 'mention', 'me', 1100);
  assert.deepEqual(merged, { callsMe: true, at: 1100, userId: 'me' });
  assert.equal(mergeLiveArrival(merged, 'comment', 'me', 1200).callsMe, true, '묶인 동안 부름은 지워지지 않는다');
  assert.equal(mergeLiveArrival(merged, 'comment', 'other', 1200).callsMe, false, '다른 계정 신호는 새로 시작');
  assert.equal(mergeLiveArrival(merged, 'comment', 'me', 1100 + LIVE_ARRIVAL_TTL_MS + 1).callsMe, false, '오래된 신호는 새로 시작');
});

test('신호는 한 번만 꺼내지고, 계정이 바뀌었거나 오래되면 버려진다', () => {
  let calls = 0;
  const unsubscribe = subscribeLiveNotificationArrival(() => { calls += 1; });
  try {
    // 5개가 한꺼번에 와도 꺼낼 때는 하나
    for (let i = 0; i < 5; i += 1) markLiveNotificationArrival(i === 2 ? 'mention' : 'scene_change', 'me', 5000 + i);
    assert.equal(calls, 5, '들을 때마다 알린다(처리는 듣는 쪽이 한 번으로 묶는다)');
    assert.deepEqual(takeLiveNotificationArrival('me', 5010), { callsMe: true, at: 5004, userId: 'me' });
    assert.equal(takeLiveNotificationArrival('me', 5011), null, '두 번 꺼내지지 않는다');

    markLiveNotificationArrival('mention', 'me', 6000);
    assert.equal(takeLiveNotificationArrival('someone-else', 6001), null, '계정 전환 직후엔 흔들지 않는다');
    assert.equal(takeLiveNotificationArrival('me', 6002), null, '버린 신호는 남지 않는다');

    markLiveNotificationArrival('mention', 'me', 7000);
    assert.equal(takeLiveNotificationArrival('me', 7000 + LIVE_ARRIVAL_TTL_MS + 1), null, '종이 없을 때 온 오래된 신호는 버린다');
  } finally {
    unsubscribe();
  }
  markLiveNotificationArrival('mention', 'me', 8000);
  assert.equal(calls, 7, '구독을 끊으면 더 듣지 않는다');
  takeLiveNotificationArrival('me', 8000);
});

test('종 흔들림과 배지 톡은 각자 1초에 한 번 — 서로의 제한에 묶이지 않는다', () => {
  assert.equal(BELL_RING_THROTTLE_MS, 1000);
  assert.equal(BADGE_POP_THROTTLE_MS, 1000);
  let clock = INITIAL_BELL_CLOCK;
  const step = (callsMe: boolean, now: number) => {
    const decision = decideBellReaction({ callsMe }, clock, now);
    clock = decision.clock;
    return [decision.ring, decision.pop];
  };
  assert.deepEqual(step(true, 0), [true, true], '멘션: 종 + 배지');
  assert.deepEqual(step(true, 500), [false, false], '1초 안 재도착은 조용히');
  assert.deepEqual(step(false, 1200), [false, true], '자동 알림: 배지만');
  assert.deepEqual(step(true, 1500), [true, false], '종은 마지막 흔들림(0ms) 기준, 배지는 마지막 톡(1200ms) 기준');
  assert.deepEqual(step(false, 2300), [false, true]);
});

/* ─── 움직임 값(사양 수치) ───────────────────────────────────── */

test('종 딩동: rotate 0→18→−14→9→−4→0deg 600ms, 축 50% 15%', () => {
  assert.deepEqual([...BELL_RING_DEGREES], [0, 18, -14, 9, -4, 0]);
  assert.deepEqual(BELL_RING_KEYFRAMES.map((frame) => frame.transform), BELL_RING_DEGREES.map((deg) => `rotate(${deg}deg)`));
  assert.equal(BELL_RING_MS, 600);
  assert.equal(BELL_RING_ORIGIN, '50% 15%');
});

test('배지 톡 1→1.28→1 260ms(넘치는 곡선), 숫자 굴림 70% 150ms — 늘면 아래에서, 줄면 위에서', () => {
  assert.deepEqual(BADGE_POP_KEYFRAMES.map((frame) => frame.transform), ['scale(1)', 'scale(1.28)', 'scale(1)']);
  assert.equal(BADGE_POP_MS, 260);
  assert.equal(BADGE_POP_EASING, 'cubic-bezier(0.18, 0.88, 0.34, 1.28)');
  assert.equal(BADGE_ROLL_MS, 150);
  assert.deepEqual(badgeRollKeyframes('up').map((frame) => frame.transform), ['translateY(70%)', 'translateY(0)']);
  assert.deepEqual(badgeRollKeyframes('down').map((frame) => frame.transform), ['translateY(-70%)', 'translateY(0)']);
});

test('지운 줄은 오른쪽 24px 로 밀려나며 사라지고(150ms), 아래 줄은 220ms 에 미끄러진다', () => {
  assert.deepEqual(NOTIFICATION_ROW_EXIT_KEYFRAMES, [
    { opacity: 1, transform: 'translateX(0)' },
    { opacity: 0, transform: 'translateX(24px)' },
  ]);
  assert.equal(NOTIFICATION_ROW_EXIT_MS, 150);
  assert.equal(NOTIFICATION_ROW_SHIFT_MS, 220);
});

test('아래 줄 FLIP — 지운 줄 높이만큼 되돌렸다 풀고, 묶음 안 줄은 묶음이 움직인 만큼을 뺀다', () => {
  const before = new Map([
    ['n:a', 100], // 지운 줄
    ['n:b', 136],
    ['g:scene:1', 172],
    ['n:c', 210], // 묶음 안
    ['n:d', 246], // 묶음 안
    ['n:e', 300],
  ]);
  const shifts = notificationRowShifts(before, [
    { key: 'n:b', top: 100, parentKey: null },
    { key: 'g:scene:1', top: 136, parentKey: null },
    { key: 'n:c', top: 174, parentKey: 'g:scene:1' },
    { key: 'n:d', top: 210, parentKey: 'g:scene:1' },
    { key: 'n:e', top: 264, parentKey: null },
    { key: 'n:new', top: 400, parentKey: null }, // 지우는 사이 새로 온 줄 — 출발점이 없으니 그대로
  ]);
  assert.deepEqual([...shifts.entries()], [['n:b', 36], ['g:scene:1', 36], ['n:e', 36]]);

  // 묶음 안에서 지웠으면 그 묶음의 아래 줄만 자기 몫을 움직인다.
  const inner = notificationRowShifts(
    new Map([['g:x', 0], ['n:p', 30], ['n:q', 66], ['n:r', 120]]),
    [
      { key: 'g:x', top: 0, parentKey: null },
      { key: 'n:q', top: 30, parentKey: 'g:x' },
      { key: 'n:r', top: 84, parentKey: null },
    ],
  );
  assert.deepEqual([...inner.entries()], [['n:q', 36], ['n:r', 36]]);

  // 묶음이 풀려 낱개가 된 줄(부모 없음)은 절대 이동을 쓴다. 1px 미만은 움직이지 않는다.
  const dissolved = notificationRowShifts(new Map([['n:s', 80], ['n:t', 50]]), [
    { key: 'n:s', top: 44, parentKey: null },
    { key: 'n:t', top: 49.5, parentKey: null },
  ]);
  assert.deepEqual([...dissolved.entries()], [['n:s', 36]]);
});

test('도착 줄 테두리: opacity 0→.9→0→.9→0 1.4초, 동작 줄이기면 1.4초 정지 표시', () => {
  assert.equal(ARRIVAL_RING_MS, 1400);
  assert.deepEqual(arrivalRingKeyframes(false).map((frame) => frame.opacity), [0, 0.9, 0, 0.9, 0]);
  assert.deepEqual(arrivalRingKeyframes(true).map((frame) => frame.opacity), [0.9, 0.9]);
  for (const reduce of [false, true]) {
    assert.ok(arrivalRingKeyframes(reduce).every((frame) => Object.keys(frame).every((key) => key === 'opacity')), '테두리 층의 opacity 만');
  }

  const calls: Array<{ keyframes: Keyframe[]; options: KeyframeAnimationOptions }> = [];
  let cancelled = 0;
  const el = {
    getAnimations: () => [{ cancel: () => { cancelled += 1; } }],
    animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => { calls.push({ keyframes, options }); return {} as Animation; },
  } as unknown as Element;
  playArrivalRing(el, false);
  assert.equal(cancelled, 1, '다시 도착하면 앞 빛을 끊고 처음부터');
  assert.equal(calls[0].options.duration, 1400);
  assert.equal(playArrivalRing(null, false), null);
});

test('알림 카드 클래스는 종류별(bflow-toast--<종류>)', () => {
  assert.equal(notificationToastClassName('mention'), 'bflow-toast--mention');
  assert.equal(notificationToastClassName('acting_feedback'), 'bflow-toast--acting_feedback');
});

/* ─── 배선(소스 가드) ─────────────────────────────────────────── */

test('실시간 수신 경로만 종·배지에 신호를 준다 — 쌓인 알림 불러오기·놓친 알림 모으기는 신호 없음', () => {
  const dispatch = bodyOf(helper, 'export function dispatchNotification(');
  assert.match(dispatch, /const unreadBefore = store\.unreadCount;\n\s*const notificationId = store\.addNotification\(/);
  assert.match(dispatch, /\}\);\n\s*noteLiveNotificationArrival\(payload\.type, unreadBefore\);/);
  const note = bodyOf(helper, 'export function noteLiveNotificationArrival(');
  assert.match(note, /if \(state\.unreadCount > unreadBefore\) markLiveNotificationArrival\(type, state\.activeUserId\);/, '안 읽은 수가 늘었을 때만');
  // 실시간 다시 알림·실시간 반응 알림
  assert.match(retakeHook, /noteLiveNotificationArrival\('revision', unreadBefore\)/);
  assert.match(app, /noteLiveNotificationArrival\('comment_reaction', unreadBefore\)/);
  assert.equal(app.match(/noteLiveNotificationArrival\(/g)?.length, 1, 'App 의 놓친 알림 모으기(addNotification 직접)는 신호를 내지 않는다');
  const store = read('src/stores/useNotificationStore.ts');
  assert.doesNotMatch(store, /markLiveNotificationArrival|noteLiveNotificationArrival/, '디스크 불러오기·계정 전환은 신호 없음');
});

test('종: 실시간 신호를 받아 다음 차례에 한 번 처리 — WAAPI 로 흔들고, 빛 클래스는 그대로', () => {
  const bell = bodyOf(panel, 'export function NotificationBell(');
  assert.match(bell, /subscribeLiveNotificationArrival\(/);
  assert.match(bell, /window\.clearTimeout\(timer\);\n\s*timer = window\.setTimeout\(/, '같은 순간 여러 개는 한 번으로');
  assert.match(bell, /takeLiveNotificationArrival\(state\.activeUserId\)/);
  assert.match(bell, /animateEl\(ringRef\.current, BELL_RING_KEYFRAMES, \{ duration: BELL_RING_MS, easing: 'ease-out' \}, reduceRef\.current\)/);
  assert.match(bell, /animateEl\(badgeRef\.current, BADGE_POP_KEYFRAMES/);
  assert.match(bell, /rollBadgeNumber\('up'\)/);
  assert.match(bell, /if \(previous\.userId !== activeUserId\) return;/, '계정 전환 땐 숫자도 그냥 바뀐다');
  assert.match(bell, /style=\{\{ transformOrigin: BELL_RING_ORIGIN \}\}/);
  assert.match(bell, /'bf-press p-2 rounded-lg relative cursor-pointer'/, '버튼 누름 반응 그대로');
  assert.match(bell, /!panelOpen && hasUnread && !hasMention && 'bell-glow-soft'/, '종 주변 은은한 빛 그대로');
  assert.match(bell, /!panelOpen && hasMention && 'bell-glow-mention'/);
  assert.doesNotMatch(bell, /classList\.(add|remove|toggle)/, '클래스 토글로 애니메이션을 켜지 않는다');
});

test('알림 창: 종 아래(오른쪽 위)에서 0.14초 피어남 — motion.ts 프리셋, 흐림 없는 판, 닫힘은 바로', () => {
  assert.match(panel, /const PANEL_POP = transformPreset\(\{ from: PANEL_POP_FROM, duration: 140 \}\);/);
  assert.match(panel, /const PANEL_POP_FROM = 'translateY\(-4px\) scale\(0\.97\)';/);
  assert.match(panel, /\{\.\.\.\(reduce \? PANEL_POP_REDUCED : PANEL_POP\)\}/);
  assert.match(panel, /transformOrigin: 'top right'/);
  assert.match(panel, /backdropFilter: 'none'/);
  assert.match(panel, /background: 'rgb\(var\(--color-bg-card\) \/ 0\.985\)'/);
  assert.match(panel, /\.\.\.panelSolidStyle,/);
  assert.match(panel, /\{panelOpen && <NotificationDropdown \/>\}/, '닫힘은 바로(AnimatePresence 없이)');
  assert.doesNotMatch(panel, /AnimatePresence/);
});

test('알림 창 줄: 읽음 막대는 색 고정 + 클래스로 접힘, 지우기는 밀어낸 뒤 실제로 지우고 아래 줄 FLIP', () => {
  const item = bodyOf(panel, 'function NotificationItem(');
  assert.match(item, /data-noti-read=\{n\.isRead \? 'true' : 'false'\}/);
  assert.match(item, /className="bf-noti-unread-bar /);
  assert.doesNotMatch(item, /backgroundColor: n\.isRead/, '읽음이 색을 투명으로 바꾸지 않는다(막대가 접힌다)');
  assert.match(item, /onRemove\(n\.id, rowRef\.current\)/);
  assert.doesNotMatch(item, /removeNotification\(/);

  const dropdown = bodyOf(panel, 'function NotificationDropdown(');
  assert.match(dropdown, /animateEl\(\n\s*row,\n\s*NOTIFICATION_ROW_EXIT_KEYFRAMES,\n\s*\{ duration: NOTIFICATION_ROW_EXIT_MS, easing: EASE_CSS\.in, fill: 'forwards' \},\n\s*reduce,\n\s*\)/);
  assert.match(dropdown, /window\.setTimeout\(commit, duration\)/);
  assert.match(dropdown, /removeNotification\(id\);/);
  assert.match(dropdown, /notificationRowShifts\(before, measureNotificationRows\(list\)\)/);
  assert.match(dropdown, /\{ duration: NOTIFICATION_ROW_SHIFT_MS, easing: EASE_CSS\.out \}/);
  assert.match(dropdown, /className="overflow-y-auto overflow-x-hidden p-1\.5 space-y-0\.5"/, '밀려나는 동안 가로 스크롤바 없음');
  assert.match(panel, /data-noti-flip=\{`g:\$\{group\.key\}`\}/);
  assert.match(panel, /data-noti-flip=\{`n:\$\{n\.id\}`\}/);
});

test('읽음 막대 CSS: scaleY + opacity 200ms(색 전환 아님)', () => {
  assert.match(journeyCss, /\.bf-noti-unread-bar \{\n\s*transform-origin: 50% 50%;\n\s*transition: transform 200ms var\(--ease-std\), opacity 200ms var\(--ease-std\);/);
  assert.match(journeyCss, /\[data-noti-read="true"\] > \.bf-noti-unread-bar \{\n\s*transform: scaleY\(0\);\n\s*opacity: 0;/);
});

test('알림 카드: 흐림 없음, 움직임은 동작 줄이기가 꺼졌을 때만, 퇴장 0.2초, 종류별 색 막대·아이콘', () => {
  const toastBlock = indexCss.slice(indexCss.indexOf('[data-sonner-toaster] [data-sonner-toast].bflow-toast {'), indexCss.indexOf('/* ─── Sonner 액션 버튼'));
  assert.doesNotMatch(toastBlock, /backdrop-filter/, '쌓이며 움직이는 카드에 흐림 없음');
  // 흐림이 없으면 뒤 글자가 또렷이 비쳐 .97 이 아니라 .985(사양 .97 에서 올림 — 대시보드 글자가 비쳤다)
  assert.match(toastBlock, /background: rgb\(var\(--color-bg-card\) \/ 0\.985\) !important;/);
  assert.match(toastBlock, /box-shadow:\n\s*inset 3px 0 0 0 var\(--bflow-toast-tone, transparent\),/);
  const motionBlock = toastBlock.slice(toastBlock.indexOf('@media (prefers-reduced-motion: no-preference) {'));
  assert.ok(toastBlock.includes('@media (prefers-reduced-motion: no-preference) {'), '움직임 규칙은 no-preference 안');
  assert.match(motionBlock, /\[data-sonner-toaster\] \[data-sonner-toast\] \{\n\s*transition: transform 0\.35s/);
  assert.match(motionBlock, /animation: bflow-toast-fade-out 0\.2s/);
  assert.equal(toastBlock.slice(0, toastBlock.indexOf('@media')).match(/transition:|animation:/g), null, '미디어 밖에 움직임 규칙 없음');

  assert.match(journeyCss, /\[data-sonner-toast\]\.bflow-toast--mention,\n\[data-sonner-toast\]\.bflow-toast--scene_assignment,/);
  assert.match(journeyCss, /--bflow-toast-tone: rgb\(var\(--color-accent\)\);/);
  assert.match(journeyCss, /\.bflow-toast--acting_feedback \{ --bflow-toast-tone: #FDCB6E; \}/);
  assert.match(journeyCss, /\.bflow-toast--calendar,/);
  assert.match(journeyCss, /--bflow-toast-tone: #74B9FF;/);
  assert.match(journeyCss, /@media \(prefers-reduced-motion: reduce\) \{\n\s*\[data-sonner-toaster\] \[data-sonner-toast\]\.bflow-toast\[data-mounted="true"\] \{\n\s*animation: bflow-toast-fade-in 120ms/);
  assert.match(journeyCss, /@keyframes bflow-toast-calm-out \{\n\s*from \{ opacity: 1; \}\n\s*to \{ opacity: 0; \}/, '동작 줄이기 퇴장은 opacity 만');

  assert.match(helper, /\.\.\.notificationToastDecor\(payload\.type\),/);
  assert.match(helper, /createElement\(visual\.icon, \{ size: 16, style: \{ color: visual\.color \}, 'aria-hidden': true \}\)/);
  assert.match(retakeHook, /\.\.\.notificationToastDecor\('revision'\),/);
});

test('돌아가기: 왼쪽에서 밀려 나오고(160ms), 제목은 스르륵 비켜선다(180ms snap, FLIP)', () => {
  assert.match(header, /'bf-back-in',/);
  assert.equal(header.match(/bf-press/g)?.length, 3, '누름 반응 버튼 수 그대로');
  assert.match(header, /<h1 ref=\{titleRef\} className="truncate text-lg font-semibold">/);
  assert.match(header, /titleLeftBeforeRef\.current = titleRef\.current\.offsetLeft;/, '바뀌기 직전 자리는 렌더 단계에서');
  assert.match(header, /\[\{ transform: `translateX\(\$\{shift\}px\)` \}, \{ transform: 'translateX\(0\)' \}\],\n\s*\{ duration: MOTION_MS\.base, easing: EASE_CSS\.snap \},\n\s*reduce,/);
  assert.match(journeyCss, /\.bf-back-in \{\n\s*animation: bf-back-in 160ms var\(--ease-out\) backwards;/);
  assert.match(journeyCss, /from \{ opacity: 0; transform: translateX\(-6px\); \}/);
});

test('리테이크 허브 도착 줄: 미리 그린 테두리 층의 opacity 만, 다시 도착하면 다시, 동작 줄이기면 바로 이동', () => {
  assert.match(hubRow, /<span ref=\{arrivalRingRef\} className="bf-arrive-ring" aria-hidden \/>/);
  assert.match(hubRow, /playArrivalRing\(arrivalRingRef\.current, reduce\);/);
  assert.match(hubRow, /behavior: reduce \? 'auto' : 'smooth'/);
  assert.match(hubRow, /\}, \[focused, focusToken\]\);/);
  assert.match(journeyCss, /\.bf-arrive-ring \{[^}]*box-shadow: inset 0 0 0 2px rgb\(var\(--color-accent\)\);[^}]*opacity: 0;/);
  assert.doesNotMatch(journeyCss, /@keyframes[^{]*\{[^}]*box-shadow/, '테두리를 키프레임으로 다시 칠하지 않는다');
});

test('강조 카드로 데려다주기는 같은 강조에 한 번 — 카드가 다시 마운트돼도 다시 끌어당기지 않는다', () => {
  assert.equal(HIGHLIGHT_SCROLL_ONCE_MS, 4000, '씬 목록 강조 자동 해제(4초)와 같다');
  assert.equal(claimHighlightScroll('a006', 100_000), true, '처음 강조 → 데려다준다');
  assert.equal(claimHighlightScroll('a006', 100_500), false, '같은 강조 중 다시 마운트 → 그대로');
  assert.equal(claimHighlightScroll('a007', 101_000), true, '다른 씬 강조 → 데려다준다');
  assert.equal(claimHighlightScroll('a006', 102_000), true, '다른 강조를 거친 뒤엔 다시');
  assert.equal(claimHighlightScroll('a006', 102_000 + HIGHLIGHT_SCROLL_ONCE_MS), true, '강조가 끝난 뒤 같은 씬을 다시 강조 → 다시');
  // 다른 파트의 같은 번호 씬은 다른 강조
  const at = 200_000;
  assert.equal(claimHighlightScroll(highlightScrollKey(['EP05_A_BG'], 'a001'), at), true);
  assert.equal(claimHighlightScroll(highlightScrollKey(['EP05_B_BG'], 'a001'), at + 500), true, '다른 파트의 a001 → 데려다준다');
  assert.equal(claimHighlightScroll(highlightScrollKey(['EP05_B_BG'], 'a001'), at + 800), false, '같은 파트의 같은 강조 → 그대로');
  assert.notEqual(highlightScrollKey(['EP05_A_BG', null], 'a001'), highlightScrollKey([null, 'EP05_A_BG'], 'a001'));
});

test('씬 목록 강조 카드: 인라인 ref 콜백 대신 효과에서 한 번, 동작 줄이기면 바로', () => {
  // framer motion.div 는 처음 받은 ref 콜백만 쓰므로, 예전 방식은 이미 떠 있던 카드가 강조되면 데려가지 못했다.
  assert.doesNotMatch(scenesView, /ref=\{isHighlighted \? \(el\) => el\?\.scrollIntoView/);
  const card = bodyOf(scenesView, 'function SceneCard(');
  // 열쇠에 파트(시트) 이름을 함께 — 다른 파트의 같은 번호 씬으로 이어 건너뛰어도 데려다준다(리뷰 반영)
  assert.match(card, /if \(isHighlighted && !wasHighlightedRef\.current && claimHighlightScroll\(highlightScrollKey\(\[sheetName\], scene\.sceneId\)\)\) \{\n\s*highlightCardRef\.current\?\.scrollIntoView\(\{ behavior: prefersReducedMotion\(\) \? 'auto' : 'smooth', block: 'center' \}\);/);
  assert.match(card, /ref=\{highlightCardRef\}/);
  assert.match(unifiedCard, /claimHighlightScroll\(highlightScrollKey\(\[bgSheetName, actSheetName\], primaryScene\?\.sceneId \?\? ''\)\)/);
  assert.match(unifiedCard, /cardRootRef\.current\?\.scrollIntoView\(\{ behavior: prefersReducedMotion\(\) \? 'auto' : 'smooth', block: 'center' \}\)/);
});
