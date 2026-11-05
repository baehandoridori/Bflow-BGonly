import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const store = readFileSync('src/stores/useNotificationStore.ts', 'utf8');

test('catch-up notifications preserve source timestamps in the notification panel', () => {
  // v1.149.0(PR 6): 다른 PC 에서 이미 읽은 서버 알림은 읽은 채로 넣을 수 있다(기본은 안 읽음).
  assert.match(store, /type NotificationDraft = Omit<AppNotification,\s*'id'\s*\|\s*'createdAt'\s*\|\s*'isRead'> & \{ createdAt\?: string; isRead\?: boolean \};/);
  assert.match(store, /isRead:\s*n\.isRead === true,/);
  assert.match(store, /createdAt:\s*n\.createdAt\s*\?\?\s*new Date\(\)\.toISOString\(\)/);
  // 서버 알림 줄(놓친 알림 모으기)도 원래 댓글 시각.
  const notifier = readFileSync('src/services/sceneCommentNotifier.ts', 'utf8');
  assert.match(notifier, /store\.addNotification\(\{[\s\S]*?createdAt:\s*comment\.createdAt \?\? row\.eventAt,/);
  assert.match(store, /addNotification:\s*\(n:\s*NotificationDraft\) => string;/);

  // v1.146.0(§6.1): 놓친 멘션도 실시간과 같은 판정 함수로 제목·종류를 만들고, 시각은 원래 댓글 시각.
  assert.match(app, /type:\s*decision\.type[\s\S]*?createdAt:\s*c\.createdAt[\s\S]*?metadata:/);
  assert.match(app, /type:\s*'acting_feedback'[\s\S]*?createdAt:\s*m\.createdAt[\s\S]*?metadata:/);
  assert.match(app, /type:\s*'scene_assignment'[\s\S]*?createdAt:\s*m\.createdAt[\s\S]*?metadata:/);
});
