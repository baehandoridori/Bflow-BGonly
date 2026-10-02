import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CELEBRATE_GLOW_MS,
  CONFETTI_COLORS,
  CONFETTI_COUNT,
  CONFETTI_FALL_EASE,
  CONFETTI_FALL_PX,
  CONFETTI_MS,
  CONFETTI_PEAK_OFFSET,
  CONFETTI_RISE_EASE,
  buildConfettiPieces,
  confettiKeyframes,
  confettiPieceBox,
} from '../../src/components/ui/confettiMotion.ts';
import {
  CARD_POP_EASE,
  CARD_POP_KEYFRAMES,
  CARD_POP_MS,
  CELEBRATE_GLOW_KEYFRAMES,
  PART_COMPLETE_EXIT_MS,
  PART_COMPLETE_FLOW_MS,
  PART_COMPLETE_SEEN_MAX,
  PART_COMPLETE_SEEN_STORAGE_KEY,
  PART_COMPLETE_SETTLE_MS,
  bokehBackground,
  buildBokehOrbs,
  driftKeyframes,
  readSeenPartCompletionKeys,
  rectWithin,
  rememberSeenPartCompletionKey,
  settlePlaybackRate,
} from '../../src/components/scenes/celebrateMotion.ts';
import { RETAKE_DONE_FADE_MS, RETAKE_DONE_HOLD_MS, remainingLeaveMs, withLeavingRows } from '../../src/components/widgets/myRetakesMotion.ts';
import { rowFlipShifts } from '../../src/utils/rowFlip.ts';

/* 움직임 폴리싱 17번 celebrate-done — 씬 완료 '톡'·번짐·꽃가루, 파트 완료 화면, 할 일 완료 손맛. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 결정적 난수(테스트용). */
function seeded(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const MOTION_KEYS = new Set(['offset', 'easing', 'composite', 'transform', 'opacity']);

/* ─── 꽃가루 ─── */

test('꽃가루는 20개, 보라·살구·초록, 6~9px — 축하 해제(1.6초)보다 짧은 0.9초', () => {
  const pieces = buildConfettiPieces(CONFETTI_COUNT, seeded());
  assert.equal(pieces.length, 20);
  assert.deepEqual([...CONFETTI_COLORS], ['#6C5CE7', '#FDCB6E', '#00B894']);
  for (const piece of pieces) {
    assert.ok(CONFETTI_COLORS.includes(piece.color as typeof CONFETTI_COLORS[number]));
    assert.ok(piece.size >= 6 && piece.size <= 9, `size ${piece.size}`);
    assert.ok(piece.rise >= 40 && piece.rise <= 100);
    assert.ok(Math.abs(piece.dx) <= 90);
    const box = confettiPieceBox(piece);
    assert.ok(box.width <= 9 && box.height <= 9 && box.height >= 3);
  }
  assert.equal(CONFETTI_MS, 900);
  assert.ok(CONFETTI_MS < 1600);
  assert.equal(CELEBRATE_GLOW_MS, 400);
});

test('조각은 45% 지점까지 위로 튀었다가 110px 떨어지며 사라진다 — transform 문자열·opacity 만', () => {
  const [piece] = buildConfettiPieces(1, seeded(3));
  const frames = confettiKeyframes(piece);
  assert.deepEqual(frames.map((frame) => frame.offset), [0, CONFETTI_PEAK_OFFSET, 1]);
  assert.equal(CONFETTI_PEAK_OFFSET, 0.45);
  assert.equal(frames[0].easing, CONFETTI_RISE_EASE);
  assert.equal(frames[1].easing, CONFETTI_FALL_EASE);
  assert.equal(CONFETTI_RISE_EASE, 'cubic-bezier(0.2, 0.8, 0.4, 1)');
  assert.equal(CONFETTI_FALL_EASE, 'cubic-bezier(0.5, 0, 0.9, 0.6)');
  for (const frame of frames) {
    for (const key of Object.keys(frame)) assert.ok(MOTION_KEYS.has(key), `허용되지 않은 키 ${key}`);
  }
  const y = (frame: Keyframe) => Number(String(frame.transform).match(/translate\([^,]+,\s*(-?[\d.]+)px\)/)?.[1]);
  assert.equal(y(frames[0]), 0);
  assert.equal(y(frames[1]), -piece.rise);
  assert.equal(Math.round(y(frames[2]) * 10) / 10, Math.round((-piece.rise + CONFETTI_FALL_PX) * 10) / 10);
  assert.equal(frames[2].opacity, 0);
  assert.equal(CONFETTI_FALL_PX, 110);
});

test('꽃가루 컴포넌트: framer 개별 값 대신 WAAPI, 동작 줄이기면 그리지 않고 끝 알림만', () => {
  const source = stripComments(read('src/components/ui/Confetti.tsx'));
  assert.doesNotMatch(source, /framer-motion/);
  assert.match(source, /el\.animate\(confettiKeyframes\(pieces\[index\]\), \{ duration: CONFETTI_MS \}\)/);
  assert.match(source, /active && !reduceRef\.current \? buildConfettiPieces\(\) : null/);
  assert.match(source, /reduceRef\.current \? CELEBRATE_GLOW_MS : CONFETTI_MS/);
  assert.match(source, /completeRef/);
  assert.match(source, /if \(!pieces\) return null;/);
  // '나의 할 일' 위젯 꽃가루도 같은 방식.
  const myTasks = stripComments(read('src/components/widgets/my-tasks/components/Confetti.tsx'));
  assert.doesNotMatch(myTasks, /framer-motion/);
  assert.match(myTasks, /el\.animate\(PIECES\[i\]\.keyframes/);
  const css = read('src/styles/motion-scene-check.css');
  assert.match(css, /\.bf-confetti-piece \{[^}]*opacity: 0;/);
});

/* ─── 씬 카드 '톡'·번짐·빛 ─── */

test("카드 '톡'은 개별 transform 속성(translate·scale)으로 40% 지점에 -2px·1.025, 280ms 살짝 넘치는 곡선", () => {
  assert.equal(CARD_POP_MS, 280);
  assert.equal(CARD_POP_EASE, 'cubic-bezier(0.34, 1.56, 0.64, 1)');
  assert.deepEqual(CARD_POP_KEYFRAMES, [
    { translate: '0px 0px', scale: '1' },
    { offset: 0.4, translate: '0px -2px', scale: '1.025' },
    { translate: '0px 0px', scale: '1' },
  ]);
  for (const frame of CARD_POP_KEYFRAMES) assert.equal('transform' in frame, false, 'hover 떠오름(transform)을 덮어쓰지 않는다');
  assert.deepEqual(CELEBRATE_GLOW_KEYFRAMES, [{ opacity: 0.7 }, { opacity: 0 }]);
});

test('빛 테두리 자리는 카드 테두리 안쪽 기준으로 잰다', () => {
  assert.deepEqual(
    rectWithin({ left: 120, top: 302, width: 64.4, height: 28 }, { left: 100, top: 200 }, { left: 1, top: 1 }, '6px'),
    { left: 19, top: 101, width: 64, height: 28, radius: '6px' },
  );
});

test('씬 카드 두 종류 모두 완료 연출을 첫 자식으로 두고, 완료 칸 표시를 단다', () => {
  const scenesView = read('src/views/ScenesView.tsx');
  const unified = read('src/components/scenes/UnifiedSceneCard.tsx');
  assert.match(scenesView, /<SceneCompletionFx celebrating=\{celebrating\} tinted=\{completionTintEnabled && isComplete\} \/>\n\n\s*\{\/\* 하이라이트 배경 오버레이 \*\/\}/);
  assert.match(unified, /<SceneCompletionFx celebrating=\{celebrating\} tinted=\{completionTintEnabled && isMergedComplete\} \/>\n\n\s*\{isHighlighted && <div className="scene-highlight-bg" \/>\}/);
  // 테두리 강조(border·그림자)는 그대로, 초록 그라데이션 바탕만 층으로 옮겼다.
  assert.match(scenesView, /completionTintEnabled && isComplete && 'scene-completion-tint-card'/);
  const fx = stripComments(read('src/components/scenes/SceneCompletionFx.tsx'));
  assert.match(fx, /card\.animate\(CARD_POP_KEYFRAMES, \{ duration: CARD_POP_MS, easing: CARD_POP_EASE \}\)/);
  assert.match(fx, /if \(!celebrating \|\| was\) return;/);
  assert.match(fx, /\[data-celebrate-cell="true"\]/);
  assert.match(read('src/components/scenes/StageSegmentToggle.tsx'), /data-celebrate-cell=\{isCurrent && i === STAGES\.length - 1 \? true : undefined\}/);
  assert.match(read('src/components/scenes/ScenePhaseToggle.tsx'), /data-celebrate-cell=\{isActive && state === 'done' \? true : undefined\}/);
});

test('초록빛은 그라데이션 바탕을 바꾸지 않고 겹친 층의 opacity 로 0.4초 동안 번진다', () => {
  const index = read('src/index.css');
  const tintRules = index.match(/(?:^|\n)[^\n{]*\.scene-completion-tint-card \{[^}]*\}/g) ?? [];
  assert.equal(tintRules.length, 2, '다크·라이트 두 규칙');
  for (const rule of tintRules) {
    assert.doesNotMatch(rule, /background/, '카드 바탕 그라데이션은 층으로 옮겼다');
    assert.match(rule, /border-color/);
  }
  const css = stripComments(read('src/styles/motion-scene-check.css'));
  assert.match(css, /\.scene-completion-tint-layer \{[^}]*z-index: -1;[^}]*opacity: 0;[^}]*transition: opacity 400ms ease-out;/);
  assert.match(css, /\.scene-completion-tint-layer\[data-on='true'\] \{\s*opacity: 1;\s*\}/);
  assert.match(css, /:root\[data-color-mode='light'\] \.scene-completion-tint-layer \{/);
});

/* ─── 파트 완료 화면 ─── */

test('파트 완료 장식은 4.5초 흐른 뒤 1초에 걸쳐 재생 속도 1→0 으로 잦아든다', () => {
  assert.equal(PART_COMPLETE_FLOW_MS, 4500);
  assert.equal(PART_COMPLETE_SETTLE_MS, 1000);
  assert.equal(PART_COMPLETE_EXIT_MS, 300);
  assert.equal(settlePlaybackRate(0), 1);
  assert.equal(settlePlaybackRate(1), 0);
  assert.equal(settlePlaybackRate(-1), 1);
  assert.equal(settlePlaybackRate(2), 0);
  let previous = 1;
  for (let p = 0.05; p <= 1; p += 0.05) {
    const rate = settlePlaybackRate(p);
    assert.ok(rate <= previous, `줄어들기만 한다 (${p})`);
    previous = rate;
  }
  assert.ok(settlePlaybackRate(0.05) > 0.99, '부드럽게 멈추기 시작한다');
});

test('장식 키프레임은 모양이 같은 transform 문자열이라 이어지고, 빛망울 경로는 제자리로 돌아온다', () => {
  const frames = driftKeyframes([{ x: 0, rotate: 7, scaleX: 0.94, opacity: 0.1 }, { x: 22, rotate: 7, scaleX: 1.04, opacity: 0.5 }]);
  assert.deepEqual(frames.map((frame) => frame.transform), ['translate(0px, 0px) rotate(7deg) scaleX(0.94)', 'translate(22px, 0px) rotate(7deg) scaleX(1.04)']);
  assert.deepEqual(frames.map((frame) => frame.opacity), [0.1, 0.5]);
  const orbs = buildBokehOrbs({ count: 6, minR: 18, maxR: 44, drift: 34, speed: 8, palette: [[1, 2, 3], [4, 5, 6]] }, seeded(11));
  assert.equal(orbs.length, 6);
  for (const orb of orbs) {
    assert.equal(orb.keyframes.length, 5);
    assert.equal(orb.keyframes[0].transform, 'translate(0px, 0px) scale(1)');
    assert.equal(orb.keyframes[4].transform, orb.keyframes[0].transform);
    assert.ok(orb.delayMs <= 0 && -orb.delayMs <= orb.durationMs, '처음부터 길 중간에서 움직인다');
    for (const frame of orb.keyframes) for (const key of Object.keys(frame)) assert.ok(MOTION_KEYS.has(key));
    assert.doesNotMatch(bokehBackground(orb.color, 0.2, orb.r), /blur/);
  }
});

test('본 완료 화면은 기억한다 — 중복 없이 최근 200개, 저장소가 깨지거나 없어도 멈추지 않는다', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  assert.deepEqual(readSeenPartCompletionKeys(storage), []);
  assert.deepEqual(rememberSeenPartCompletionKey('a', storage), ['a']);
  assert.deepEqual(rememberSeenPartCompletionKey('b', storage), ['a', 'b']);
  assert.deepEqual(rememberSeenPartCompletionKey('a', storage), ['b', 'a']);
  assert.deepEqual(JSON.parse(data.get(PART_COMPLETE_SEEN_STORAGE_KEY) ?? '[]'), ['b', 'a']);
  for (let i = 0; i < PART_COMPLETE_SEEN_MAX + 10; i++) rememberSeenPartCompletionKey(`k${i}`, storage);
  const kept = readSeenPartCompletionKeys(storage);
  assert.equal(kept.length, PART_COMPLETE_SEEN_MAX);
  assert.equal(kept.at(-1), `k${PART_COMPLETE_SEEN_MAX + 9}`);
  data.set(PART_COMPLETE_SEEN_STORAGE_KEY, '{broken');
  assert.deepEqual(readSeenPartCompletionKeys(storage), []);
  data.set(PART_COMPLETE_SEEN_STORAGE_KEY, JSON.stringify(['x', 3, null]));
  assert.deepEqual(readSeenPartCompletionKeys(storage), ['x']);
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(readSeenPartCompletionKeys(throwing), []);
  assert.deepEqual(rememberSeenPartCompletionKey('z', throwing), ['z']);
  assert.deepEqual(readSeenPartCompletionKeys(null), []);
});

test('파트 완료 화면: 무한 반복·카드 유리 흐림 없이, 닫으면 0.3초 사라지고 본 화면은 카드만 작게', () => {
  const overlay = stripComments(read('src/components/scenes/PartCompleteOverlay.tsx'));
  assert.doesNotMatch(overlay, /repeat: Infinity/);
  assert.doesNotMatch(overlay, /backdropFilter|backdrop-blur/);
  assert.doesNotMatch(overlay, /filter: ribbon\.blur|filter: 'blur\(10px\)'|filter: o\.r/);
  assert.match(overlay, /iterations: Infinity,/, '잦아들어 멈출 때까지만 돈다');
  assert.match(overlay, /PART_COMPLETE_FLOW_MS\);/);
  assert.match(overlay, /animations\.forEach\(\(animation\) => animation\.pause\(\)\);/);
  assert.match(overlay, /useSettlingDecor\(decorRefs, decorMotions, showDecor && !reduce\);/);
  assert.match(overlay, /exit=\{\{ opacity: 0, transition: \{ duration: PART_COMPLETE_EXIT_MS \/ 1000, ease: EASE\.in \} \}\}/);
  assert.match(overlay, /const showDecor = !compact;/);
  assert.match(overlay, /part-complete-restore/);
  const scenesView = read('src/views/ScenesView.tsx');
  assert.doesNotMatch(scenesView, /function PartCompleteOverlay|function BokehOrbs|function AuroraMesh/);
  assert.match(scenesView, /useState<string\[\]>\(readSeenPartCompletionKeys\)/);
  // 기억은 에피소드·파트를 직접 고르기 전후로 값이 같은 키로(처음 들어온 화면과 다시 들어온 화면이 같은 완료면 같은 키).
  assert.match(scenesView, /if \(completionSeenKey\) setSeenCompletionOverlayKeys\(rememberSeenPartCompletionKey\(completionSeenKey\)\);/);
  assert.match(scenesView, /const completionOverlayCompact = completionSeenKey != null && seenCompletionOverlayKeys\.includes\(completionSeenKey\);/);
  assert.equal((scenesView.match(/compact=\{completionOverlayCompact\}/g) ?? []).length, 2);
  assert.equal((scenesView.match(/onDismiss=\{dismissCompletionOverlay\}/g) ?? []).length, 2);
  const css = stripComments(read('src/styles/motion-scene-check.css'));
  assert.match(css, /@keyframes part-complete-restore-in \{\s*from \{ opacity: 0; transform: translateY\(12px\); \}/);
  assert.match(css, /\.part-complete-restore \{\s*animation: part-complete-restore-in 200ms var\(--ease-out\);\s*\}/);
});

/* ─── 할 일 완료 손맛 ─── */

test('동그란 체크: 원은 초록 층 opacity, 체크는 scale 0→1 300ms 살짝 넘치는 곡선 — framer 없이', () => {
  const circle = stripComments(read('src/components/ui/SuccessCheckCircle.tsx'));
  assert.doesNotMatch(circle, /framer-motion/);
  assert.match(circle, /role="checkbox"/);
  assert.match(circle, /aria-checked=\{checked\}/);
  assert.match(circle, /disabled=\{disabled\}/);
  const css = stripComments(read('src/styles/motion-scene-check.css'));
  assert.match(css, /\.success-check\[data-on='true'\] \.success-check-mark \{[^}]*transform 300ms var\(--ease-spring\)/);
  assert.match(css, /\.success-check-fill \{[^}]*opacity: 0;[^}]*transition: opacity/);
  assert.match(css, /\.thread-todo-text \{[^}]*text-decoration-color: transparent;[^}]*color 220ms[^}]*text-decoration-color 220ms/);
  assert.match(css, /\.thread-todo-text\[data-done='true'\] \{[^}]*text-decoration-color: currentColor;/);
  const section = read('src/components/scenes/ThreadTodoSection.tsx');
  assert.match(section, /transition-opacity duration-150 hover:bg-bg-primary\/50', busy && 'opacity-60'/);
});

test("내 리테이크: 끝낸 줄을 원래 자리에 잠깐 남기고, 되돌아온 줄이 있으면 그 줄을 쓴다", () => {
  const items = [{ id: 'a' }, { id: 'c' }];
  const leavingB = { item: { id: 'b' }, index: 1, fading: false };
  assert.deepEqual(withLeavingRows(items, [leavingB]).map((row) => [row.item.id, row.leaving !== null]), [['a', false], ['b', true], ['c', false]]);
  // 저장 실패로 같은 id 가 돌아오면 남겨 둔 줄은 버린다.
  assert.deepEqual(withLeavingRows([{ id: 'a' }, { id: 'b' }], [leavingB]).map((row) => [row.item.id, row.leaving !== null]), [['a', false], ['b', false]]);
  // 목록이 짧아졌으면 끝에 붙인다.
  assert.deepEqual(withLeavingRows([], [{ item: { id: 'x' }, index: 5, fading: true }]).map((row) => row.item.id), ['x']);
  assert.equal(RETAKE_DONE_HOLD_MS, 400);
  assert.equal(RETAKE_DONE_FADE_MS, 150);
  assert.equal(remainingLeaveMs(1000, 1000), 550);
  assert.equal(remainingLeaveMs(1000, 1400), 150);
  assert.equal(remainingLeaveMs(1000, 2000), 0);
  const css = stripComments(read('src/styles/motion-scene-check.css'));
  assert.match(css, /\.my-retake-row \{[^}]*transition: opacity 150ms/);
  assert.match(css, /\.my-retake-row-tint \{[^}]*background: rgb\(var\(--color-accent\) \/ 0\.06\);[^}]*transition: opacity 150ms/);
  assert.match(css, /@keyframes my-retake-note-in \{\s*from \{ opacity: 0; transform: translateY\(-4px\); \}/);
  const widget = read('src/components/widgets/MyRetakesWidget.tsx');
  assert.match(widget, /useRowFlip\(listRef, /);
  assert.match(widget, /data-flip-id=\{revision\.id\}/);
  assert.match(widget, /<SuccessCheckCircle checked popIn size="sm" \/>/);
});

test('줄 FLIP: 전후 모두 있는 줄 중 움직인 줄만 옛 자리에서 출발한다', () => {
  const before = new Map([['a', 0], ['b', 40], ['c', 80]]);
  const after = new Map([['a', 0], ['c', 40], ['d', 80]]);
  assert.deepEqual(rowFlipShifts(before, after), [['c', 40]]);
  assert.deepEqual(rowFlipShifts(new Map([['a', 10]]), new Map([['a', 10.3]])), []);
});
