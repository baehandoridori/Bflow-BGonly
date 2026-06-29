import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const store = readFileSync('src/stores/useNotificationStore.ts', 'utf8');
const persistencePath = 'src/utils/notificationPersistence.ts';
const persistence = existsSync(persistencePath) ? readFileSync(persistencePath, 'utf8') : '';

test('notification history is scoped to the logged-in user instead of the shared PC profile', () => {
  assert.equal(existsSync(persistencePath), true, 'notification persistence helper must exist');
  assert.match(persistence, /export function notificationFileNameForUser\(userId: string\): string/);
  assert.match(persistence, /return `notifications\.\$\{safeUserId\}\.json`;/);

  assert.match(store, /activeUserId: string \| null;/);
  assert.match(store, /activeUserId: null,/);
  assert.match(store, /loadFromDisk: \(userId: string \| null\) => Promise<void>;/);
  assert.match(store, /notificationFileNameForUser\(userId\)/);
  assert.match(store, /persistToDisk\(get\(\)\.activeUserId, next\)/);
  assert.doesNotMatch(store, /const NOTIFICATIONS_FILE = 'notifications\.json'/);

  assert.doesNotMatch(app, /loadFromDisk\(\)/);
  assert.match(app, /loadFromDisk\(notificationUserId\)/);
});
