import test from 'node:test';
import assert from 'node:assert/strict';
import { getSymbolPreset, symbolCatalog } from '../src/features/backgrounds/symbolCatalog.ts';
import type { BackgroundSymbolKind } from '../src/features/backgrounds/types.ts';

test('the symbol list has stairs before the generic object, and a kind that is not listed reads as the generic object', () => {
  // Removed presets stay the generic object: they never become whatever is listed next to it.
  for (const kind of ['desk', 'sofa', 'cabinet', 'plant'] as const) assert.equal(getSymbolPreset(kind).id, 'custom', kind);
  assert.deepEqual(getSymbolPreset('stairs'), { id: 'stairs', label: '계단', width: 120, height: 240 });
  assert.equal(getSymbolPreset('piano' as BackgroundSymbolKind).id, 'custom');
  assert.deepEqual(symbolCatalog.map(item => item.id), ['door', 'chair', 'table', 'bed', 'stairs', 'custom']);
});
