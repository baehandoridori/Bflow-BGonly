import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_MOTION_LEVEL,
  MOTION_LEVELS,
  applyStoredMotionLevel,
  getMotionLevel,
  isMinimalMotionInDom,
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
    assert.equal(calls, 1);
    setMotionLevel('lite');
    assert.equal(calls, 1, '같은 값은 알리지 않는다');
    setMotionLevel('nonsense');
    assert.equal(getMotionLevel(), 'full');
    assert.equal(doc.documentElement.dataset.motion, 'full');
    assert.equal(calls, 2);
    off();
    setMotionLevel('minimal');
    assert.equal(calls, 2, '구독을 끊으면 더 알리지 않는다');
    assert.equal(isMinimalMotionInDom(), true);
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
    if (!times.some((ms) => ms >= 1)) return;
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
  assert.match(widget, /\n\.react-grid-item\.react-draggable-dragging \{\s*z-index: 100 !important;\s*opacity: 0\.95 !important;\s*\}/);
  assert.match(widget, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.widget-settling \{/);
});

/* ─── CSS: '최소'·'가볍게' ─── */

test("'최소' 전역 규칙: 동작 줄이기 전역 규칙과 같은 네 값, ID 특이도로 !important 규칙도 이긴다", () => {
  const css = stripComments(read('src/styles/motion-foundation.css'));
  const at = css.indexOf("html[data-motion='minimal'],\nhtml[data-motion='minimal'] :is(*, #bf-motion-minimal),");
  assert.ok(at >= 0, '최소 전역 규칙 선택자');
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  for (const decl of ['animation-duration: 0.01ms !important', 'animation-iteration-count: 1 !important', 'transition-duration: 0.01ms !important', 'scroll-behavior: auto !important']) {
    assert.ok(body.includes(decl), decl);
  }
  // index.css 전역 규칙과 같은 값인지
  const index = stripComments(read('src/index.css'));
  for (const decl of ['animation-duration: 0.01ms !important', 'animation-iteration-count: 1 !important', 'transition-duration: 0.01ms !important', 'scroll-behavior: auto !important']) {
    assert.ok(index.includes(decl), `index.css 전역 규칙: ${decl}`);
  }
  // 동작 줄이기 전용 규칙의 '최소' 짝
  assert.match(css, /html\[data-motion='minimal'\] \.bf-card-hover:hover \{\s*translate: none;/);
  assert.match(css, /html\[data-motion='minimal'\] \.bf-press:active:not\(:disabled\) \{\s*transform: none;/);
});

test("'가볍게' 이상: 숨 쉬는 장식을 멈추고 움직이는 알림 카드 흐림을 뺀다", () => {
  const css = stripComments(read('src/styles/motion-foundation.css'));
  const lite = ":root:is([data-motion='lite'], [data-motion='minimal'])";
  for (const target of ['.comment-unread-badge', '.bflow-peak-pulse', '.bflow-badge-pulse', '.bflow-bulk-bar-pulse', '.bell-glow-soft::after', '.bell-glow-mention::after', '.scene-num-glow-wrap::before', '.editing-beam::before', '.scene-top-progress-fill::after', '.bflow-update-latest-card::before']) {
    assert.ok(css.includes(`${lite} ${target}`), `가볍게 정지 대상 없음: ${target}`);
  }
  assert.ok(css.includes(`${lite} [data-sonner-toaster] [data-sonner-toast].bflow-toast {\n  backdrop-filter: none;`));
});

test('휴가 화면 동기화 막대: framer x 반복 대신 CSS transform 훑기, 동작 줄이기·최소는 멈춘 막대', () => {
  const view = read('src/views/VacationView.tsx');
  assert.doesNotMatch(view, /repeat: Infinity/);
  assert.match(view, /className="bf-sync-sweep"/);
  const css = stripComments(read('src/styles/motion-foundation.css'));
  assert.match(css, /@keyframes bf-sync-sweep \{\s*from \{ transform: translateX\(-100%\); \}\s*to \{ transform: translateX\(250%\); \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.bf-sync-sweep \{[^}]*animation: none;/);
  assert.match(css, /html\[data-motion='minimal'\] \.bf-sync-sweep \{[^}]*animation: none;/);
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
  assert.match(hook, /useReducedMotion\(\) === true/);
  assert.match(hook, /resolveMotionPref\(osReduce, level\)/);
  // 함수로 직접 불러 보는 테스트 하네스가 흉내 내지 않는 useSyncExternalStore 는 쓰지 않는다
  assert.doesNotMatch(hook, /useSyncExternalStore\(/);
});

test('설정 저장·방송: preferences.json motionLevel, 다른 창은 방송으로 같은 값', () => {
  const sync = read('src/services/motionLevelSync.ts');
  assert.match(sync, /savePreferences\(\{ \.\.\.existing, motionLevel: level \}\)/);
  assert.match(sync, /preferencesBroadcastChange\?\.\(\{ motionLevel: level \}\)/);
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
    assert.match(source, /createFrameLoop\((animate|render|draw), \{ still: stillRef\.current \}\)/, `${file}: 루프`);
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
