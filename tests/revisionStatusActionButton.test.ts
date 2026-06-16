import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const revisionPanel = readFileSync('src/components/scenes/RevisionPanel.tsx', 'utf8');

test('scene detail retake cards use direct status action buttons instead of a dropdown', () => {
  assert.doesNotMatch(revisionPanel, /function StatusDropdown/);
  assert.doesNotMatch(revisionPanel, /<StatusDropdown/);
  assert.doesNotMatch(revisionPanel, />\s*상태 변경\s*</);
  assert.match(revisionPanel, /function RevisionStatusAction/);
  assert.match(revisionPanel, /data-retake-status-action/);
  assert.match(revisionPanel, /진행 중으로 변경/);
  assert.match(revisionPanel, /완료로 변경/);
});

test('completed retake cards show a small undo action back to in-progress', () => {
  assert.match(revisionPanel, /revision\.status === 'resolved'/);
  assert.match(revisionPanel, /진행 중으로 되돌리기/);
  assert.match(revisionPanel, /onStatusChange\('in_progress'\)/);
  assert.match(revisionPanel, /text-\[10px\]/);
});

test('retake status action button cross-fades between progress and done states', () => {
  assert.match(revisionPanel, /AnimatePresence[^]*mode="wait"/);
  assert.match(revisionPanel, /filter:\s*'blur\(6px\)'/);
  assert.match(revisionPanel, /transition=\{\{\s*duration:\s*0\.18/);
  assert.match(revisionPanel, /STATUS_CONFIG\.in_progress\.color/);
  assert.match(revisionPanel, /STATUS_CONFIG\.resolved\.color/);
});
