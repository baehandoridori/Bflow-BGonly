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
  // v1.146.0(§6.1): 리테이크 댓글 알림 대상(요청자·담당자·알림 대상)은 판정 함수 하나가 정한다.
  const decision = readFileSync('src/utils/sceneCommentNotification.ts', 'utf8');
  assert.match(decision, /\.\.\.\(revision\.requesterId \? \[revision\.requesterId\] : \[\]\),\s*\.\.\.\(revision\.assigneeIds \?\? \[\]\),\s*\.\.\.\(revision\.notifyUserIds \?\? \[\]\),/);
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
