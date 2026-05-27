import test from 'node:test';
import assert from 'node:assert/strict';

import { filterRevisionsBySearch, type SceneInfo } from '../src/views/compositing/utils.ts';
import type { CompRevision } from '../src/types/index.ts';

const baseRevision = {
  id: 'rev-1',
  sceneKey: 'EP01:A:a001',
  revisionNo: 1,
  status: 'open',
  priority: 'normal',
  description: '색감 확인 필요',
  requesterId: 'user-1',
  requesterName: '한솔',
  createdAt: '2026-05-27T01:00:00.000Z',
  updatedAt: '2026-05-27T01:00:00.000Z',
} satisfies Partial<CompRevision>;

function revision(overrides: Partial<CompRevision>): CompRevision {
  return {
    ...baseRevision,
    ...overrides,
  } as CompRevision;
}

function sceneInfo(overrides: Partial<SceneInfo>): SceneInfo {
  return {
    sceneKey: 'EP01:A:a001',
    sceneId: 'a001',
    sceneNo: 1,
    sceneName: '숲 입구',
    sheetName: 'EP01_A_BG',
    part: 'A',
    department: 'bg',
    assignee: '',
    ...overrides,
  };
}

test('revision search includes revision assignee names', () => {
  const revisions = [
    revision({ id: 'target', assignee: '배한' }),
    revision({ id: 'other', sceneKey: 'EP01:A:a002', assignee: '민지' }),
  ];

  const filtered = filterRevisionsBySearch(revisions, '배한', new Map());

  assert.deepEqual(filtered.map((item) => item.id), ['target']);
});

test('revision search includes scene assignee names', () => {
  const target = revision({ id: 'target', sceneKey: 'EP01:A:a001', assignee: '' });
  const other = revision({ id: 'other', sceneKey: 'EP01:A:a002', assignee: '' });
  const sceneInfoMap = new Map([
    [target.sceneKey, sceneInfo({ sceneKey: target.sceneKey, assignee: '서연' })],
    [other.sceneKey, sceneInfo({ sceneKey: other.sceneKey, sceneId: 'a002', assignee: '민지' })],
  ]);

  const filtered = filterRevisionsBySearch([target, other], '서연', sceneInfoMap);

  assert.deepEqual(filtered.map((item) => item.id), ['target']);
});
