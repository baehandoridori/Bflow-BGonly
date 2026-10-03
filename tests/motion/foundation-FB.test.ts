import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  DEFAULT_MOTION_LEVEL,
  MOTION_LEVELS,
  applyStoredMotionLevel,
  getMotionLevel,
  isMinimalMotionInDom,
  motionLevelBroadcastPayload,
  motionLevelFromBroadcast,
  motionLevelWriteMark,
  normalizeMotionLevel,
  resetMotionLevelForTest,
  resolveMotionPref,
  setMotionLevel,
  subscribeMotionLevel,
} from '../../src/utils/motionLevel.ts';
import { createFrameLoop } from '../../src/utils/frameLoop.ts';
import { animateEl, prefersReducedMotion } from '../../src/utils/motion.ts';

/* 움직임 폴리싱 바탕 B — 윈도우 '애니메이션 끄기'(동작 줄이기)를 앱 전체가 따르게(1단계) +
   앱 안 '움직임: 기본 / 가볍게 / 최소' 설정(2단계). */

const read = (file: string) => readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// 빌드 때 '최소' 짝을 만드는 PostCSS 플러그인(scripts/postcss-motion-minimal.cjs)을 거친 CSS.
const requireCjs = createRequire(import.meta.url);
const postcss = requireCjs('postcss') as (plugins: unknown[]) => { process(css: string, opts: { from: string }): Promise<{ css: string }> };
const motionMinimal = requireCjs('../../scripts/postcss-motion-minimal.cjs') as (() => unknown) & { MINIMAL_ON: string; minimalMirrorSelectors(selector: string): string[] };
const MINIMAL_ON = motionMinimal.MINIMAL_ON;
/** 동작 줄이기 규칙 선택자 하나의 '최소' 짝(html 자신 + html 안) — 빌드된 CSS 의 선택자 목록 모양. */
const minimalSel = (...selectors: string[]) => selectors.flatMap((sel) => motionMinimal.minimalMirrorSelectors(sel)).join(', ');
async function buildMinimal(file: string): Promise<string> {
  const result = await postcss([motionMinimal()]).process(readFileSync(file, 'utf-8'), { from: file });
  return stripComments(result.css.replace(/\r\n/g, '\n'));
}

type FakeDoc = { documentElement: { dataset: Record<string, string> } };
const g = globalThis as unknown as { document?: FakeDoc; window?: unknown };

function withFakeDocument<T>(run: (doc: FakeDoc) => T): T {
  const previous = g.document;
  const doc: FakeDoc = { documentElement: { dataset: {} } };
  g.document = doc;
  try {
    return run(doc);
  } finally {
    if (previous === undefined) delete g.document;
    else g.document = previous;
  }
}

/* ─── 설정값 ─── */

test('움직임 설정값: 세 가지, 기본은 full, 모르는 값은 기본으로', () => {
  assert.deepEqual([...MOTION_LEVELS], ['full', 'lite', 'minimal']);
  assert.equal(DEFAULT_MOTION_LEVEL, 'full');
  assert.equal(normalizeMotionLevel('lite'), 'lite');
  assert.equal(normalizeMotionLevel('minimal'), 'minimal');
  for (const bad of [undefined, null, '', 'reduce', 'LITE', 1, {}]) assert.equal(normalizeMotionLevel(bad), 'full');
});

test('판단표: 최소=동작 줄이기와 같게(reduce), 가볍게 이상이면 반복 장식 멈춤(lite), OS 동작 줄이기는 늘 둘 다', () => {
  assert.deepEqual({ ...resolveMotionPref(false, 'full') }, { reduce: false, lite: false, level: 'full' });
  assert.deepEqual({ ...resolveMotionPref(false, 'lite') }, { reduce: false, lite: true, level: 'lite' });
  assert.deepEqual({ ...resolveMotionPref(false, 'minimal') }, { reduce: true, lite: true, level: 'minimal' });
  for (const level of MOTION_LEVELS) {
    const pref = resolveMotionPref(true, level);
    assert.equal(pref.reduce, true, `OS 동작 줄이기 + ${level}`);
    assert.equal(pref.lite, true, `OS 동작 줄이기 + ${level}`);
  }
  // 같은 조합이면 같은 객체(렌더마다 새 객체 X)
  assert.equal(resolveMotionPref(false, 'lite'), resolveMotionPref(false, 'lite'));
  assert.ok(Object.isFrozen(resolveMotionPref(true, 'full')));
});

test('가게: 바꾸면 <html data-motion> 에 적고 구독자에게 한 번 알린다 — 같은 값이면 알리지 않는다', () => {
  withFakeDocument((doc) => {
    resetMotionLevelForTest();
    let calls = 0;
    const off = subscribeMotionLevel(() => { calls += 1; });
    assert.equal(getMotionLevel(), 'full');
    assert.equal(setMotionLevel('lite'), 'lite');
    assert.equal(doc.documentElement.dataset.motion, 'lite');
    // CSS 용 '있다/없다' 표시(가볍게 이상 · 최소) — 값과 함께 바뀐다.
    assert.equal(doc.documentElement.dataset.motionLite, '');
    assert.equal(doc.documentElement.dataset.motionMinimal, undefined);
    assert.equal(calls, 1);
    setMotionLevel('lite');
    assert.equal(calls, 1, '같은 값은 알리지 않는다');
    setMotionLevel('nonsense');
    assert.equal(getMotionLevel(), 'full');
    assert.equal(doc.documentElement.dataset.motion, 'full');
    assert.equal(doc.documentElement.dataset.motionLite, undefined);
    assert.equal(doc.documentElement.dataset.motionMinimal, undefined);
    assert.equal(calls, 2);
    off();
    setMotionLevel('minimal');
    assert.equal(calls, 2, '구독을 끊으면 더 알리지 않는다');
    assert.equal(isMinimalMotionInDom(), true);
    assert.equal(doc.documentElement.dataset.motionMinimal, '');
    assert.equal(doc.documentElement.dataset.motionLite, '', "'최소'는 '가볍게' 규칙도 함께 받는다");
    resetMotionLevelForTest();
  });
});

test('시작 때 늦게 읽어 온 저장값은, 그사이 사용자가 바꿨으면 덮어쓰지 않는다', () => {
  withFakeDocument(() => {
    resetMotionLevelForTest();
    const mark = motionLevelWriteMark();
    assert.equal(applyStoredMotionLevel('lite', mark), true);
    assert.equal(getMotionLevel(), 'lite');

    const mark2 = motionLevelWriteMark();
    setMotionLevel('minimal'); // 읽는 사이 설정 화면에서 바꿈
    assert.equal(applyStoredMotionLevel('full', mark2), false);
    assert.equal(getMotionLevel(), 'minimal');
    resetMotionLevelForTest();
  });
});

test('방송: { motionLevel } 만 받아들이고 다른 설정 방송은 무시한다', () => {
  assert.equal(motionLevelFromBroadcast({ motionLevel: 'lite' }), 'lite');
  assert.equal(motionLevelFromBroadcast({ motionLevel: 'weird' }), 'full');
  assert.equal(motionLevelFromBroadcast({ plexus: {} }), null);
  assert.equal(motionLevelFromBroadcast(null), null);
  assert.equal(motionLevelFromBroadcast('lite'), null);
});

test('방송 메아리: 내 창이 보낸 오래된 방송은 버리고(연타 깜빡임 방지), 마지막 요청·다른 창 방송은 따른다', () => {
  const me = { from: 'win-a', seq: 2 };
  // 가볍게(1) → 최소(2)를 빠르게 고름: 먼저 끝난 '가볍게' 방송이 뒤늦게 돌아와도 되돌아가지 않는다
  assert.equal(motionLevelFromBroadcast(motionLevelBroadcastPayload('lite', { from: 'win-a', seq: 1 }), me), null);
  assert.equal(motionLevelFromBroadcast(motionLevelBroadcastPayload('minimal', { from: 'win-a', seq: 2 }), me), 'minimal');
  // 다른 창(플로팅 위젯 등)의 방송은 번호와 상관없이 따른다
  assert.equal(motionLevelFromBroadcast(motionLevelBroadcastPayload('lite', { from: 'win-b', seq: 1 }), me), 'lite');
  // 번호 없는 방송·내 창 표시를 넘기지 않은 경우는 그대로 따른다
  assert.equal(motionLevelFromBroadcast({ motionLevel: 'lite', motionLevelFrom: 'win-a' }, me), 'lite');
  assert.equal(motionLevelFromBroadcast(motionLevelBroadcastPayload('lite', { from: 'win-a', seq: 1 })), 'lite');
  assert.deepEqual(
    motionLevelBroadcastPayload('full', { from: 'w', seq: 3 }),
    { motionLevel: 'full', motionLevelFrom: 'w', motionLevelSeq: 3 },
  );
});

test("React 밖 판단(prefersReducedMotion·animateEl)도 '최소'를 동작 줄이기로 본다", () => {
  assert.equal(prefersReducedMotion(), false, '창·문서가 없으면 false');
  withFakeDocument((doc) => {
    doc.documentElement.dataset.motion = 'lite';
    assert.equal(prefersReducedMotion(), false, "'가볍게'는 짧은 반응을 남긴다");
    doc.documentElement.dataset.motion = 'minimal';
    assert.equal(prefersReducedMotion(), true);

    const calls: Array<{ frames: Keyframe[]; options: KeyframeAnimationOptions }> = [];
    const el = { animate(frames: Keyframe[], options: KeyframeAnimationOptions) { calls.push({ frames, options }); return {} as Animation; } };
    animateEl(el as unknown as Element, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260 });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].frames, [{ opacity: 0 }, { opacity: 1 }], '움직임 키는 빠진다');
    assert.equal(calls[0].options.duration, 120);
  });
});

/* ─── 배경 루프 ─── */

function fakeFrames() {
  const queue = new Map<number, (now: number) => void>();
  let next = 1;
  let now = 0;
  return {
    requestFrame: (cb: (now: number) => void) => { const id = next++; queue.set(id, cb); return id; },
    cancelFrame: (id: number) => { queue.delete(id); },
    pending: () => queue.size,
    tick() {
      now += 16;
      const callbacks = [...queue.values()];
      queue.clear();
      for (const cb of callbacks) cb(now);
    },
  };
}

test('배경 루프: 움직이는 동안은 매 프레임 이어 그리고, 멈춤이면 한 장만 그린다', () => {
  const frames = fakeFrames();
  let draws = 0;
  const loop = createFrameLoop(() => { draws += 1; }, { still: false, ...frames });
  for (let i = 0; i < 5; i += 1) frames.tick();
  assert.equal(draws, 5);
  assert.equal(frames.pending(), 1);
  loop.dispose();
  assert.equal(frames.pending(), 0);

  const stillFrames = fakeFrames();
  let stillDraws = 0;
  const still = createFrameLoop(() => { stillDraws += 1; }, { still: true, ...stillFrames });
  for (let i = 0; i < 5; i += 1) stillFrames.tick();
  assert.equal(stillDraws, 1, '멈춤 상태는 첫 장 하나');
  assert.equal(still.isScheduled(), false);
});

test('배경 루프: 멈춘 동안 invalidate 는 한 장만, 풀리면 이어 가고, 다시 멈추면 그 프레임까지만', () => {
  const frames = fakeFrames();
  let draws = 0;
  const loop = createFrameLoop(() => { draws += 1; }, { still: true, ...frames });
  frames.tick();
  loop.invalidate();
  loop.invalidate(); // 겹쳐 불러도 한 장
  frames.tick();
  frames.tick();
  assert.equal(draws, 2);

  loop.setStill(false);
  frames.tick();
  frames.tick();
  frames.tick();
  assert.equal(draws, 5);

  loop.setStill(true);
  frames.tick(); // 이미 예약된 프레임은 그린다
  frames.tick();
  assert.equal(draws, 6);
  assert.equal(loop.isScheduled(), false);
  loop.dispose();
});

test('배경 루프: draw 가 false(아직 못 그림)면 멈춤 상태여도 다음 프레임에 다시 부른다', () => {
  const frames = fakeFrames();
  let draws = 0;
  const loop = createFrameLoop(() => { draws += 1; return draws >= 3; }, { still: true, ...frames });
  for (let i = 0; i < 6; i += 1) frames.tick();
  assert.equal(draws, 3);
  loop.dispose();
});

test('배경 루프: dispose 뒤에는 invalidate·setStill 로도 다시 그리지 않는다', () => {
  const frames = fakeFrames();
  let draws = 0;
  const loop = createFrameLoop(() => { draws += 1; }, { still: false, ...frames });
  loop.dispose();
  loop.invalidate();
  loop.setStill(true);
  loop.setStill(false);
  frames.tick();
  assert.equal(draws, 0);
  assert.equal(frames.pending(), 0);
});

/* ─── CSS: 동작 줄이기 전역 규칙을 이기는 !important 움직임이 없어야 한다 ─── */

function walkCss(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkCss(full);
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

/** !important 로 0.01ms 넘는 전환·애니메이션 길이를 정한 선언 중, 동작 줄이기 미디어 블록 밖에 있는 것. */
function importantMotionOutsideReduceMedia(css: string): string[] {
  const text = stripComments(css);
  const stack: string[] = [];
  const found: string[] = [];
  let last = 0;
  const check = (decl: string) => {
    const match = decl.trim().match(/^(transition|transition-duration|animation|animation-duration)\s*:\s*([\s\S]*)!important$/);
    if (!match) return;
    const times = [...match[2].matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map(([, n, unit]) => Number(n) * (unit === 's' ? 1000 : 1));
    // 박자 토큰(var(--motion-base) 등)도 길이다. 곡선 토큰(--ease-*)만 빼고, 값에 var() 가 있으면 길이가 있다고 본다.
    const varLengths = [...match[2].matchAll(/var\(\s*(--[\w-]+)/g)].filter(([, name]) => !name.startsWith('--ease'));
    if (!times.some((ms) => ms >= 1) && varLengths.length === 0) return;
    if (stack.some((header) => header.includes('prefers-reduced-motion'))) return;
    found.push(`${stack.join(' > ')} :: ${decl.trim().slice(0, 90)}`);
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') { stack.push(text.slice(last, i).trim()); last = i + 1; }
    else if (ch === '}') { check(text.slice(last, i)); stack.pop(); last = i + 1; }
    else if (ch === ';') { check(text.slice(last, i)); last = i + 1; }
  }
  return found;
}

test('src 의 모든 CSS: !important 전환·애니메이션은 동작 줄이기 미디어 블록 안에서만 (전역 규칙을 이기지 않게)', () => {
  const offenders = walkCss('src').flatMap((file) => importantMotionOutsideReduceMedia(read(file)).map((line) => `${file}: ${line}`));
  assert.deepEqual(offenders, []);
});

test('검사기 자체: 블록 밖 !important 는 잡고, no-preference 안·none·0.01ms 는 통과', () => {
  assert.equal(importantMotionOutsideReduceMedia('.a { transition: opacity .2s !important; }').length, 1);
  assert.equal(importantMotionOutsideReduceMedia('.a { color: red; animation: x 1s infinite !important }').length, 1);
  assert.equal(importantMotionOutsideReduceMedia('@media (prefers-reduced-motion: no-preference) { .a { transition: opacity .2s !important; } }').length, 0);
  assert.equal(importantMotionOutsideReduceMedia('.a { transition: none !important; animation-duration: 0.01ms !important; }').length, 0);
  // 박자 토큰으로 길이를 정해도 잡는다(곡선 토큰만 있고 길이 0 이면 통과)
  assert.equal(importantMotionOutsideReduceMedia('.a { transition: opacity var(--motion-base) !important; }').length, 1);
  assert.equal(importantMotionOutsideReduceMedia('.a { transition:\n    transform var(--motion-base) var(--ease-out),\n    color var(--motion-fast) var(--ease-out) !important; }').length, 1);
  assert.equal(importantMotionOutsideReduceMedia('.a { transition-duration: var(--motion-slow) !important; }').length, 1);
  assert.equal(importantMotionOutsideReduceMedia('@media (prefers-reduced-motion: no-preference) { .a { transition: opacity var(--motion-base) var(--ease-out) !important; } }').length, 0);
  assert.equal(importantMotionOutsideReduceMedia('.a { transition: opacity 0ms var(--ease-out) !important; }').length, 0);
});

test('토스트·대시보드 위젯의 !important 움직임은 no-preference 안으로 옮겼다(겹침·투명도 같은 값은 밖에 남김)', () => {
  const index = stripComments(read('src/index.css'));
  for (const selector of ['[data-sonner-toaster] [data-sonner-toast]', '[data-sonner-toast][data-removed="true"]', '[data-sonner-toast] [data-button]', '[data-sonner-toast] [data-close-button]', '.react-grid-item.react-grid-placeholder']) {
    assert.ok(
      index.includes(`@media (prefers-reduced-motion: no-preference) {\n  ${selector} {`),
      `no-preference 블록 없음: ${selector}`,
    );
  }
  const widget = stripComments(read('src/styles/widget-animations.css'));
  assert.match(widget, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.react-grid-item \{\s*transition: transform/);
  // 통합: 16번(끌어서 옮기기)이 잡은 위젯을 진하게(.95 → 1) 바꾸고 안착 규칙을 .react-grid-item.widget-settling 으로 좁혔다.
  assert.match(widget, /\n\.react-grid-item\.react-draggable-dragging \{\s*z-index: 100 !important;\s*opacity: 1 !important;\s*\}/);
  assert.match(widget, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.react-grid-item\.widget-settling \{/);
});

/* ─── CSS: '최소'·'가볍게' ─── */

test("'최소' 전역 규칙: 빌드 때 동작 줄이기 전역 규칙을 특이도 그대로 복제(정보 표시를 살리는 규칙을 누르지 않게)", async () => {
  // 예전에는 이 파일이 ID 특이도 '최소' 전역 규칙을 따로 두어, 동작 줄이기에서 정보 표시를 살리는 규칙까지 눌렀다.
  // 이제 scripts/postcss-motion-minimal.cjs 가 index.css 동작 줄이기 블록을 그대로 '최소' 짝으로 만든다.
  const css = stripComments(read('src/styles/motion-foundation.css'));
  assert.doesNotMatch(css, /#bf-motion-minimal/);
  assert.ok(!css.includes("html[data-motion='minimal']"), "손으로 쓴 '최소' 짝 없음(플러그인이 만든다)");
  const index = await buildMinimal('src/index.css');
  const at = index.indexOf(`${minimalSel('*', '*::before', '*::after')} {`);
  assert.ok(at >= 0, '전역 규칙의 최소 짝(특이도 0)');
  const body = index.slice(at, index.indexOf('}', at));
  for (const decl of ['animation-duration: 0.01ms !important', 'animation-iteration-count: 1 !important', 'transition-duration: 0.01ms !important', 'scroll-behavior: auto !important']) {
    assert.ok(body.includes(decl), decl);
  }
  // 동작 줄이기 전용 규칙의 '최소' 짝 — 카드 떠오름·누름 축소 없음
  assert.ok(index.includes(`${minimalSel('.bf-press:active:not(:disabled)')} { transform: none; }`), '누름 축소 없음');
  const foundation = (await buildMinimal('src/styles/motion-foundation.css')).replace(/\s+/g, ' ');
  assert.ok(foundation.includes(`${minimalSel('.bf-card-hover:hover')} { translate: none; }`), '카드 떠오름 없음');
  assert.ok(foundation.includes(`${minimalSel('.scene-card-interactive:hover')} { --tw-translate-y: 0px; }`), '씬 카드 떠오름 없음');
});

test("'가볍게' 이상: 숨 쉬는 장식을 멈춘다", () => {
  const css = stripComments(read('src/styles/motion-foundation.css'));
  const lite = ':root[data-motion-lite]';
  // 바탕 C: 새 댓글·새 버전 배지·그래프 정점은 미리 그린 빛 층(::before/::after)의 opacity 로 숨 쉰다 — 층을 멈춘다.
  for (const target of ['.comment-unread-badge::before', '.bflow-peak-pulse::after', '.bflow-badge-pulse::before', '.bflow-badge-pulse::after', '.bell-glow-soft::after', '.bell-glow-mention::after', '.scene-num-glow-wrap::before', '.editing-beam::before', '.scene-top-progress-fill::after', '.bflow-update-latest-card::before']) {
    assert.ok(css.includes(`${lite} ${target}`), `가볍게 정지 대상 없음: ${target}`);
  }
});

test("'가볍게' 이상: 뒤 흐림을 모두 끄고(인라인 흐림도 이김), 겹침 순서는 지키며, 다크 위젯 유리는 바탕을 올린다", () => {
  const css = stripComments(read('src/styles/motion-foundation.css'));
  const lite = ':root[data-motion-lite]';
  const selectors = [
    `${lite} :is(*, #bf-motion-lite),`,
    `${lite} :is(*, #bf-motion-lite)::before,`,
    `${lite} :is(*, #bf-motion-lite)::after {`,
  ].join('\n');
  const at = css.indexOf(selectors);
  assert.ok(at >= 0, '모든 요소·가상 요소를 ID 특이도로 고르는 흐림 끄기 규칙');
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  assert.match(body, /-webkit-backdrop-filter: none !important;/);
  assert.match(body, /(^|\s)backdrop-filter: none !important;/);
  // 흐림이 만들던 쌓임 맥락은 남긴다(인라인 style·Tailwind 로 흐림을 준 요소)
  const isolate = `${lite} :is([style*='backdrop-filter: blur'], [style*='backdrop-filter: saturate'], [class*='backdrop-blur']) {`;
  const isolateAt = css.indexOf(isolate);
  assert.ok(isolateAt >= 0, '흐림 있던 요소의 쌓임 맥락 유지 규칙');
  assert.match(css.slice(isolateAt, css.indexOf('}', isolateAt)), /isolation: isolate;/);
  // 다크 위젯 유리: 흐림 없이 글자가 묻히지 않게 바탕을 올린다(라이트는 원래 .8 이라 그대로)
  assert.match(css, /:root:not\(\[data-color-mode='light'\]\)\[data-motion-lite\] \{\s*--glass-tint-alpha: 0\.72;/);
  assert.match(read('src/components/widgets/Widget.tsx'), /background: 'rgb\(var\(--color-glass-tint\) \/ var\(--glass-tint-alpha\)\)'/);
  // OS 동작 줄이기만 켠 경우의 흐림은 그대로(움직임이 아니라 무게 설정) — 흐림 끄기 선언은 위 규칙 하나뿐
  assert.equal(css.split('backdrop-filter: none !important;').length - 1, 2, '-webkit- 포함 두 줄, 위 규칙 안에만');
  // 설정 화면 안내도 흐림 끄기를 말한다
  const effects = read('src/components/settings/EffectsSection.tsx');
  assert.match(effects, /lite: '[^']*유리 효과도 꺼요/);
});

test('휴가 화면 동기화 막대: framer x 반복 대신 CSS transform 훑기, 동작 줄이기·최소는 멈춘 막대', async () => {
  const view = read('src/views/VacationView.tsx');
  assert.doesNotMatch(view, /repeat: Infinity/);
  assert.match(view, /className="bf-sync-sweep"/);
  const css = stripComments(read('src/styles/motion-foundation.css'));
  assert.match(css, /@keyframes bf-sync-sweep \{\s*from \{ transform: translateX\(-100%\); \}\s*to \{ transform: translateX\(250%\); \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.bf-sync-sweep \{[^}]*animation: none;/);
  const built = (await buildMinimal('src/styles/motion-foundation.css')).replace(/\s+/g, ' ');
  assert.ok(built.includes(`${minimalSel('.bf-sync-sweep')} { width: 100%; transform: none; opacity: 0.55; animation: none; }`), "'최소' 짝");
});

/* ─── 배선 ─── */

test('앱 바깥 MotionConfig: 기본 user, 최소면 always — 메인 창·위젯 팝업 모두', () => {
  const main = read('src/main.tsx');
  assert.match(main, /startMotionLevelSync\(\);[\s\S]*ReactDOM\.createRoot/);
  assert.match(main, /<AppMotionConfig>\s*\{popupMatch \? \(\s*<WidgetPopup[\s\S]*<App \/>[\s\S]*<\/AppMotionConfig>/);
  const config = read('src/components/common/AppMotionConfig.tsx');
  assert.match(config, /reducedMotion=\{level === 'minimal' \? 'always' : 'user'\}/);
  // 캘린더 화면의 안쪽 MotionConfig 는 그대로(안쪽이 이긴다)
  assert.match(read('src/views/ScheduleView.tsx'), /<MotionConfig reducedMotion=\{reduce \? 'always' : 'never'\}>/);
});

test('useMotionPref: 기존 { reduce } 사용처 그대로 + lite·level, OS 값과 앱 설정을 함께 본다', () => {
  const hook = read('src/hooks/useMotionPref.ts');
  assert.match(hook, /export function useMotionPref\(\): MotionPref/);
  // OS 값은 matchMedia 구독(쓰는 도중 바뀌어도 따라감) + 앱 설정 — 판단은 resolveMotionPref 한 곳
  assert.match(hook, /useState<MotionPref>\(readMotionPref\)/);
  assert.match(hook, /subscribeOsReducedMotion\(sync\)/);
  assert.match(read('src/utils/motionLevel.ts'), /return resolveMotionPref\(readOsReducedMotion\(\), current\);/);
  // 함수로 직접 불러 보는 테스트 하네스가 흉내 내지 않는 useSyncExternalStore 는 쓰지 않는다
  assert.doesNotMatch(hook, /useSyncExternalStore\(/);
});

test('설정 저장·방송: preferences.json motionLevel, 다른 창은 방송으로 같은 값', () => {
  const sync = read('src/services/motionLevelSync.ts');
  assert.match(sync, /savePreferences\(\{ \.\.\.existing, motionLevel: level \}\)/);
  assert.match(sync, /preferencesBroadcastChange\?\.\(motionLevelBroadcastPayload\(level, \{ from: windowTag, seq \}\)\)/);
  // 받는 쪽은 내 창의 오래된 방송을 버린다(연타 깜빡임 방지)
  assert.match(sync, /motionLevelFromBroadcast\(payload, \{ from: windowTag, seq: lastRequestSeq \}\)/);
  const save = sync.slice(sync.indexOf('export async function saveMotionLevel'));
  assert.ok(save.indexOf('lastRequestSeq += 1;') >= 0, '요청 번호');
  assert.ok(save.indexOf('lastRequestSeq += 1;') < save.indexOf('setMotionLevel(level);'), '요청 번호는 반영보다 먼저 올린다');
  assert.ok(save.indexOf('setMotionLevel(level);') < save.indexOf('await savePreferences'), '저장보다 먼저 이 창에 반영');
  assert.match(sync, /onPreferencesChanged\?\.\(/);
  // 이 창에는 저장보다 먼저 반영(낙관적)
  assert.ok(sync.indexOf('setMotionLevel(level);') < sync.indexOf('await savePreferences'));
  assert.match(read('src/services/settingsService.ts'), /motionLevel\?: MotionLevel;/);
});

test('설정 › 효과 맨 위에 움직임 3칸(기본·가볍게·최소)', () => {
  const effects = read('src/components/settings/EffectsSection.tsx');
  assert.match(effects, /\{ value: 'full', label: '기본' \},\s*\{ value: 'lite', label: '가볍게' \},\s*\{ value: 'minimal', label: '최소' \},/);
  const motionRow = effects.indexOf('<p className="text-sm font-medium text-text-primary">움직임</p>');
  const firstOtherRow = effects.indexOf('<p className="text-sm font-medium text-text-primary">씬 완료 색상 표시</p>');
  assert.ok(motionRow > 0 && motionRow < firstOtherRow, '움직임 줄이 효과 섹션 맨 위');
  assert.match(effects, /onChange=\{\(level\) => \{ void saveMotionLevel\(level\); \}\}/);
  // 되돌리기 아이콘 버튼은 스크린리더용 이름이 있다
  assert.match(effects, /onClick=\{\(\) => \{ void saveMotionLevel\('full'\); \}\}[\s\S]{0,200}aria-label="움직임 기본값으로"/);
});

test('계속 움직이는 배경(대시보드·로그인 플렉서스, StarNest 두 종, 설정 미리보기)은 루프 문지기를 거친다', () => {
  const files = [
    'src/views/Dashboard.tsx',
    'src/components/auth/LoginScreen.tsx',
    'src/components/effects/StarNestBackground.tsx',
    'src/components/effects/BflowStarNestBackground.tsx',
    'src/components/settings/EffectsSection.tsx',
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /useBackgroundLoopGate\(/, `${file}: 문지기`);
    // 바탕 C: 옵션은 문지기가 만든다(멈춤·창 상태·초당 30장 상한)
    assert.match(source, /createFrameLoop\((animate|render|draw), loopOptions\(\)\)/, `${file}: 루프`);
    assert.match(source, /loop\.dispose\(\);/, `${file}: 정리`);
    // 그리기 함수가 스스로 다음 프레임을 예약하지 않는다(멈춤 상태를 우회하게 됨)
    assert.doesNotMatch(source, /requestAnimationFrame\((animate|render|draw)\)/, `${file}: 자체 rAF 예약`);
  }
  const gate = read('src/hooks/useBackgroundLoopGate.ts');
  assert.match(gate, /const \{ lite: still \} = useMotionPref\(\);/);
  assert.match(gate, /loopRef\.current\?\.setStill\(still\);/);
});

test('그래프 정점 SMIL 펄스·활동 피드 미끄럼 스크롤·캐릭터 그룹 점프도 동작 줄이기/설정을 따른다', () => {
  const chart = read('src/components/widgets/activity/GoldenBarChart.tsx');
  assert.match(chart, /\{!lite && \(\s*<>\s*<animate attributeName="r"/);
  const feed = read('src/components/widgets/activity/ActivityFeed.tsx');
  assert.match(feed, /behavior: prefersReducedMotion\(\) \? 'auto' : 'smooth'/);
  assert.doesNotMatch(feed, /behavior: 'smooth'/);
  const groups = read('src/components/characters/CharacterTabGroupsView.tsx');
  assert.match(groups, /const reduced = prefersReducedMotion\(\);/);
});

test("씬 상세 확대 전환(WAAPI)은 '최소'도 동작 줄이기로 본다 — OS 값만 보는 matchMedia 직접 판정 금지", () => {
  const transition = read('src/components/scenes/SceneContinuityTransition.tsx');
  assert.match(transition, /import \{ prefersReducedMotion \} from '@\/utils\/motion';/);
  assert.match(transition, /const reduce = prefersReducedMotion\(\);\s*if \(!sourceElement \|\| !targetRoot \|\| reduce\) \{\s*onComplete\?\.\(\);\s*return;/);
  assert.doesNotMatch(transition, /matchMedia\(/);
});
