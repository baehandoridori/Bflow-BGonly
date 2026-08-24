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

function calendarCreateRpc(sql: string): string {
  return between(
    sql,
    'CREATE OR REPLACE FUNCTION public.create_calendar_with_members_authorized',
    'COMMENT ON FUNCTION public.create_calendar_with_members_authorized',
  );
}

test('calendar create RPC is an invoker transaction with parent-to-child writer lock order', () => {
  const fn = calendarCreateRpc(readFileSync(migrationPath, 'utf8'));
  assert.match(fn, /RETURNS SETOF calendars/);
  assert.match(fn, /LANGUAGE\s+plpgsql\s+SECURITY INVOKER\s+SET search_path\s*=\s*public,\s*pg_temp/s);

  const calendarTableLock = fn.indexOf('LOCK TABLE calendars IN ROW EXCLUSIVE MODE;');
  const memberTableLock = fn.indexOf('LOCK TABLE calendar_members IN ROW EXCLUSIVE MODE;');
  const actorRowLock = fn.indexOf('FOR NO KEY UPDATE;');
  const calendarInsert = fn.indexOf('INSERT INTO calendars');
  const memberInsert = fn.indexOf('INSERT INTO calendar_members');
  const returnRow = fn.indexOf('RETURN NEXT v_created;');

  assert.ok(calendarTableLock >= 0 && calendarTableLock < memberTableLock);
  assert.ok(memberTableLock < actorRowLock, 'writer table locks must precede the actor permission row lock');
  assert.ok(actorRowLock < calendarInsert, 'session actor must be locked and authorized before creation');
  assert.doesNotMatch(fn, /WHERE actor\.id\s*=\s*p_actor_id\s+FOR UPDATE;/s);
  assert.ok(calendarInsert < memberInsert, 'calendar parent must be inserted before initial member children');
  assert.ok(memberInsert < returnRow, 'success must be returned only after initial members are written');
});

test('calendar create RPC derives ownership and team permission from the locked session actor', () => {
  const fn = calendarCreateRpc(readFileSync(migrationPath, 'utf8'));
  assert.match(fn, /FROM users AS actor[\s\S]*actor\.id\s*=\s*p_actor_id[\s\S]*FOR NO KEY UPDATE;/);
  assert.match(fn, /v_visibility\s*=\s*'team'[\s\S]*v_actor_role\s+IS DISTINCT FROM\s+'admin'[\s\S]*ERRCODE\s*=\s*'42501'/);
  assert.match(fn, /INSERT INTO calendars\s*\(name, color, visibility, owner_id, is_personal\)/s);
  assert.match(fn, /p_actor_id,\s*false/s);
  assert.doesNotMatch(fn, /p_owner_id|p_is_personal/);
});

test('calendar create RPC accepts only canonical calendar and member input fields', () => {
  const fn = calendarCreateRpc(readFileSync(migrationPath, 'utf8'));
  const calendarAllowed = fn.match(/v_allowed_keys CONSTANT TEXT\[\] := ARRAY\[([\s\S]*?)\];/);
  const memberAllowed = fn.match(/v_member_allowed_keys CONSTANT TEXT\[\] := ARRAY\[([\s\S]*?)\];/);
  assert.ok(calendarAllowed);
  assert.ok(memberAllowed);
  assert.deepEqual(
    [...calendarAllowed[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    ['name', 'color', 'visibility'],
  );
  assert.deepEqual(
    [...memberAllowed[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    ['user_id', 'can_edit'],
  );
  assert.match(fn, /jsonb_typeof\(p_calendar\)\s*<>\s*'object'/);
  assert.match(fn, /jsonb_typeof\(p_members\)\s*<>\s*'array'/);
  assert.match(fn, /jsonb_object_keys\(p_calendar\)/);
  assert.match(fn, /jsonb_array_elements\(p_members\)[\s\S]*jsonb_object_keys/);
  assert.match(fn, /ERRCODE\s*=\s*'22023'/);
  for (const immutable of ['id', 'owner_id', 'is_personal', 'created_at', 'updated_at']) {
    assert.doesNotMatch(calendarAllowed[1], new RegExp(`'${immutable}'`));
  }
});

test('delete_user_cascade serializes calendar and event writers before row cleanup', () => {
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

  const calendarTableLockIndex = fn.indexOf('LOCK TABLE calendars IN SHARE ROW EXCLUSIVE MODE;');
  const eventTableLockIndex = fn.indexOf('LOCK TABLE calendar_events IN SHARE ROW EXCLUSIVE MODE;');
  const parentLockIndex = fn.indexOf('PERFORM c.id');
  const eventCleanupIndex = fn.indexOf('UPDATE calendar_events SET created_by = NULL');
  const personalDeleteIndex = fn.indexOf('DELETE FROM calendars WHERE owner_id = p_user_id AND is_personal');
  const memberDeleteIndex = fn.indexOf('DELETE FROM calendar_members m USING calendars c');
  const ownerUpdateIndex = fn.indexOf('UPDATE calendars SET owner_id = v_admin_id');

  assert.ok(calendarTableLockIndex >= 0, 'calendar writers must be serialized first');
  assert.ok(
    calendarTableLockIndex < eventTableLockIndex,
    'calendar table lock must precede the event table lock',
  );
  assert.ok(
    eventTableLockIndex < eventCleanupIndex,
    'both table locks must be held before event rows are changed',
  );
  assert.ok(eventCleanupIndex < parentLockIndex);
  assert.ok(parentLockIndex < personalDeleteIndex);
  assert.ok(parentLockIndex < memberDeleteIndex);
  assert.ok(parentLockIndex < ownerUpdateIndex);
});

const eventRpcNames = [
  'create_calendar_event_authorized',
  'update_calendar_event_authorized',
  'delete_calendar_event_authorized',
] as const;

function eventRpc(sql: string, name: typeof eventRpcNames[number]): string {
  return between(
    sql,
    `CREATE OR REPLACE FUNCTION public.${name}`,
    `COMMENT ON FUNCTION public.${name}`,
  );
}

test('calendar event RPCs run as invokers and lock writer tables in parent-to-child order', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  for (const name of eventRpcNames) {
    const fn = eventRpc(sql, name);
    assert.match(fn, /LANGUAGE\s+plpgsql\s+SECURITY INVOKER\s+SET search_path\s*=\s*public,\s*pg_temp/s);
    const calendarTableLock = fn.indexOf('LOCK TABLE calendars IN ROW EXCLUSIVE MODE;');
    const eventTableLock = fn.indexOf('LOCK TABLE calendar_events IN ROW EXCLUSIVE MODE;');
    assert.ok(calendarTableLock >= 0, `${name} must lock calendars`);
    assert.ok(calendarTableLock < eventTableLock, `${name} must lock calendars before calendar_events`);
  }
});

test('calendar event RPCs authorize only the owner or an explicit can_edit member', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  for (const name of eventRpcNames) {
    const fn = eventRpc(sql, name);
    assert.match(fn, /owner_id\s*<>\s*p_actor_id/s);
    assert.match(
      fn,
      /calendar_members[\s\S]*user_id\s*=\s*p_actor_id[\s\S]*can_edit\s+IS TRUE/s,
    );
    assert.doesNotMatch(fn, /visibility\s*=\s*'team'|role\s*=\s*'admin'/i);
    assert.match(fn, /ERRCODE\s*=\s*'42501'/);
  }
});

test('calendar event create and update reject non-object or non-whitelisted payload fields', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const allowedFields = [
    'calendar_id', 'title', 'memo', 'tag_id', 'all_day', 'start_date', 'end_date',
    'start_time', 'end_time', 'linked_episode', 'linked_part', 'linked_sheet_name',
    'linked_scene_id', 'linked_department', 'linked_todo_id',
  ];
  for (const name of ['create_calendar_event_authorized', 'update_calendar_event_authorized'] as const) {
    const fn = eventRpc(sql, name);
    assert.match(fn, /jsonb_typeof\([^)]*\)\s*<>\s*'object'/);
    assert.match(fn, /jsonb_object_keys/);
    assert.match(fn, /ERRCODE\s*=\s*'22023'/);
    for (const field of allowedFields) assert.match(fn, new RegExp(`'${field}'`));
    for (const immutable of ['id', 'created_by', 'created_at', 'updated_at']) {
      assert.doesNotMatch(fn, new RegExp(`allowed[^;]*'${immutable}'`, 'is'));
    }
  }

  const createFn = eventRpc(sql, 'create_calendar_event_authorized');
  assert.match(createFn, /v_required_keys\s+CONSTANT\s+TEXT\[\]/);
  assert.match(createFn, /unnest\(v_required_keys\)[\s\S]*NOT \(p_event \? required\.key\)/);
});

test('calendar event create and delete lock parent rows before writing event rows', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const createFn = eventRpc(sql, 'create_calendar_event_authorized');
  const createParentLock = createFn.indexOf('FROM calendars AS candidate');
  const createParentForUpdate = createFn.indexOf('FOR UPDATE;', createParentLock);
  const createWrite = createFn.indexOf('INSERT INTO calendar_events');
  assert.ok(createParentLock >= 0 && createParentLock < createParentForUpdate);
  assert.ok(createParentForUpdate < createWrite, 'create permission parent must stay locked through insert');

  const deleteFn = eventRpc(sql, 'delete_calendar_event_authorized');
  const deleteParentLock = deleteFn.indexOf('ORDER BY candidate.id\n  FOR UPDATE;');
  const deleteEventLock = deleteFn.indexOf('FROM calendar_events AS current_event');
  const deleteWrite = deleteFn.indexOf('DELETE FROM calendar_events');
  assert.ok(deleteParentLock >= 0 && deleteParentLock < deleteEventLock);
  assert.ok(deleteEventLock < deleteWrite, 'delete must lock its event after its parent and before deletion');
});

test('calendar event update locks ordered source and target parents before the event row and checks stale source', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = eventRpc(sql, 'update_calendar_event_authorized');
  const parentLock = fn.indexOf('ORDER BY candidate.id\n  FOR UPDATE;');
  const eventLock = fn.indexOf('FROM calendar_events AS current_event');
  const staleGuard = fn.indexOf('v_existing.calendar_id <> p_expected_calendar_id');
  const write = fn.indexOf('UPDATE calendar_events');

  assert.ok(parentLock >= 0, 'source and derived target parents must be UUID-ordered and locked');
  assert.ok(parentLock < eventLock, 'parent rows must be locked before the event row');
  assert.ok(eventLock < staleGuard, 'the locked event source must be checked for staleness');
  assert.ok(staleGuard < write, 'stale source must fail before the update');
  assert.match(fn, /ERRCODE\s*=\s*'40001'/);
  assert.match(fn, /p_updates\s*\?\s*'calendar_id'/);
});

test('calendar event update preserves omitted fields, explicit null clears, and owns updated_at', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = eventRpc(sql, 'update_calendar_event_authorized');
  for (const field of ['memo', 'tag_id', 'start_time', 'end_time', 'linked_part', 'linked_todo_id']) {
    assert.match(
      fn,
      new RegExp(`${field}\\s*=\\s*CASE\\s+WHEN\\s+p_updates\\s*\\?\\s*'${field}'`, 's'),
    );
  }
  assert.match(fn, /updated_at\s*=\s*now\(\)/);
  assert.doesNotMatch(fn, /created_by\s*=/);
});
