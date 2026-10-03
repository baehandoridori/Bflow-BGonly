import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CARD_DROP_FLIP,
  FILTER_REVEAL_WINDOW_MS,
  GRID_FLIP,
  GRID_FLIP_EASING,
  enterDelayMs,
  enterKeyframes,
  gridFlipCommitAction,
  gridFlipMeasureMode,
  moveKeyframes,
  planGridEnters,
  planGridFlip,
  rectsIntersect,
  shouldRevealOnMount,
  type FlipRect,
} from '../../src/utils/gridFlip.ts';
import {
  REFLOW_LINGER,
  extendLingerDeadline,
  holdLingeringItems,
  initialLingerState,
  lingerHoldMs,
  lingerPhaseOf,
  lingerReducer,
  lingerView,
  shouldHoldForReflow,
  type LingerEntry,
  type LingerState,
} from '../../src/utils/reflowLinger.ts';
import { EASE_CSS } from '../../src/utils/motion.ts';

/* 움직임 폴리싱 15번 reflow-on-filter — 필터·정렬을 켠 채 체크해도 카드가 증발하지 않게 +
   필터·정렬·검색을 바꿀 때 바뀐 것만 미끄러져 움직이기.
   수치: 머무름 1200ms(축하 1600ms)·곧 빠짐 .65·사라짐 200ms → 남는 카드 320ms cubic-bezier(.16,1,.3,1),
   새 카드 200ms·translateY(8px)·지연 min(i×12,150)ms, 150장 넘으면 생략, 캘린더는 새 막대만 180ms. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');

const rect = (left: number, top: number, width = 180, height = 130): FlipRect => ({ left, top, width, height });

/* ─── 목록 미끄러짐 계획 ─────────────────────────────────────── */

test('수치 사양: 남는 카드 320ms·out 곡선, 새 카드 200ms·8px, 지연 12ms 간격 최대 150ms, 150장 상한', () => {
  assert.equal(GRID_FLIP.moveMs, 320);
  assert.equal(GRID_FLIP.enterMs, 200);
  assert.equal(GRID_FLIP.enterOffsetPx, 8);
  assert.equal(GRID_FLIP.staggerStepMs, 12);
  assert.equal(GRID_FLIP.staggerMaxMs, 150);
  assert.equal(GRID_FLIP.maxItems, 150);
  assert.equal(GRID_FLIP_EASING, EASE_CSS.out, '바탕 A 의 out 곡선과 같다');
  assert.deepEqual([0, 1, 5, 12, 13, 40].map((i) => enterDelayMs(i)), [0, 12, 60, 144, 150, 150]);
});

test('남는 카드는 이전 자리에서 새 자리로(dx·dy), 새로 보이는 카드는 순서대로 지연을 두고 떠오른다', () => {
  const before = new Map([
    ['a01', rect(0, 0)],
    ['a02', rect(200, 0)],
    ['a03', rect(400, 0)],
  ]);
  // a02 가 빠지고 a03 이 당겨지며, 새 카드 a07·a08 이 뒤에 나타난다.
  const after = new Map([
    ['a01', rect(0, 0)],
    ['a03', rect(200, 0)],
    ['a07', rect(400, 0)],
    ['a08', rect(0, 150)],
  ]);
  const plan = planGridFlip(before, after);
  assert.ok(plan);
  assert.deepEqual(plan.moves, [{ id: 'a03', dx: 200, dy: 0 }], '움직이지 않은 a01 은 건너뛴다');
  assert.deepEqual(plan.enters, [{ id: 'a07', delay: 0 }, { id: 'a08', delay: 12 }]);
});

test('반올림 떨림(0.5px 미만)은 움직임으로 치지 않고, 화면 밖에서 화면 밖으로 가는 카드는 건너뛴다', () => {
  const viewport = rect(0, 0, 1000, 600);
  const before = new Map([
    ['tiny', rect(0.3, 0)],
    ['offscreen', rect(0, 900)],
    ['comes-in', rect(0, 900)],
  ]);
  const after = new Map([
    ['tiny', rect(0, 0)],
    ['offscreen', rect(0, 1200)],
    ['comes-in', rect(0, 300)],
    ['new-below', rect(0, 2000)],
  ]);
  const plan = planGridFlip(before, after, { viewport });
  assert.ok(plan);
  assert.deepEqual(plan.moves.map((move) => move.id), ['comes-in'], '화면 밖→안은 움직이고, 밖→밖은 건너뛴다');
  assert.deepEqual(plan.enters, [], '화면 밖에 새로 생긴 카드는 떠오름을 걸지 않는다');
  assert.equal(rectsIntersect(rect(0, 0, 10, 10), rect(10, 0, 10, 10)), false, '맞닿기만 하면 겹침이 아니다');
});

test('카드가 150장을 넘으면 움직임 없이 바로 바뀌고, enter:false 면 새 카드 떠오름을 생략한다', () => {
  const many = new Map(Array.from({ length: 151 }, (_, i) => [`s${i}`, rect(0, i * 10)] as const));
  assert.equal(planGridFlip(many, new Map()), null, '전(151장)이 많아도 생략');
  assert.equal(planGridFlip(new Map(), many), null, '후(151장)가 많아도 생략');
  const plan = planGridFlip(new Map([['a', rect(0, 0)]]), new Map([['a', rect(0, 50)], ['b', rect(0, 0)]]), { enter: false });
  assert.deepEqual(plan, { moves: [{ id: 'a', dx: 0, dy: -50 }], enters: [] });
  assert.equal(planGridFlip(new Map(), new Map([['a', rect(0, 0)]]), { maxItems: 40 })?.enters.length, 1);
});

test('키프레임: 이동은 translate 하나(크기 보정 없음 — 글자가 눌리지 않음), 등장은 투명·8px 아래에서', () => {
  assert.deepEqual(moveKeyframes(12, -40), [
    { transform: 'translate(12px, -40px)' },
    { transform: 'translate(0px, 0px)' },
  ]);
  assert.deepEqual(enterKeyframes(), [
    { opacity: 0, transform: 'translateY(8px)' },
    { opacity: 1, transform: 'translateY(0px)' },
  ]);
  for (const frame of [...moveKeyframes(1, 2), ...enterKeyframes()]) {
    assert.equal(/scale/.test(String(frame.transform)), false);
  }
});

test('언제 재나: 필터·정렬 키가 바뀌면 전체, 검색어(enterKey)만 바뀌면 카드 목록만, 이미 쟀거나 꺼져 있으면 재지 않는다', () => {
  const base = { keyChanged: false, enterKeyChanged: false, disabled: false, alreadyMeasured: false };
  assert.equal(gridFlipMeasureMode(base), null, '바뀐 것이 없으면 재지 않는다');
  assert.equal(gridFlipMeasureMode({ ...base, keyChanged: true }), 'full');
  assert.equal(gridFlipMeasureMode({ ...base, keyChanged: true, enterKeyChanged: true }), 'full', '둘 다 바뀌면 전체');
  assert.equal(gridFlipMeasureMode({ ...base, enterKeyChanged: true }), 'enter-only', '검색어만 — 카드 위치는 다시 재지 않는다');
  assert.equal(gridFlipMeasureMode({ ...base, keyChanged: true, disabled: true }), null, '동작 줄이기·끌어 고르기 중');
  assert.equal(gridFlipMeasureMode({ ...base, keyChanged: true, alreadyMeasured: true }), null, 'StrictMode 이중 렌더는 처음 잰 값');
});

test('커밋 직후: 키 그대로면 손대지 않고, 꺼짐·보기 전환(scope)·잰 값 없음은 바로 바뀌고, 그 밖에는 미끄러진다', () => {
  const base = { keyChanged: true, enterKeyChanged: false, disabled: false, scopeChanged: false, measured: true };
  assert.equal(gridFlipCommitAction(base), 'run');
  assert.equal(gridFlipCommitAction({ ...base, keyChanged: false, enterKeyChanged: true }), 'run', '검색어만 바뀌어도 새 카드 떠오름');
  assert.equal(gridFlipCommitAction({ ...base, keyChanged: false }), 'keep', '키가 그대로인 커밋(체크 등 데이터 변경)은 진행 중 움직임도 그대로');
  assert.equal(gridFlipCommitAction({ ...base, scopeChanged: true }), 'skip', '파트·화면 전환은 미끄러지지 않는다');
  assert.equal(gridFlipCommitAction({ ...base, disabled: true }), 'skip');
  assert.equal(gridFlipCommitAction({ ...base, measured: false }), 'skip', '못 쟀거나 카드가 너무 많음');
});

test('검색어만 바뀔 때: 남는 카드는 움직이지 않고 새로 보이는 카드만(화면 안, 순서대로 지연) 떠오른다', () => {
  const plan = planGridEnters(new Set(['a01', 'a02']), new Map([
    ['a03', rect(0, 0)],
    ['a04', rect(200, 0)],
    ['a05', rect(0, 5000)],
  ]), { viewport: rect(0, 0, 1000, 800) });
  assert.ok(plan);
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.enters, [{ id: 'a03', delay: 0 }, { id: 'a04', delay: 12 }], '화면 밖 a05 는 건너뛴다');
  assert.deepEqual(planGridEnters(new Set(['a01']), new Map([['a01', rect(0, 0)]]))?.enters, [], '있던 카드는 떠오르지 않는다');
  const many = new Set(Array.from({ length: 151 }, (_, i) => `x${i}`));
  assert.equal(planGridEnters(many, new Map()), null, '150장을 넘으면 생략');
});

/* ─── 체크한 카드 붙잡아 두기 ────────────────────────────────── */

type Card = { id: string; done: boolean; pct: number };
const keysOf = (card: Card) => [card.id];

test('붙잡기 조건·시간: 상태 필터나 진행률·미완료 정렬일 때만, 1.2초(완료 축하면 1.6초), 연속 체크는 마감을 늘리기만 한다', () => {
  assert.equal(shouldHoldForReflow('all', 'no'), false);
  assert.equal(shouldHoldForReflow('all', 'assignee'), false);
  assert.equal(shouldHoldForReflow('in-progress', 'no'), true);
  assert.equal(shouldHoldForReflow('all', 'progress'), true);
  assert.equal(shouldHoldForReflow('all', 'incomplete'), true);
  assert.equal(REFLOW_LINGER.holdMs, 1200);
  assert.equal(REFLOW_LINGER.celebrateHoldMs, 1600);
  assert.equal(REFLOW_LINGER.fadeOutMs, 200);
  assert.equal(REFLOW_LINGER.dimOpacity, 0.65);
  assert.equal(lingerHoldMs(false), 1200);
  assert.equal(lingerHoldMs(true), 1600);
  assert.equal(extendLingerDeadline(0, 10_000, 1200), 11_200, '처음이면 지금부터');
  assert.equal(extendLingerDeadline(11_200, 10_500, 1200), 11_700, '연속 체크는 마지막 체크 기준으로 늘어난다');
  assert.equal(extendLingerDeadline(12_000, 10_500, 1200), 12_000, '축하로 길게 잡힌 마감은 줄이지 않는다');
});

test("'진행 중' 필터에서 체크해 빠질 카드는 체크 전 자리에 남고 '곧 빠짐'으로 표시된다", () => {
  const a = { id: 'a01', done: false, pct: 50 };
  const b = { id: 'a02', done: true, pct: 100 }; // 방금 마지막 단계 체크 → 필터에서 빠짐
  const c = { id: 'a03', done: false, pct: 25 };
  const pool = [a, b, c];
  const visible = pool.filter((card) => !card.done);
  const entries = new Map<string, LingerEntry>([['a02', { order: 1 }]]);
  const held = holdLingeringItems(visible, pool, keysOf, entries);
  assert.deepEqual(held.items.map((card) => card.id), ['a01', 'a02', 'a03'], '뒤 카드가 당겨지지 않는다');
  assert.equal(held.items[1], b, '최신 객체(체크된 상태)를 그대로 보여 준다');
  assert.deepEqual([...held.leaving].map((card) => card.id), ['a02']);
});

test("'진행률순'에서 체크한 카드는 순간이동하지 않고 체크 전 자리에 머문다(빠지지 않으니 '곧 빠짐' 아님)", () => {
  const cards = [
    { id: 'a01', done: false, pct: 25 },
    { id: 'a02', done: false, pct: 75 }, // 50 → 75 로 체크 → 정렬상 맨 뒤로 가야 함
    { id: 'a03', done: false, pct: 50 },
  ];
  const sorted = [...cards].sort((x, y) => x.pct - y.pct);
  assert.deepEqual(sorted.map((card) => card.id), ['a01', 'a03', 'a02']);
  const held = holdLingeringItems(sorted, cards, keysOf, new Map([['a02', { order: 1 }]]));
  assert.deepEqual(held.items.map((card) => card.id), ['a01', 'a02', 'a03']);
  assert.equal(held.leaving.size, 0);
  // 비우면 자연 순서로 — 이때 useGridFlip 이 a02·a03 을 새 자리로 미끄러뜨린다.
  assert.deepEqual(holdLingeringItems(sorted, cards, keysOf, new Map()).items.map((card) => card.id), ['a01', 'a03', 'a02']);
});

test('연달아 여러 장을 체크하면 모두 체크 전 순서대로 기다리고, 목록에서 사라진(검색·삭제) 카드는 끼워 넣지 않는다', () => {
  const pool = ['a01', 'a02', 'a03', 'a04', 'a05'].map((id) => ({ id, done: false, pct: 0 }));
  pool[1].done = true;
  pool[3].done = true;
  const visible = pool.filter((card) => !card.done);
  const held = holdLingeringItems(visible, pool, keysOf, new Map([
    ['a04', { order: 3 }],
    ['a02', { order: 1 }],
    ['gone', { order: 0 }],
  ]));
  assert.deepEqual(held.items.map((card) => card.id), ['a01', 'a02', 'a03', 'a04', 'a05']);
  assert.deepEqual([...held.leaving].map((card) => card.id).sort(), ['a02', 'a04']);
  assert.deepEqual(
    holdLingeringItems([pool[0]], [pool[0]], keysOf, new Map([['a02', { order: 0 }]])).items.map((card) => card.id),
    ['a01'],
    '후보(pool)에 없으면 그대로',
  );
  const order = holdLingeringItems(visible, pool, keysOf, new Map([['a05', { order: 99 }]])).items.map((card) => card.id);
  assert.deepEqual(order.at(-1), 'a05', '기록 순서가 목록보다 길면 맨 끝');
});

test('통합 카드(BG·액팅 두 씬)는 둘 중 하나만 붙잡아도 카드째 머문다', () => {
  type Merged = { key: string; bg?: string; act?: string; pass: boolean };
  const merged: Merged[] = [
    { key: 'm1', bg: 'uuid:b1', act: 'uuid:c1', pass: true },
    { key: 'm2', bg: 'uuid:b2', act: 'uuid:c2', pass: false },
    { key: 'm3', bg: 'uuid:b3', pass: true },
  ];
  const mergedKeys = (item: Merged) => [item.bg, item.act].filter((key): key is string => Boolean(key));
  const held = holdLingeringItems(merged.filter((item) => item.pass), merged, mergedKeys, new Map([['uuid:c2', { order: 1 }]]));
  assert.deepEqual(held.items.map((item) => item.key), ['m1', 'm2', 'm3']);
  assert.deepEqual([...held.leaving].map((item) => item.key), ['m2']);
});

test('붙잡은 것이 없으면 같은 배열을 그대로 돌려준다(렌더마다 새 배열을 만들지 않음)', () => {
  const visible = [{ id: 'a', done: false, pct: 0 }];
  assert.equal(holdLingeringItems(visible, visible, keysOf, new Map()).items, visible);
});

/* ─── 붙잡기 상태 흐름 (useReflowLinger 가 타이머로 모는 lingerReducer) ─── */

const ids = (state: LingerState) => [...state.entries.keys()];

test('붙잡기 흐름: hold → (마감) expire 사라짐 → clear 비우고 generation+1 — 나머지 카드가 그때 미끄러진다', () => {
  let state = initialLingerState('v1');
  assert.deepEqual({ ...state, entries: ids(state) }, { scope: 'v1', entries: [], phase: 'hold', generation: 0 });
  state = lingerReducer(state, { type: 'hold', scope: 'v1', keys: ['a02'], order: 1 });
  assert.deepEqual(ids(state), ['a02']);
  assert.equal(state.phase, 'hold');
  // 연속 체크: 이미 붙잡은 키는 처음 순서를 지키고 새 키만 더한다.
  state = lingerReducer(state, { type: 'hold', scope: 'v1', keys: ['a02', 'a04'], order: 3 });
  assert.deepEqual(state.entries.get('a02'), { order: 1 });
  assert.deepEqual(state.entries.get('a04'), { order: 3 });
  state = lingerReducer(state, { type: 'expire' });
  assert.equal(state.phase, 'leaving', '빠질 카드가 0.2초에 사라진다');
  assert.equal(state.generation, 0, '사라지는 동안은 아직 자리를 그대로 둔다');
  state = lingerReducer(state, { type: 'clear' });
  assert.deepEqual(ids(state), []);
  assert.equal(state.phase, 'hold');
  assert.equal(state.generation, 1, '비우는 순간 목록 미끄러짐 키가 바뀐다');
  // 이미 비었으면 같은 상태(쓸데없는 다시 그리기·미끄러짐 없음)
  assert.equal(lingerReducer(state, { type: 'clear' }), state);
  assert.equal(lingerReducer(state, { type: 'expire' }), state);
  assert.equal(lingerReducer(state, { type: 'hold', scope: 'v1', keys: [], order: 0 }), state);
});

test('붙잡기 흐름: 보기(필터·정렬·검색·파트)가 바뀌면 붙잡은 것을 버리고, 미끄러짐 키는 그대로(보기 전환은 다른 움직임이 맡는다)', () => {
  let state = lingerReducer(initialLingerState('v1'), { type: 'hold', scope: 'v1', keys: ['a02'], order: 1 });
  // 렌더에서는 바로 무효
  assert.deepEqual(lingerView(state, 'v2'), { entries: new Map(), phase: 'hold' });
  assert.equal(lingerView(state, 'v1').entries, state.entries);
  state = lingerReducer(state, { type: 'scope', scope: 'v2' });
  assert.deepEqual(ids(state), []);
  assert.equal(state.scope, 'v2');
  assert.equal(state.generation, 0);
  // 다른 보기에서 붙잡혔던 것은 새 hold 에 섞이지 않는다
  const stale = lingerReducer(initialLingerState('v1'), { type: 'hold', scope: 'v1', keys: ['a02'], order: 1 });
  const fresh = lingerReducer(stale, { type: 'hold', scope: 'v2', keys: ['b01'], order: 0 });
  assert.deepEqual(ids(fresh), ['b01']);
  assert.equal(fresh.scope, 'v2');
});

test('사라지는 중(leaving)에 다른 카드를 체크해도 사라지던 카드는 다시 나타나지 않고, 새 카드와 함께 끝에 빠진다', () => {
  let state = lingerReducer(initialLingerState('v1'), { type: 'hold', scope: 'v1', keys: ['a02'], order: 1 });
  state = lingerReducer(state, { type: 'expire' });
  assert.equal(lingerPhaseOf(state.entries, state.phase, ['a02']), 'leaving');
  state = lingerReducer(state, { type: 'hold', scope: 'v1', keys: ['a05'], order: 4 });
  assert.equal(state.phase, 'hold', '새로 체크한 카드는 다시 머문다');
  assert.equal(lingerPhaseOf(state.entries, state.phase, ['a02']), 'leaving', '사라지던 카드는 계속 사라진 채(.65 로 되살아나지 않음)');
  assert.equal(lingerPhaseOf(state.entries, state.phase, ['a05']), 'hold');
  assert.deepEqual(state.entries.get('a02'), { order: 1, gone: true }, '체크 전 순서는 그대로 — 자리가 흔들리지 않는다');
  assert.equal(state.generation, 0);
  state = lingerReducer(lingerReducer(state, { type: 'expire' }), { type: 'clear' });
  assert.deepEqual(ids(state), []);
  assert.equal(state.generation, 1, '마지막에 한 번에 비우고 미끄러진다');
  // 통합 카드(키 두 개)는 하나라도 사라지던 중이면 사라진 채
  const merged = new Map<string, LingerEntry>([['bg', { order: 0, gone: true }], ['act', { order: 0 }]]);
  assert.equal(lingerPhaseOf(merged, 'hold', ['bg', 'act']), 'leaving');
  assert.equal(lingerPhaseOf(merged, 'hold', ['act']), 'hold');
});

/* ─── 캐릭터 카드 놓기 · 캘린더 ────────────────────────────── */

test('캐릭터 카드 놓기: 내가 놓은 뒤 1.5초 안의 순서 변경만, 40장 이하에서만 미끄러진다', () => {
  assert.deepEqual({ ...CARD_DROP_FLIP }, { armMs: 1500, maxItems: 40 });
});

test('캘린더: 필터를 바꾼 직후(0.4초 안)에 새로 생긴 막대만 떠오른다', () => {
  assert.equal(FILTER_REVEAL_WINDOW_MS, 400);
  assert.equal(shouldRevealOnMount(0, 5_000), false, '필터를 바꾼 적 없으면(첫 화면·달 넘김) 떠오르지 않는다');
  assert.equal(shouldRevealOnMount(5_000, 5_004), true);
  assert.equal(shouldRevealOnMount(5_000, 5_400), false);
  assert.equal(shouldRevealOnMount(5_000, 4_999), false);
});

/* ─── 연결 가드(소스) ─────────────────────────────────────── */

test('훅은 순수 함수가 정한 대로만: 붙잡기는 hold → 마감 expire → 0.2초 뒤 clear, 보기 바뀌면 scope / 미끄러짐은 재기·커밋 판정', () => {
  const linger = read('src/hooks/useReflowLinger.ts');
  assert.match(linger, /setState\(\(previous\) => lingerReducer\(previous, action\)\)/);
  assert.match(linger, /dispatch\(\{ type: 'hold', scope: scopeRef\.current, keys, order \}\);/);
  assert.match(linger, /dispatch\(\{ type: 'expire' \}\);\n\s+timerRef\.current = setTimeout\(\(\) => \{\n\s+timerRef\.current = null;\n\s+deadlineRef\.current = 0;\n\s+dispatch\(\{ type: 'clear' \}\);\n\s+\}, REFLOW_LINGER\.fadeOutMs\);\n\s+\}, Math\.max\(0, deadlineRef\.current - now\)\);/);
  assert.match(linger, /dispatch\(\{ type: 'scope', scope \}\);/);
  assert.match(linger, /const view = lingerView\(state, scope\);/);
  assert.match(linger, /generation: state\.generation,/);
  assert.match(read('src/views/ScenesView.tsx'), /reflowLinger\.phaseOf\(\[reflowSceneKey\(currentPart\?\.sheetName \?\? '', scene\)\]\)/);

  const grid = read('src/hooks/useGridFlip.ts');
  assert.match(grid, /const measureMode = gridFlipMeasureMode\(\{\n\s+keyChanged: committedKeyRef\.current !== flipKey,\n\s+enterKeyChanged: committedEnterKeyRef\.current !== options\.enterKey,\n\s+disabled: !!options\.disabled,\n\s+alreadyMeasured: snapshotRef\.current !== null,\n\s+\}\);/);
  assert.match(grid, /const scopeChanged = committedScopeRef\.current !== scope;/);
  assert.match(grid, /const action = gridFlipCommitAction\(\{\n\s+keyChanged,\n\s+enterKeyChanged,\n\s+disabled: !!disabled,\n\s+scopeChanged,\n\s+measured: before !== null && before !== TOO_MANY,\n\s+\}\);/, '파트·화면 전환(scope)은 판정에 그대로 넘긴다');
  assert.match(grid, /if \(action === 'keep'\) return;\n\s+for \(const animation of runningRef\.current\) animation\.cancel\(\);\n\s+runningRef\.current = \[\];\n\s+if \(action === 'skip' \|\| !before \|\| before === TOO_MANY\) return;/);
  // 검색어(enter-only)는 있던 카드 위치를 재지 않는다(속성만 읽음)
  const ids = grid.slice(grid.indexOf('function measureIds('), grid.indexOf('/** 스크롤 상자'));
  assert.doesNotMatch(ids, /getBoundingClientRect/);
  assert.match(grid, /const after = measure\(container, attr, maxItems, before\.ids\);/);
});

test('씬 목록: 체크 직전(낙관 갱신 전)에 붙잡고, 붙잡은 카드는 체크 전 자리·곧 빠짐 표시로 그린다', () => {
  const view = read('src/views/ScenesView.tsx');
  const toggle = view.slice(view.indexOf('const handleToggleForSheet = ('), view.indexOf('// 기존 호환: currentPart의 sheetName 사용'));
  assert.ok(toggle.indexOf('holdSceneForReflow(sheetName, scene,') > 0);
  assert.ok(
    toggle.indexOf('holdSceneForReflow(sheetName, scene,') < toggle.indexOf('// 낙관적 업데이트 — 즉시 UI 반영'),
    '낙관 갱신보다 먼저 붙잡아야 한 프레임도 사라지지 않는다',
  );
  // 액팅 단계·담당자별 진행도 같은 자리에서 붙잡는다.
  assert.match(view, /holdSceneForReflow\(sheetName, scene, Boolean\(completionMeta\?\.nextCompletedBy && completionMeta\.nextCompletedAt\)\);\n {6}updateSceneByUuid\(sceneUuid, phasePatch\);/);
  assert.match(view, /holdSceneForReflow\(sheetName, scene, !wasFullyDone && willBeFullyDone\);\n {6}updateSceneByUuid\(sceneUuid, patch\);/);
  // 카드 보기 + 상태 필터·진행률 정렬일 때만.
  assert.match(view, /view\.sceneViewMode !== 'card' \|\| !shouldHoldForReflow\(view\.statusFilter, view\.sortKey\)/);
  assert.match(view, /const heldSingleScenes = holdLingeringItems\(\n {4}scenes,\n {4}lingerPoolScenes,/);
  assert.match(view, /const mergedScenes = heldMergedScenes\.items;/);
  assert.equal((view.match(/lingering=\{singleLingerPhase\(scene\)\}/g) ?? []).length, 2, '개별 카드 두 곳(레이아웃 묶음·평면)');
  assert.equal((view.match(/lingering=\{mergedLingerPhase\(m\)\}/g) ?? []).length, 2, '통합 카드 두 곳');
  assert.match(view, /data-lingering=\{lingering \?\? undefined\}/);
  assert.match(read('src/components/scenes/UnifiedSceneCard.tsx'), /data-lingering=\{lingering \?\? undefined\}/);
});

test('씬 목록 미끄러짐: 필터·정렬·검색·붙잡기 해제만 키로 쓰고(체크 데이터 X), 동작 줄이기·시트 보기·끌어 고르기 중에는 끈다', () => {
  const view = read('src/views/ScenesView.tsx');
  const call = view.slice(view.indexOf('useGridFlip(\n    sceneListRef,'), view.indexOf("idAttribute: 'data-scene-id',"));
  assert.match(call, /JSON\.stringify\(\[statusFilter, selectedAssignee, sortKey, sortDir, sceneGroupMode, reflowLinger\.generation\]\)/);
  // 검색어는 글자마다 바뀐다 — 카드 위치를 다시 재지 않고 새로 보이는 카드만 떠오르게(enterKey)
  assert.match(call, /enterKey: searchQuery,/);
  assert.match(call, /disabled: reduceMotion \|\| sceneViewMode !== 'card' \|\| lassoRect !== null/);
  assert.match(call, /scope: JSON\.stringify\(\[selectedEpisode, selectedPart, selectedDepartment, sceneViewMode\]\)/, '파트·화면 전환은 건너뛴다');
  assert.equal((view.match(/ref=\{sceneListRef\}/g) ?? []).length, 2, '통합·개별 목록 상자 모두');
});

test('곧 빠짐 표시: 머무는 동안 .65(0.3초), 빠질 때 0(0.2초) — opacity 전환만', () => {
  const css = read('src/styles/motion-scene-flow.css');
  assert.match(css, /\.scene-card-interactive\[data-lingering='hold'\] \{\n {2}opacity: 0\.65;/);
  assert.match(css, /\.scene-card-interactive\[data-lingering='leaving'\] \{\n {2}opacity: 0;\n {2}pointer-events: none;/);
  assert.match(css, /opacity 300ms var\(--ease-std\) !important/);
  assert.match(css, /opacity 200ms var\(--ease-in\) !important/);
  const section = css.slice(css.indexOf('15. 필터·정렬'));
  assert.equal(/(?:^|\n)\s*(?:width|height|top|left|box-shadow|background)\s*:/.test(section.slice(0, section.indexOf('.sf-cal-bar-reveal'))), false,
    '배치·그림자·배경을 새로 움직이지 않는다');
});

test('인원별·팀원 정렬과 리테이크 완료 항목은 framer layout 대신 같은 미끄러짐(WAAPI)을 쓴다', () => {
  for (const path of ['src/views/AssigneeView.tsx', 'src/views/TeamView.tsx']) {
    const source = read(path);
    assert.match(source, /useGridFlip\(cardGridRef, `\$\{sortBy\}:\$\{sortAsc\}`, \{ disabled: reduce, enter: false \}\)/, path);
    assert.match(source, /<div ref=\{cardGridRef\} className="grid /, path);
    assert.match(source, /data-flip-id=\{/, path);
  }
  const item = read('src/views/compositing/RevisionItem.tsx');
  assert.equal(/^\s*layout\s*$/m.test(item), false, 'framer layout(글자 눌림·이중 이동) 제거');
  assert.equal(/transition-all duration-200 group cursor-pointer/.test(item), false, 'transition-all → transition-colors');
  assert.match(item, /transition-colors duration-200 group cursor-pointer/);
  assert.match(item, /data-flip-id=\{revision\.id\}/);
  assert.equal(/\bx: -8\b/.test(item), false, '개별 x 값 대신 transform 문자열');
  const row = read('src/views/compositing/SceneGroupSection.tsx');
  assert.match(row, /useGridFlip\(revisionListRef, sortedRevisions\.map\(\(revision\) => revision\.id\)\.join\('\|'\), \{ disabled: reduce, enter: false \}\)/);
  assert.match(row, /<div ref=\{revisionListRef\} className="relative pb-2 ml-8">/);
});

test('캐릭터 카드: 놓는 순간(순서 바꾸기 직전)에만 미끄러짐을 켠다', () => {
  const board = read('src/views/CharacterBoardView.tsx');
  const drop = board.slice(board.indexOf('const handleCardDrop = useCallback'), board.indexOf('}, [reorderCharacters]);'));
  assert.ok(drop.indexOf('cardFlipArmedUntilRef.current = Date.now() + CARD_DROP_FLIP.armMs;') >= 0);
  assert.ok(drop.indexOf('cardFlipArmedUntilRef.current =') < drop.indexOf('void reorderCharacters('));
  assert.match(board, /disabled: reduceMotion \|\| Date\.now\(\) > cardFlipArmedUntilRef\.current,\n {4}maxItems: CARD_DROP_FLIP\.maxItems,/);
  const groups = read('src/components/characters/CharacterTabGroupsView.tsx');
  assert.equal((groups.match(/cardFlipArmedUntilRef\.current = Date\.now\(\) \+ CARD_DROP_FLIP\.armMs;/g) ?? []).length, 2, '그룹에 놓기·카드에 놓기');
  assert.match(read('src/components/characters/CharacterCard.tsx'), /data-flip-id=\{character\.id\}/);
});

test('캘린더: 필터를 바꿔도 달력 전체를 옅게 하지 않고, 새로 생긴 막대만 마운트 때 한 번 떠오른다', () => {
  const schedule = read('src/views/ScheduleView.tsx');
  assert.equal(/filterFadeOpacity/.test(schedule), false, '격자 전체 opacity 1→.55→1 깜빡임 제거');
  assert.match(schedule, /animate=\{\{ opacity: 1, transform: 'translateY\(0px\)', transitionEnd: \{ transform: 'none' \} \}\}/);
  assert.match(schedule, /const filterRevealAt = reduce \? 0 : filterRevealRef\.current\.at;/);
  assert.match(schedule, /filterRevealAt=\{filterRevealAt\}/);
  const grid = read('src/components/calendar/CalendarGrid.tsx');
  // 통합: 16번(끌어서 옮기기)이 끄는 막대의 흐린 복제본(isGhost)을 없애고 진하게 들린 막대(isDragging)로 바꿨다.
  // 끄는 중인지는 마운트 때 판정에만 쓴다 — 클래스를 뗐다 붙이면 놓는 순간 떠오름이 다시 돌았다(검증 지적 acc-scene-flow-1).
  assert.match(grid, /if \(revealOnMountRef\.current === null\) \{\n {4}revealOnMountRef\.current = !reduceMotion && !isDragging && shouldRevealOnMount\(revealSince, Date\.now\(\)\);/);
  assert.match(grid, /revealOnMountRef\.current && 'sf-cal-bar-reveal'/);
  const css = read('src/styles/motion-scene-flow.css');
  assert.match(css, /\.sf-cal-bar-reveal \{\n {2}animation: sf-cal-bar-reveal var\(--motion-base\) var\(--ease-out\) backwards;/);
  assert.match(css, /@keyframes sf-cal-bar-reveal \{\n {2}from \{\n {4}opacity: 0;\n {4}transform: translateY\(2px\);/);
  const rail = read('src/components/calendar/CalendarRail.tsx');
  assert.equal((rail.match(/onClick=\{\(event\) => \{ popRailCheck\(event\?\.currentTarget\); onToggleVisible\(\); \}\}/g) ?? []).length, 2);
  assert.match(rail, /\], \{ duration: 160, easing: EASE_CSS\.out \}\);/);
});
