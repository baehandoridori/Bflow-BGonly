import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('global editable focus recovery is installed by the app shell', async () => {
  const app = await readFile(path.join(process.cwd(), 'src', 'App.tsx'), 'utf-8');
  const helper = await readFile(path.join(process.cwd(), 'src', 'utils', 'editableFocus.ts'), 'utf-8');

  assert.match(app, /installEditableFocusRecovery/);
  assert.match(helper, /pointerdown/);
  assert.match(helper, /focus\(\{ preventScroll: true \}\)/);
  assert.match(helper, /HTMLTextAreaElement/);
  assert.match(helper, /isContentEditable/);
});
