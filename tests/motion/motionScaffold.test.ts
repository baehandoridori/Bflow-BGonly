import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* 움직임 폴리싱 갈래용 틀 — 갈래마다 자기 CSS 파일 하나만 고치도록 진입점과 테스트 체인을 고정한다. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');

test('갈래별 CSS 9개가 전역 CSS 뒤에 순서대로 import 된다', () => {
  const main = read('src/main.tsx');
  const files = ['foundation', 'scene-check', 'scene-flow', 'view-entry', 'comments-notify', 'chrome-popups', 'live-drag', 'popups-panels', 'view-transition'];
  const indexAt = main.indexOf("import './index.css';");
  assert.ok(indexAt >= 0);
  let previous = main.indexOf("import './styles/scene-effects.css';");
  assert.ok(previous > indexAt, '전역 CSS 묶음 뒤');
  for (const name of files) {
    const at = main.indexOf(`import './styles/motion-${name}.css';`);
    assert.ok(at > previous, `motion-${name}.css 순서`);
    previous = at;
    assert.match(read(`src/styles/motion-${name}.css`), /^\/\* 이 갈래 전용 움직임 CSS/);
  }
});

test('package.json: test:motion 이 build·build:vite 체인에서 test:vacation 다음에 돈다', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['test:motion'], 'node --test "tests/motion/*.test.ts"');
  for (const script of ['build', 'build:vite']) {
    assert.match(pkg.scripts[script], /npm run test:vacation && npm run test:motion && vite build/, script);
  }
});
