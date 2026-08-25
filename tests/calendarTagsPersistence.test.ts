import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const storePath = 'electron/calendarStore.ts';
const migrationPath = 'DEVLOG/migrations/2026-08-24-shared-calendars.sql';

function between(source: string, start: string, end: string): string {
  source = source.replace(/\r\n?/g, '\n');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing start: ${start}`);
  assert.notEqual(to, -1, `missing end: ${end}`);
  return source.slice(from, to);
}

test('saveTags delegates the final tag list and session actor to exactly one authorized RPC', () => {
  const store = readFileSync(storePath, 'utf8');
  const saveTags = between(store, 'export async function saveTags', '// ── 알림');

  assert.match(
    saveTags,
    /supabase\.rpc\('replace_calendar_tags_authorized', \{\s*p_actor_id: actorId,\s*p_tags: tags,?\s*\}\)/,
  );
  assert.match(saveTags, /throwIfError\(error\)/);
  assert.match(saveTags, /return \(data \?\? \[\]\) as CalendarTagRow\[\]/);
  assert.equal((saveTags.match(/\.rpc\('replace_calendar_tags_authorized'/g) ?? []).length, 1);
  assert.doesNotMatch(saveTags, /\.rpc\('replace_calendar_tags'/);
  assert.doesNotMatch(saveTags, /readTags\(|\.from\('calendar_tags'\)|\.delete\(|\.update\(|\.insert\(/);
});

test('authorized tag replacement locks and revalidates the actor role before atomic final-list writes', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.replace_calendar_tags_authorized',
    'COMMENT ON FUNCTION public.replace_calendar_tags_authorized',
  );

  assert.match(sql, /DROP FUNCTION IF EXISTS public\.replace_calendar_tags\(JSONB\)/);
  assert.match(fn, /\(\s*p_actor_id TEXT,\s*p_tags JSONB\s*\)/);
  assert.match(fn, /RETURNS TABLE \(id UUID, name TEXT, color TEXT, sort_order INTEGER\)/);
  assert.match(fn, /SECURITY INVOKER/);
  assert.match(fn, /SET search_path = public, pg_temp/);
  assert.match(fn, /p_actor_id IS NULL OR btrim\(p_actor_id\) = ''/);
  assert.match(fn, /p_tags IS NULL OR jsonb_typeof\(p_tags\) <> 'array'/);
  assert.match(fn, /jsonb_typeof\(tag\.value\) <> 'object'/);
  assert.match(fn, /requires name, color, and sort_order/);
  assert.match(fn, /SELECT actor\.role INTO v_actor_role[\s\S]*FROM users AS actor[\s\S]*WHERE actor\.id = p_actor_id[\s\S]*FOR SHARE/);
  assert.match(fn, /Session actor % not found[\s\S]*ERRCODE = '42501'/);
  assert.match(fn, /v_actor_role IS DISTINCT FROM 'admin'[\s\S]*Calendar tag management permission denied[\s\S]*ERRCODE = '42501'/);
  assert.match(fn, /Duplicate calendar tag id/);
  assert.match(fn, /Duplicate calendar tag name/);
  assert.match(fn, /Unknown calendar tag id/);
  assert.match(fn, /RAISE EXCEPTION/);
  assert.match(fn, /DELETE FROM calendar_tags AS target\s+WHERE target\.id NOT IN/);
  assert.doesNotMatch(fn, /DELETE FROM calendar_tags\s+WHERE id\b/);

  const fieldValidationEnd = fn.indexOf('Each calendar tag requires name, color, and sort_order');
  const lockIndex = fn.indexOf('LOCK TABLE calendar_tags IN SHARE ROW EXCLUSIVE MODE;');
  const actorLockIndex = fn.indexOf('SELECT actor.role INTO v_actor_role');
  const adminCheckIndex = fn.indexOf("v_actor_role IS DISTINCT FROM 'admin'");
  const dataValidationIndex = fn.indexOf('Duplicate calendar tag id');
  const deleteIndex = fn.indexOf('DELETE FROM calendar_tags');
  const temporaryRenameIndex = fn.indexOf("format('__calendar_tags_tmp_");
  const updateIndex = fn.indexOf('SET name = submitted.name');
  const insertIndex = fn.indexOf('INSERT INTO calendar_tags (name, color, sort_order)');
  assert.ok(fieldValidationEnd < lockIndex, 'lock follows structural and field validation');
  assert.ok(lockIndex < actorLockIndex, 'tag table lock precedes the actor row lock consistently');
  assert.ok(actorLockIndex < adminCheckIndex, 'the locked actor role is checked before proceeding');
  assert.ok(adminCheckIndex < dataValidationIndex, 'authorization precedes data validation and every write');
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

test('legacy private-event migration quarantines impossible dates without exception-prone DATE casts', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const copy = between(
    sql,
    '-- 5-2) 이벤트 복사',
    '-- 5-3) private_calendar_events 테이블은 이번엔 남겨둠',
  );

  assert.doesNotMatch(copy, /::date\b/i);
  assert.match(copy, /WITH legacy_raw AS MATERIALIZED/);
  assert.match(copy, /legacy_parts AS MATERIALIZED/);
  assert.match(copy, /legacy_parsed AS MATERIALIZED/);
  assert.match(copy, /start_year BETWEEN 1 AND 9999/);
  assert.match(copy, /start_month BETWEEN 1 AND 12/);
  assert.match(copy, /start_day BETWEEN 1 AND 31/);
  assert.match(copy, /extract\(month FROM \(make_date\(start_year, start_month, 1\) \+ start_day - 1\)\) = start_month/);
  assert.match(copy, /end_year BETWEEN 1 AND 9999/);
  assert.match(copy, /end_month BETWEEN 1 AND 12/);
  assert.match(copy, /end_day BETWEEN 1 AND 31/);
  assert.match(copy, /extract\(month FROM \(make_date\(end_year, end_month, 1\) \+ end_day - 1\)\) = end_month/);
  assert.match(copy, /migrated_start_date IS NOT NULL/);
  assert.match(copy, /migrated_end_date IS NOT NULL/);
});
