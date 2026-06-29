import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  normalizeRevisionDescription,
  sanitizeRequiredAssignees,
} from '../src/utils/revisionWorkflow.ts';

const read = (path: string) => readFileSync(path, 'utf8');

test('sanitizeRequiredAssignees keeps valid assignees after notify-list sanitization', () => {
  const result = sanitizeRequiredAssignees(['a', 'b', 'ghost'], { a: { state: 'done' } }, ['a', 'b']);

  assert.deepEqual(result.assigneeIds, ['a', 'b']);
  assert.deepEqual(Object.keys(result.assigneeStates).sort(), ['a', 'b']);
  assert.equal(result.assigneeStates.a.state, 'done');
  assert.equal(result.assigneeStates.b.state, 'pending');
});

test('sanitizeRequiredAssignees rejects empty assignees after notify-list sanitization', () => {
  assert.throws(
    () => sanitizeRequiredAssignees(['ghost'], {}, ['a']),
    /담당자를 1명 이상 선택/,
  );
  assert.throws(
    () => sanitizeRequiredAssignees([], {}, ['a']),
    /담당자를 1명 이상 선택/,
  );
});

test('normalizeRevisionDescription trims content and rejects blank edits', () => {
  assert.equal(normalizeRevisionDescription('  컷 그림자 정리  '), '컷 그림자 정리');
  assert.throws(() => normalizeRevisionDescription('   \n\t  '), /리테이크 내용을 입력/);
});

test('revision service requires assignees on create and reassign while allowing description edits', () => {
  const service = read('src/services/revisionService.ts');
  const store = read('src/stores/useRevisionStore.ts');

  assert.match(service, /sanitizeRequiredAssignees\(input\.assigneeIds \?\? \[\], \{\}, notifyUserIds\)/);
  assert.match(service, /sanitizeRequiredAssignees\(\s*nextAssigneeIds,\s*rev\.assigneeStates \?\? \{\},\s*rev\.notifyUserIds \?\? \[\]/);
  assert.match(service, /export async function updateRevisionDetails/);
  assert.match(service, /description:\s*normalizeRevisionDescription\(input\.description\)/);
  assert.match(store, /updateDetails:\s*\(rev:\s*CompRevision,\s*input:\s*\{\s*description:\s*string\s*\}\)/);
});

test('retake creation surfaces disable submit until a 담당 is selected and cards expose content editing', () => {
  const panel = read('src/components/scenes/RevisionPanel.tsx');
  const addModal = read('src/views/retake-hub/RevisionAddModal.tsx');
  const newModal = read('src/views/compositing/NewRevisionModal.tsx');
  const inlineForm = read('src/views/compositing/AddRevisionForm.tsx');
  const row = read('src/views/retake-hub/RetakeHubItemRow.tsx');

  for (const source of [panel, addModal, newModal, inlineForm]) {
    assert.match(source, /assigneeIds\.length > 0|formAssigneeIds\.length > 0/);
    assert.match(source, /담당자를 1명 이상 선택/);
    assert.match(source, /enableAssignee/);
  }

  for (const source of [panel, row]) {
    assert.match(source, /data-retake-edit-description/);
    assert.match(source, /updateDetails/);
    assert.match(source, /내용 수정/);
  }
});
