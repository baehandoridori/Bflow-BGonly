import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('installer progress window is a normal non-modal window', async () => {
  const source = await readFile(
    path.join(process.cwd(), 'electron', 'autoUpdate', 'installerApply.ts'),
    'utf-8',
  );

  assert.match(source, /Topmost="False"/);
  assert.match(source, /ShowActivated="False"/);
  assert.match(source, /\$window\.ShowActivated = \$false/);
  assert.match(source, /\$window\.Show\(\) \| Out-Null/);
  assert.doesNotMatch(source, /\$window\.ShowDialog\(\)/);
});
