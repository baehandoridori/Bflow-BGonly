import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('retake hub rows open the scene detail modal on ctrl-click with the revision thread focused', () => {
  const row = readFileSync('src/views/retake-hub/RetakeHubItemRow.tsx', 'utf8');

  assert.match(row, /handleRowClickCapture/);
  assert.match(row, /event\.ctrlKey\s*\|\|\s*event\.metaKey/);
  assert.match(row, /resolveNotificationSceneTarget/);
  assert.match(row, /department:\s*revision\.department/);
  assert.match(row, /navigateToSceneView\(\{/);
  assert.match(row, /department:\s*'all'/);
  assert.match(row, /initialTab:\s*'revisions'/);
  assert.match(row, /focusRevisionId:\s*revision\.id/);
  assert.match(row, /forceDeptFilter:\s*'all'/);
});

test('assignee completion note input lets users choose completion alarm recipients', () => {
  const input = readFileSync('src/components/scenes/revision/CompletionNoteInput.tsx', 'utf8');
  const panel = readFileSync('src/components/scenes/RevisionPanel.tsx', 'utf8');
  const row = readFileSync('src/views/retake-hub/RetakeHubItemRow.tsx', 'utf8');

  assert.match(input, /RevisionRecipientPicker/);
  assert.match(input, /notifyDefaultIds/);
  assert.match(input, /selectedNotifyIds/);
  assert.match(input, /onSubmit=\{\(\)\s*=>\s*onConfirm\(value\.trim\(\),\s*selectedNotifyIds\)\}/);
  assert.match(input, /onClick=\{\(\)\s*=>\s*onConfirm\(value\.trim\(\),\s*selectedNotifyIds\)\}/);
  assert.match(panel, /notifyDefaultIds=\{completionNotifyDefaults/);
  assert.match(row, /notifyDefaultIds=\{completionNotifyDefaults/);
});

test('retake hub status pill can advance the current assignee workflow', () => {
  const row = readFileSync('src/views/retake-hub/RetakeHubItemRow.tsx', 'utf8');

  assert.match(row, /handleStatusPillAction/);
  assert.match(row, /currentAssigneeState === 'pending'/);
  assert.match(row, /currentAssigneeState === 'in_progress'/);
  assert.match(row, /data-retake-hub-status-action/);
});
