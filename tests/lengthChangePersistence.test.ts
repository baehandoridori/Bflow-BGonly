import test from 'node:test';
import assert from 'node:assert/strict';

import {
  persistLengthChangeAtomic,
  persistLengthChangeIndependent,
  type LengthChangeTarget,
} from '../src/utils/lengthChangePersistence.ts';

test('atomic lengthChange persistence rolls back all linked targets and reverses fulfilled writes on partial failure', async () => {
  const targets: LengthChangeTarget[] = [
    { uuid: 'bg-1', prev: 'LD' },
    { uuid: 'act-1', prev: null },
  ];
  const updates: Array<[string, string | null]> = [];
  const saves: Array<[string, string]> = [];

  const result = await persistLengthChangeAtomic(targets, 'SD', {
    updateScene: (uuid, value) => updates.push([uuid, value]),
    saveSceneField: async (uuid, value) => {
      saves.push([uuid, value]);
      if (uuid === 'act-1' && value === 'SD') throw new Error('save failed');
    },
    logError: () => {},
  });

  assert.equal(result.ok, false);
  assert.deepEqual(updates, [
    ['bg-1', 'SD'],
    ['act-1', 'SD'],
    ['bg-1', 'LD'],
    ['act-1', null],
  ]);
  assert.deepEqual(saves, [
    ['bg-1', 'SD'],
    ['act-1', 'SD'],
    ['bg-1', 'LD'],
  ]);
});

test('independent lengthChange persistence rolls back only failed single-department targets', async () => {
  const targets: LengthChangeTarget[] = [
    { uuid: 'bg-1', prev: 'LD' },
    { uuid: 'bg-2', prev: null },
  ];
  const updates: Array<[string, string | null]> = [];

  const result = await persistLengthChangeIndependent(targets, 'SD', {
    updateScene: (uuid, value) => updates.push([uuid, value]),
    saveSceneField: async (uuid) => {
      if (uuid === 'bg-2') throw new Error('save failed');
    },
    logError: () => {},
  });

  assert.equal(result.ok, false);
  assert.deepEqual(updates, [
    ['bg-1', 'SD'],
    ['bg-2', 'SD'],
    ['bg-2', null],
  ]);
});
