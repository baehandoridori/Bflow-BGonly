import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('pinned personal section renders before scene and character work', () => {
  const source = read('src/components/widgets/MyTasksWidget.tsx');
  assert.ok(source.indexOf('<PinnedTodoSection') < source.indexOf('sceneTodos.map'));
});

test('list drag starts only from the handle', () => {
  const source = read('src/components/widgets/my-tasks/components/TodoRow.tsx');
  assert.match(source, /dragListener=\{false\}/);
  assert.match(source, /dragControls\.start/);
});

test('pinned section is a purple named panel and switches list/card surfaces', () => {
  const source = read('src/components/widgets/my-tasks/components/PinnedTodoSection.tsx');
  const widget = read('src/components/widgets/MyTasksWidget.tsx');
  assert.match(source, /나의 고정/);
  assert.match(source, /viewMode/);
  assert.match(source, /bg-accent|text-accent/);
  assert.match(source, /Reorder\.Group/);
  assert.match(source, /TodoCard/);
  assert.match(widget, /<PinnedTodoSection[\s\S]*viewMode=\{viewMode\}/);
});

test('personal todo surfaces expose only the next-action status control', () => {
  const row = read('src/components/widgets/my-tasks/components/TodoRow.tsx');
  const card = read('src/components/widgets/my-tasks/components/TodoCard.tsx');
  assert.doesNotMatch(row, /SuccessCheckCircle/);
  assert.doesNotMatch(card, /SuccessCheckCircle/);
  assert.match(row, /TodoStatusAction/);
  assert.match(card, /TodoStatusAction/);
  assert.match(row, /다시 열기|TodoStatusAction/);
});

test('metadata keeps controls outside the title/memo click target', () => {
  const row = read('src/components/widgets/my-tasks/components/TodoRow.tsx');
  assert.match(row, /<TodoMetadata[\s\S]*onTogglePinned/);
  assert.match(row, /<TodoMetadata[\s\S]*\/>/);
  const roleStart = row.indexOf('role="button"');
  const metadataStart = row.indexOf('<TodoMetadata');
  assert.ok(roleStart >= 0 && metadataStart > roleStart);
  assert.doesNotMatch(row.slice(roleStart, metadataStart), /<TodoMetadata/);
});

test('priority metadata has a color token and an accessible pin state', () => {
  const source = read('src/components/widgets/my-tasks/components/TodoMetadata.tsx');
  assert.match(source, /priorityColor|priorityLine|backgroundColor/);
  assert.match(source, /aria-pressed=\{todo\.pinned\}/);
  assert.match(source, /disabled=\{syncState === 'pending' \|\| syncState === 'sync-needed'\}/);
  assert.match(read('src/components/widgets/MyTasksWidget.tsx'), /personalTodoSyncState !== 'sync-needed'/);
  assert.match(source, /우선순위/);
});

test('personal completion celebration waits for a committed status action', () => {
  const widget = read('src/components/widgets/MyTasksWidget.tsx');
  assert.doesNotMatch(widget, /if \(status === 'done'\) armCompletion\(\)/);
  assert.match(widget, /setPersonalTodoStatus\(todoId, status\)\.then/);
});
