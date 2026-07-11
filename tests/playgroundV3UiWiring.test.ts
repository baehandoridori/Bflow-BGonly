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
