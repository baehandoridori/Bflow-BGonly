import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('retake hub rows open the scene card in place with the revision thread focused', () => {
  const row = readFileSync('src/views/retake-hub/RetakeHubItemRow.tsx', 'utf8');
  const provider = readFileSync('src/views/retake-hub/RetakeSceneModalProvider.tsx', 'utf8');
  const modal = readFileSync('src/views/compositing-dashboard/modal/CompositingSceneModal.tsx', 'utf8');

  assert.match(row, /handleRowClickCapture/);
  assert.match(row, /event\.ctrlKey\s*\|\|\s*event\.metaKey/);
  assert.match(row, /openRetakeScene\?\.\(\{/);
  assert.match(row, /department:\s*revision\.department/);
  assert.match(row, /focusRevisionId:\s*revision\.id/);
  assert.doesNotMatch(row, /navigateToSceneView/);
  assert.match(provider, /resolveNotificationSceneTarget/);
  assert.match(provider, /sceneTarget=\{\{ partId: target\.partId, sceneUuid: target\.sceneUuid \}\}/);
  assert.match(provider, /initialTab="revisions"/);
  assert.match(provider, /focusRevisionId=\{target\.focusRevisionId\}/);
  assert.doesNotMatch(provider, /setView|setSelectedEpisode|setSelectedPart|setSelectedDepartment|setSearchQuery/);
  assert.match(modal, /resolveReferenceMergedScene\(\{/);
  assert.match(modal, /focusRevisionId=\{focusRevisionId\}/);
  assert.match(modal, /initialTab=\{initialTab\}/);
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

test('the revision board detail keeps final approval available for assigned revisions', () => {
  const detail = readFileSync('src/views/compositing/RevisionDetailPanel.tsx', 'utf8');

  // Regression: assigned revisions hid every legacy action without supplying the workflow controls.
  assert.match(detail, /<AssigneeChipRow/);
  assert.match(detail, /<CompletionNoteInput/);
  assert.match(detail, /<FinalResolveBar/);
  assert.match(detail, /canFinalResolveRevision\(currentUser, revision\)/);
  assert.match(detail, /enabled=\{summary\.allDone\}/);
  assert.match(detail, /finalResolve\(revision, currentUser\.name\)/);
  assert.match(detail, /revertFinalResolve\(revision\)/);
  assert.match(detail, /!hasAssignees/);
});

test('both retake boards retain their local scene modal host and consume matched deep links', () => {
  const board = readFileSync('src/views/CompositingView.tsx', 'utf8');
  const hub = readFileSync('src/views/RetakeHubView.tsx', 'utf8');
  const row = readFileSync('src/views/retake-hub/RetakeHubItemRow.tsx', 'utf8');
  for (const source of [board, hub]) {
    assert.match(source, /<RetakeSceneModalProvider>/);
    assert.match(source, /pendingRetakeId/);
    assert.match(source, /revisionsLoaded/);
    assert.match(source, /setPendingRetakeId\(null\)/);
  }
  assert.match(board, /setSelectedRevisionId\(revision\.id\)/);
  assert.match(board, /if \(!revision \|\| revision\.setId\) return;/);
  assert.match(hub, /select\(revision\.setId\)/);
  assert.match(hub, /focusRevisionId=\{focusedRevisionId\}/);
  assert.match(row, /setExpanded\(true\)/);
  assert.match(row, /scrollIntoView/);
});

test('assigned revision rows cannot bypass the workflow with the legacy reopen shortcut', () => {
  const row = readFileSync('src/views/compositing/RevisionItem.tsx', 'utf8');
  assert.match(row, /isInProgress && !hasAssignees &&/);
});
