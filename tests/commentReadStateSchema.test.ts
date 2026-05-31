import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('DEVLOG/migrations/2026-05-30-comment-read-states.sql', 'utf8');
const initSql = readFileSync('DEVLOG/supabase-init.sql', 'utf8');

for (const [label, sql] of [
  ['migration', migration],
  ['supabase init', initSql],
] as const) {
  test(`${label} defines comment_read_states`, () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS comment_read_states/i);
    assert.match(sql, /user_id\s+TEXT\s+NOT NULL/i);
    assert.match(sql, /scene_thread_key\s+TEXT\s+NOT NULL/i);
    assert.match(sql, /last_read_at\s+TIMESTAMPTZ\s+NOT NULL/i);
    assert.match(sql, /PRIMARY KEY\s*\(\s*user_id\s*,\s*scene_thread_key\s*\)/i);
  });

  test(`${label} protects comment_read_states with allow_all RLS policy`, () => {
    assert.match(sql, /ALTER TABLE comment_read_states ENABLE ROW LEVEL SECURITY/i);
    assert.match(sql, /CREATE POLICY "allow_all" ON comment_read_states FOR ALL USING \(true\) WITH CHECK \(true\)/i);
  });

  test(`${label} upserts comment_read_states monotonically`, () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION upsert_comment_read_state/i);
    assert.match(sql, /GREATEST\s*\(\s*comment_read_states\.last_read_at\s*,\s*EXCLUDED\.last_read_at\s*\)/i);
    assert.match(sql, /WHEN\s+EXCLUDED\.last_read_at\s*>\s*comment_read_states\.last_read_at\s+THEN\s+now\(\)/i);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION upsert_comment_read_state\s*\(\s*TEXT\s*,\s*TEXT\s*,\s*TIMESTAMPTZ\s*\)\s+TO anon,\s*authenticated/i);
  });
}
