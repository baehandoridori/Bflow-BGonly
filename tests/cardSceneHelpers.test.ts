import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCardScenes, flattenCardScenes } from '../src/views/compositing-dashboard/cardSceneHelpers.ts';

// 최소 fixture — buildCardScenes 가 읽는 필드만 채운다.
function scene(sceneId: string, no: number) {
  return { sceneId, no } as any;
}
function ep(parts: any[]) {
  return { episodeNumber: 1, title: 'EP.01', parts } as any;
}

test('대소문자만 다른 BG d001 / ACT D001 은 한 카드로 병합된다', () => {
  // BG 파트는 소문자 d001, ACT 파트는 대문자 D001 — 논리적으로 같은 씬.
  const e = ep([
    { partId: 'd', sheetName: 'BG_D', department: 'bg', id: 'p-bg', scenes: [scene('d001', 1)] },
    { partId: 'D', sheetName: 'ACT_D', department: 'acting', id: 'p-act', scenes: [scene('D001', 1)] },
  ]);
  const all = flattenCardScenes(buildCardScenes(e));
  assert.equal(all.length, 1, 'd001/D001 은 1개 카드로 병합되어야 한다(2개로 분리 X)');
  assert.ok(all[0].bg, 'bg 채워짐');
  assert.ok(all[0].act, 'act 채워짐');
  assert.equal(all[0].bgSheetName, 'BG_D');
  assert.equal(all[0].actSheetName, 'ACT_D');
});

test('대소문자 동일 BG/ACT 씬도 1개로 병합(기존 동작 유지)', () => {
  const e = ep([
    { partId: 'A', sheetName: 'BG_A', department: 'bg', id: 'p-bg', scenes: [scene('a001', 1)] },
    { partId: 'A', sheetName: 'ACT_A', department: 'acting', id: 'p-act', scenes: [scene('a001', 1)] },
  ]);
  const all = flattenCardScenes(buildCardScenes(e));
  assert.equal(all.length, 1);
  assert.ok(all[0].bg && all[0].act);
});

test('서로 다른 씬은 그대로 별개 카드(과병합 방지)', () => {
  const e = ep([
    { partId: 'A', sheetName: 'BG_A', department: 'bg', id: 'p-bg', scenes: [scene('a001', 1), scene('a002', 2)] },
  ]);
  const all = flattenCardScenes(buildCardScenes(e));
  assert.equal(all.length, 2);
});
