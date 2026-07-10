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
  assert.doesNotMatch(row, /role="button"/);
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

test('normal-only reorder keeps the existing pinned bucket intact', () => {
  const hook = read('src/components/widgets/my-tasks/hooks/usePersonalTodos.ts');
  assert.match(hook, /if \(reordered\.some\(\(todo\) => todo\.pinned\)\) groups\.pinned/);
});

test('detail modal exposes personal properties and bounded auto-grow memo', () => {
  const modal = read('src/components/widgets/my-tasks/components/TodoDetailModal.tsx');
  assert.match(modal, /상단 고정/);
  assert.match(modal, /할 일/);
  assert.match(modal, /진행 중/);
  assert.match(modal, /완료/);
  assert.match(modal, /autoGrowMaxRows=\{10\}/);
  assert.match(modal, /autoGrowMaxContainerRatio=\{0\.4\}/);
});

test('label picker restores trigger focus and reacts to container resize', () => {
  const picker = read('src/components/widgets/my-tasks/components/TodoLabelPicker.tsx');
  const input = read('src/components/common/EntityAwareInput.tsx');
  assert.match(picker, /rootRef\.current\?\.focus\(\)/);
  assert.match(picker, /previouslyFocused\?\.focus\?\.\(\)/);
  assert.match(input, /ResizeObserver/);
  assert.match(input, /addEventListener\('resize'/);
});

test('label picker secondary actions keep visible focus rings', () => {
  const picker = read('src/components/widgets/my-tasks/components/TodoLabelPicker.tsx');
  assert.match(picker, /onClick=\{\(\) => setEditingId\(null\)\}[\s\S]*focus-visible:ring/);
  assert.match(picker, /onClick=\{\(\) => void submitEdit\(\)\}[\s\S]*focus-visible:ring/);
  assert.match(picker, /setCreateOpen\(false\)[\s\S]*focus-visible:ring/);
});

test('nested picker Escape keeps focus inside picker before modal close', () => {
  const picker = read('src/components/widgets/my-tasks/components/TodoLabelPicker.tsx');
  assert.match(picker, /setEditingId\(null\);\s*rootRef\.current\?\.focus\(\)/);
  assert.match(picker, /setCreateOpen\(false\);\s*setCreateName\(''\);\s*rootRef\.current\?\.focus\(\)/);
});
