import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const helperPath = 'src/utils/revisionNotificationRecipients.ts';
const app = readFileSync('src/App.tsx', 'utf8');
const revisionService = readFileSync('src/services/revisionService.ts', 'utf8');

test('revision comment notifications include the retake requester even if the requester is not in notifyUserIds', () => {
  assert.equal(existsSync(helperPath), true, 'revision notification recipient helper must exist');

  const helper = readFileSync(helperPath, 'utf8');
  assert.match(helper, /buildRevisionNotificationUserIds/);
  assert.match(helper, /requesterId/);
  assert.match(helper, /notifyUserIds/);
  assert.match(helper, /mentionedUserIds/);
  assert.match(helper, /new Set<string>/);
  assert.match(app, /buildRevisionNotificationUserIds\(\{/);
  assert.match(app, /requesterId:\s*rev\.requesterId/);
});

test('revision notification recipient helper merges requester, notify users, and mentions without duplicates', async () => {
  const { buildRevisionNotificationUserIds } = await import('../src/utils/revisionNotificationRecipients.ts');

  assert.deepEqual(
    buildRevisionNotificationUserIds({
      notifyUserIds: ['worker-1', 'requester-1', ''],
      requesterId: 'requester-1',
      mentionedUserIds: ['mentioned-1', 'worker-1'],
    }),
    ['worker-1', 'requester-1', 'mentioned-1'],
  );
});

test('new retakes persist the requester id into notification recipients for future comment and status alarms', () => {
  assert.match(revisionService, /buildRevisionNotificationUserIds/);
  assert.match(revisionService, /requesterId:\s*input\.requesterId/);
  assert.doesNotMatch(revisionService, /const notifyUserIds = Array\.isArray\(input\.notifyUserIds\) \? input\.notifyUserIds : \[\];/);
});
