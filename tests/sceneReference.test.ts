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
test('sceneUuid 로 같은 sceneId 중복 row 를 정확히 구분(첫 매치 아님)', () => {
  const eps = [{ episodeNumber: 1, title: 'EP.01', parts: [
    { partId: 'A', department: 'bg', sheetName: 'EP01_A_BG', scenes: [
      { sceneId: 'a001', no: 1, id: 'uuid-1' },
      { sceneId: 'a001', no: 2, id: 'uuid-2' },
    ] },
  ]}];
  const r = resolveReferenceMergedScene(
    { kind: 'scene', episodeNumber: 1, partId: 'A', sceneId: 'a001', sceneUuid: 'uuid-2' } as any, eps as any, 'no', 'asc');
  assert.ok(r);
  assert.equal(r!.merged.bgScene?.id, 'uuid-2'); // 첫 row(uuid-1)가 아니라 uuid-2
});
test('ACT 비정규 sceneId(ac001)도 raw 매칭으로 찾음(정규 a001로 병합돼도)', () => {
  const eps = [{ episodeNumber: 1, title: 'EP.01', parts: [
    { partId: 'A', department: 'bg', sheetName: 'EP01_A_BG', scenes: [{ sceneId: 'a001', no: 1, id: 'uuid-bg' }] },
    { partId: 'A', department: 'acting', sheetName: 'EP01_A_ACT', scenes: [{ sceneId: 'ac001', no: 1, id: 'uuid-act' }] },
  ]}];
  const r = resolveReferenceMergedScene(
    { kind: 'scene', episodeNumber: 1, partId: 'A', sceneId: 'ac001' } as any, eps as any, 'no', 'asc');
  assert.ok(r); // merged.sceneId 가 a001 로 정규화돼도 ac001(ACT raw)로 찾힌다
  assert.equal(r!.merged.actScene?.sceneId, 'ac001');
});
