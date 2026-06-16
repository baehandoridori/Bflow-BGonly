import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildNotificationDisplayGroups,
  getNotificationGroupKey,
} from '../src/utils/notificationGrouping.ts';
import type { AppNotification } from '../src/stores/useNotificationStore.ts';

function notification(partial: Partial<AppNotification>): AppNotification {
  return {
    id: partial.id ?? crypto.randomUUID(),
    type: partial.type ?? 'revision',
    title: partial.title ?? '알림',
    body: partial.body,
    metadata: partial.metadata,
    isRead: partial.isRead ?? false,
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };
}

test('revision notifications group by retake id', () => {
  const first = notification({ id: 'n1', title: '새 리테이크', metadata: { revisionId: 'r32', revisionAction: 'add' } });
  const second = notification({ id: 'n2', title: '리테이크 진행중', metadata: { revisionId: 'r32', revisionAction: 'in_progress' } });

  assert.equal(getNotificationGroupKey(first), 'revision:r32');
  assert.deepEqual(buildNotificationDisplayGroups([first, second]), [
    {
      kind: 'group',
      key: 'revision:r32',
      title: '리테이크 알림 2건',
      notifications: [first, second],
      unreadCount: 2,
      latestCreatedAt: second.createdAt,
    },
  ]);
});

test('scene notifications group by exact scene target', () => {
  const sceneChange = notification({
    id: 'n1',
    type: 'scene_change',
    title: '씬 변경',
    metadata: { sheetName: 'EP01_A_BG', sceneName: 'a032' },
  });
  const assignment = notification({
    id: 'n2',
    type: 'scene_assignment',
    title: '씬 배정',
    metadata: { sheetName: 'EP01_A_BG', sceneName: 'a032' },
  });

  assert.equal(getNotificationGroupKey(sceneChange), 'scene:EP01_A_BG:a032');
  const groups = buildNotificationDisplayGroups([sceneChange, assignment]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'group');
});

test('notification panel renders collapsible notification groups', () => {
  const panel = readFileSync('src/components/NotificationPanel.tsx', 'utf8');

  assert.match(panel, /buildNotificationDisplayGroups/);
  assert.match(panel, /NotificationGroupItem/);
  assert.match(panel, /groupCollapsedKeys/);
  assert.match(panel, /묶음 펼치기|묶음 접기/);
});
