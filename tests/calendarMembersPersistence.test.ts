import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = 'DEVLOG/migrations/2026-08-24-shared-calendars.sql';

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing start: ${start}`);
  assert.notEqual(to, -1, `missing end: ${end}`);
  return source.slice(from, to);
}

test('replace_calendar_members locks its calendar parent before replacing child rows', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.replace_calendar_members',
    'COMMENT ON FUNCTION public.replace_calendar_members',
  );

  assert.match(
    fn,
    /PERFORM\s+1\s+FROM\s+calendars\s+WHERE\s+id\s*=\s*p_calendar_id\s+FOR UPDATE;/s,
  );
  assert.doesNotMatch(fn, /LOCK\s+TABLE/i);

  const fieldValidationIndex = fn.indexOf('Each calendar member requires user_id and can_edit');
  const duplicateValidationIndex = fn.indexOf('Duplicate calendar member user_id');
  const parentLockIndex = fn.indexOf('FOR UPDATE;');
  const deleteIndex = fn.indexOf('DELETE FROM calendar_members');
  const insertIndex = fn.indexOf('INSERT INTO calendar_members');

  assert.ok(fieldValidationIndex >= 0 && fieldValidationIndex < parentLockIndex);
  assert.ok(duplicateValidationIndex >= 0 && duplicateValidationIndex < parentLockIndex);
  assert.ok(parentLockIndex < deleteIndex, 'parent lock must precede the child delete');
  assert.ok(deleteIndex < insertIndex, 'the final-list delete must precede the insert');
});

test('replace_calendar_members rejects a missing calendar before an empty replacement can succeed', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.replace_calendar_members',
    'COMMENT ON FUNCTION public.replace_calendar_members',
  );

  const parentLockIndex = fn.indexOf('FOR UPDATE;');
  const missingGuardIndex = fn.indexOf('IF NOT FOUND THEN', parentLockIndex);
  const foreignKeyErrorIndex = fn.indexOf("ERRCODE = '23503'", missingGuardIndex);
  const deleteIndex = fn.indexOf('DELETE FROM calendar_members');

  assert.ok(parentLockIndex >= 0 && parentLockIndex < missingGuardIndex);
  assert.ok(missingGuardIndex < foreignKeyErrorIndex);
  assert.ok(foreignKeyErrorIndex < deleteIndex, 'missing parent must fail before child rows change');
});

test('delete_user_cascade clears event authors before locking owned calendars and cleaning members', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.delete_user_cascade',
    'COMMENT ON FUNCTION public.delete_user_cascade',
  );

  assert.match(
    fn,
    /PERFORM\s+c\.id\s+FROM\s+calendars\s+c\s+WHERE\s+c\.owner_id\s*=\s*p_user_id\s+ORDER BY\s+c\.id\s+FOR UPDATE;/s,
  );
  assert.doesNotMatch(fn, /LOCK\s+TABLE/i);

  const parentLockIndex = fn.indexOf('PERFORM c.id');
  const eventCleanupIndex = fn.indexOf('UPDATE calendar_events SET created_by = NULL');
  const personalDeleteIndex = fn.indexOf('DELETE FROM calendars WHERE owner_id = p_user_id AND is_personal');
  const memberDeleteIndex = fn.indexOf('DELETE FROM calendar_members m USING calendars c');
  const ownerUpdateIndex = fn.indexOf('UPDATE calendars SET owner_id = v_admin_id');

  assert.ok(eventCleanupIndex >= 0 && eventCleanupIndex < parentLockIndex);
  assert.ok(parentLockIndex < personalDeleteIndex);
  assert.ok(parentLockIndex < memberDeleteIndex);
  assert.ok(parentLockIndex < ownerUpdateIndex);
});
