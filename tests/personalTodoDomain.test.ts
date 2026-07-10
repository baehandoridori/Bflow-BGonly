import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyPersonalTodoStatus,
  createPersonalTodo,
  getPriorityPresentation,
  getTodoNextAction,
  normalizePersonalTodo,
  reassemblePersonalTodos,
  splitPersonalTodos,
  summarizeTodoLabels,
} from '../src/components/widgets/my-tasks/personalTodoDomain.ts';
import type { PersonalTodoLabel } from '../src/components/widgets/my-tasks/types.ts';

test('legacy completed value is normalized into canonical status', () => {
  assert.equal(normalizePersonalTodo({ id: 'a', title: 'A', completed: true }).status, 'done');
  assert.equal(normalizePersonalTodo({ id: 'b', title: 'B', completed: false }).status, 'todo');
});

test('invalid enum values fall back and label ids are de-duplicated in first-seen order', () => {
  const todo = normalizePersonalTodo({
    id: 'a',
    title: 'A',
    status: 'complete',
    completed: true,
    priority: 'urgent',
    labelIds: ['l2', 'l1', 'l2', 'l3', 'l1'],
  });

  assert.equal(todo.status, 'todo');
  assert.equal(todo.completed, false);
  assert.equal(todo.priority, 'none');
  assert.deepEqual(todo.labelIds, ['l2', 'l1', 'l3']);
  assert.equal(normalizePersonalTodo({ id: 'b', title: 'B', status: null, completed: true }).status, 'todo');
});

test('createPersonalTodo fills the canonical personalization defaults', () => {
  assert.deepEqual(createPersonalTodo({ id: 'a', title: 'A' }), {
    id: 'a',
    title: 'A',
    memo: '',
    status: 'todo',
    completed: false,
    priority: 'none',
    pinned: false,
    labelIds: [],
    createdAt: '',
  });
});

test('completed pinned todo leaves the pinned group and reopens into it', () => {
  const done = normalizePersonalTodo({ id: 'a', title: 'A', completed: true, pinned: true });
  assert.deepEqual(splitPersonalTodos([done]).pinned, []);
  const reopened = applyPersonalTodoStatus(done, 'todo');
  assert.deepEqual(splitPersonalTodos([reopened]).pinned.map((todo) => todo.id), ['a']);
});

test('splitPersonalTodos keeps active pinned, active normal, and done groups separate', () => {
  const todos = [
    normalizePersonalTodo({ id: 'normal', title: 'Normal' }),
    normalizePersonalTodo({ id: 'done', title: 'Done', status: 'done' }),
    normalizePersonalTodo({ id: 'pinned', title: 'Pinned', pinned: true }),
  ];

  const groups = splitPersonalTodos(todos);
  assert.deepEqual(groups.pinned.map((todo) => todo.id), ['pinned']);
  assert.deepEqual(groups.normal.map((todo) => todo.id), ['normal']);
  assert.deepEqual(groups.done.map((todo) => todo.id), ['done']);
});

test('reassemblePersonalTodos uses group order and removes duplicate ids', () => {
  const pinned = normalizePersonalTodo({ id: 'pinned', title: 'Pinned', pinned: true });
  const duplicate = normalizePersonalTodo({ id: 'pinned', title: 'Duplicate' });
  const normal = normalizePersonalTodo({ id: 'normal', title: 'Normal' });
  const done = normalizePersonalTodo({ id: 'done', title: 'Done', status: 'done' });

  assert.deepEqual(
    reassemblePersonalTodos({ pinned: [pinned], normal: [duplicate, normal], done: [done] }).map((todo) => todo.id),
    ['pinned', 'normal', 'done'],
  );
});

test('priority values never reorder input through split and reassemble', () => {
  const todos = [
    normalizePersonalTodo({ id: 'low', title: 'Low', priority: 'low' }),
    normalizePersonalTodo({ id: 'high', title: 'High', priority: 'high' }),
    normalizePersonalTodo({ id: 'none', title: 'None', priority: 'none' }),
    normalizePersonalTodo({ id: 'medium', title: 'Medium', priority: 'medium' }),
  ];

  assert.deepEqual(
    reassemblePersonalTodos(splitPersonalTodos(todos)).map((todo) => todo.id),
    ['low', 'high', 'none', 'medium'],
  );
});

test('runtime load and creation paths use the canonical personal todo boundary', () => {
  const dataHook = readFileSync(
    new URL('../src/components/widgets/my-tasks/hooks/useMyTasksData.ts', import.meta.url),
    'utf8',
  );
  const widget = readFileSync(
    new URL('../src/components/widgets/MyTasksWidget.tsx', import.meta.url),
    'utf8',
  );

  assert.match(dataHook, /import \{ normalizePersonalTodo \} from '\.\.\/personalTodoDomain';/);
  assert.match(dataHook, /return rows\.map\(normalizePersonalTodo\);/);
  assert.match(widget, /import \{ createPersonalTodo \} from '\.\/my-tasks\/personalTodoDomain';/);
  assert.equal(
    widget.match(/(?:onAddPersonalTodo|addPersonalTodo)\(createPersonalTodo\(\{/g)?.length,
    2,
  );
});

test('getTodoNextAction exposes the canonical three-state action cycle', () => {
  assert.deepEqual(getTodoNextAction('todo'), { label: '시작하기', nextStatus: 'doing' });
  assert.deepEqual(getTodoNextAction('doing'), { label: '완료하기', nextStatus: 'done' });
  assert.deepEqual(getTodoNextAction('done'), { label: '다시 열기', nextStatus: 'todo' });
});

test('label summary preserves selected order and reports overflow', () => {
  const labels = [
    { id: 'l1', name: '작화', colorKey: 'violet', createdAt: '' },
    { id: 'l2', name: '급함', colorKey: 'red', createdAt: '' },
    { id: 'l3', name: '회의', colorKey: 'blue', createdAt: '' },
  ] satisfies PersonalTodoLabel[];
  assert.deepEqual(summarizeTodoLabels(['l2', 'l1', 'l3'], labels, false), {
    visible: [labels[1], labels[0]], hiddenCount: 1,
  });
  assert.deepEqual(summarizeTodoLabels(['l2', 'missing', 'l1'], labels, true), {
    visible: [labels[1]], hiddenCount: 1,
  });
});

test('priority presentation uses stable Korean labels and color keys', () => {
  assert.deepEqual(getPriorityPresentation('high'), { label: '높음', colorKey: 'red' });
  assert.deepEqual(getPriorityPresentation('medium'), { label: '보통', colorKey: 'orange' });
  assert.deepEqual(getPriorityPresentation('low'), { label: '낮음', colorKey: 'blue' });
  assert.deepEqual(getPriorityPresentation('none'), { label: '없음', colorKey: 'gray' });
});
