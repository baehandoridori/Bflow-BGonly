import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReferenceMergedScene } from '../src/utils/sceneReference.ts';

const EPISODES2 = [{ episodeNumber: 1, title: 'EP.01', parts: [
  { partId: 'A', department: 'bg', sheetName: 'EP01_A_BG', scenes: [{ sceneId: 'a001', no: 1, memo: 'bg' }] },
  { partId: 'A', department: 'acting', sheetName: 'EP01_A_ACT', scenes: [{ sceneId: 'a001', no: 1, memo: 'act' }] },
]}];

test('scene 타깃 → {merged, bgSheetName, actSheetName}', () => {
  const r = resolveReferenceMergedScene(
    { kind: 'scene', episodeNumber: 1, partId: 'A', sceneId: 'a001' }, EPISODES2 as any, 'no', 'asc');
  assert.ok(r);
  assert.equal(r!.merged.sceneId, 'a001');
  assert.equal(r!.bgSheetName, 'EP01_A_BG');
  assert.equal(r!.actSheetName, 'EP01_A_ACT');
  assert.ok(r!.merged.bgScene || r!.merged.actScene);
});
test('없는 씬 → null', () => {
  assert.equal(resolveReferenceMergedScene(
    { kind: 'scene', episodeNumber: 9, partId: 'Z', sceneId: 'zzz' }, EPISODES2 as any, 'no', 'asc'), null);
});
