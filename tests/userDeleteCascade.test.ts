import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(root, 'DEVLOG', 'migrations', '2026-04-30_delete_user_cascade_rpc.sql');
const supabasePath = path.join(root, 'electron', 'supabase.ts');

test('delete_user_cascade migration records the full atomic user deletion policy', () => {
  assert.equal(fs.existsSync(migrationPath), true, 'delete_user_cascade migration file must exist');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.delete_user_cascade\(p_user_id TEXT\)/);
  assert.match(sql, /UPDATE scenes\s+SET assignee = NULL WHERE assignee = v_user_name;/);
  assert.match(sql, /UPDATE comp_revisions SET assignee = NULL WHERE assignee = v_user_name;/);

  for (const table of ['personal_todos', 'task_views', 'memos', 'private_calendar_events']) {
    assert.match(sql, new RegExp(`DELETE FROM ${table}\\s+WHERE user_id = p_user_id;`));
  }

  assert.match(sql, /DELETE FROM users WHERE id = p_user_id;/);
  assert.doesNotMatch(sql, /DELETE FROM comments/i);
  assert.doesNotMatch(sql, /DELETE FROM activity_log/i);
});

test('deleteUser delegates to the atomic RPC instead of deleting dependent rows in app code', () => {
  const source = fs.readFileSync(supabasePath, 'utf-8');
  const match = source.match(/export async function deleteUser\(userId: string\): Promise<void> \{[\s\S]*?\n\}/);
  assert.ok(match, 'deleteUser function must exist');
  const body = match[0];

  assert.match(body, /supabase\.rpc\('delete_user_cascade', \{ p_user_id: userId \}\)/);
  assert.doesNotMatch(body, /\.from\('users'\)\.delete\(\)/);
  assert.doesNotMatch(body, /\.from\(table\)\.delete\(\)/);
});
