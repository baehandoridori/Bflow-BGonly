import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf-8');

test('revision status colors use theme tokens so light mode can keep text readable', () => {
  const constants = read('src/constants/revision.ts');
  const detailPanel = read('src/views/compositing/RevisionDetailPanel.tsx');
  const revisionSurfaces = [
    'src/views/compositing/ProgressKanbanSection.tsx',
    'src/views/compositing/RevisionDetailPanel.tsx',
    'src/views/compositing/RevisionItem.tsx',
    'src/views/compositing/SceneGroupSection.tsx',
    'src/views/compositing/sharedComponents.tsx',
  ].map(read).join('\n');

  assert.match(constants, /var\(--status-adjust\)/);
  assert.match(constants, /var\(--status-combine\)/);
  assert.match(constants, /var\(--status-done\)/);
  assert.match(constants, /color-mix\(in srgb, var\(--status-adjust\) 15%, transparent\)/);
  assert.match(constants, /color-mix\(in srgb, var\(--status-combine\) 15%, transparent\)/);
  assert.match(constants, /color-mix\(in srgb, var\(--status-done\) 15%, transparent\)/);

  assert.doesNotMatch(constants, /#FDCB6E|#74B9FF|#00B894/);
  assert.doesNotMatch(detailPanel, /STATUS_CONFIG\.[a-z_]+\.color \+ '40'/);
  assert.doesNotMatch(
    revisionSurfaces,
    /#FDCB6E|#74B9FF|#00B894|rgba\(253, 203, 110|rgba\(116, 185, 255|rgba\(0, 184, 148/,
  );
});
