import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createPersonalTodoPreviewStore,
  createMemoryStorage,
  resetPersonalTodoPreview,
} from '../src/mocks/personalTodoPreviewStore.ts';
import { createPersonalTodo } from '../src/components/widgets/my-tasks/personalTodoDomain.ts';

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
