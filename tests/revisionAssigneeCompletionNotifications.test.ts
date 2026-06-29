import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('assignee completion notification defaults include requester and notify users but exclude completer', async () => {
  const { buildRevisionAssigneeCompletionNotifyUserIds } = await import('../src/utils/revisionNotificationRecipients.ts');

  assert.deepEqual(
    buildRevisionAssigneeCompletionNotifyUserIds({
      notifyUserIds: ['worker-1', 'requester-1', 'completer-1', ''],
      requesterId: 'requester-1',
      completerId: 'completer-1',
    }),
    ['worker-1', 'requester-1'],
  );
});

test('assignee completion notification selected recipients are sanitized and sender-safe', async () => {
  const { buildRevisionAssigneeCompletionNotifyUserIds } = await import('../src/utils/revisionNotificationRecipients.ts');

  assert.deepEqual(
    buildRevisionAssigneeCompletionNotifyUserIds({
      notifyUserIds: ['worker-1'],
      requesterId: 'requester-1',
      selectedUserIds: ['selected-1', 'worker-1', 'completer-1', 'selected-1'],
      completerId: 'completer-1',
    }),
    ['selected-1', 'worker-1'],
  );
});

test('assignee completion notification honors an intentionally empty selected list', async () => {
  const { buildRevisionAssigneeCompletionNotifyUserIds } = await import('../src/utils/revisionNotificationRecipients.ts');

  assert.deepEqual(
    buildRevisionAssigneeCompletionNotifyUserIds({
      notifyUserIds: ['worker-1'],
      requesterId: 'requester-1',
      selectedUserIds: [],
      completerId: 'completer-1',
    }),
    [],
  );
});

test('retake completion notifications use a selected-recipient broadcast path', () => {
  const preload = readFileSync('electron/preload.ts', 'utf8');
  const main = readFileSync('electron/main.ts', 'utf8');
  const broadcast = readFileSync('electron/broadcast.ts', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const store = readFileSync('src/stores/useRevisionStore.ts', 'utf8');
  const service = readFileSync('src/services/revisionService.ts', 'utf8');

  assert.match(preload, /supabaseDispatchRetakeAssigneeCompletionNotification/);
  assert.match(main, /supabase:dispatch-retake-assignee-completion-notification/);
  assert.match(broadcast, /retake-assignee-completion/);
  assert.match(app, /retake-assignee-completion/);
  assert.match(app, /if \(notiSettings\.commentNotify === false\) return/);
  assert.match(app, /const dedupeKey = `revision:\$\{p\.revisionId \?\? ''\}:assignee_done:\$\{p\.updatedAt \?\? ''\}`/);
  assert.match(app, /isGeneralRevisionSceneKey/);
  assert.match(app, /const sceneKey = p\.sceneKey;/);
  assert.match(app, /const isGeneralRetakeCompletion = !sceneKey \|\| isGeneralRevisionSceneKey\(sceneKey\);/);
  assert.match(app, /const sceneTarget = !isGeneralRetakeCompletion/);
  assert.match(app, /resolveNotificationSceneTarget\(\{ sceneName: sceneKey \}, ds\.episodes\)/);
  assert.match(app, /metadata: !isGeneralRetakeCompletion/);
  assert.match(app, /sceneId:\s*sceneTarget\?\.sceneUuid/);
  assert.match(app, /sceneName:\s*sceneTarget\?\.sceneName \?\? sceneKey/);
  assert.match(app, /revisionAction:\s*'assignee_done'/);
  assert.match(app, /revisionEventId/);
  assert.match(app, /resolveLatestAssigneeCompletionFallback/);
  assert.match(app, /fallbackCompletion = resolveLatestAssigneeCompletionFallback\(newRow\.assignee_states\)/);
  assert.match(app, /retakeHubSetId:\s*p\.setId \?\? undefined/);
  assert.match(store, /completionNotifyUserIds:\s*recipients/);
  assert.match(store, /dispatchRetakeAssigneeCompletionNotification/);
  assert.match(service, /completionNotifyUserIds:\s*string\[\] = \[\]/);
  assert.match(service, /completedByName:\s*completerName \|\| userId/);
});
