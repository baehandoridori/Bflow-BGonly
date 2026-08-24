import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const storePath = 'electron/calendarStore.ts';
const migrationPath = 'DEVLOG/migrations/2026-08-24-shared-calendars.sql';

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing start: ${start}`);
  assert.notEqual(to, -1, `missing end: ${end}`);
  return source.slice(from, to);
}

test('saveTags delegates the final tag list to exactly one replace_calendar_tags RPC', () => {
  const store = readFileSync(storePath, 'utf8');
  const saveTags = between(store, 'export async function saveTags', '// ── 알림');

  assert.match(saveTags, /supabase\.rpc\('replace_calendar_tags', \{ p_tags: tags \}\)/);
  assert.match(saveTags, /throwIfError\(error\)/);
  assert.match(saveTags, /return \(data \?\? \[\]\) as CalendarTagRow\[\]/);
  assert.equal((saveTags.match(/\.rpc\('replace_calendar_tags'/g) ?? []).length, 1);
  assert.doesNotMatch(saveTags, /readTags\(|\.from\('calendar_tags'\)|\.delete\(|\.update\(|\.insert\(/);
});

test('replace_calendar_tags validates final input then atomically deletes, temporary-renames, updates, and inserts', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(sql, 'CREATE OR REPLACE FUNCTION public.replace_calendar_tags', 'COMMENT ON FUNCTION public.replace_calendar_tags');

  assert.match(fn, /RETURNS TABLE \(id UUID, name TEXT, color TEXT, sort_order INTEGER\)/);
  assert.match(fn, /p_tags IS NULL OR jsonb_typeof\(p_tags\) <> 'array'/);
  assert.match(fn, /jsonb_typeof\(tag\.value\) <> 'object'/);
  assert.match(fn, /requires name, color, and sort_order/);
  assert.match(fn, /Duplicate calendar tag id/);
  assert.match(fn, /Duplicate calendar tag name/);
  assert.match(fn, /Unknown calendar tag id/);
  assert.match(fn, /RAISE EXCEPTION/);
  assert.match(fn, /DELETE FROM calendar_tags AS target\s+WHERE target\.id NOT IN/);
  assert.doesNotMatch(fn, /DELETE FROM calendar_tags\s+WHERE id\b/);

  const fieldValidationEnd = fn.indexOf('Each calendar tag requires name, color, and sort_order');
  const lockIndex = fn.indexOf('LOCK TABLE calendar_tags IN SHARE ROW EXCLUSIVE MODE;');
  const dataValidationIndex = fn.indexOf('Duplicate calendar tag id');
  const deleteIndex = fn.indexOf('DELETE FROM calendar_tags');
  const temporaryRenameIndex = fn.indexOf("format('__calendar_tags_tmp_");
  const updateIndex = fn.indexOf('SET name = submitted.name');
  const insertIndex = fn.indexOf('INSERT INTO calendar_tags (name, color, sort_order)');
  assert.ok(fieldValidationEnd < lockIndex, 'lock follows structural and field validation');
  assert.ok(lockIndex < dataValidationIndex, 'lock precedes ID/name/existence validation and writes');
  assert.ok(deleteIndex >= 0 && deleteIndex < temporaryRenameIndex, 'delete must follow validation and precede name staging');
  assert.ok(temporaryRenameIndex < updateIndex, 'existing names must be staged before final updates for swaps');
  assert.ok(updateIndex < insertIndex, 'existing rows update before new rows insert');
  assert.match(fn, /RETURN QUERY[\s\S]*ORDER BY tag\.sort_order, tag\.id/);
  assert.doesNotMatch(fn, /\bCOMMIT\b|\bROLLBACK\b/);
});

test('calendar tag seed runs once behind a metadata marker without moving seed rows outside its gate', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const seedGate = between(sql, "DO $$\nBEGIN\n  LOCK TABLE metadata IN SHARE ROW EXCLUSIVE MODE;\n\n  IF NOT EXISTS (\n    SELECT 1\n    FROM metadata\n    WHERE type = 'migration-seed'", '-- ── 5) 기존 "나만 보기" 데이터 이관');

  const seedIndex = seedGate.indexOf('INSERT INTO calendar_tags (name, color, sort_order) VALUES');
  const markerIndex = seedGate.indexOf("INSERT INTO metadata (type, key, value)\n    VALUES ('migration-seed', 'calendar-tags-v1'");
  assert.ok(seedIndex >= 0, 'seed rows must stay inside the marker gate');
  assert.ok(markerIndex > seedIndex, 'marker is written only after seed succeeds');
  assert.match(seedGate, /ON CONFLICT \(name\) DO NOTHING/);
  assert.equal((sql.match(/ON CONFLICT \(name\) DO NOTHING/g) ?? []).length, 1);
  assert.match(seedGate, /LOCK TABLE metadata IN SHARE ROW EXCLUSIVE MODE;/);
  assert.match(seedGate, /key = 'calendar-tags-v1'/);
});
