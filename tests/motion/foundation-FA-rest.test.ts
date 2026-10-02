import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DOCK_LIFT,
  DOCK_MAX_DIST,
  DOCK_SCALE,
  SAME_ROW_Y_THRESHOLD,
  dockTransform,
  smoothstep,
  type DockSlotRect,
} from '../../src/views/compositing-dashboard/cards/dockLift.ts';

/* 움직임 폴리싱 바탕 A(나머지) — 카드 hover 공통 반응 .bf-card-hover, 고유 hover 카드의 박자 맞춤,
   컴포지팅 카드의 hover 판정(원래 자리)과 들리는 카드 분리. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** 선택자 문자열 그대로 시작하는 규칙 본문 하나(첫 번째)를 꺼낸다. */
const ruleBody = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `규칙 없음: ${selector}`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
};
const mediaBlock = (css: string, query: string) => {
  const at = css.indexOf(`@media (${query}) {`);
  assert.ok(at >= 0, `미디어 블록 없음: ${query}`);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') { depth -= 1; if (depth === 0) return css.slice(at, i + 1); }
  }
  throw new Error('미디어 블록이 닫히지 않음');
};

/* ─── 컴포지팅 dock-lift: 순수 계산 ─── */

const SLOT: DockSlotRect = { left: 100, top: 300, width: 180, height: 220 };
const center = { x: SLOT.left + SLOT.width / 2, y: SLOT.top + SLOT.height / 2 };

/** transform 문자열을 카드(원점 center bottom)에 적용했을 때의 화면상 사각형 — 예전 방식(들린 카드를 잼) 재현용. */
function liftedRect(slot: DockSlotRect, transform: string): DockSlotRect {
  if (!transform) return slot;
  const m = transform.match(/translateY\((-?[\d.]+)px\) scale\(([\d.]+)\)/);
  assert.ok(m, transform);
  const dy = Number(m[1]);
  const s = Number(m[2]);
  const bottom = slot.top + slot.height + dy;
  const width = slot.width * s;
  const height = slot.height * s;
  return { left: slot.left + (slot.width - width) / 2, top: bottom - height, width, height };
}

test('dock-lift: 커서가 카드 중심이면 최대로(-10px, 1.05배), 거리·행 밖이면 제자리', () => {
  assert.equal(dockTransform(SLOT, center.x, center.y), `translateY(${DOCK_LIFT.toFixed(2)}px) scale(${(1 + DOCK_SCALE).toFixed(3)})`);
  assert.equal(dockTransform(SLOT, center.x + DOCK_MAX_DIST, center.y), '');
  assert.equal(dockTransform(SLOT, center.x + DOCK_MAX_DIST + 50, center.y), '');
  assert.equal(dockTransform(SLOT, center.x, center.y + SAME_ROW_Y_THRESHOLD + 1), '');
  assert.equal(dockTransform(SLOT, center.x, center.y - SAME_ROW_Y_THRESHOLD - 1), '');
  // 가까울수록 더 높이 — 단조 감소
  const lifts = [0, 40, 80, 120, 160].map((dx) => {
    const t = dockTransform(SLOT, center.x + dx, center.y);
    return t ? Number(t.match(/translateY\((-?[\d.]+)px\)/)![1]) : 0;
  });
  for (let i = 1; i < lifts.length; i += 1) assert.ok(lifts[i] > lifts[i - 1], `거리 ${i}: ${lifts}`);
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(0.5), 0.5);
});

test('dock-lift: 원래 자리 칸으로 재면 아래 가장자리에서도 한 값에 머문다(들린 카드로 재면 들썩임)', () => {
  // 커서가 카드 아래쪽, 같은 행 경계(110px) 바로 안쪽에 멈춰 있다.
  const x = center.x + 10;
  const y = center.y + SAME_ROW_Y_THRESHOLD - 4;

  // 예전 방식: 매 프레임 '들린 카드' 사각형으로 다시 재면 들림 ↔ 제자리가 번갈아 나온다.
  let transform = '';
  const old: string[] = [];
  for (let frame = 0; frame < 6; frame += 1) {
    transform = dockTransform(liftedRect(SLOT, transform), x, y);
    old.push(transform);
  }
  assert.ok(new Set(old).size > 1, `예전 방식 재현 실패: ${old}`);
  assert.ok(old.includes(''), '예전 방식은 제자리로 떨어지는 프레임이 있다');

  // 지금 방식: 판정은 원래 자리 칸으로 — 카드가 들려도 입력이 같으니 결과가 고정.
  const now = Array.from({ length: 6 }, () => dockTransform(SLOT, x, y));
  assert.equal(new Set(now).size, 1);
  assert.notEqual(now[0], '');
});

test('PartCardRow: 거리는 [data-scene-key] 원래 자리 칸으로 재고, 동작 줄이기면 dock-lift 를 쓰지 않는다', () => {
  const row = read('src/views/compositing-dashboard/cards/PartCardRow.tsx');
  const move = row.slice(row.indexOf('const handleMouseMove'), row.indexOf('const handleMouseLeave'));
  assert.ok(move.length > 0);
  assert.match(move, /card\.closest<HTMLElement>\('\[data-scene-key\]'\)/);
  assert.match(move, /dockTransform\(slot\.getBoundingClientRect\(\), x, y\)/);
  assert.doesNotMatch(move, /card\.getBoundingClientRect\(\)/, '들린 카드 자신을 재면 떨린다');
  assert.match(move, /if \(prefersReducedMotion\(\)\) return;/);
  // 원래 자리 칸이 실제로 카드 shell 의 부모로 존재한다.
  assert.match(row, /data-scene-key=\{`\$\{sc\.episodeNumber\}:\$\{sc\.sceneId\}`\}/);
});

/* ─── 카드 hover 공통 클래스 ─── */

test('.bf-card-hover: 떠오름은 translate 2px, 테두리·그림자는 미리 그린 ::after 의 opacity 로만', () => {
  const css = stripComments(read('src/styles/motion-foundation.css'));
  assert.match(ruleBody(css, '.bf-card-hover'), /--bf-card-lift: 2px;/);
  assert.match(ruleBody(css, ':where(.bf-card-hover)'), /position: relative;/);

  const after = ruleBody(css, '.bf-card-hover::after');
  assert.match(after, /pointer-events: none;/);
  assert.match(after, /opacity: 0;/);
  assert.match(after, /transition: opacity var\(--motion-base\) var\(--ease-out\);/);
  assert.match(after, /box-shadow: inset 0 0 0 1px var\(--bf-card-ring\);/);
  assert.equal(ruleBody(css, '.bf-card-hover:hover::after').trim(), 'opacity: 1;');

  const pressable = ruleBody(css, '.bf-card-hover:not(.bf-card-hover--info)');
  assert.match(pressable, /transition-property: translate, transform, opacity, color, background-color, border-color;/);
  assert.match(pressable, /transition-duration: var\(--motion-base\);/);
  assert.match(pressable, /transition-timing-function: var\(--ease-out\);/);
  const pressableAfter = ruleBody(css, '.bf-card-hover:not(.bf-card-hover--info)::after');
  assert.match(pressableAfter, /inset: -1px;/);
  assert.match(pressableAfter, /box-shadow: var\(--bf-card-shadow\);/);

  // 어떤 전환 목록에도 box-shadow 가 없다(그림자는 층의 opacity 로).
  for (const m of css.matchAll(/transition(?:-property)?:([^;]*);/g)) assert.doesNotMatch(m[1], /box-shadow/, m[0]);
  // hover 때 카드 자신은 translate 만 바뀐다.
  const motionOk = mediaBlock(css, 'prefers-reduced-motion: no-preference');
  assert.equal(ruleBody(motionOk, '.bf-card-hover:not(.bf-card-hover--info):hover').trim(), 'translate: 0 calc(-1 * var(--bf-card-lift));');
  assert.doesNotMatch(css.replace(motionOk, ''), /:hover\s*\{[^}]*translate: 0/, '떠오름은 동작 줄이기가 아닐 때만');
});

test('.bf-card-hover: hover 판정 띠가 원래 아래 가장자리를 채운다(편집 중 무지개 테두리와 겹치지 않게)', () => {
  const css = stripComments(read('src/styles/motion-foundation.css'));
  const motionOk = mediaBlock(css, 'prefers-reduced-motion: no-preference');
  const strip = ruleBody(motionOk, ':is(.bf-card-hover:not(.bf-card-hover--info), .scene-card-interactive):not(.editing-beam):hover::before');
  assert.match(strip, /content: '';/);
  assert.match(strip, /position: absolute;/);
  assert.match(strip, /top: 100%;/);
  // 들림(2px) + 테두리(1px) 이상을 덮어야 원래 아래 가장자리까지 닿는다.
  assert.match(strip, /height: calc\(var\(--bf-card-lift, 2px\) \+ 2px\);/);
});

test('.bf-card-hover: 동작 줄이기면 떠오르지 않는다(씬 카드의 Tailwind 떠오름 포함)', () => {
  const css = stripComments(read('src/styles/motion-foundation.css'));
  const reduce = mediaBlock(css, 'prefers-reduced-motion: reduce');
  assert.match(ruleBody(reduce, '.bf-card-hover:hover'), /translate: none;/);
  assert.match(ruleBody(reduce, '.scene-card-interactive:hover'), /--tw-translate-y: 0px;/);
});

/* ─── 적용처 ─── */

test('대시보드 위젯: 효과 없던 그림자 유틸을 걷고 정보 카드 hover 로', () => {
  const widget = read('src/components/widgets/Widget.tsx');
  assert.match(widget, /'bf-card-hover bf-card-hover--info'/);
  assert.match(widget, /'transition-colors duration-base'/);
  // 인라인 boxShadow 에 덮여 아무 일도 하지 않던 클래스, 레이아웃까지 움직이던 transition-all
  assert.doesNotMatch(widget, /hover:shadow-lg|'shadow-sm'|transition-all/);
  assert.match(widget, /boxShadow: '0 8px 32px/);
});

test('누를 수 있는 카드(에피소드·캐릭터)는 .bf-card-hover, framer y·개별 hover 테두리 없이', () => {
  const episode = read('src/views/EpisodeView.tsx');
  const card = episode.slice(episode.indexOf('function EpisodeCard('), episode.indexOf('function', episode.indexOf('function EpisodeCard(') + 10));
  assert.match(card, /<button\n\s+type="button"/);
  assert.match(card, /'bf-card-hover',/);
  assert.doesNotMatch(card, /whileHover|motion\.button|hover:shadow-md|hover:border-bg-border/);

  const character = read('src/components/characters/CharacterCard.tsx');
  assert.match(character, /'bf-card-hover',/);
  assert.doesNotMatch(character, /hover:border-accent\/50|transition-\[transform,opacity,border-color\]/);
  // 끌기 축소·흐림과 드롭 대상 테두리는 그대로(공통 클래스의 전환 목록이 받아 준다)
  assert.match(character, /dragging \? 'opacity-30 scale-\[0\.97\] motion-reduce:scale-100' : 'scale-100'/);
  assert.match(character, /dropTarget && !dragging && 'border-accent\/60'/);
});

test('정보 카드(인원별·팀원)는 .bf-card-hover--info, box-shadow hover 없이', () => {
  const assignee = read('src/views/AssigneeView.tsx');
  assert.match(assignee, /'bf-card-hover bf-card-hover--info'/);
  assert.doesNotMatch(assignee, /hover:shadow-md/);

  const team = read('src/views/TeamView.tsx');
  assert.match(team, /'rounded-xl border overflow-hidden bf-card-hover bf-card-hover--info'/);
  assert.match(team, /'transition-\[border-color,box-shadow\] duration-slow ease-out-expo'/);
  assert.doesNotMatch(team, /hover:shadow-md|transition-all duration-300/);
});

test('고유 hover 카드는 효과를 유지하고 박자만 공통 토큰으로', () => {
  const css = stripComments(read('src/index.css'));
  const interactive = ruleBody(css, '.scene-card-interactive');
  assert.match(interactive, /transform var\(--motion-base\) var\(--ease-out\)/);
  assert.match(interactive, /box-shadow var\(--motion-base\) var\(--ease-out\)/);
  assert.doesNotMatch(interactive, /300ms/);

  const compositing = ruleBody(css, '.scene-card');
  assert.match(compositing, /transform var\(--motion-slow\) var\(--ease-out\)/);
  assert.match(compositing, /outline-color var\(--motion-base\) var\(--ease-std\)/);
  assert.doesNotMatch(compositing, /320ms|220ms/);

  // 씬 카드의 떠오름·액센트 테두리는 그대로 둔다.
  for (const file of ['src/views/ScenesView.tsx', 'src/components/scenes/UnifiedSceneCard.tsx']) {
    assert.match(read(file), /'scene-card-interactive',\n\s+'hover:-translate-y-0\.5 hover:border-accent\/70',/, file);
  }
});
