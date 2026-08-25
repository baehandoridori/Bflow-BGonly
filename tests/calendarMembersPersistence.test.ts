import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = 'DEVLOG/migrations/2026-08-24-shared-calendars.sql';

function between(source: string, start: string, end: string): string {
  source = source.replace(/\r\n?/g, '\n');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing start: ${start}`);
  assert.notEqual(to, -1, `missing end: ${end}`);
  return source.slice(from, to);
}

test('legacy private events add an idempotent type-safe NOT VALID user foreign key', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const block = between(
    sql,
    '-- ── 1-1) 레거시 개인 일정 사용자 FK',
    '-- ── 2) 캘린더 관리 쓰기 권한 원자적 검증 RPC',
  );

  const tableGuard = block.indexOf("to_regclass('public.private_calendar_events') IS NULL");
  const legacyTypeLookup = block.indexOf("attrelid = 'public.private_calendar_events'::regclass");
  const userTypeLookup = block.indexOf("attrelid = 'public.users'::regclass", legacyTypeLookup);
  const typeMismatch = block.indexOf('v_legacy_user_type IS DISTINCT FROM v_user_id_type');
  const typeError = block.indexOf("ERRCODE = '42804'", typeMismatch);
  const constraintLookup = block.indexOf("conname = 'private_calendar_events_user_id_fkey'", typeError);
  const existingConstraintBranch = block.indexOf('IF FOUND THEN', constraintLookup);
  const existingDefinitionCheck = block.indexOf("v_existing_constraint.contype <> 'f'", existingConstraintBranch);
  const existingDeleteActionCheck = block.indexOf("v_existing_constraint.confdeltype <> 'c'", existingDefinitionCheck);
  const incompatibleConstraintError = block.indexOf("ERRCODE = '42710'", existingDeleteActionCheck);
  const addConstraint = block.indexOf(
    'ADD CONSTRAINT private_calendar_events_user_id_fkey',
    incompatibleConstraintError,
  );

  assert.ok(tableGuard >= 0, 'older or clean databases may not have the legacy table');
  assert.ok(tableGuard < legacyTypeLookup && legacyTypeLookup < userTypeLookup);
  assert.ok(userTypeLookup < typeMismatch && typeMismatch < typeError);
  assert.ok(typeError < constraintLookup && constraintLookup < existingConstraintBranch);
  assert.ok(existingConstraintBranch < existingDefinitionCheck);
  assert.ok(existingDefinitionCheck < existingDeleteActionCheck);
  assert.ok(existingDeleteActionCheck < incompatibleConstraintError);
  assert.ok(incompatibleConstraintError < addConstraint);
  assert.match(
    block,
    /FOREIGN KEY \(user_id\)\s+REFERENCES public\.users\(id\)\s+ON DELETE CASCADE\s+NOT VALID/s,
  );
  assert.doesNotMatch(block, /VALIDATE CONSTRAINT/);
});

test('calendar management RPCs lock and recheck actor rights in the write transaction', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const scenarios = [
    {
      name: 'update_calendar_authorized',
      permissionDenied: 'Calendar update permission denied',
      write: 'UPDATE calendars AS target',
    },
    {
      name: 'delete_calendar_authorized',
      permissionDenied: 'Calendar delete permission denied',
      write: 'DELETE FROM calendars AS target',
    },
    {
      name: 'replace_calendar_members_authorized',
      permissionDenied: 'Calendar member management permission denied',
      write: 'DELETE FROM calendar_members',
    },
  ];
  for (const scenario of scenarios) {
    const fn = between(
      sql,
      `CREATE OR REPLACE FUNCTION public.${scenario.name}`,
      `COMMENT ON FUNCTION public.${scenario.name}`,
    );
    assert.match(fn, /LANGUAGE\s+plpgsql\s+SECURITY INVOKER\s+SET search_path\s*=\s*public,\s*pg_temp/s);
    const parentLock = fn.indexOf('FOR UPDATE;');
    const actorLock = fn.indexOf('FOR SHARE;');
    const permission = fn.indexOf(scenario.permissionDenied, actorLock);
    const write = fn.indexOf(scenario.write, permission);
    assert.ok(parentLock >= 0, `${scenario.name} must lock the calendar row`);
    assert.ok(parentLock < actorLock, `${scenario.name} must lock the calendar before the actor row`);
    assert.ok(actorLock < permission, `${scenario.name} must recheck owner/admin rights after both locks`);
    assert.ok(permission < write, `${scenario.name} must deny stale management rights before writing`);
    assert.match(fn, /v_calendar\.is_personal[\s\S]*v_calendar\.owner_id\s*<>\s*p_actor_id/s);
    assert.match(fn, /v_actor_role\s+IS DISTINCT FROM\s+'admin'/s);
  }

  const updateFn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.update_calendar_authorized',
    'COMMENT ON FUNCTION public.update_calendar_authorized',
  );
  assert.match(updateFn, /v_requested_visibility\s*=\s*'team'[\s\S]*v_actor_role\s+IS DISTINCT FROM\s+'admin'/s);
  assert.match(updateFn, /UPDATE calendars/);

  const deleteFn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.delete_calendar_authorized',
    'COMMENT ON FUNCTION public.delete_calendar_authorized',
  );
  const deleteCalendarTableLock = deleteFn.indexOf('LOCK TABLE calendars IN ROW EXCLUSIVE MODE;');
  const deleteEventTableLock = deleteFn.indexOf('LOCK TABLE calendar_events IN ROW EXCLUSIVE MODE;');
  const deleteMemberTableLock = deleteFn.indexOf('LOCK TABLE calendar_members IN ROW EXCLUSIVE MODE;');
  const deleteParentRowLock = deleteFn.indexOf('FOR UPDATE;');
  assert.ok(deleteCalendarTableLock >= 0 && deleteCalendarTableLock < deleteEventTableLock);
  assert.ok(deleteEventTableLock < deleteMemberTableLock);
  assert.ok(deleteMemberTableLock < deleteParentRowLock);
  assert.match(deleteFn, /v_calendar\.is_personal[\s\S]*ERRCODE\s*=\s*'42501'/s);
  assert.match(deleteFn, /DELETE FROM calendars/);

  const membersFn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.replace_calendar_members_authorized',
    'COMMENT ON FUNCTION public.replace_calendar_members_authorized',
  );
  const fieldValidation = membersFn.indexOf('Each calendar member requires user_id and can_edit');
  const parentLock = membersFn.indexOf('FOR UPDATE;');
  const memberDelete = membersFn.indexOf('DELETE FROM calendar_members');
  const memberInsert = membersFn.indexOf('INSERT INTO calendar_members');
  assert.ok(fieldValidation >= 0 && fieldValidation < parentLock);
  assert.ok(parentLock < memberDelete);
  assert.ok(memberDelete < memberInsert);
});

test('replace_calendar_members_authorized rejects a missing calendar before an empty replacement can succeed', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.replace_calendar_members_authorized',
    'COMMENT ON FUNCTION public.replace_calendar_members_authorized',
  );

  const parentLockIndex = fn.indexOf('FOR UPDATE;');
  const missingGuardIndex = fn.indexOf('IF NOT FOUND THEN', parentLockIndex);
  const foreignKeyErrorIndex = fn.indexOf("ERRCODE = '23503'", missingGuardIndex);
  const deleteIndex = fn.indexOf('DELETE FROM calendar_members');

  assert.ok(parentLockIndex >= 0 && parentLockIndex < missingGuardIndex);
  assert.ok(missingGuardIndex < foreignKeyErrorIndex);
  assert.ok(foreignKeyErrorIndex < deleteIndex, 'missing parent must fail before child rows change');
});

test('calendar visibility update to private clears member access in the same transaction', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.update_calendar_authorized',
    'COMMENT ON FUNCTION public.update_calendar_authorized',
  );

  const calendarTableLock = fn.indexOf('LOCK TABLE calendars IN ROW EXCLUSIVE MODE;');
  const memberTableLock = fn.indexOf('LOCK TABLE calendar_members IN ROW EXCLUSIVE MODE;');
  const calendarRowLock = fn.indexOf('FOR UPDATE;');
  const calendarUpdate = fn.indexOf('UPDATE calendars AS target');
  const privateCleanup = fn.indexOf("v_requested_visibility = 'private'", calendarUpdate);
  const memberDelete = fn.indexOf('DELETE FROM calendar_members', privateCleanup);

  assert.ok(calendarTableLock >= 0 && calendarTableLock < memberTableLock);
  assert.ok(memberTableLock < calendarRowLock, 'parent-to-child table locks precede the calendar row lock');
  assert.ok(calendarRowLock < calendarUpdate);
  assert.ok(calendarUpdate < privateCleanup, 'visibility changes before the conditional member cleanup');
  assert.ok(privateCleanup < memberDelete, 'private visibility removes every former member row');
  assert.match(fn, /IF NOT v_calendar\.is_personal[\s\S]*v_requested_visibility\s*=\s*'private'[\s\S]*DELETE FROM calendar_members[\s\S]*calendar_id\s*=\s*p_calendar_id/s);
});

test('calendar settings update replaces fields and members in one authorized transaction', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.update_calendar_authorized',
    'COMMENT ON FUNCTION public.update_calendar_authorized',
  );

  const memberValidation = fn.indexOf('Each calendar member requires user_id and can_edit');
  const calendarRowLock = fn.indexOf('FOR UPDATE;');
  const calendarUpdate = fn.indexOf('UPDATE calendars AS target');
  const memberDelete = fn.indexOf('DELETE FROM calendar_members', calendarUpdate);
  const memberInsert = fn.indexOf('INSERT INTO calendar_members', memberDelete);

  assert.match(fn, /v_allowed_keys[^;]*'members'/s);
  assert.ok(memberValidation >= 0 && memberValidation < calendarRowLock);
  assert.ok(calendarRowLock < calendarUpdate);
  assert.ok(calendarUpdate < memberDelete);
  assert.ok(memberDelete < memberInsert);
  assert.match(
    fn,
    /p_updates\s*\?\s*'members'[\s\S]*jsonb_array_length\(p_updates->'members'\)\s*>\s*0[\s\S]*Private calendars cannot have members/s,
  );
});

test('private nonpersonal calendars reject nonempty member replacement but allow empty cleanup', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.replace_calendar_members_authorized',
    'COMMENT ON FUNCTION public.replace_calendar_members_authorized',
  );

  const permission = fn.indexOf('Calendar member management permission denied');
  const privateGuard = fn.indexOf("v_calendar.visibility = 'private'", permission);
  const nonemptyGuard = fn.indexOf('jsonb_array_length(p_members) > 0', privateGuard);
  const privateError = fn.indexOf('Private calendars cannot have members', nonemptyGuard);
  const invalidCode = fn.indexOf("ERRCODE = '22023'", privateError);
  const memberDelete = fn.indexOf('DELETE FROM calendar_members', invalidCode);

  assert.ok(permission >= 0 && permission < privateGuard, 'management permission is checked first');
  assert.ok(privateGuard < nonemptyGuard);
  assert.ok(nonemptyGuard < privateError && privateError < invalidCode);
  assert.ok(invalidCode < memberDelete, 'a rejected nonempty list cannot alter existing membership rows');
});

function calendarCreateRpc(sql: string): string {
  return between(
    sql,
    'CREATE OR REPLACE FUNCTION public.create_calendar_with_members_authorized',
    'COMMENT ON FUNCTION public.create_calendar_with_members_authorized',
  );
}

test('calendar event range reads authorize the actor and filter visibility in one SQL statement', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.list_calendar_events_authorized',
    'COMMENT ON FUNCTION public.list_calendar_events_authorized',
  );

  assert.match(fn, /p_actor_id\s+TEXT[\s\S]*p_from\s+DATE[\s\S]*p_to\s+DATE/s);
  assert.match(fn, /RETURNS SETOF public\.calendar_events/);
  assert.match(fn, /LANGUAGE\s+sql\s+SECURITY INVOKER\s+SET search_path\s*=\s*public,\s*pg_temp\s+STABLE/s);
  assert.match(fn, /FROM public\.calendar_events AS event\s+JOIN public\.calendars AS calendar/s);
  assert.match(fn, /EXISTS \([\s\S]*FROM public\.users AS actor[\s\S]*actor\.id\s*=\s*p_actor_id[\s\S]*\)/s);
  assert.match(fn, /calendar\.owner_id\s*=\s*p_actor_id/);
  assert.match(fn, /calendar\.visibility\s*=\s*'team'/);
  assert.match(
    fn,
    /FROM public\.calendar_members AS permission[\s\S]*permission\.calendar_id\s*=\s*calendar\.id[\s\S]*permission\.user_id\s*=\s*p_actor_id/s,
  );
  assert.doesNotMatch(fn, /calendar\.visibility\s*=\s*'members'/);
  assert.match(fn, /p_from\s+IS NULL\s+OR\s+event\.end_date\s*>=\s*p_from/);
  assert.match(fn, /p_to\s+IS NULL\s+OR\s+event\.start_date\s*<=\s*p_to/);
  assert.equal((fn.match(/\bSELECT\b/gi) ?? []).length, 3, 'one event query plus actor and membership EXISTS');
  assert.doesNotMatch(fn, /\bLOCK\s+TABLE\b|\bFOR\s+(?:UPDATE|SHARE)\b/i);
});

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
  assert.ok(parentLockIndex < eventCleanupIndex, 'owned calendars must be locked before any cleanup');
  assert.ok(parentLockIndex < personalDeleteIndex);
  assert.ok(parentLockIndex < memberDeleteIndex);
  assert.ok(parentLockIndex < ownerUpdateIndex);
});

test('delete_user_cascade rejects a shared owner without a successor before any mutation', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.delete_user_cascade',
    'COMMENT ON FUNCTION public.delete_user_cascade',
  );

  const parentLock = fn.indexOf('PERFORM c.id');
  const sharedOwnershipCheck = fn.indexOf('SELECT EXISTS (', parentLock);
  const sharedBranch = fn.indexOf('IF v_has_shared_calendars THEN', sharedOwnershipCheck);
  const successorSelection = fn.indexOf('SELECT id INTO v_admin_id FROM users', sharedBranch);
  const successorLock = fn.indexOf('FOR NO KEY UPDATE;', successorSelection);
  const missingSuccessorGuard = fn.indexOf('IF v_admin_id IS NULL THEN', successorLock);
  const invariantError = fn.indexOf('Shared calendars require another admin owner', missingSuccessorGuard);
  const invariantSqlState = fn.indexOf("ERRCODE = '55000'", invariantError);
  const firstMutation = fn.indexOf('UPDATE scenes');

  assert.match(
    fn,
    /SELECT EXISTS \([\s\S]*c\.owner_id\s*=\s*p_user_id[\s\S]*AND NOT c\.is_personal[\s\S]*\) INTO v_has_shared_calendars;/s,
  );
  assert.ok(parentLock >= 0 && parentLock < sharedOwnershipCheck);
  assert.ok(sharedOwnershipCheck < sharedBranch);
  assert.ok(sharedBranch < successorSelection);
  assert.ok(successorSelection < successorLock);
  assert.ok(successorLock < missingSuccessorGuard);
  assert.ok(missingSuccessorGuard < invariantError && invariantError < invariantSqlState);
  assert.ok(
    invariantSqlState < firstMutation,
    'the missing-successor invariant must abort before dependent user data is changed',
  );
  assert.equal(
    fn.includes('DELETE FROM calendars WHERE owner_id = p_user_id;'),
    false,
    'shared calendars must never fall through to a destructive delete',
  );
});

test('delete_user_cascade locks the deterministic successor admin through ownership transfer', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.delete_user_cascade',
    'COMMENT ON FUNCTION public.delete_user_cascade',
  );

  const successorSelection = fn.indexOf('SELECT id INTO v_admin_id FROM users');
  const successorOrder = fn.indexOf(
    "ORDER BY (name = '배한솔') DESC, created_at ASC, id ASC",
    successorSelection,
  );
  const successorLimit = fn.indexOf('LIMIT 1', successorOrder);
  const successorLock = fn.indexOf('FOR NO KEY UPDATE;', successorLimit);
  const memberCleanup = fn.indexOf('DELETE FROM calendar_members m USING calendars c', successorLock);
  const ownershipTransfer = fn.indexOf('UPDATE calendars SET owner_id = v_admin_id', memberCleanup);

  assert.ok(successorSelection >= 0, 'successor selection must exist');
  assert.ok(successorSelection < successorOrder, 'successor preference remains deterministic');
  assert.ok(successorOrder < successorLimit);
  assert.ok(
    successorLimit < successorLock,
    'the chosen admin row must be locked against demotion or deletion before LIMIT 1 returns',
  );
  assert.ok(successorLock < memberCleanup);
  assert.ok(memberCleanup < ownershipTransfer, 'the successor stays locked through ownership transfer');
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

test('privacy replacement delete RPC atomically matches the exact created row incarnation', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const fn = between(
    sql,
    'CREATE OR REPLACE FUNCTION public.delete_calendar_privacy_replacement',
    'COMMENT ON FUNCTION public.delete_calendar_privacy_replacement',
  );

  assert.match(fn, /RETURNS SETOF public\.calendar_events/);
  assert.match(fn, /LANGUAGE\s+sql\s+SECURITY INVOKER\s+SET search_path\s*=\s*public,\s*pg_temp/s);
  assert.match(fn, /DELETE FROM public\.calendar_events AS target_event/);
  assert.match(fn, /target_event\.id\s*=\s*p_event_id/);
  assert.match(fn, /target_event\.calendar_id\s*=\s*p_calendar_id/);
  assert.match(fn, /target_event\.created_at\s*=\s*p_created_at/);
  assert.match(fn, /RETURNING target_event\.\*/);
  assert.equal((fn.match(/\bDELETE\s+FROM\b/g) ?? []).length, 1, 'receipt cleanup stays one statement');
  assert.doesNotMatch(fn, /created_by|p_created_by|calendar_members|\busers\b|can_edit|\brole\b/i);
  assert.match(
    sql,
    /DROP FUNCTION IF EXISTS public\.delete_calendar_privacy_replacement\(UUID, UUID, TEXT, TIMESTAMPTZ\)/,
  );
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
