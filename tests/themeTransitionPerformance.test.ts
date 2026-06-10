import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('theme transitions avoid global wildcard rules on dense scene views', () => {
  const css = readFileSync('src/index.css', 'utf-8');
  const transitionBlock = css.match(/\/\* ─── 라이트↔다크 전환 트랜지션 ───[\s\S]*?\n\}/)?.[0] ?? '';

  assert.ok(transitionBlock, 'theme transition block should exist');
  assert.doesNotMatch(transitionBlock, /body\.theme-ready\s+\*/);
  assert.doesNotMatch(transitionBlock, /\*::before|\*::after/);
  assert.doesNotMatch(transitionBlock, /box-shadow/);
  assert.match(transitionBlock, /body\.theme-ready header/);
  assert.match(transitionBlock, /body\.theme-ready button/);
  assert.match(transitionBlock, /0\.18s/);
});
