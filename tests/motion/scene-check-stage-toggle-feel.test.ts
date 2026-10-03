import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  STAGE_FILL_MS,
  STAGE_FILL_STEP_MS,
  stageCurrentFlags,
  stageFillSettleMs,
  stageFillSteps,
  stageOnFromKey,
  stageOnKey,
} from '../../src/components/scenes/stageToggleMotion.ts';
import { SEQUENTIAL_STAGE_ORDER, buildSequentialStagePatch } from '../../src/utils/sceneStageProgression.ts';

/* 움직임 폴리싱 6번 stage-toggle-feel — 단계 버튼 눌림·차오름·미끄러짐 + 카드 선택 체크 '톡'. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const bits = (key: string) => stageOnFromKey(key);

/* ─── 순서 계산 ─── */

test('여러 칸이 한 번에 켜지면 LO→완료→검수→PNG, 꺼지면 PNG→검수→완료→LO 순서로 이어진다', () => {
  assert.deepEqual(stageFillSteps(bits('0000'), bits('1111')), [0, 1, 2, 3]);
  assert.deepEqual(stageFillSteps(bits('1111'), bits('0000')), [3, 2, 1, 0]);
  // 한 칸만 바뀌면 기다림 없이 바로.
  assert.deepEqual(stageFillSteps(bits('0000'), bits('1000')), [0, 0, 0, 0]);
  assert.deepEqual(stageFillSteps(bits('1110'), bits('1111')), [0, 0, 0, 0]);
});

test('켜짐은 그대로인데 현재 단계 표시만 옮겨 가는 칸은 사슬의 마지막 순서에 맞춰 바뀐다', () => {
  // 전부 켜진 상태에서 '완료'를 눌러 LO 만 남김: PNG(0)→검수(1)→완료(2) 가 빠진 뒤 LO 가 진해진다(2).
  assert.deepEqual(stageFillSteps(bits('1111'), bits('1000')), [2, 2, 1, 0]);
  // LO 만 켜진 상태에서 검수까지: 완료(0)→검수(1), LO 는 검수가 차오를 때(1) 옅어진다.
  assert.deepEqual(stageFillSteps(bits('1000'), bits('1110')), [1, 0, 1, 0]);
});

test('실시간 수신처럼 켜짐·꺼짐이 섞여도 각자 0 부터 센다', () => {
  assert.deepEqual(stageFillSteps(bits('1010'), bits('0101')), [1, 0, 0, 1]);
  assert.deepEqual(stageFillSteps(bits('1111'), bits('1111')), [0, 0, 0, 0]);
});

test('앞 단계까지 켜기/뒤 단계까지 끄기 — 누른 칸이 항상 사슬의 마지막이다', () => {
  // 앞에서부터 차례로 켜진 상태(0000·1000·1100·1110·1111)만. 중간이 빈 옛 데이터는 켜짐·꺼짐이 섞여 각자 센다(위 테스트).
  for (const mask of [0b0000, 0b0001, 0b0011, 0b0111, 0b1111]) {
    const before = Object.fromEntries(
      SEQUENTIAL_STAGE_ORDER.map((stage, index) => [stage, Boolean(mask & (1 << index))]),
    ) as Record<(typeof SEQUENTIAL_STAGE_ORDER)[number], boolean>;
    SEQUENTIAL_STAGE_ORDER.forEach((target, targetIndex) => {
      const patch = buildSequentialStagePatch(before, target);
      const prev = SEQUENTIAL_STAGE_ORDER.map((stage) => before[stage]);
      const next = SEQUENTIAL_STAGE_ORDER.map((stage) => patch[stage]);
      const steps = stageFillSteps(prev, next);
      const changed = next.map((value, index) => value !== prev[index]);
      if (!changed[targetIndex]) return;
      const changedSteps = steps.filter((_, index) => changed[index]);
      assert.equal(steps[targetIndex], Math.max(...changedSteps), `mask ${mask} → ${target}`);
      assert.deepEqual([...changedSteps].sort((a, b) => a - b), changedSteps.map((_, i) => i), `mask ${mask} → ${target}: 0,1,2… 빈틈 없이`);
    });
  }
});

test('현재 단계 규칙과 끝나는 시점', () => {
  assert.deepEqual(stageCurrentFlags(bits('1100')), [false, true, false, false]);
  assert.deepEqual(stageCurrentFlags(bits('1111')), [false, false, false, true]);
  assert.deepEqual(stageCurrentFlags(bits('0000')), [false, false, false, false]);
  assert.equal(stageFillSettleMs([0, 1, 2, 3]), 3 * STAGE_FILL_STEP_MS + STAGE_FILL_MS + 40);
  assert.equal(stageFillSettleMs([0, 0, 0, 0]), STAGE_FILL_MS + 40);
  assert.equal(stageOnKey(bits('1010')), '1010');
});

/* ─── 세 버튼 묶음 ─── */

test('LO/완료/검수/PNG 칸: 바탕색·굵기를 바꾸지 않고 채움 층으로, transition-all 없음', () => {
  const source = read('src/components/scenes/StageSegmentToggle.tsx');
  assert.doesNotMatch(source, /transition-all/);
  assert.doesNotMatch(source, /backgroundColor/);
  assert.doesNotMatch(source, /fontWeight/);
  assert.doesNotMatch(source, /boxShadow/);
  assert.match(source, /'stage-seg compact-label-container/);
  assert.match(source, /className="stage-seg-fill"[\s\S]*data-on=\{isDone\}[\s\S]*data-current=\{isCurrent\}/);
  assert.match(source, /'--stage-step': fillSteps\[i\]/);
  assert.match(source, /useStageFillSteps\(STAGES\.map/);
  // 기존 계약 유지: 누르는 순간 반영, 이어 보기 표시.
  assert.match(source, /onPointerDown=\{\(e\) => \{/);
  assert.match(source, /data-continuity-stage-segment/);
});

test('액팅 칩: 색 알약 하나가 미끄러지고 차수 표시는 흐름에서 빠진다(높이 불변)', () => {
  const source = read('src/components/scenes/ScenePhaseToggle.tsx');
  assert.doesNotMatch(source, /transition-all/);
  assert.doesNotMatch(source, /backgroundColor/);
  assert.doesNotMatch(source, /fontWeight/);
  assert.match(source, /className=\{cn\('stage-seg-pill rounded-md'/);
  assert.match(source, /'--stage-pill-index': activeIndex/);
  assert.match(source, /className="stage-seg-pill-layer"[\s\S]*data-on=\{activeState === state\}/);
  // 예전: flex-col 안의 줄(칩 위에 한 줄이 생겨 카드가 덜컹 길어짐) → 이제 absolute 배지.
  assert.doesNotMatch(source, /w-full flex flex-col gap-1\.5/);
  assert.match(source, /'stage-round-badge',/);
  assert.match(source, /roundBadgePlacement === 'above' && 'stage-round-badge--above'/);
  for (const modal of ['src/components/scenes/SceneDetailModal.tsx', 'src/components/scenes/UnifiedSceneDetailModal.tsx']) {
    assert.match(read(modal), /<ScenePhaseToggle[\s\S]{0,200}roundBadgePlacement="above"/, modal);
  }
});

test('담당자별 버튼: 액팅은 알약, BG 는 칸 채움 — transition-all·바탕색 없음, 차수 배지가 줄 높이를 늘리지 않는다', () => {
  const source = read('src/components/scenes/AssigneeProgressStack.tsx');
  assert.doesNotMatch(source, /transition-all/);
  assert.doesNotMatch(source, /backgroundColor/);
  assert.match(source, /className="stage-seg-pill rounded"/);
  assert.match(source, /function AssigneeStageControls/);
  assert.match(source, /useStageFillSteps\(STAGES\.map/);
  assert.match(source, /className="stage-seg-fill \[--stage-seg-dim:1\]"/);
  // 이름 12px + 배지 14px + 간격 2px = 버튼 줄 28px.
  assert.match(source, /'h-3\.5 min-w-\[3\.25rem\] justify-center px-1 text-\[9px\]'/);
  assert.match(source, /truncate text-\[10px\] leading-3 font-semibold/);
});

test('카드 선택 체크는 늘 그려 두고 data-on 으로 톡 — 위치 규칙(top-9/top-1.5·top-2.5)은 그대로', () => {
  const single = read('src/views/ScenesView.tsx');
  const unified = read('src/components/scenes/UnifiedSceneCard.tsx');
  for (const [file, source, top] of [
    ['ScenesView', single, /revisionCount > 0 \? 'top-9' : 'top-1\.5'/],
    ['UnifiedSceneCard', unified, /openRevCount > 0 \|\| resolvedRevCount > 0 \? 'top-9' : 'top-2\.5'/],
  ] as const) {
    assert.match(source, /data-on=\{isSelected\}\s*className=\{cn\(\s*'scene-select-check absolute/, file);
    assert.match(source, top, file);
    assert.doesNotMatch(source, /\{isSelected && \(\s*<div className=\{cn\(\s*'absolute right-/, file);
  }
});

/* ─── CSS ─── */

test('CSS: transform·opacity·color 만 전환, 사양 박자(눌림 .94/80ms → 260ms 톡, 채움 220ms·40ms 간격, 알약 260ms, 체크 200ms)', () => {
  const css = stripComments(read('src/styles/motion-scene-check.css'));
  const block = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} 규칙 없음`);
    return css.slice(at, css.indexOf('}', at));
  };

  const seg = block('.stage-seg');
  assert.match(seg, /transition-property: transform, color, opacity;/);
  assert.doesNotMatch(seg, /background|box-shadow|\ball\b/);
  assert.match(seg, /var\(--motion-slow\)/);
  assert.match(seg, /var\(--ease-spring\)/);
  assert.match(seg, /calc\(var\(--stage-step, 0\) \* 40ms\)/);

  const active = block(".stage-seg:active:not(:disabled):not([aria-disabled='true'])");
  assert.match(active, /transform: scale\(0\.94\);/);
  assert.match(active, /transition-duration: 80ms/);

  const fill = block('.stage-seg-fill');
  assert.match(fill, /transform: scaleX\(0\);/);
  assert.match(fill, /transform-origin: left center;/);
  assert.match(fill, new RegExp(`transition-duration: ${STAGE_FILL_MS}ms, 160ms, ${STAGE_FILL_MS}ms;`));
  assert.match(fill, new RegExp(`calc\\(var\\(--stage-step, 0\\) \\* ${STAGE_FILL_STEP_MS}ms\\)`));
  assert.match(css, /\.stage-seg-fill\[data-on='true'\] \{\s*transform: scaleX\(1\);/);
  assert.match(css, /\.stage-seg-fill\[data-current='true'\] \{\s*opacity: 1;/);

  const pill = block('.stage-seg-pill');
  assert.match(pill, /transform: translateX\(calc\(var\(--stage-pill-index, 0\) \* \(100% \+ var\(--stage-pill-gap, 2px\)\)\)\);/);
  assert.match(pill, /transform var\(--motion-slow\) cubic-bezier\(0\.2, 0\.9, 0\.3, 1\.1\)/);
  assert.match(block('.stage-seg-pill-layer'), /transition: opacity 200ms/);

  assert.match(block('.stage-round-badge'), /position: absolute;/);
  assert.match(css, /@keyframes stage-round-in \{\s*from \{ opacity: 0; transform: translateY\(4px\); \}/);

  assert.match(block('.scene-select-check'), /transform: scale\(0\.4\);/);
  assert.match(block(".scene-select-check[data-on='true']"), /transform 200ms var\(--ease-spring\)/);
  assert.match(block(".scene-select-check[data-on='true'] path"), /stroke-dashoffset 160ms var\(--ease-out\) 60ms/);

  // 움직이는 층에 흐림·무한 반복 없음.
  assert.doesNotMatch(css, /backdrop-filter|infinite/);
  // 그림자는 미리 그린 층의 opacity 로만 — box-shadow 를 전환 목록에 넣지 않는다.
  assert.doesNotMatch(css, /transition[^;]*box-shadow/);
});

test('겹친 층은 쉬는 동안 상자 없음(display: none) — 사라질 땐 다 줄어든/흐려진 뒤, 나타날 땐 @starting-style 에서 (최종 성능 측정 지적)', () => {
  // 카드 46장 × 칸 4개마다 hover 바탕·채움·빛·선택 체크 층이 늘 깔려 있으면 마우스 판정(HitTest)이 1.7→4.6ms 로 늘었다.
  const css = stripComments(read('src/styles/motion-scene-check.css'));
  const block = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} 규칙 없음`);
    return css.slice(at, css.indexOf('}', at));
  };
  const hover = block('.stage-seg::before');
  assert.match(hover, /display: none;/);
  assert.match(hover, /transition: opacity var\(--motion-fast\) var\(--ease-std\), display var\(--motion-fast\) allow-discrete;/);
  assert.match(block(".stage-seg[data-on='false']:not([aria-disabled='true']):hover::before"), /display: block;\s*opacity: 1;/);

  const fill = block('.stage-seg-fill');
  assert.match(fill, /display: none;/);
  assert.match(fill, /transition-property: transform, opacity, display;/);
  assert.match(fill, /transition-behavior: allow-discrete;/);
  assert.match(css, /\.stage-seg-fill\[data-on='true'\] \{\s*transform: scaleX\(1\);\s*display: block;/);

  const glow = css.slice(css.indexOf('.stage-seg-fill::after {'));
  assert.match(glow, /^\.stage-seg-fill::after \{\s*display: none;\s*transition: opacity 160ms var\(--ease-std\), display 160ms allow-discrete;/);
  assert.match(css, /\.stage-seg-fill\[data-glow='true'\]::after \{\s*display: block;/);
  // 액팅 칩 알약 층의 빛은 그대로(늘 그려 둠)
  assert.doesNotMatch(css, /\.stage-seg-pill-layer::after \{\s*display: none/);

  assert.match(block('.scene-select-check'), /display var\(--motion-fast\) allow-discrete;/);
  assert.match(css, /\.scene-select-check:not\(\[data-on='true'\]\) \{\s*display: none;/, 'Tailwind flex 보다 특이도가 높아야 덮는다');

  // 출발 모습: hover 는 늘, 채움·빛·체크는 한 번 그려진 묶음(data-motion-armed)에서만 — 처음부터 켜진 칸이 차오르지 않게.
  const at = css.indexOf('@starting-style {');
  assert.ok(at >= 0, '@starting-style');
  const starting = css.slice(at, css.indexOf('\n}', at));
  assert.match(starting, /\.stage-seg\[data-on='false'\]:not\(\[aria-disabled='true'\]\):hover::before \{\s*opacity: 0;/);
  assert.match(starting, /\[data-motion-armed\] \.stage-seg-fill\[data-on='true'\] \{\s*opacity: var\(--stage-seg-dim, 0\.125\);\s*transform: scaleX\(0\);/);
  assert.match(starting, /\[data-motion-armed\] \.stage-seg-fill\[data-glow='true'\]::after \{\s*opacity: 0;/);
  assert.match(starting, /\[data-motion-armed\] \.scene-select-check\[data-on='true'\] \{\s*opacity: 0;\s*transform: scale\(0\.4\);/);
  assert.match(starting, /\[data-motion-armed\] \.scene-select-check\[data-on='true'\] \.scene-select-check-mark \{\s*stroke-dashoffset: 13;/, '태그가 아니라 클래스로(무장 때 아이콘 path 전체 재계산 방지)');
  assert.doesNotMatch(starting, /\[data-motion-armed\][^{]*\s(path|svg|span|div|button)\s*\{/, '무장 조건 규칙의 대상은 클래스로만');
  for (const file of ['src/components/scenes/UnifiedSceneCard.tsx', 'src/views/ScenesView.tsx']) {
    assert.match(read(file), /<path className="scene-select-check-mark" d="M2 6l3 3 5-5"/, file);
  }
  assert.doesNotMatch(starting, /^\s*\.stage-seg-fill|^\s*\.scene-select-check/m, '무장 표시 없이 쓰면 카드가 그려질 때마다 차오른다');

  // 무장: 묶음마다 한 번 그려진 뒤(크기 감시 첫 알림 → 다음 프레임) 붙는다. 감시는 하나를 같이 쓴다.
  const hook = read('src/hooks/useMotionArmed.ts');
  assert.match(hook, /export const MOTION_ARMED_ATTR = 'data-motion-armed';/);
  assert.match(hook, /if \(width === 0 && height === 0\) continue;/, '숨은 채 마운트된 묶음은 보이게 된 뒤에');
  assert.match(hook, /observer\.unobserve\(entry\.target\);\s*queued\.push\(entry\.target\);/);
  assert.match(hook, /flushFrame = requestAnimationFrame\(flush\)/);
  assert.equal(hook.match(/new ResizeObserver\(/g)?.length, 1, '감시 하나를 같이 쓴다');
  for (const [file, refName] of [
    ['src/components/scenes/StageSegmentToggle.tsx', 'armRef'],
    ['src/components/scenes/AssigneeProgressStack.tsx', 'armRef'],
    ['src/components/scenes/UnifiedSceneCard.tsx', 'cardRootRef'],
    ['src/views/ScenesView.tsx', 'highlightCardRef'],
  ] as const) {
    const source = read(file);
    assert.match(source, /import \{ useMotionArmed \} from '@\/hooks\/useMotionArmed';/, file);
    assert.match(source, new RegExp(`useMotionArmed\\(${refName}\\);`), file);
    assert.match(source, new RegExp(`ref=\\{${refName}\\}`), file);
  }
});

test('CSS: 동작 줄이기면 눌림·채움·미끄러짐·지연 없이 색만 즉시', () => {
  const css = stripComments(read('src/styles/motion-scene-check.css'));
  const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(at >= 0);
  const reduce = css.slice(at);
  assert.match(reduce, /transition-delay: 0ms !important;/);
  for (const selector of ['.stage-seg-fill,', '.stage-seg-pill,', '.scene-select-check path']) {
    assert.ok(reduce.slice(0, reduce.indexOf('transition-delay')).includes(selector), `${selector} 지연 해제`);
  }
  assert.match(reduce, /\.stage-seg:active:not\(:disabled\):not\(\[aria-disabled='true'\]\) \{\s*transform: none;/);
  assert.match(reduce, /\.stage-seg-fill \{\s*transform: none;/);
  assert.match(reduce, /\.stage-seg-fill\[data-on='false'\] \{\s*opacity: 0;/);
  assert.match(reduce, /\.stage-round-badge,\s*\.stage-round-pop \{\s*animation: none;/);
  assert.match(reduce, /\.scene-select-check\[data-on='true'\] \{\s*transform: none;/);
});
