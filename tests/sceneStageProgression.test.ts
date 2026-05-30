import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildSequentialStagePatch,
  getChangedSequentialStages,
  isSequentialStageComplete,
} from '../src/utils/sceneStageProgression.ts';

test('stage progression turns on all previous stages when advancing', () => {
  assert.deepEqual(
    buildSequentialStagePatch(
      { lo: false, done: false, review: false, png: false },
      'review',
    ),
    { lo: true, done: true, review: true, png: false },
  );

  assert.deepEqual(
    buildSequentialStagePatch(
      { lo: false, done: false, review: false, png: false },
      'png',
    ),
    { lo: true, done: true, review: true, png: true },
  );
});

test('stage progression rolls back from the clicked completed stage', () => {
  assert.deepEqual(
    buildSequentialStagePatch(
      { lo: true, done: true, review: true, png: true },
      'review',
    ),
    { lo: true, done: true, review: false, png: false },
  );

  assert.deepEqual(
    buildSequentialStagePatch(
      { lo: true, done: false, review: false, png: false },
      'lo',
    ),
    { lo: false, done: false, review: false, png: false },
  );
});

test('stage progression exposes changed fields and full completion', () => {
  const current = { lo: false, done: true, review: false, png: false };
  const patch = buildSequentialStagePatch(current, 'review');

  assert.deepEqual(getChangedSequentialStages(current, patch), ['lo', 'review']);
  assert.equal(isSequentialStageComplete(patch), false);
  assert.equal(isSequentialStageComplete(buildSequentialStagePatch(current, 'png')), true);
});

test('inline confirmation mockup is not kept as an active design artifact', () => {
  assert.equal(
    existsSync(path.join(process.cwd(), 'docs', 'mockups', '2026-05-30-inline-confirmation-interactions.html')),
    false,
  );
});

test('scene view uses sequential stage patches for single and bulk toggles', async () => {
  const scenesView = await readFile(path.join(process.cwd(), 'src', 'views', 'ScenesView.tsx'), 'utf-8');
  const bulkOperations = await readFile(path.join(process.cwd(), 'src', 'utils', 'bulkOperations.ts'), 'utf-8');

  assert.match(scenesView, /buildSequentialStagePatch\(scene, stage\)/);
  assert.match(scenesView, /changedStages\.forEach\(\(changedStage\) => \{/);
  assert.match(scenesView, /setSceneStageValue\(sheetName, sceneId, changedStage, stagePatch\[changedStage\]\)/);
  assert.match(scenesView, /for \(const changedStage of changedStages\)/);
  assert.match(scenesView, /updateCell\(sheetName, sceneIndex, changedStage, stagePatch\[changedStage\]/);
  assert.doesNotMatch(scenesView, /toggleSceneStage\(sheetName, sceneId, stage\)/);

  assert.match(scenesView, /const stagePatchByUuid = new Map<string, Partial<Record<Stage, boolean>>>\(\)/);
  assert.match(scenesView, /stagePatchByUuid\.set\(s\.id, sceneStagePatch\)/);
  assert.match(scenesView, /coalesceBulkStageResults/);
  assert.match(bulkOperations, /stagePatchByUuid\?: Map<string, Partial<Record<Stage, boolean>>>/);
  assert.match(bulkOperations, /Object\.assign\(patch, stagePatch\)/);
});
