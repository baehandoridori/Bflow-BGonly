import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CARD_CASCADE_DURATION_MS,
  CARD_CASCADE_WINDOW_MS,
  COMPOSITING_EP_SWAP,
  DASHBOARD_CONTENT_KEYFRAMES,
  DASHBOARD_CONTENT_SWAP_MS,
  INITIAL_SWAP_GATE,
  RAPID_SWAP_MS,
  SCENE_GROUP_SWAP,
  VIEW_REVEAL_KEYFRAMES,
  VIEW_REVEAL_MS,
  VIEW_REVEAL_REDUCED_MS,
  VIEW_SPINNER_DELAY_MS,
  cardCascadeClass,
  cardCascadeDelayMs,
  cardCascadeStyle,
  compareSceneLocation,
  createGroupSwapController,
  createRapidGate,
  dashboardBoardIdentity,
  episodeDirection,
  groupSwapKeyframes,
  holdOverflowHidden,
  isRapidSwap,
  nextCascadeArm,
  parseSceneGroupKey,
  planViewReveal,
  sceneGroupKey,
  shouldSkipViewReveal,
  stepSwapGate,
  swapOverflowGuard,
  viewRevealTiming,
  type CascadeArm,
  type GroupSwapRequest,
  type SwapGate,
} from '../../src/utils/viewTransitionMotion.ts';
import { EASE_CSS } from '../../src/utils/motion.ts';

/* 움직임 폴리싱 12번 — 화면·파트·에피소드를 바꿀 때 한 덩어리로 스르륵(+대시보드 탭은 판 그대로 내용만). */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ─── 순수 규칙 ─────────────────────────────────────────────── */

test('화면 덮개: 0.18초 out 곡선으로 opacity 1→0 만, 동작 줄이기는 0.12초', () => {
  assert.equal(VIEW_REVEAL_MS, 180);
  assert.equal(VIEW_REVEAL_REDUCED_MS, 120);
  assert.deepEqual(VIEW_REVEAL_KEYFRAMES, [{ opacity: 1 }, { opacity: 0 }]);
  // 덮개는 opacity 만 움직인다(위치·크기 없음).
  for (const frame of VIEW_REVEAL_KEYFRAMES) assert.deepEqual(Object.keys(frame), ['opacity']);
  assert.deepEqual(viewRevealTiming(false), { duration: 180, easing: EASE_CSS.out });
  assert.deepEqual(viewRevealTiming(true), { duration: 120, easing: EASE_CSS.out });
});

test('로딩 동그라미는 0.25초를 넘길 때만', () => {
  assert.equal(VIEW_SPINNER_DELAY_MS, 250);
});

test('덮개 생략: 첫 화면·배플레이그라운드·들어가자마자 창을 여는 경우(씬 창·캐릭터 상세)', () => {
  const base = { view: 'assignee', isFirstView: false, pendingDeepLink: null, pendingSceneModalRequest: null };
  assert.equal(shouldSkipViewReveal(base), false);
  assert.equal(shouldSkipViewReveal({ ...base, isFirstView: true }), true, '앱 첫 진입은 첫 진입 연출 몫');
  assert.equal(shouldSkipViewReveal({ ...base, view: 'playground' }), true);
  assert.equal(shouldSkipViewReveal({ ...base, view: 'scenes' }), false, '그냥 씬 목록으로 가면 덮개');
  assert.equal(shouldSkipViewReveal({ ...base, view: 'scenes', pendingSceneModalRequest: { sceneUuid: 'x' } }), true);
  assert.equal(shouldSkipViewReveal({ ...base, view: 'scenes', pendingDeepLink: { sheetName: 's', sceneId: 'a001' } }), true);
  // 씬 창 요청은 씬 목록으로 갈 때만 의미가 있다.
  assert.equal(shouldSkipViewReveal({ ...base, view: 'dashboard', pendingSceneModalRequest: { sceneUuid: 'x' } }), false);
  // 검색·위젯에서 캐릭터 상세 창을 바로 여는 경우도 창이 덮개에 가리지 않게.
  assert.equal(shouldSkipViewReveal({ ...base, view: 'character-board', pendingCharacterBoardRequest: { characterId: 'c1' } }), true);
  assert.equal(shouldSkipViewReveal({ ...base, view: 'character-board' }), false);
  assert.equal(shouldSkipViewReveal({ ...base, view: 'scenes', pendingCharacterBoardRequest: { characterId: 'c1' } }), false);
});

test('화면 신호 처리: 같은 화면 재신호는 무시, 첫 화면은 스크롤·덮개 그대로, 다른 화면은 스크롤 맨 위 + 덮개', () => {
  const none = { pendingDeepLink: null, pendingSceneModalRequest: null, pendingCharacterBoardRequest: null };
  assert.equal(planViewReveal('assignee', 'assignee', none), null, 'StrictMode 이중 실행에도 한 번만');
  assert.deepEqual(planViewReveal(null, 'dashboard', none), { resetScroll: false, reveal: false }, '첫 화면은 첫 진입 연출 몫');
  assert.deepEqual(planViewReveal('dashboard', 'assignee', none), { resetScroll: true, reveal: true });
  // 알림 링크로 씬 창을 바로 열어도 이전 화면 스크롤은 맨 위로 돌린다(덮개만 생략).
  assert.deepEqual(
    planViewReveal('dashboard', 'scenes', { ...none, pendingSceneModalRequest: { sceneUuid: 'x' } }),
    { resetScroll: true, reveal: false },
  );
  assert.deepEqual(planViewReveal('dashboard', 'playground', none), { resetScroll: true, reveal: false });
});

test('카드 차례 등장: 20ms 간격, 마지막 카드도 0.2초 안에 출발 → 0.4초면 모두 도착', () => {
  assert.equal(cardCascadeDelayMs(0), 0);
  assert.equal(cardCascadeDelayMs(1), 20);
  assert.equal(cardCascadeDelayMs(5), 100);
  assert.equal(cardCascadeDelayMs(10), 200);
  assert.equal(cardCascadeDelayMs(19), 200, '20명이어도 마지막 지연은 0.2초');
  assert.equal(cardCascadeDelayMs(-3), 0);
  assert.equal(cardCascadeDelayMs(Number.NaN), 0);
  assert.equal(cardCascadeDelayMs(19) + CARD_CASCADE_DURATION_MS, 400);
  assert.deepEqual(cardCascadeStyle(3), { animationDelay: '60ms' });
});

test('연타 판정: 300ms 안에 다시 바꾸면 연출 생략, 첫 전환과 뜸한 전환은 연출', () => {
  assert.equal(RAPID_SWAP_MS, 300);
  assert.equal(isRapidSwap(1000, Number.NEGATIVE_INFINITY), false, '처음');
  assert.equal(isRapidSwap(1299, 1000), true);
  assert.equal(isRapidSwap(1300, 1000), false, '딱 300ms 면 연타가 아니다');
  const gate = createRapidGate();
  assert.equal(gate.hit(1000), false, '첫 전환');
  assert.equal(gate.hit(1100), true);
  assert.equal(gate.hit(1350), true, '연타 중에는 마지막 전환 기준');
  assert.equal(gate.hit(1700), false, '잠시 쉬면 다시 연출');
});

test('키 전환 판정(stepSwapGate): 처음 키는 그대로, 연타·skip 은 바로, 그 밖엔 연출', () => {
  const never = () => { throw new Error('연타면 skip 을 묻지 않는다'); };
  let gate: SwapGate = INITIAL_SWAP_GATE;
  // 처음 정해지는 키는 움직이지 않는다(덮개·첫 진입 연출 몫) — 시각도 기록하지 않는다.
  let step = stepSwapGate(gate, '5|A', 1000);
  assert.equal(step.decision, 'none');
  assert.deepEqual(step.gate, { key: '5|A', at: Number.NEGATIVE_INFINITY });
  gate = step.gate;
  // 같은 키 재실행(StrictMode·다른 상태 변경)은 아무것도 하지 않는다.
  step = stepSwapGate(gate, '5|A', 1010);
  assert.equal(step.decision, 'none');
  assert.equal(step.gate, gate);
  // 바뀌면 연출, 이전·새 키를 넘긴다.
  step = stepSwapGate(gate, '5|B', 1050);
  assert.deepEqual(step, { gate: { key: '5|B', at: 1050 }, decision: 'animate', from: '5|A', to: '5|B' });
  gate = step.gate;
  // 300ms 안에 다시 → 바로(연타 중엔 skip 을 묻지 않는다).
  step = stepSwapGate(gate, '5|C', 1200, never);
  assert.equal(step.decision, 'instant');
  assert.deepEqual(step.gate, { key: '5|C', at: 1200 });
  gate = step.gate;
  step = stepSwapGate(gate, '5|D', 1450, never);
  assert.equal(step.decision, 'instant', '연타 중에는 마지막 전환 기준');
  gate = step.gate;
  // 쉬었다가 바꿔도 skip 이 true 면 바로.
  step = stepSwapGate(gate, '6|A', 2000, () => true);
  assert.equal(step.decision, 'instant');
  gate = step.gate;
  step = stepSwapGate(gate, '6|B', 2400, () => false);
  assert.equal(step.decision, 'animate');
  gate = step.gate;
  // 키가 사라졌다 다시 생기면(에피소드 없음 → 있음) 처음처럼 그대로.
  step = stepSwapGate(gate, null, 3000);
  assert.equal(step.decision, 'none');
  gate = step.gate;
  step = stepSwapGate(gate, '7|A', 3500);
  assert.equal(step.decision, 'none');
});

test('방향: 다음 에피소드·뒤 파트는 오른쪽(1), 이전은 왼쪽(-1), 같으면 0', () => {
  assert.equal(compareSceneLocation({ episode: 5, part: 'C' }, { episode: 6, part: 'A' }), 1);
  assert.equal(compareSceneLocation({ episode: 6, part: 'A' }, { episode: 5, part: 'D' }), -1);
  assert.equal(compareSceneLocation({ episode: 5, part: 'A' }, { episode: 5, part: 'B' }), 1);
  assert.equal(compareSceneLocation({ episode: 5, part: 'C' }, { episode: 5, part: 'B' }), -1);
  assert.equal(compareSceneLocation({ episode: 5, part: 'a' }, { episode: 5, part: 'A' }), 0, '대소문자만 다른 같은 파트');
  assert.equal(compareSceneLocation({ episode: 5, part: null }, { episode: 5, part: 'A' }), 0, '모르면 방향 없음');
  assert.equal(episodeDirection(5, 6), 1);
  assert.equal(episodeDirection(6, 5), -1);
  assert.equal(episodeDirection(5, 5), 0);
  assert.equal(episodeDirection(null, 5), 0);
});

test('씬 목록 묶음 키: 에피소드가 없으면 null(움직이지 않음), 파트 이름에 | 가 있어도 되돌린다', () => {
  assert.equal(sceneGroupKey(null, 'A'), null);
  assert.equal(sceneGroupKey(undefined, 'A'), null);
  assert.equal(sceneGroupKey(5, 'A'), '5|A');
  assert.equal(sceneGroupKey(5, null), '5|');
  assert.deepEqual(parseSceneGroupKey('5|A'), { episode: 5, part: 'A' });
  assert.deepEqual(parseSceneGroupKey('5|'), { episode: 5, part: null });
  assert.deepEqual(parseSceneGroupKey('12|A|B'), { episode: 12, part: 'A|B' });
});

/* ─── 묶음 미끄러짐 상태 기계(createGroupSwapController) ─────────── */

interface FakeAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  cancelled: boolean;
  onfinish: (() => void) | null;
  cancel(): void;
}

function fakeEl() {
  const animations: FakeAnimation[] = [];
  return {
    animations,
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const animation: FakeAnimation = {
        keyframes,
        options,
        cancelled: false,
        onfinish: null,
        cancel() { this.cancelled = true; },
      };
      animations.push(animation);
      return animation;
    },
  };
}

type Metrics = { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number };

function fakeBox(metrics: Metrics, overflowX = '') {
  return { ...metrics, style: { overflowX, overflowY: '' } };
}

/** 가로·세로 모두 넘치지 않는 스크롤 상자(카드 몇 장). */
const FITS: Metrics = { scrollWidth: 800, clientWidth: 800, scrollHeight: 400, clientHeight: 542 };
const sceneDir = (prev: string, next: string) => compareSceneLocation(parseSceneGroupKey(prev), parseSceneGroupKey(next));

function swapRequest(el: ReturnType<typeof fakeEl>, box: ReturnType<typeof fakeBox> | null, extra: Partial<GroupSwapRequest> = {}): GroupSwapRequest {
  return {
    el: el as unknown as Element,
    direction: sceneDir,
    distancePx: SCENE_GROUP_SWAP.distancePx,
    durationMs: SCENE_GROUP_SWAP.durationMs,
    overflowBox: () => box,
    reduce: false,
    ...extra,
  };
}

test('묶음 미끄러짐: 다음 파트는 오른쪽에서 들어오는 동안만 스크롤 상자 가로 넘침을 숨기고, 끝나면 되돌린다', () => {
  const el = fakeEl();
  const box = fakeBox(FITS);
  const swap = createGroupSwapController();
  assert.equal(swap.update('5|A', 0, swapRequest(el, box)), 'none', '처음 키');
  assert.equal(el.animations.length, 0);
  assert.equal(swap.update('5|B', 1000, swapRequest(el, box)), 'animate');
  assert.equal(el.animations.length, 1);
  assert.deepEqual(el.animations[0].keyframes[0], { opacity: 0, transform: 'translateX(10px)' });
  assert.equal(el.animations[0].options.duration, 180);
  assert.equal('fill' in el.animations[0].options, false, '끝값(transform)을 남기지 않는다');
  assert.equal(box.style.overflowX, 'hidden', '오른쪽으로 밀린 10px 이 가로 스크롤바를 만들지 않게');
  assert.equal(box.style.overflowY, '', '세로 스크롤은 그대로');
  el.animations[0].onfinish?.();
  assert.equal(box.style.overflowX, '', '끝나면 원래대로(넓은 시트는 다시 가로 스크롤)');
});

test('묶음 미끄러짐: 이전 파트(왼쪽에서)·이미 가로로 넘치는 시트·동작 줄이기는 넘침을 건드리지 않는다', () => {
  // 이전 파트: 왼쪽으로 밀린 부분은 스크롤 영역이 아니다.
  let el = fakeEl();
  let box = fakeBox(FITS);
  let swap = createGroupSwapController();
  swap.update('5|B', 0, swapRequest(el, box));
  assert.equal(swap.update('5|A', 1000, swapRequest(el, box)), 'animate');
  assert.deepEqual(el.animations[0].keyframes[0], { opacity: 0, transform: 'translateX(-10px)' });
  assert.equal(box.style.overflowX, '');

  // 이미 가로 스크롤바가 있는 넓은 시트: 숨기면 오히려 스크롤바가 사라졌다 돌아온다.
  el = fakeEl();
  box = fakeBox({ ...FITS, scrollWidth: 1400 });
  swap = createGroupSwapController();
  swap.update('5|A', 0, swapRequest(el, box));
  swap.update('5|B', 1000, swapRequest(el, box));
  assert.equal(el.animations.length, 1);
  assert.equal(box.style.overflowX, '');

  // 동작 줄이기: 위치가 움직이지 않으니 opacity 만 0.12초, 넘침은 그대로.
  el = fakeEl();
  box = fakeBox(FITS);
  swap = createGroupSwapController();
  swap.update('5|A', 0, swapRequest(el, box, { reduce: true }));
  swap.update('5|B', 1000, swapRequest(el, box, { reduce: true }));
  assert.deepEqual(el.animations[0].keyframes, [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(el.animations[0].options.duration, 120);
  assert.equal(box.style.overflowX, '');
});

test('묶음 미끄러짐: 방향을 모를 때(아래에서 6px)는 세로 넘침을, 이미 세로로 넘치면 그대로', () => {
  const el = fakeEl();
  const box = fakeBox(FITS);
  const swap = createGroupSwapController();
  swap.update('5|', 0, swapRequest(el, box));
  swap.update('5|A', 1000, swapRequest(el, box));
  assert.deepEqual(el.animations[0].keyframes[0], { opacity: 0, transform: 'translateY(6px)' });
  assert.equal(box.style.overflowY, 'hidden');
  assert.equal(box.style.overflowX, '');
  el.animations[0].onfinish?.();
  assert.equal(box.style.overflowY, '');
  assert.equal(swapOverflowGuard(0, { ...FITS, scrollHeight: 900 }, false), null, '이미 세로 스크롤바가 있으면 그대로');
  assert.equal(swapOverflowGuard(1, FITS, false), 'x');
  assert.equal(swapOverflowGuard(-1, FITS, false), null);
  assert.equal(swapOverflowGuard(1, FITS, true), null);
});

test('묶음 미끄러짐: 연타면 돌던 움직임을 끊고 숨긴 넘침을 그 자리에서 되돌린 뒤 바로 바꾼다', () => {
  const el = fakeEl();
  const box = fakeBox(FITS, 'auto');
  const swap = createGroupSwapController();
  swap.update('5|A', 0, swapRequest(el, box));
  swap.update('5|B', 1000, swapRequest(el, box));
  assert.equal(box.style.overflowX, 'hidden');
  assert.equal(swap.update('5|C', 1100, swapRequest(el, box)), 'instant');
  assert.equal(el.animations[0].cancelled, true);
  assert.equal(el.animations.length, 1, '연타엔 새 움직임 없음');
  assert.equal(box.style.overflowX, 'auto', 'cancel 이벤트를 기다리지 않고 원래 인라인 값으로');
});

test('묶음 미끄러짐: 앞 움직임의 늦은 끝 신호가 다음 움직임의 넘침 숨김을 풀지 않는다', () => {
  const el = fakeEl();
  const box = fakeBox(FITS);
  const swap = createGroupSwapController();
  swap.update('5|A', 0, swapRequest(el, box));
  swap.update('5|B', 1000, swapRequest(el, box));
  const first = el.animations[0];
  // 쉬었다가 다음 파트 — 앞 움직임은 끊기고 새 움직임이 넘침을 다시 숨긴다.
  swap.update('5|C', 1500, swapRequest(el, box));
  assert.equal(first.cancelled, true);
  assert.equal(el.animations.length, 2);
  assert.equal(box.style.overflowX, 'hidden');
  first.onfinish?.();
  assert.equal(box.style.overflowX, 'hidden', '앞 움직임이 뒤늦게 끝나도 지금 움직임의 숨김은 그대로');
  el.animations[1].onfinish?.();
  assert.equal(box.style.overflowX, '');
});

test('묶음 미끄러짐: skip(씬 창이 열린 중)이면 바로, 화면을 떠나면 돌던 움직임과 숨김을 정리', () => {
  const el = fakeEl();
  const box = fakeBox(FITS);
  const swap = createGroupSwapController();
  swap.update('5|A', 0, swapRequest(el, box));
  assert.equal(swap.update('5|B', 1000, swapRequest(el, box, { skip: () => true })), 'instant');
  assert.equal(el.animations.length, 0);
  assert.equal(box.style.overflowX, '');
  swap.update('5|C', 2000, swapRequest(el, box));
  assert.equal(box.style.overflowX, 'hidden');
  swap.dispose();
  assert.equal(el.animations[0].cancelled, true);
  assert.equal(box.style.overflowX, '');
});

test('묶음 미끄러짐: 스크롤 상자를 주지 않으면(컴포지팅 — 패딩이 흡수) 넘침을 묻지도 않는다', () => {
  const el = fakeEl();
  const swap = createGroupSwapController();
  const request = { ...swapRequest(el, null), overflowBox: undefined, direction: (a: string, b: string) => episodeDirection(Number(a), Number(b)), distancePx: 16, durationMs: 240 };
  swap.update('5', 0, request);
  assert.equal(swap.update('6', 1000, request), 'animate');
  assert.deepEqual(el.animations[0].keyframes[0], { opacity: 0, transform: 'translateX(16px)' });
  assert.equal(el.animations[0].options.duration, 240);
});

test('넘침 숨김: 원래 인라인 값으로 한 번만 되돌린다', () => {
  const box = fakeBox(FITS, 'scroll');
  const release = holdOverflowHidden(box, 'x');
  assert.equal(box.style.overflowX, 'hidden');
  release();
  assert.equal(box.style.overflowX, 'scroll');
  box.style.overflowX = 'clip';
  release();
  assert.equal(box.style.overflowX, 'clip', '두 번째 호출은 아무것도 하지 않는다');
});

test('컴포지팅 cascade 켜짐: 처음 EP·↻ 직후에만, EP 를 바꾸면 ↻ 전까지 꺼진다', () => {
  let arm: CascadeArm = nextCascadeArm(null, 0, null);
  assert.deepEqual(arm, { key: 0, ep: null, armed: true }, '마지막 본 EP 를 불러오기 전');
  assert.equal(nextCascadeArm(arm, 0, null), arm, 'EP 가 아직 없으면 그대로');
  arm = nextCascadeArm(arm, 0, 5);
  assert.deepEqual(arm, { key: 0, ep: 5, armed: true }, '처음 정해진 EP 는 cascade');
  assert.equal(nextCascadeArm(arm, 0, 5), arm, '그대로면 같은 객체');
  arm = nextCascadeArm(arm, 0, 6);
  assert.equal(arm.armed, false, 'EP 를 바꾸면 카드 영역 한 덩어리만 움직인다');
  arm = nextCascadeArm(arm, 0, 5);
  assert.equal(arm.armed, false, '원래 EP 로 돌아와도 꺼진 채');
  arm = nextCascadeArm(arm, 1, 5);
  assert.deepEqual(arm, { key: 1, ep: 5, armed: true }, '↻ 를 누르면 다시 cascade');
  assert.deepEqual(nextCascadeArm(null, 3, 7), { key: 3, ep: 7, armed: true });
});

test('묶음 미끄러짐 키프레임: 다음은 오른쪽에서, 이전은 왼쪽에서, 끝은 제자리(translate 0) · opacity 0→1', () => {
  assert.deepEqual(groupSwapKeyframes(1, 16), [
    { opacity: 0, transform: 'translateX(16px)' },
    { opacity: 1, transform: 'translateX(0px)' },
  ]);
  assert.deepEqual(groupSwapKeyframes(-1, 10), [
    { opacity: 0, transform: 'translateX(-10px)' },
    { opacity: 1, transform: 'translateX(0px)' },
  ]);
  assert.deepEqual(groupSwapKeyframes(0, 16)[0], { opacity: 0, transform: 'translateY(6px)' });
  // 사양: 컴포지팅 EP ±16px 240ms, 씬 목록은 6~16px 안에서 보통 박자.
  assert.deepEqual(COMPOSITING_EP_SWAP, { distancePx: 16, durationMs: 240 });
  assert.ok(SCENE_GROUP_SWAP.distancePx >= 6 && SCENE_GROUP_SWAP.distancePx <= 16);
  assert.equal(SCENE_GROUP_SWAP.durationMs, 180);
});

test('대시보드: 같은 레이아웃끼리는 같은 판(배경↔액팅, 에피소드↔에피소드), 내용만 0.18초 opacity', () => {
  assert.equal(dashboardBoardIdentity(false, 'all'), 'all');
  assert.equal(dashboardBoardIdentity(false, 'bg'), 'dept');
  assert.equal(dashboardBoardIdentity(false, 'acting'), 'dept');
  assert.equal(dashboardBoardIdentity(true, 'all'), 'ep');
  assert.equal(dashboardBoardIdentity(true, 'bg'), 'ep');
  assert.equal(DASHBOARD_CONTENT_SWAP_MS, 180);
  assert.deepEqual(DASHBOARD_CONTENT_KEYFRAMES, [{ opacity: 0 }, { opacity: 1 }]);
});

/* ─── 배선 가드 ─────────────────────────────────────────────── */

test('사이드바 화면 이동: 본문 위 덮개 한 장만 걷고, 본문(main)에는 opacity·transform 을 걸지 않는다', () => {
  const layout = read('src/components/layout/MainLayout.tsx');
  assert.match(layout, /<main ref=\{mainRef\} className=\{immersive \? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-4'\}>/);
  assert.match(layout, /<div ref=\{coverRef\} aria-hidden="true" className="bf-view-cover" \/>/);
  assert.match(layout, /cover\.animate\(VIEW_REVEAL_KEYFRAMES, viewRevealTiming\(prefersReducedMotion\(\)\)\)/);
  // 판단은 planViewReveal(위 단위 테스트) — 배선은 그 결과를 그대로 따른다.
  assert.match(layout, /const plan = planViewReveal\(state\.lastView, view, readPendingOpenRequests\(\)\);\n\s*if \(!plan\) return;/, 'StrictMode 이중 실행에도 한 번만');
  assert.match(layout, /if \(plan\.resetScroll && mainRef\.current\) mainRef\.current\.scrollTop = 0;/, '새 화면은 맨 위부터');
  assert.match(layout, /if \(!plan\.reveal\) return;\n\s*const cover = coverRef\.current;/);
  assert.doesNotMatch(layout, /mainRef\.current\.animate|main[^\n]*style=\{\{[^}]*(opacity|transform)/);
  const revealSrc = read('src/components/layout/ViewReveal.tsx');
  assert.match(revealSrc, /pendingSceneModalRequest: s\.pendingSceneModalRequest,\n\s*pendingCharacterBoardRequest: s\.pendingCharacterBoardRequest,/);

  const css = stripCssComments(read('src/styles/motion-view-transition.css'));
  const cover = css.match(/\.bf-view-cover \{([^}]*)\}/);
  assert.ok(cover, '.bf-view-cover 규칙');
  assert.match(cover[1], /position: absolute;/);
  assert.match(cover[1], /pointer-events: none;/);
  assert.match(cover[1], /opacity: 0;/);
  assert.match(cover[1], /background: rgb\(var\(--color-bg-primary\)\);/);
});

test('화면 코드: 250ms 지연 동그라미 + 그려지는 순간 신호, hover 때 그 화면만 미리 받기', () => {
  const app = read('src/App.tsx');
  assert.match(app, /<Suspense fallback=\{<DelayedViewSpinner \/>\}>\n\s*<ViewReady view=\{safeCurrentView\} \/>\n\s*\{view\}/);
  for (const name of ['Dashboard', 'ScenesView', 'AssigneeView', 'VacationView', 'SettingsView']) {
    assert.match(app, new RegExp(`const ${name} = lazy\\(\\(\\) => load${name === 'Dashboard' ? 'Dashboard' : name.replace(/View$/, '')}View\\(\\)`), name);
  }
  // 배플레이그라운드는 자체 진입 연출 — 직접 lazy 유지(다른 테스트가 고정).
  assert.match(app, /lazy\(\(\) => import\('@\/views\/PlaygroundView'\)\)/);

  const sidebar = read('src/components/layout/Sidebar.tsx');
  assert.match(sidebar, /onMouseEnter=\{\(\) => prefetchView\(item\.id\)\}/);
  assert.match(sidebar, /onFocus=\{\(\) => prefetchView\(item\.id\)\}/);
  const loaders = read('src/views/viewLoaders.ts');
  assert.doesNotMatch(loaders, /requestIdleCallback/, '전부 미리 받지 않는다');
  assert.match(loaders, /export function prefetchView\(view: ViewMode\): void/);

  const reveal = read('src/components/layout/ViewReveal.tsx');
  assert.match(reveal, /window\.setTimeout\(\(\) => setVisible\(true\), VIEW_SPINNER_DELAY_MS\)/);

  const header = read('src/components/layout/Header.tsx');
  assert.match(header, /<span key=\{headerTitle\} className="bf-view-title">\{headerTitle\}<\/span>/);
});

test('카드 차례 등장(인원별·팀원·에피소드)은 CSS 한 번 — 메인 스레드 y·30ms 간격 지연이 남지 않는다', () => {
  for (const path of ['src/views/AssigneeView.tsx', 'src/views/TeamView.tsx', 'src/views/EpisodeView.tsx']) {
    const src = read(path);
    // 통합: 정렬이 있는 인원별·팀원은 등장 창이 열려 있을 때만 클래스(cardCascadeClass) — 아래 테스트 참고.
    assert.match(src, /className=(?:"bf-card-cascade"|\{cardCascadeClass\(cascading\)\}) style=\{cardCascadeStyle\(i\)\}/, path);
    assert.doesNotMatch(src, /delay: i \* 0\.0[34]/, path);
  }
  const css = stripCssComments(read('src/styles/motion-view-transition.css'));
  assert.match(css, /\.bf-card-cascade \{\s*animation: bf-card-cascade-in 200ms var\(--ease-out\) backwards;\s*\}/);
  assert.match(css, /from \{ opacity: 0; transform: translateY\(8px\); \}/);
});

test('통합: 정렬 미끄러짐(15번)이 있는 인원별·팀원은 차례 등장(12번)을 처음 그려질 때만 — 정렬 때 다시 돌지 않는다', () => {
  // 브라우저는 DOM 에서 옮겨진 요소의 CSS 애니메이션을 처음부터 다시 튼다 → 옮겨진 카드가 지연 동안 투명해졌다.
  assert.equal(CARD_CASCADE_WINDOW_MS, CARD_CASCADE_DURATION_MS + cardCascadeDelayMs(99) + 50, '마지막 카드 등장이 끝난 뒤에 닫힌다');
  assert.equal(cardCascadeClass(true), 'bf-card-cascade');
  assert.equal(cardCascadeClass(false), undefined);
  for (const [path, list] of [['src/views/AssigneeView.tsx', 'assignees'], ['src/views/TeamView.tsx', 'teamData']] as const) {
    const src = read(path);
    assert.match(src, new RegExp(`const cascading = useCardCascadeWindow\\(${list}\\.length > 0\\);`), path);
    assert.match(src, /data-flip-id=\{[^}]+\} className=\{cardCascadeClass\(cascading\)\}/, path);
  }
  const hook = read('src/hooks/useCardCascadeWindow.ts');
  assert.match(hook, /if \(!ready \|\| !active\) return undefined;/);
  assert.match(hook, /window\.setTimeout\(\(\) => setActive\(false\), CARD_CASCADE_WINDOW_MS\)/);
});

test('씬 목록 파트·에피소드: 묶음 하나만 미끄러지고, 시트 줄마다 따로 떠오르지 않는다', () => {
  const scenes = read('src/views/ScenesView.tsx');
  assert.equal((scenes.match(/<div ref=\{sceneGroupSwapRef\} className="relative z-10 flex h-full min-h-0 flex-col">/g) ?? []).length, 2, '통합·부서 두 갈래');
  assert.match(scenes, /useGroupSwapMotion\(\n\s*sceneGroupSwapRef,/);
  assert.match(scenes, /sceneDetailOpenRef\.current \|\| Boolean\(app\.pendingDeepLink \|\| app\.pendingSceneModalRequest\)/, '씬 창이 열리는 중엔 생략');
  // 묶음 바로 바깥이 패딩 없는 스크롤 상자 — 오른쪽에서 들어오는 동안 가로 넘침을 잠깐 숨긴다(두 갈래 모두 부모).
  assert.match(scenes, /overflowGuard: \(\) => sceneGroupSwapRef\.current\?\.parentElement \?\? null,/);
  const boxes = [...scenes.matchAll(/'relative flex-1 min-h-0 overflow-auto',([\s\S]*?)<div ref=\{sceneGroupSwapRef\}/g)];
  assert.equal(boxes.length, 2, '묶음 래퍼는 두 갈래 모두 스크롤 상자 바로 안');
  for (const [, between] of boxes) {
    // 사이에 있는 건 완료 덮개·되돌리기 버튼뿐(묶음을 감싸는 다른 상자가 끼면 parentElement 가 스크롤 상자가 아니다).
    const opened = (between.match(/<div\b(?![^>]*\/>)/g) ?? []).length;
    const closed = (between.match(/<\/div>/g) ?? []).length;
    assert.equal(opened, closed, '스크롤 상자와 묶음 래퍼 사이에 열린 채 남은 상자가 없다');
  }
  const sheet = read('src/components/scenes/SceneSheetView.tsx');
  assert.doesNotMatch(sheet, /motion\.tr/);

  // 훅은 상태 기계(createGroupSwapController — 위 단위 테스트)에 그대로 넘긴다.
  const hook = read('src/hooks/useGroupSwapMotion.ts');
  assert.match(hook, /controller\.update\(swapKey, performance\.now\(\), \{\n\s*el: ref\.current,\n\s*direction,\n\s*distancePx,\n\s*durationMs,\n\s*skip,\n\s*overflowBox: overflowGuard,\n\s*reduce: prefersReducedMotion\(\),\n\s*\}\);\n\s*\}, \[controller, ref, swapKey\]\);/);
  assert.match(hook, /useLayoutEffect\(\(\) => \(\) => controller\.dispose\(\), \[controller\]\);/, '화면을 떠날 때 정리');
  const util = read('src/utils/viewTransitionMotion.ts');
  const start = util.indexOf('export function createGroupSwapController');
  const body = util.slice(start, util.indexOf('\n}\n', start));
  assert.doesNotMatch(body, /fill:/, '끝값(transform)을 남기지 않는다');
});

test('컴포지팅 EP 전환: 카드 영역 한 덩어리 ±16px, cascade 는 처음·↻ 에만', () => {
  const src = read('src/views/CompositingDashboardView.tsx');
  assert.match(src, /useGroupSwapMotion\(epSwapRef, episodeNumber === null \? null : String\(episodeNumber\),/);
  assert.match(src, /direction: \(prev, next\) => episodeDirection\(Number\(prev\), Number\(next\)\)/);
  assert.match(src, /ref=\{epSwapRef\}\n\s*className=\{cascadeArmed \? undefined : 'bf-cascade-quiet'\}/);
  // 켜짐 판단은 nextCascadeArm(위 단위 테스트).
  assert.match(src, /cascadeArmRef\.current = nextCascadeArm\(cascadeArmRef\.current, cascadeKey, episodeNumber\);\n\s*const cascadeArmed = cascadeArmRef\.current\.armed;/);
});

test('컴포지팅 cascade 끄기는 등장만 — 팀원 단계 변경 물듦(.bf-status-wash)은 꺼지지 않는다', () => {
  const css = stripCssComments(read('src/styles/motion-view-transition.css'));
  assert.match(css, /\.bf-cascade-quiet \.bf-cascade-item \{\s*animation: none;\s*\}/);
  // 통합: 5번(컴포지팅 카드)이 셸 animation 을 덮어쓰던 .scene-card.flashing 을 없애고, 물듦을 셸 안의 별도 층으로 옮겼다.
  // 그래서 셸 등장을 끄는 위 규칙이 물듦을 끌 수 없다 — 그 구조가 그대로인지 지킨다.
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/animation(-name)?:\s*none/.test(body)) assert.doesNotMatch(selector, /bf-status-wash/, selector.trim());
  }
  const index = read('src/index.css');
  assert.doesNotMatch(index, /\.scene-card\.flashing \{/);
  const card = read('src/views/compositing-dashboard/cards/SceneCard.tsx');
  assert.match(card, /'scene-card bf-cascade-item relative rounded-lg text-left'/);
  assert.match(card, /className="bf-status-wash"/);
  assert.match(read('src/styles/motion-live-drag.css'), /\.bf-status-wash \{[^}]*animation: bf-status-wash/);
});

test('대시보드 탭: 판 제자리 — 탭마다 다시 만들지 않고, 판(유리)에는 opacity 를 걸지 않는다', () => {
  const dash = read('src/views/Dashboard.tsx');
  assert.doesNotMatch(dash, /WidthProvider\(|import \{[^}]*WidthProvider/, '1280px 로 먼저 그렸다 옆으로 쓸리는 원인');
  assert.match(dash, /const boardWidth = useMeasuredWidth\(boardRef\);/);
  assert.match(dash, /<ResponsiveGridLayout\n\s*key=\{boardIdentity\}\n\s*width=\{boardWidth\}/);
  assert.doesNotMatch(dash, /<AnimatePresence mode="wait">\n\s*<motion\.div\n\s*key=\{`\$\{isEpMode/, '탭마다 판을 사라지게 했다 다시 그리지 않는다');
  // 탭 판정은 stepSwapGate(위 단위 테스트) — 처음 들어올 때는 그대로, 연타면 내용 드러남 없이 바로.
  assert.match(dash, /const step = stepSwapGate\(swap\.gate, contentKey, performance\.now\(\)\);\n\s*swap\.gate = step\.gate;\n\s*if \(step\.decision === 'none'\) return;/);
  assert.match(dash, /for \(const animation of swap\.animations\) animation\.cancel\(\);\n\s*swap\.animations = \[\];\n[^\n]*\n\s*if \(step\.decision !== 'animate'\) return;\n\s*boardRef\.current\?\.querySelectorAll\('\[data-widget-body\]'\)/);
  assert.match(dash, /\[scrollbar-gutter:stable\]/, '스크롤바가 생겨도 판 폭이 그대로');
  const widget = read('src/components/widgets/Widget.tsx');
  assert.match(widget, /<div data-widget-body className="flex-1 overflow-auto p-4">\{children\}<\/div>/);
});

test('동작 줄이기: 위젯 자리 전환·카드 등장·제목 페이드를 끈다', () => {
  const css = stripCssComments(read('src/styles/motion-view-transition.css'));
  const reduceBlocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  assert.match(reduceBlocks, /\.react-grid-layout \.react-grid-item,[\s\S]*?transition: none !important;/, 'widget-animations.css 의 !important 보다 특이도 높게');
  assert.match(reduceBlocks, /\.bf-view-title,\s*\.bf-card-cascade \{\s*animation: none;/);
  // 휴가 동기화 막대의 동작 줄이기는 바탕 B 의 .bf-sync-sweep(motion-foundation.css, foundation-FB 테스트)가 맡는다(통합 때 하나로 합침).
  assert.doesNotMatch(css, /bf-vac-sync/);
});

test('휴가 달 넘김: 캘린더처럼 두 달이 겹쳐 넘어가고, 연타·동작 줄이기는 바로', () => {
  const src = read('src/views/VacationView.tsx');
  assert.match(src, /const VACATION_MONTH_SLIDE_VARIANTS = createMonthSlideVariants\(\n\s*24,/);
  assert.match(src, /<div className="grid flex-1 min-h-0" style=\{MONTH_STACK_STYLE\}>\n\s*<AnimatePresence initial=\{false\} custom=\{monthSlide\}>/);
  assert.match(src, /initial=\{monthSlide\.instant \? false : 'enter'\}/);
  assert.match(src, /const monthSlide: MonthSlide = \{ direction, instant: rapidMonthNav \|\| reduce \};/);
  // 연타 판정은 createRapidGate(위 단위 테스트). 이전·다음·오늘 모두 판정을 거친다.
  assert.match(src, /const \[monthNavGate\] = useState\(createRapidGate\);/);
  assert.match(src, /const markMonthNavigation = \(\) => setRapidMonthNav\(monthNavGate\.hit\(performance\.now\(\)\)\);/);
  for (const fn of ['goToday', 'goPrev', 'goNext']) {
    assert.match(src, new RegExp(`const ${fn} = \\(\\) => \\{\\n(?:\\s*const now = new Date\\(\\);\\n)?\\s*markMonthNavigation\\(\\);`), fn);
  }
  // 층 키 ref 는 훅이라 '휴가 미연동' 조기 반환보다 앞에 있어야 한다(연동 상태가 바뀌면 훅 개수가 달라진다).
  const refAt = src.indexOf('const monthLayerKeyRef = useRef(');
  const earlyReturnAt = src.indexOf('if (!vacationConnected) {');
  assert.ok(refAt > 0 && earlyReturnAt > 0 && refAt < earlyReturnAt, '훅 순서');
  assert.doesNotMatch(src, /<AnimatePresence mode="wait" initial=\{false\}>\n\s*<motion\.div\n\s*key=\{monthKey\}/, '나간 뒤에야 들어오는 빈 화면 제거');
  assert.doesNotMatch(src, /x: direction \* 40/);
  // 나가는 달이 나중에 떨어질 때 들어온 달의 행 높이 관찰을 끊지 않는다.
  assert.match(src, /const measureWeekRow = useCallback\(\(el: HTMLDivElement \| null\) => \{[\s\S]*?if \(!el\) return;\n\s*weekRowObserverRef\.current\?\.disconnect\(\);/);
  // 동기화 막대: 메인 스레드 framer 무한 반복 대신 CSS — 통합 뒤에는 바탕 B 의 .bf-sync-sweep 하나로 합쳤다.
  assert.doesNotMatch(src, /repeat: Infinity/);
  assert.match(src, /className="bf-sync-sweep"/);
  // 화면 들어올 때 따로 미끄러지지 않는다(덮개가 맡음).
  assert.doesNotMatch(src, /initial=\{\{ opacity: 0, y: 12 \}\}/);
});
