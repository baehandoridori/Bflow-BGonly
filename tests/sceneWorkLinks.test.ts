import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySceneWorkLinkRealtimeRows,
  buildSceneWorkLinkMap,
  getSceneWorkLinkSlots,
  getWorkLinkSlotKey,
  getWorkLinkWarnings,
  isLikelyPersonalPath,
  mapSceneWorkLinkRow,
} from '../src/utils/sceneWorkLinks.ts';
import type { SceneWorkLink } from '../src/types/index.ts';

const stamp = '2026-06-25T00:00:00.000Z';

function link(input: Partial<SceneWorkLink> & Pick<SceneWorkLink, 'id' | 'sceneUuid' | 'department' | 'linkKind' | 'path'>): SceneWorkLink {
  return {
    label: null,
    sortOrder: 0,
    createdBy: null,
    createdAt: stamp,
    updatedBy: null,
    updatedAt: stamp,
    ...input,
  };
}

test('buildSceneWorkLinkMap indexes primary slots by scene, department, and kind', () => {
  const links: SceneWorkLink[] = [
    link({ id: '1', sceneUuid: 's1', department: 'bg', linkKind: 'folder', path: 'G:\\show\\A_014', updatedBy: 'u1' }),
    link({ id: '2', sceneUuid: 's1', department: 'bg', linkKind: 'primary_file', path: 'G:\\show\\A_014\\main.psd', updatedBy: 'u1' }),
  ];

  const map = buildSceneWorkLinkMap(links);

  assert.equal(map.get(getWorkLinkSlotKey('s1', 'bg', 'folder'))?.path, 'G:\\show\\A_014');
  assert.equal(map.get(getWorkLinkSlotKey('s1', 'bg', 'primary_file'))?.path, 'G:\\show\\A_014\\main.psd');
});

test('getSceneWorkLinkSlots returns folder and primary file for a department', () => {
  const links: SceneWorkLink[] = [
    link({ id: '1', sceneUuid: 's1', department: 'acting', linkKind: 'folder', path: 'G:\\act\\A_014' }),
    link({ id: '2', sceneUuid: 's1', department: 'acting', linkKind: 'primary_file', path: 'G:\\act\\A_014\\main.clip' }),
  ];

  const slots = getSceneWorkLinkSlots(buildSceneWorkLinkMap(links), 's1', 'acting');

  assert.equal(slots.folder?.path, 'G:\\act\\A_014');
  assert.equal(slots.primaryFile?.path, 'G:\\act\\A_014\\main.clip');
});

test('isLikelyPersonalPath detects user profile paths but not shared drive or UNC paths', () => {
  assert.equal(isLikelyPersonalPath('C:\\Users\\user\\Desktop\\a.psd'), true);
  assert.equal(isLikelyPersonalPath('C:\\Documents and Settings\\user\\a.psd'), true);
  assert.equal(isLikelyPersonalPath('G:\\공유 드라이브\\JBBJ\\a.psd'), false);
  assert.equal(isLikelyPersonalPath('\\\\nas\\show\\a.psd'), false);
});

test('getWorkLinkWarnings allows saving but flags personal and kind mismatch paths', () => {
  assert.deepEqual(getWorkLinkWarnings('C:\\Users\\user\\Desktop\\a.psd', 'primary_file'), ['personal_path']);
  assert.deepEqual(getWorkLinkWarnings('G:\\show\\folder\\', 'primary_file'), ['maybe_not_file']);
  assert.deepEqual(getWorkLinkWarnings('G:\\show\\main.psd', 'folder'), ['maybe_not_folder']);
});

test('mapSceneWorkLinkRow normalizes database snake_case fields', () => {
  const mapped = mapSceneWorkLinkRow({
    id: 'row1',
    scene_uuid: 's1',
    department: 'bg',
    link_kind: 'folder',
    path: 'G:\\show',
    label: null,
    sort_order: 0,
    created_by: 'u1',
    created_at: '2026-06-25T00:00:00.000Z',
    updated_by: 'u2',
    updated_at: '2026-06-25T01:00:00.000Z',
  });

  assert.equal(mapped.sceneUuid, 's1');
  assert.equal(mapped.linkKind, 'folder');
  assert.equal(mapped.updatedBy, 'u2');
});

test('applySceneWorkLinkRealtimeRows upserts and deletes rows by id', () => {
  const initial = [
    link({ id: '1', sceneUuid: 's1', department: 'bg', linkKind: 'folder', path: 'old' }),
  ];

  const upserted = applySceneWorkLinkRealtimeRows(initial, {
    eventType: 'UPDATE',
    row: { id: '1', scene_uuid: 's1', department: 'bg', link_kind: 'folder', path: 'new' },
  });
  assert.equal(upserted[0].path, 'new');

  const deleted = applySceneWorkLinkRealtimeRows(upserted, {
    eventType: 'DELETE',
    row: { id: '1' },
  });
  assert.equal(deleted.length, 0);
});
