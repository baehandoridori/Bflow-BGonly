import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildSingleSceneSelectionId,
  parseSingleSceneSelectionId,
  resolveSingleSceneSelection,
} from '../src/utils/sceneSelectionId.ts';

type MinimalScene = { id?: string; sceneId: string };
type MinimalPart = { sheetName: string; scenes: MinimalScene[] };

test('single-view selection ids resolve duplicate visible scene numbers by uuid', () => {
  const part: MinimalPart = {
    sheetName: 'EP01_A_ACT',
    scenes: [
      { id: 'uuid-first', sceneId: 'a003' },
      { id: 'uuid-second', sceneId: 'a003' },
    ],
  };

  const selectionId = buildSingleSceneSelectionId(part.sheetName, part.scenes[1], 1);
  const parsed = parseSingleSceneSelectionId(selectionId);

  assert.match(selectionId, /^scene:/);
  assert.notEqual(selectionId, 'a003');
  assert.equal(parsed?.sheetName, part.sheetName);
  assert.equal(parsed?.sceneUuid, 'uuid-second');
  assert.equal(resolveSingleSceneSelection(part, selectionId)?.id, 'uuid-second');
});

test('single-view selection ids fall back to row index when uuid is missing', () => {
  const part: MinimalPart = {
    sheetName: 'EP01_A_BG',
    scenes: [
      { sceneId: 'a010' },
      { sceneId: 'a010' },
    ],
  };

  const selectionId = buildSingleSceneSelectionId(part.sheetName, part.scenes[1], 1);
  const parsed = parseSingleSceneSelectionId(selectionId);

  assert.equal(parsed?.sceneIndex, 1);
  assert.equal(resolveSingleSceneSelection(part, selectionId), part.scenes[1]);
});

test('scene card and sheet selections use stable single-view selection ids', async () => {
  const scenesView = await readFile(path.join(process.cwd(), 'src', 'views', 'ScenesView.tsx'), 'utf-8');
  const sheetView = await readFile(path.join(process.cwd(), 'src', 'components', 'scenes', 'SceneSheetView.tsx'), 'utf-8');
  const bulkOperations = await readFile(path.join(process.cwd(), 'src', 'utils', 'bulkOperations.ts'), 'utf-8');

  assert.match(scenesView, /buildSingleSceneSelectionId\(currentPart\?\.sheetName \?\? '', scene, sIdx\)/);
  assert.match(scenesView, /selectionId=\{selectionId\}/);
  assert.match(scenesView, /selectedSceneIds\.has\(selectionId\)/);
  assert.doesNotMatch(scenesView, /isSelected=\{selectedSceneIds\.has\(scene\.sceneId\)\}/);
  assert.doesNotMatch(scenesView, /toggleSelectedScene\(scene\.sceneId\)/);
  assert.doesNotMatch(scenesView, /rangeIds\.add\([^)]*\.sceneId\)/);

  assert.match(sheetView, /buildSingleSceneSelectionId\(sheetName, scene, idx\)/);
  assert.match(sheetView, /selectedSceneIds\?\.has\(selectionId\)/);
  assert.match(sheetView, /onCtrlClick\(selectionId\)/);
  assert.doesNotMatch(sheetView, /selectedSceneIds\?\.has\(scene\.sceneId\)/);

  assert.match(bulkOperations, /parseSingleSceneSelectionId/);
  assert.match(bulkOperations, /resolveSingleSceneSelection/);
});
