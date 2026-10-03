import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* 움직임 폴리싱 바탕 C 목업 — 시트 씬 번호 빛 테두리(sheet-number-glow).
   평소에는 멈춘 그라데이션 테두리 + 멈춘 글자 빛, 마우스를 올린 줄만 1.2초 회전 + 밝게.
   회전은 늘 걸어 두고 animation-play-state 로만 멈추고 돌린다(none 토글은 나갈 때 각도가 0 으로 튄다).
   열 너비·창 크기 조절 중(is-resizing)에도 지우지 않고 멈춘다. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

interface CssRule { media: string | null; selectors: string[]; body: string }

/** 맨 위 규칙과 @media 안 규칙(한 단계)을 선택자 목록·본문·미디어 조건으로 펼친다. */
function cssRules(source: string): CssRule[] {
  const css = stripComments(source);
  const rules: CssRule[] = [];
  const walk = (text: string, media: string | null) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 0;
      let close = open;
      for (; close < text.length; close += 1) {
        if (text[close] === '{') depth += 1;
        if (text[close] === '}') { depth -= 1; if (depth === 0) break; }
      }
      const inner = text.slice(open + 1, close);
      if (head.startsWith('@media')) walk(inner, head.replace(/^@media\s*/, ''));
      else if (!head.startsWith('@')) rules.push({ media, selectors: head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: inner });
      i = close + 1;
    }
  };
  walk(css, null);
  return rules;
}
const rulesFor = (rules: CssRule[], selector: string) => rules.filter((r) => r.selectors.includes(selector));
const decl = (body: string, prop: string) => body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+);`))?.[1].trim() ?? null;

const effects = cssRules(read('src/styles/scene-effects.css'));
const NO_PREF = '(prefers-reduced-motion: no-preference)';

test('검사기 자체: @media 안팎 규칙·선택자 목록·주석을 가른다', () => {
  const rules = cssRules('/* a { x: 1; } */ .a, .b:hover::before { opacity: 1; }\n@media (prefers-reduced-motion: no-preference) { tr:hover  .c { animation-play-state: running; } }\n@keyframes k { to { opacity: 0; } }');
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], { media: null, selectors: ['.a', '.b:hover::before'], body: ' opacity: 1; ' });
  assert.equal(rules[1].media, NO_PREF);
  assert.deepEqual(rules[1].selectors, ['tr:hover .c']);
  assert.equal(decl(rules[1].body, 'animation-play-state'), 'running');
  assert.equal(decl(rules[0].body, 'animation'), null);
});

test('평소: 테두리 회전은 걸어 두되 멈춰 있고(paused) 은은한 opacity .55, 밝아짐은 200ms opacity 전환', () => {
  const [base] = rulesFor(effects, '.scene-num-glow-wrap::before').filter((r) => r.media === null);
  assert.ok(base, '.scene-num-glow-wrap::before 기본 규칙');
  assert.equal(decl(base.body, 'animation'), 'scene-effect-rotate 1.2s linear infinite paused');
  assert.equal(decl(base.body, 'opacity'), '0.55');
  assert.match(decl(base.body, 'transition') ?? '', /^opacity 200ms var\(--ease-std\)/);
  // 디자인(conic 링)은 그대로
  assert.match(base.body, /conic-gradient\(\s*from var\(--scene-effect-angle\)/);
});

test('마우스를 올린 줄(tr:hover)과 번호 칸 hover 모두: 밝아짐은 늘, 회전은 동작 줄이기가 아닐 때만', () => {
  for (const selector of ['tr:hover .scene-num-glow-wrap::before', '.scene-num-glow-wrap:hover::before']) {
    const rules = rulesFor(effects, selector);
    const bright = rules.find((r) => r.media === null);
    assert.ok(bright, `밝아짐 규칙: ${selector}`);
    assert.equal(decl(bright.body, 'opacity'), '1');
    const spin = rules.find((r) => decl(r.body, 'animation-play-state') === 'running');
    assert.ok(spin, `회전 규칙: ${selector}`);
    assert.equal(spin.media, NO_PREF, '회전은 no-preference 안에서만');
    // hover 로 animation 자체를 바꾸지 않는다(none ↔ 회전 토글 금지, 길이도 기본 규칙 하나로)
    for (const r of rules) {
      for (const prop of ['animation', 'animation-name', 'animation-duration']) {
        assert.equal(decl(r.body, prop), null, `${selector} 에 ${prop} 금지`);
      }
    }
  }
  // running 은 어디서든 no-preference 안에서만
  for (const r of effects) {
    if (decl(r.body, 'animation-play-state') === 'running') assert.equal(r.media, NO_PREF, r.selectors.join(', '));
  }
});

test('글자 빛: 숨 쉬지 않고(펄스 없음) 마우스를 올린 줄에서만 밝아진다', () => {
  const [text] = rulesFor(effects, '.scene-num-glow-text').filter((r) => r.media === null);
  assert.ok(text);
  assert.equal(decl(text.body, 'animation'), null);
  assert.match(decl(text.body, 'text-shadow') ?? '', /0 0 4px rgb\(var\(--color-accent\) \/ 0\.6\)/);
  assert.match(decl(text.body, 'transition') ?? '', /200ms/);
  const [hover] = rulesFor(effects, 'tr:hover .scene-num-glow-text');
  assert.ok(hover, 'tr:hover 글자 밝아짐');
  assert.ok(hover.selectors.includes('.scene-num-glow-wrap:hover .scene-num-glow-text'));
  assert.equal(decl(hover.body, 'color'), 'rgb(var(--color-accent-sub))');
  // 쓰지 않게 된 펄스 keyframe 은 어디에도 없다
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(css|tsx?)$/.test(name) ? [p] : [];
  });
  for (const file of walk('src')) assert.doesNotMatch(read(file), /scene-effect-pulse/, file);
});

test('크기 조절 중(is-resizing): 애니메이션을 지우지 않고 멈춘다 — 끝나면 이어서 돈다', () => {
  const [resizing] = rulesFor(effects, 'html.is-resizing .unified-scene-sheet *::before');
  assert.ok(resizing);
  assert.equal(decl(resizing.body, 'animation-play-state'), 'paused !important');
  assert.equal(decl(resizing.body, 'animation'), null, 'animation: none 금지');
  assert.equal(decl(resizing.body, 'transition'), 'none !important');
  for (const selector of ['html.is-resizing .unified-scene-sheet', 'html.is-resizing .unified-scene-sheet *', 'html.is-resizing .unified-scene-sheet *::after']) {
    assert.ok(resizing.selectors.includes(selector), selector);
  }
});

test("'가볍게'·'최소': 테두리 회전은 빼고(밝아짐만), 이제 숨 쉬지 않는 글자는 정지 목록에서 뺐다", () => {
  const foundation = stripComments(read('src/styles/motion-foundation.css'));
  const lite = ':root[data-motion-lite]';
  assert.ok(foundation.includes(`${lite} .scene-num-glow-wrap::before`));
  assert.ok(!foundation.includes(`${lite} .scene-num-glow-text`));
});

test('두 시트 보기 모두 씬 번호가 표 줄(tr) 안에 있어 줄 hover 로 돈다', () => {
  for (const file of ['src/components/scenes/UnifiedSceneSheetView.tsx', 'src/components/scenes/SceneSheetView.tsx']) {
    const src = read(file);
    const at = src.indexOf('<span className="scene-num-glow-wrap');
    assert.ok(at > 0, file);
    const rowOpen = Math.max(src.lastIndexOf('<tr', at), src.lastIndexOf('<motion.tr', at));
    const rowClose = src.lastIndexOf('</tr>', at);
    assert.ok(rowOpen > rowClose, `${file}: 번호 칸이 줄 안에 있어야 한다`);
  }
});
