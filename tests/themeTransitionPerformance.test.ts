import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function themeTransitionRule() {
  const css = readFileSync('src/index.css', 'utf-8').replace(/\r\n/g, '\n');
  const transitionBlock = css.match(/\/\* ─── 라이트↔다크 전환 트랜지션 ───[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(transitionBlock, 'theme transition block should exist');
  // 주석(예전 셀렉터를 설명하는 글)은 빼고 규칙만 본다.
  return transitionBlock.replace(/\/\*[\s\S]*?\*\//g, '');
}

test('theme transitions avoid global wildcard rules on dense scene views', () => {
  const rule = themeTransitionRule();
  assert.doesNotMatch(rule, /body\.theme-ready\)?\s+\*/);
  assert.doesNotMatch(rule, /\*::before|\*::after/);
  assert.doesNotMatch(rule, /box-shadow/);
  // 큰 표면과 컨트롤만: header·button 등을 이름으로 고른다.
  assert.match(rule, /:where\(body\.theme-ready\) :where\([^)]*\bheader\b/);
  assert.match(rule, /:where\(body\.theme-ready\) :where\([^)]*\bbutton\b/);
  assert.match(rule, /0\.18s/);
});

test('theme transitions only fade colors and never override a component transition', () => {
  const rule = themeTransitionRule();
  // 특이도 0 — `body.theme-ready button`(0,1,2)은 Tailwind transition-*·duration-*(0,1,0)을 이겨
  // 버튼·svg 의 transform/opacity 전환을 넉 달 동안 꺼 두었다(움직임 폴리싱 1번).
  assert.doesNotMatch(
    rule,
    /(^|,)\s*body\.theme-ready\s+(#root|header|aside|main|\[role|button|input|textarea|select|svg)/m,
    '요소 셀렉터는 :where() 안에 둔다',
  );
  const declarations = rule.slice(rule.indexOf('{'));
  assert.doesNotMatch(declarations, /\b(transform|opacity|all)\b/, '색 속성만 전환한다');
});

test('calendar + button keeps its own light transition after the theme rule steps back', () => {
  const css = readFileSync('src/index.css', 'utf-8').replace(/\r\n/g, '\n');
  const addButton = css.slice(css.indexOf('.calendar-day-add {'), css.indexOf('.calendar-day-add:hover'));
  const transition = addButton.match(/\n\s*transition:([^;]+);/)?.[1] ?? '';
  assert.ok(transition, '+ 버튼 전환을 찾지 못했다');
  // --reveal 이 커서 이동마다 바뀌므로 여기 걸린 전환은 매번 다시 시작된다(v1.127.5 성능 기준 유지).
  assert.doesNotMatch(transition, /box-shadow/, '흐린 그림자 전환은 매 프레임 넓게 다시 그린다');
  assert.doesNotMatch(transition, /\b(opacity|transform|all)\b/, '근접 노출이 커서보다 늦게 따라온다');
  assert.match(transition, /\bcolor 0\.14s/);
});
