import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Playground owns a local header and named inline-size container', () => {
  const shell = readFileSync('src/views/playground/PlaygroundShell.tsx', 'utf8');
  const header = readFileSync('src/views/playground/PlaygroundHeader.tsx', 'utf8');
  const css = readFileSync('src/views/playground/playground.css', 'utf8');
  assert.match(shell, /data-pg-shell/);
  assert.match(shell, /data-pg-surface/);
  assert.match(shell, /<PlaygroundHeader/);
  assert.match(header, /data-pg-header/);
  assert.match(header, /JBBJ 하우스/);
  assert.match(header, /ranking\.balanceLabel/);
  assert.match(header, /ranking\.rankLabel/);
  assert.match(css, /container:\s*playground\s*\/\s*inline-size/);
  assert.match(css, /@container playground \(max-width: 970px\)/);
  assert.match(css, /@container playground \(max-width: 619px\)/);
  assert.match(css, /min-height:\s*88px/);
  assert.match(css, /grid-template-areas:\s*"identity house"\s*"balance balance"/);
  assert.match(css, /\.pg-header__actions\s*{\s*display:\s*contents;/);
  assert.match(css, /\.pg-header__identity\s*{[^}]*grid-area:\s*identity/);
  assert.match(css, /\.pg-header__house\s*{[^}]*grid-area:\s*house/);
  assert.match(css, /\.pg-header__balance\s*{[^}]*grid-area:\s*balance/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('compact back control keeps an accessible name when its visible label is hidden', () => {
  const header = readFileSync('src/views/playground/PlaygroundHeader.tsx', 'utf8');
  assert.match(header, /className="pg-header__back"[^>]*aria-label=\{backLabel\}/);
});

test('compact back control keeps a 44 by 44 pixel target', () => {
  const css = readFileSync('src/views/playground/playground.css', 'utf8');
  assert.match(css, /\.pg-header__back\s*{[^}]*min-width:\s*44px/);
  assert.match(css, /\.pg-header__back,\s*\.pg-header__house\s*{[^}]*min-height:\s*44px/);
});

test('Korean header description and status copy never renders below 14 pixels', () => {
  const css = readFileSync('src/views/playground/playground.css', 'utf8');
  for (const selector of [
    '.pg-header__copy p',
    '.pg-header__online-copy',
    '.pg-header__balance span',
    '.pg-header__house strong',
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blocks = [...css.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))];
    const fontSizes = blocks.flatMap((block) => (
      [...block[1].matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) => Number(match[1]))
    ));
    assert.ok(fontSizes.length > 0, `${selector} must define a pixel font-size`);
    assert.ok(fontSizes.every((fontSize) => fontSize >= 14), `${selector} must stay at or above 14px`);
  }
});
