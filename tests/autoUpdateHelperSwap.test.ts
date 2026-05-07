import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('PowerShell helper script keeps stepName interpolation inside PowerShell', async () => {
  const source = await readFile(
    path.join(process.cwd(), 'electron', 'autoUpdate', 'helperSwap.ts'),
    'utf-8',
  );

  assert.equal(
    source.includes('${stepName}'),
    false,
    '`${stepName}` is evaluated by JavaScript before the helper starts; use `$($stepName)` inside the PowerShell script.',
  );
  assert.match(source, /\$\(\$stepName\): rename try/);
  assert.match(source, /\$\(\$stepName\): copy fallback/);
});

test('PowerShell helper lock regex avoids JavaScript-stripped backslash escapes', async () => {
  const source = await readFile(
    path.join(process.cwd(), 'electron', 'autoUpdate', 'helperSwap.ts'),
    'utf-8',
  );

  assert.equal(
    source.includes("'^(\\d+)\\|(\\d+)$'"),
    false,
    'Backslash regex escapes inside the TypeScript template can be stripped before PowerShell receives the script.',
  );
  assert.match(source, /\$oldContent -match '\^\(\[0-9\]\+\)\[\|\]\(\[0-9\]\+\)\$'/);
});
