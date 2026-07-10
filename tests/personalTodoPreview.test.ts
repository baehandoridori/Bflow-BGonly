import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createPersonalTodoPreviewStore,
  createMemoryStorage,
  createPreviewSessionController,
  resetPersonalTodoPreview,
} from '../src/mocks/personalTodoPreviewStore.ts';
import { createPersonalTodo } from '../src/components/widgets/my-tasks/personalTodoDomain.ts';
import { collectLegacyPersonalTodos, isCanonicalPersonalTodoId } from '../src/components/widgets/my-tasks/personalTodoMigration.ts';
import { isPersonalTodoIntentCurrent, makePersonalTodoMutationKey } from '../src/components/widgets/my-tasks/personalTodoMigration.ts';

test('preview storage is isolated by canonical user and shared by windows', () => {
  const storage = createMemoryStorage();
  const alice = createPersonalTodoPreviewStore(storage, 'alice');
  const bob = createPersonalTodoPreviewStore(storage, 'bob');
  alice.replaceTodos([createPersonalTodo({ id: 'a', title: 'Alice' })]);
  assert.equal(alice.readTodos().length, 1);
  assert.equal(bob.readTodos().length, 0);

  const secondAlice = createPersonalTodoPreviewStore(storage, 'alice');
  assert.equal(secondAlice.readTodos()[0]?.title, 'Alice');
});

test('preview store has deterministic seed and reset helpers', () => {
  const storage = createMemoryStorage();
  const store = createPersonalTodoPreviewStore(storage, 'alice');
  store.seedDeterministic();
  const seeded = store.readTodos();
  assert.ok(seeded.length > 0);
  store.replaceTodos([]);
  resetPersonalTodoPreview(storage);
  assert.deepEqual(createPersonalTodoPreviewStore(storage, 'alice').readTodos(), []);
});

test('personal todo hook keeps a confirmed baseline and session epoch', () => {
  const source = readFileSync('src/components/widgets/my-tasks/hooks/usePersonalTodos.ts', 'utf8');
  assert.match(source, /confirmed.*Baseline/i);
  assert.match(source, /sessionEpoch/);
  assert.match(source, /ensureCanonicalSession/);
});

test('legacy migration converts non-UUID ids while preserving calendar fields', () => {
  const storage = createMemoryStorage({
    bflow_assigned_personal_todos: JSON.stringify([
      { id: 'ptodo_old', title: 'legacy', startDate: '2026-07-01', endDate: '2026-07-02', addToCalendar: true },
    ]),
  });
  const migration = collectLegacyPersonalTodos(storage, []);
  assert.equal(migration.todos.length, 1);
  assert.equal(isCanonicalPersonalTodoId(migration.todos[0].id), true);
  assert.deepEqual(
    { startDate: migration.todos[0].startDate, endDate: migration.todos[0].endDate, addToCalendar: migration.todos[0].addToCalendar },
    { startDate: '2026-07-01', endDate: '2026-07-02', addToCalendar: true },
  );
});

test('stale mutation identity is rejected after session/generation changes', () => {
  assert.equal(isPersonalTodoIntentCurrent(
    { epoch: 1, userId: 'alice', generation: 3 },
    { epoch: 2, userId: 'bob', generation: 4 },
  ), false);
  assert.equal(makePersonalTodoMutationKey('label', 'l1', 1) === makePersonalTodoMutationKey('label', 'l1', 2), false);
  assert.equal(makePersonalTodoMutationKey('order', 'all', 1) === makePersonalTodoMutationKey('order', 'all', 2), false);
});

test('preview controller restores remembered sessions without leaking logout state', () => {
  const storage = createMemoryStorage();
  const first = createPreviewSessionController(storage);
  first.login('alice', true);
  const epoch = first.ensure().epoch;
  const second = createPreviewSessionController(storage);
  assert.equal(second.ensure().session?.userId, 'alice');
  assert.equal(second.restore().epoch, epoch);
  second.logout();
  assert.equal(createPreviewSessionController(storage).ensure().session, null);
});

test('scene-key persistence preserves legacy task views before migration marker', () => {
  const source = readFileSync('src/components/widgets/my-tasks/hooks/useMyTasksData.ts', 'utf8');
  assert.match(source, /hasPersonalTodoMigrationRun/);
  assert.match(source, /upsertTaskViews\(existing\?\.views \?\? \[\], sceneKeys\)/);
});
