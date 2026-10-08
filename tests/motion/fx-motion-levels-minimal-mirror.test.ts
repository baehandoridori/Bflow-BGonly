import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  readMotionPref,
  readOsReducedMotion,
  resetMotionLevelForTest,
  resolveMotionPref,
  setMotionLevel,
  subscribeOsReducedMotion,
} from '../../src/utils/motionLevel.ts';

/* 움직임 폴리싱 검증 지적 — '움직임: 최소'를 OS 동작 줄이기와 똑같이(바탕 B "'minimal' 은 reduce 규칙을 복제").
   빌드 때 PostCSS 플러그인(scripts/postcss-motion-minimal.cjs)이 모든 CSS 의 동작 줄이기 블록을 '최소' 짝으로 복제하고
   no-preference 블록은 '최소'에서 빼므로, 동작 줄이기에서 정적으로 남기는 정보 표시가 '최소'에서도 보인다. */

type Decl = { type: 'decl'; prop: string; value: string; important?: boolean };
type Rule = { type: 'rule'; selector: string; selectors: string[]; nodes: Array<Decl | { type: string }>; next(): Node | undefined };
type AtRule = { type: 'atrule'; name: string; params: string; nodes: Node[]; next(): Node | undefined };
type Node = Rule | AtRule | Decl | { type: 'comment'; next(): Node | undefined };
type Root = { walkAtRules(name: string, cb: (at: AtRule) => void): void; walkRules(cb: (rule: Rule) => void): void };

const require = createRequire(import.meta.url);
const postcss = require('postcss') as (plugins: unknown[]) => { process(css: string, opts: { from: string }): Promise<{ root: Root; css: string; warnings(): Array<{ text: string }> }> };
const motionMinimal = require('../../scripts/postcss-motion-minimal.cjs') as (() => { postcssPlugin: string }) & {
  PLUGIN_NAME: string;
  MINIMAL_ATTR: string;
  MINIMAL_ON: string;
  MINIMAL_OFF: string;
  withCondition(selector: string, condition: string): string;
  minimalMirrorSelectors(selector: string): string[];
  classifyMedia(params: string): string | null;
};
const { MINIMAL_ATTR, MINIMAL_ON: ON, MINIMAL_OFF: OFF, withCondition, minimalMirrorSelectors, classifyMedia } = motionMinimal;

const read = (file: string) => readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');

function walkCss(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkCss(full);
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

async function build(file: string) {
  return postcss([motionMinimal()]).process(readFileSync(file, 'utf-8'), { from: file });
}

const decls = (rule: Rule) => rule.nodes
  .filter((node): node is Decl => node.type === 'decl')
  .map((d) => `${d.prop}: ${d.value.replace(/\s+/g, ' ').trim()}${d.important ? ' !important' : ''}`);

const insideMedia = (node: { parent?: unknown }) => {
  for (let p = (node as { parent?: { type?: string; name?: string; parent?: unknown } }).parent; p; p = (p as { parent?: never }).parent) {
    if ((p as { type?: string }).type === 'atrule' && (p as { name?: string }).name === 'media') return true;
  }
  return false;
};

/** 간단한 특이도(이 저장소의 선택자 범위): :where(...) 는 0, :is()/:not() 는 안쪽을 그대로 센다. */
function specificity(selector: string): [number, number, number] {
  let s = selector;
  // :where(...) 통째로 제거(괄호 짝 맞춤)
  for (let at = s.indexOf(':where('); at >= 0; at = s.indexOf(':where(')) {
    let depth = 0;
    let end = at + ':where('.length - 1;
    for (; end < s.length; end += 1) {
      if (s[end] === '(') depth += 1;
      else if (s[end] === ')') { depth -= 1; if (depth === 0) break; }
    }
    s = s.slice(0, at) + s.slice(end + 1);
  }
  s = s.replace(/:(is|not)\(/g, ' ').replace(/\)/g, ' ').replace(/\[[^\]]*\]/g, ' .attr ');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+/g) ?? []).length + (s.match(/(^|[^:]):(?!:)[\w-]+/g) ?? []).filter((m) => !/:(before|after)$/.test(m)).length;
  const types = (s.match(/(^|[\s>+~(,])[a-zA-Z][\w-]*/g) ?? []).length + (s.match(/::?(before|after|backdrop)/g) ?? []).length;
  return [ids, classes, types];
}
const beats = (a: [number, number, number], b: [number, number, number]) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

/* ─── 선택자 변환 ─── */

test("선택자 변환: 첫 덩어리(결합자·가상 요소 앞)에 특이도 0 조건만 붙는다", () => {
  const cases: Array<[string, string]> = [
    ['.a', `.a${ON}`],
    ['.a .b', `.a${ON} .b`],
    ['.a>.b', `.a${ON}>.b`],
    ['.a::after', `.a${ON}::after`],
    ['.a:after', `.a${ON}:after`],
    ['.a:hover::before', `.a:hover${ON}::before`],
    ['*', `*${ON}`],
    ['*::before', `*${ON}::before`],
    ['html[data-dash-entry] [data-entry-rank] > .widget-lift', `html[data-dash-entry]${ON} [data-entry-rank] > .widget-lift`],
    ['.gantt-modal[open]::backdrop', `.gantt-modal[open]${ON}::backdrop`],
    ['[data-sonner-toast][data-removed="true"]', `[data-sonner-toast][data-removed="true"]${ON}`],
    ['[data-x="a b"] .c', `[data-x="a b"]${ON} .c`],
    ['.motion-safe\\:hover\\:scale-\\[1\\.02\\]:hover', `.motion-safe\\:hover\\:scale-\\[1\\.02\\]:hover${ON}`],
    [':is(.a:not(.b), .c):not(.d):hover::before', `:is(.a:not(.b), .c):not(.d):hover${ON}::before`],
    [".stage-seg:active:not(:disabled):not([aria-disabled='true'])", `.stage-seg:active:not(:disabled):not([aria-disabled='true'])${ON}`],
    ['tr.editing-beam-row > td:first-child::after', `tr.editing-beam-row${ON} > td:first-child::after`],
  ];
  for (const [input, expected] of cases) {
    const out = withCondition(input, ON);
    assert.equal(out, expected, input);
    // 붙은 것은 :where(...) 하나뿐 → 특이도·대상이 원래 선택자와 같다
    assert.equal(out.replace(ON, ''), input, `${input}: 조건 말고는 그대로`);
    assert.equal(withCondition(out, ON), out, `${input}: 두 번 붙이지 않는다`);
  }
  assert.ok(ON.startsWith(':where(') && OFF.startsWith(':where('), '조건은 특이도 0(:where)');
  assert.equal(classifyMedia('(prefers-reduced-motion:reduce)'), 'reduce');
  assert.equal(classifyMedia('( prefers-reduced-motion : reduce )'), 'reduce');
  assert.equal(classifyMedia('(prefers-reduced-motion: no-preference)'), 'no-preference');
  assert.equal(classifyMedia('(prefers-reduced-motion: reduce) and (hover: hover)'), 'mixed');
  assert.equal(classifyMedia('(min-width: 900px)'), null);
});

test("'최소' 짝 = html 자신 + html 안, 조건은 속성 이름(data-motion-minimal) — 기본 설정에서 브라우저가 미리 거른다 (최종 성능 측정 지적)", () => {
  assert.equal(MINIMAL_ATTR, 'data-motion-minimal');
  assert.equal(ON, ':where(html[data-motion-minimal])', '값 비교(data-motion=minimal)가 아니라 이름 — 조상 속성 이름으로 거르기');
  assert.doesNotMatch(ON, / \*/, '조건 안에서 조상을 거슬러 오르지 않는다');
  for (const input of ['.a', '.a .b', '*', '*::before', 'html[data-dash-entry] [data-entry-rank] > .widget-lift', '.stage-seg:active:not(:disabled)']) {
    const [self, inside] = minimalMirrorSelectors(input);
    assert.equal(self, withCondition(input, ON), `${input}: 첫 덩어리가 html 자신일 때`);
    assert.equal(inside, `${ON} ${input}`, `${input}: html 안의 요소 — 조건이 맨 앞 조상 덩어리에 있어야 미리 걸러진다`);
    assert.deepEqual(specificity(inside), specificity(input), `${input}: 특이도 그대로`);
  }
  // html 에 붙는 표시는 '최소' 설정 한 곳(writeDom)에서만 값과 함께 바뀐다.
  const level = read('src/utils/motionLevel.ts');
  assert.match(level, /if \(level === 'minimal'\) data\.motionMinimal = '';\s*else delete data\.motionMinimal;/);
  assert.match(level, /if \(level === 'full'\) delete data\.motionLite;\s*else data\.motionLite = '';/);
  // '가볍게' 규칙도 값 비교 대신 이름(:root[data-motion-lite]) — 특이도는 :root:is([…], […]) 와 같다.
  const foundation = read('src/styles/motion-foundation.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(foundation, /\[data-motion=/, '값 비교 선택자 없음');
  assert.ok(foundation.includes(':root[data-motion-lite] :is(*, #bf-motion-lite)::after {'));
  // :root:is([a], [b]) 는 :is 안에서 가장 큰 것 하나만 센다 → (0,2,0). :root[data-motion-lite] 도 (0,2,0).
  assert.deepEqual(specificity(':root[data-motion-lite] .x'), [0, 3, 0]);
});

test('플러그인: 동작 줄이기 블록은 바로 뒤에 같은 선언의 최소 짝, no-preference 블록은 최소에서 빠진다, 못 다루는 모양은 경고', async () => {
  const css = [
    '.a { animation: x 1s; }',
    '@media (prefers-reduced-motion: reduce) {',
    '  /* 설명 */',
    '  .a, .b::after { animation: x 200ms forwards !important; opacity: 1; }',
    '}',
    '.c { color: red; }',
    '@media (prefers-reduced-motion: no-preference) { .d:hover { transform: scale(1.02); } }',
    '@media (prefers-reduced-motion: reduce) { @keyframes k { from { opacity: 0; } } }',
    '@media (prefers-reduced-motion: reduce) and (hover: hover) { .e { transition: none; } }',
  ].join('\n');
  const result = await postcss([motionMinimal()]).process(css, { from: 'x.css' });
  const out = result.css.replace(/\s+/g, ' ');
  assert.ok(out.includes(`} .a${ON}, ${ON} .a, .b${ON}::after, ${ON} .b::after { animation: x 200ms forwards !important; opacity: 1; } .c {`), out);
  assert.ok(out.includes(`.d:hover${OFF} { transform: scale(1.02); }`), out);
  assert.equal(result.warnings().length, 2, '중첩 @keyframes·섞인 조건은 경고');
});

/* ─── 빌드 배선 ─── */

test('빌드: postcss.config.js 가 tailwindcss·autoprefixer 다음 맨 뒤에 이 플러그인을 쓴다', () => {
  const config = require('../../postcss.config.js') as { plugins: unknown[] };
  assert.ok(Array.isArray(config.plugins));
  assert.equal(config.plugins[0], require('tailwindcss'));
  assert.equal(config.plugins[1], require('autoprefixer'));
  const last = config.plugins[config.plugins.length - 1] as { postcssPlugin?: string };
  assert.equal(last.postcssPlugin, motionMinimal.PLUGIN_NAME);
});

/* ─── 전수 검사: src 의 모든 CSS ─── */

test('src 의 모든 CSS: 동작 줄이기 블록마다 같은 선언의 최소 짝이 바로 뒤에, no-preference 블록은 최소에서 빠짐, 경고 0', async () => {
  let mirrored = 0;
  let guarded = 0;
  for (const file of walkCss('src')) {
    const result = await build(file);
    assert.deepEqual(result.warnings().map((w) => w.text), [], `${file}: 경고`);
    const problems: string[] = [];
    result.root.walkAtRules('media', (media) => {
      const kind = classifyMedia(media.params);
      if (kind === 'reduce') {
        const rules = media.nodes.filter((n): n is Rule => n.type === 'rule');
        let sibling = media.next();
        for (const rule of rules) {
          while (sibling && sibling.type === 'comment') sibling = sibling.next();
          if (!sibling || sibling.type !== 'rule') { problems.push(`짝 없음: ${rule.selector}`); break; }
          const expected = rule.selectors.flatMap((s) => minimalMirrorSelectors(s));
          if (JSON.stringify(sibling.selectors) !== JSON.stringify(expected)) problems.push(`선택자 다름: ${rule.selector}`);
          if (JSON.stringify(decls(sibling)) !== JSON.stringify(decls(rule))) problems.push(`선언 다름: ${rule.selector}`);
          mirrored += 1;
          sibling = sibling.next();
        }
      } else if (kind === 'no-preference') {
        for (const rule of media.nodes.filter((n): n is Rule => n.type === 'rule')) {
          if (!rule.selectors.every((s) => s.includes(OFF))) problems.push(`최소에서 안 빠짐: ${rule.selector}`);
          guarded += 1;
        }
      }
    });
    assert.deepEqual(problems, [], file);
  }
  assert.ok(mirrored >= 60, `복제된 동작 줄이기 규칙 수 ${mirrored}`);
  assert.ok(guarded >= 10, `최소에서 빠지는 no-preference 규칙 수 ${guarded}`);
});

test("'최소' 전역 규칙은 동작 줄이기 전역 규칙의 짝 하나뿐 — 정보 표시를 살리는 규칙을 누르는 ID 특이도 규칙이 없다", async () => {
  // ID 특이도로 모든 요소의 길이를 0 으로 누르던 예전 '최소' 전역 규칙이 돌아오면 정보 표시가 다시 사라진다.
  const offenders: string[] = [];
  for (const file of walkCss('src')) {
    const source = read(file);
    if (source.includes('#bf-motion-minimal')) offenders.push(`${file}: #bf-motion-minimal`);
    const result = await postcss([]).process(readFileSync(file, 'utf-8'), { from: file });
    result.root.walkRules((rule) => {
      if (insideMedia(rule) || !/data-motion=['"]?minimal/.test(rule.selector)) return;
      for (const d of decls(rule)) {
        if (/^(animation-duration|transition-duration|animation-iteration-count)/.test(d) || (/^(animation|transition): /.test(d) && !/: none/.test(d))) {
          offenders.push(`${file}: ${rule.selector} { ${d} }`);
        }
      }
    });
  }
  assert.deepEqual(offenders, []);

  const index = await build('src/index.css');
  let globalRule: Rule | undefined;
  index.root.walkRules((rule) => { if (!insideMedia(rule) && rule.selectors.includes(`*${ON}`)) globalRule = rule; });
  assert.ok(globalRule, 'index.css 전역 규칙의 최소 짝');
  assert.deepEqual(globalRule!.selectors, [`*${ON}`, `${ON} *`, `*${ON}::before`, `${ON} *::before`, `*${ON}::after`, `${ON} *::after`]);
  assert.deepEqual(decls(globalRule!), [
    'animation-duration: 0.01ms !important',
    'animation-iteration-count: 1 !important',
    'transition-duration: 0.01ms !important',
    'scroll-behavior: auto !important',
  ]);
  assert.deepEqual(specificity(`*${ON}`), [0, 0, 0]);
  assert.deepEqual(specificity(`${ON} *`), [0, 0, 0]);
  assert.deepEqual(specificity(`*${ON}::after`), [0, 0, 1]);
  assert.deepEqual(specificity(`${ON} *::after`), [0, 0, 1]);
});

/* 동작 줄이기에서 정적으로 남기는 정보 표시(9·5·16·14·20·13·6번) — '최소' 짝이 있고, 전역 0.01ms 규칙보다 특이도가 높다. */
const INFO_DISPLAYS: Array<{ file: string; selector: string; decl: string; what: string }> = [
  { file: 'src/styles/motion-live-drag.css', selector: '.scene-remote-ring', decl: 'animation: bf-remote-hold 1500ms linear forwards !important', what: '팀원 변경 테두리 빛' },
  { file: 'src/styles/motion-live-drag.css', selector: '.scene-remote-row-flash', decl: 'animation: bf-remote-hold 1500ms linear forwards !important', what: '팀원 변경 줄 빛' },
  { file: 'src/styles/motion-live-drag.css', selector: '.scene-remote-tag', decl: 'animation: bf-remote-hold 1500ms linear forwards !important', what: '팀원 이름표' },
  { file: 'src/styles/motion-live-drag.css', selector: '.assignee-flash', decl: 'animation: bf-remote-hold 1500ms linear forwards !important', what: '담당자 카드 반짝' },
  { file: 'src/styles/motion-live-drag.css', selector: '.feed-row-new-wash', decl: 'animation: bf-remote-hold 1500ms linear forwards !important', what: '최근 작업 새 줄 바탕' },
  { file: 'src/styles/motion-live-drag.css', selector: '.assignee-delta', decl: 'animation: bf-remote-hold 1100ms linear forwards !important', what: '+N씬' },
  { file: 'src/styles/motion-live-drag.css', selector: '.bf-status-wash', decl: 'animation-duration: 200ms !important', what: '컴포지팅 물듦' },
  { file: 'src/styles/motion-live-drag.css', selector: '.bf-land-ring', decl: 'animation-duration: 450ms !important', what: '끌기 착지 링' },
  { file: 'src/styles/motion-live-drag.css', selector: '.bf-land-ring.is-born', decl: 'animation-duration: 600ms !important', what: '새로 만든 막대 링' },
  { file: 'src/styles/motion-live-drag.css', selector: '.widget-land-ring', decl: 'animation-duration: 450ms !important', what: '위젯 착지 링' },
  { file: 'src/styles/motion-scene-flow.css', selector: '.sf-saved-chip', decl: 'animation: none !important', what: "'저장됨 ✓' 칩" },
  { file: 'src/styles/motion-scene-flow.css', selector: '.sf-upload-bar::after', decl: 'width: 100%', what: '올리는 중 막대' },
  { file: 'src/styles/motion-comments-notify.css', selector: '[data-sonner-toast] .bflow-undo-countdown', decl: 'animation: bflow-undo-countdown-calm var(--bflow-undo-ms, 5000ms) linear forwards !important', what: '되돌리기 남은 시간 막대' },
  { file: 'src/styles/motion-view-entry.css', selector: 'html[data-dash-entry] [data-entry-rank] .bf-entry-fill-x', decl: 'animation: none', what: '첫 진입 막대 즉시' },
  { file: 'src/styles/motion-view-entry.css', selector: 'html[data-dash-entry] [data-entry-rank] > .widget-lift > .widget-lift-shadow + *', decl: 'animation: none', what: '첫 진입 위젯 즉시(차례 지연 없음)' },
  { file: 'src/styles/motion-scene-check.css', selector: ".stage-seg:active:not(:disabled):not([aria-disabled='true'])", decl: 'transform: none', what: '단계 버튼 누름 축소 없음' },
];

test("정보 표시는 '최소'에서도 보인다: 동작 줄이기 정적 대체 규칙마다 '최소' 짝이 있고 전역 0.01ms 짝을 이긴다", async () => {
  const built = new Map<string, Awaited<ReturnType<typeof build>>>();
  for (const info of INFO_DISPLAYS) {
    if (!built.has(info.file)) built.set(info.file, await build(info.file));
    const result = built.get(info.file)!;
    const target = withCondition(info.selector, ON);
    const [, inside] = minimalMirrorSelectors(info.selector);
    let reduceHit = false;
    let minimalHit = false;
    result.root.walkRules((rule) => {
      const has = decls(rule).includes(info.decl);
      if (!has) return;
      if (insideMedia(rule) && rule.selectors.includes(info.selector)) reduceHit = true;
      if (!insideMedia(rule) && rule.selectors.includes(target) && rule.selectors.includes(inside)) minimalHit = true;
    });
    assert.ok(reduceHit, `${info.what}: 동작 줄이기 규칙(${info.selector} { ${info.decl} })`);
    assert.ok(minimalHit, `${info.what}: '최소' 짝`);
    if (/!important/.test(info.decl)) {
      const sel = info.selector.includes('::') ? `*${ON}::after` : `*${ON}`;
      assert.ok(beats(specificity(target), specificity(sel)), `${info.what}: 전역 0.01ms 짝보다 특이도가 높다`);
    }
  }
});

/* ─── '가볍게': 반복 장식 ─── */

test("'가볍게' 이상: 첫 화면 숨쉬기 3종도 멈추고, 헤더 자동 받아오기 체크 숨쉬기도 생략", () => {
  const css = read('src/styles/motion-foundation.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const lite = ':root[data-motion-lite]';
  const at = css.indexOf(`${lite} .bf-entry-breathe`);
  assert.ok(at >= 0, '첫 화면 숨쉬기');
  const block = css.slice(at, css.indexOf('}', at));
  for (const cls of ['.bf-entry-glow', '.bf-entry-nudge']) assert.ok(block.includes(`${lite} ${cls}`), cls);
  assert.match(block, /animation: none !important;/);

  const status = read('src/components/layout/HeaderSyncStatus.tsx');
  assert.match(status, /const \{ reduce, lite \} = useMotionPref\(\);/);
  assert.match(status, /liteRef\.current = lite;/);
  assert.match(status, /if \(change\.breathe && !spinRef\.current && !liteRef\.current && lastSyncRef\.current !== null\) \{/);
});

/* ─── OS 동작 줄이기: 쓰는 도중 바뀌어도 따라간다 ─── */

type FakeMedia = { matches: boolean; listeners: Set<() => void>; addEventListener?: (t: string, l: () => void) => void; removeEventListener?: (t: string, l: () => void) => void; addListener?: (l: () => void) => void; removeListener?: (l: () => void) => void };

function withFakeWindow<T>(media: FakeMedia | null, run: () => T): T {
  const g = globalThis as unknown as { window?: unknown };
  const previous = g.window;
  g.window = media === null ? {} : { matchMedia: (query: string) => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return media; } };
  try {
    return run();
  } finally {
    if (previous === undefined) delete g.window;
    else g.window = previous;
  }
}

function modernMedia(matches: boolean): FakeMedia {
  const media: FakeMedia = { matches, listeners: new Set() };
  media.addEventListener = (type, listener) => { assert.equal(type, 'change'); media.listeners.add(listener); };
  media.removeEventListener = (type, listener) => { assert.equal(type, 'change'); media.listeners.delete(listener); };
  return media;
}

test('OS 동작 줄이기: 지금 값을 읽고, 바뀌면 알리고, 끊으면 그만 — 창·matchMedia 가 없으면 false·아무 일 없음', () => {
  assert.equal(readOsReducedMotion(), false, '창 없음');
  assert.doesNotThrow(() => subscribeOsReducedMotion(() => {})());
  withFakeWindow(null, () => {
    assert.equal(readOsReducedMotion(), false, 'matchMedia 없음');
    subscribeOsReducedMotion(() => {})();
  });

  const media = modernMedia(false);
  withFakeWindow(media, () => {
    resetMotionLevelForTest();
    assert.equal(readOsReducedMotion(), false);
    assert.equal(readMotionPref(), resolveMotionPref(false, 'full'));
    let calls = 0;
    const off = subscribeOsReducedMotion(() => { calls += 1; });
    assert.equal(media.listeners.size, 1);
    media.matches = true; // 앱을 쓰는 도중 윈도우 '애니메이션 효과'를 끔
    for (const listener of media.listeners) listener();
    assert.equal(calls, 1);
    assert.equal(readOsReducedMotion(), true);
    assert.equal(readMotionPref(), resolveMotionPref(true, 'full'));
    off();
    assert.equal(media.listeners.size, 0, '끊으면 리스너를 뗀다');
    setMotionLevel('lite');
    assert.equal(readMotionPref(), resolveMotionPref(true, 'lite'));
    resetMotionLevelForTest();
  });

  // 옛 MediaQueryList(addListener 만 있음)
  const legacy: FakeMedia = { matches: false, listeners: new Set() };
  legacy.addListener = (listener) => { legacy.listeners.add(listener); };
  legacy.removeListener = (listener) => { legacy.listeners.delete(listener); };
  withFakeWindow(legacy, () => {
    const off = subscribeOsReducedMotion(() => {});
    assert.equal(legacy.listeners.size, 1);
    off();
    assert.equal(legacy.listeners.size, 0);
  });
});

test('useMotionPref: framer useReducedMotion(처음 한 번만 읽음) 대신 OS 값을 구독 — 상태 하나·effect 하나로 사용처 훅 순서 유지', () => {
  const hook = read('src/hooks/useMotionPref.ts');
  assert.doesNotMatch(hook, /from 'framer-motion'/);
  assert.doesNotMatch(hook, /useReducedMotion\(/);
  const body = hook.slice(hook.indexOf('export function useMotionPref(): MotionPref'));
  assert.equal((body.match(/useState</g) ?? []).length, 1);
  assert.equal((body.match(/useEffect\(/g) ?? []).length, 1);
  assert.match(body, /useState<MotionPref>\(readMotionPref\)/);
  assert.match(body, /const offLevel = subscribeMotionLevel\(sync\);/);
  assert.match(body, /const offOs = subscribeOsReducedMotion\(sync\);/);
  assert.match(body, /offLevel\(\);\s*offOs\(\);/);
  assert.doesNotMatch(hook, /useSyncExternalStore\(/);
});
