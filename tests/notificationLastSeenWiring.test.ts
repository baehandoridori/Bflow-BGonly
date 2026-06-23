import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const main = readFileSync('electron/main.ts', 'utf8');
const broadcast = readFileSync('electron/broadcast.ts', 'utf8');
const supabase = readFileSync('electron/supabase.ts', 'utf8');
const lastSeenTracker = readFileSync('src/utils/lastSeenTracker.ts', 'utf8');

test('feedback and assignment broadcasts carry source notification timestamps', () => {
  assert.match(supabase, /\.select\('id, recipient_id, created_at'\)/);
  assert.match(supabase, /\.select\('id, created_at'\)/);
  assert.match(main, /notificationCreatedAtByRecipient = Object\.fromEntries/);
  assert.match(main, /createdAt: r\.createdAt/);
  assert.match(broadcast, /notificationCreatedAtByRecipient\?: Record<string, string>/);
  assert.match(broadcast, /createdAt\?: string/);
});

test('live notification cursors use source timestamps and never move backwards', () => {
  assert.match(app, /setAssignmentLastSeenAt\(me\.id, ap\.createdAt \?\? new Date\(\)\.toISOString\(\)\)/);
  assert.match(app, /const myFeedbackCreatedAt = p\.notificationCreatedAtByRecipient\?\.\[me\.id\]/);
  assert.match(app, /setFeedbackLastSeenAt\(me\.id, myFeedbackCreatedAt \?\? new Date\(\)\.toISOString\(\)\)/);
  assert.match(app, /setLastSeenAt\(me\.id, newComment\.created_at \?\? new Date\(\)\.toISOString\(\)\)/);
  assert.match(app, /setLastSeenAt\(me\.id, commentCreatedAt \?\? new Date\(\)\.toISOString\(\)\)/);
  assert.match(lastSeenTracker, /function setMonotonicIso\(key: string, isoString: string\)/);
  assert.match(lastSeenTracker, /if \(isIsoAfter\(isoString, current\)\)/);
});
