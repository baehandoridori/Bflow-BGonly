import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const store = readFileSync('src/stores/useNotificationStore.ts', 'utf8');

test('catch-up notifications preserve source timestamps in the notification panel', () => {
  assert.match(store, /type NotificationDraft = Omit<AppNotification,\s*'id'\s*\|\s*'createdAt'\s*\|\s*'isRead'> & \{ createdAt\?: string \};/);
  assert.match(store, /createdAt:\s*n\.createdAt\s*\?\?\s*new Date\(\)\.toISOString\(\)/);
  assert.match(store, /addNotification:\s*\(n:\s*NotificationDraft\) => string;/);

  assert.match(app, /type:\s*'mention'[\s\S]*?createdAt:\s*c\.createdAt[\s\S]*?metadata:/);
  assert.match(app, /type:\s*'acting_feedback'[\s\S]*?createdAt:\s*m\.createdAt[\s\S]*?metadata:/);
  assert.match(app, /type:\s*'scene_assignment'[\s\S]*?createdAt:\s*m\.createdAt[\s\S]*?metadata:/);
});
