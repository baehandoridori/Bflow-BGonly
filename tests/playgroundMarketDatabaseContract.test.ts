import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(
  root,
  'DEVLOG',
  'migrations',
  '2026-07-11-playground-market-v2.sql',
);

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8');
}

function functionDefinition(sql: string, functionName: string): string {
  const match = sql.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  ));
  assert.ok(match, `${functionName} must be defined`);
  return match[0];
}

const TABLES = [
  'playground_wallet_accounts',
  'playground_brokerage_accounts',
  'playground_market_holdings',
  'playground_value_ledger',
  'playground_market_events',
] as const;

const RPC_SIGNATURES = [
  ['playground_market_read', 'uuid'],
  ['playground_market_execute', 'uuid, text, text, jsonb'],
  ['playground_market_create_event', 'uuid, text, text, text, integer, timestamptz, timestamptz'],
  ['playground_market_delete_event', 'uuid, uuid'],
] as const;

function tableDefinition(sql: string, tableName: string): string {
  const match = sql.match(new RegExp(
    `CREATE TABLE IF NOT EXISTS public\\.${tableName}\\s*\\([\\s\\S]*?\\n\\);`,
    'i',
  ));
  assert.ok(match, `${tableName} must be defined`);
  return match[0];
}

test('migration creates the five private market tables with integer balance invariants', () => {
  const sql = readMigration();

  for (const table of TABLES) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, 'i'));
  }

  const wallet = tableDefinition(sql, 'playground_wallet_accounts');
  const brokerage = tableDefinition(sql, 'playground_brokerage_accounts');
  const holdings = tableDefinition(sql, 'playground_market_holdings');
  const ledger = tableDefinition(sql, 'playground_value_ledger');
  const events = tableDefinition(sql, 'playground_market_events');
  assert.match(wallet, /user_id\s+text\s+PRIMARY KEY\s+REFERENCES public\.users\s*\(id\)\s+ON DELETE CASCADE/i);
  assert.match(brokerage, /user_id\s+text\s+PRIMARY KEY\s+REFERENCES public\.users\s*\(id\)\s+ON DELETE CASCADE/i);
  assert.match(holdings, /user_id\s+text\s+NOT NULL\s+REFERENCES public\.users\s*\(id\)\s+ON DELETE CASCADE/i);
  assert.match(ledger, /user_id\s+text\s+NOT NULL\s+REFERENCES public\.users\s*\(id\)\s+ON DELETE CASCADE/i);
  assert.match(events, /created_by\s+text\s+NOT NULL\s+REFERENCES public\.users\s*\(id\)\s+ON DELETE CASCADE/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS playground_market_events_created_by_idx[\s\S]*?\(created_by\)/i);
  assert.match(wallet, /wallet_points\s+bigint\s+NOT NULL[\s\S]*?CHECK\s*\(wallet_points\s*>=\s*0\)/i);
  assert.match(wallet, /lifetime_earned_points\s+bigint\s+NOT NULL[\s\S]*?CHECK\s*\(lifetime_earned_points\s*>=\s*0\)/i);
  assert.match(brokerage, /cash_won\s+bigint\s+NOT NULL[\s\S]*?CHECK\s*\(cash_won\s*>=\s*0\)/i);
  assert.match(holdings, /quantity_shares\s+bigint\s+NOT NULL[\s\S]*?CHECK\s*\(quantity_shares\s*>\s*0\)/i);
  assert.match(holdings, /cost_basis_won\s+bigint\s+NOT NULL[\s\S]*?CHECK\s*\(cost_basis_won\s*>=\s*0\)/i);
  assert.match(ledger, /UNIQUE\s*\(user_id\s*,\s*request_id\s*\)/i);
  assert.doesNotMatch(sql, /CREATE SEQUENCE/i);
});

test('every market table enables RLS and rejects direct anon or authenticated table access', () => {
  const sql = readMigration();

  for (const table of TABLES) {
    assert.match(
      sql,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'),
      `${table} must enable RLS`,
    );
    assert.match(
      sql,
      new RegExp(`REVOKE ALL(?: PRIVILEGES)? ON TABLE public\\.${table} FROM anon, authenticated`, 'i'),
      `${table} must not be directly available to renderer roles`,
    );
    assert.match(
      sql,
      new RegExp(`REVOKE ALL(?: PRIVILEGES)? ON TABLE public\\.${table} FROM PUBLIC`, 'i'),
      `${table} must not retain PUBLIC table privileges`,
    );
  }
});

test('all market RPCs are hardened definer functions granted only to anon', () => {
  const sql = readMigration();

  for (const [name, signature] of RPC_SIGNATURES) {
    const definition = functionDefinition(sql, name);
    assert.match(definition, /SECURITY DEFINER\s+SET search_path\s*=\s*''/i);
    assert.match(
      sql,
      new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\(${signature}\\) FROM PUBLIC`, 'i'),
    );
    assert.match(
      sql,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(${signature}\\) TO anon`, 'i'),
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(${signature}\\) TO[^;]*\\bauthenticated\\b`, 'i'),
    );
    assert.match(
      sql,
      new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\(${signature}\\) FROM anon, authenticated`, 'i'),
    );
  }
});

test('canonical Hansol seed lookup is exact, unique, and never hardcodes a generated user UUID', () => {
  const sql = readMigration();

  assert.match(
    sql,
    /FROM public\.users[\s\S]*?name\s*=\s*'배한솔'[\s\S]*?slack_id\s*=\s*'U05DFV9UAN5'/i,
  );
  assert.match(sql, /COUNT\s*\(\*\)[\s\S]*?(?:<>|!=)\s*1[\s\S]*?RAISE EXCEPTION/i);
  assert.doesNotMatch(sql, /fcc4b438-2696-4e88-a03f-d6f34e73e08f/i);
  assert.doesNotMatch(sql, /'\s*[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\s*'\s*::\s*uuid/i);
});

test('initial million-point grant is idempotent and represented by one exact ledger delta', () => {
  const sql = readMigration();
  const seedKeyMatches = sql.match(/test-initial-grant-v1/g) ?? [];

  assert.ok(seedKeyMatches.length >= 1, 'seed ledger key must be present');
  assert.match(
    sql,
    /INSERT INTO public\.playground_value_ledger[\s\S]*?'test-initial-grant-v1'[\s\S]*?1000000[\s\S]*?ON CONFLICT\s*\(user_id\s*,\s*request_id\s*\)\s*DO NOTHING/i,
  );
  assert.match(
    sql,
    /GET DIAGNOSTICS\s+v_seed_inserted\s*=\s*ROW_COUNT[\s\S]*?IF\s+v_seed_inserted\s*=\s*1[\s\S]*?wallet_points\s*=\s*wallet_points\s*\+\s*1000000[\s\S]*?lifetime_earned_points\s*=\s*lifetime_earned_points\s*\+\s*1000000/i,
  );
});

test('execute RPC owns idempotency, locking, command validation, and atomic ledger writes', () => {
  const sql = readMigration();
  const definition = functionDefinition(sql, 'playground_market_execute');

  assert.match(
    definition,
    /playground_market_execute\s*\(\s*p_user_id\s+uuid\s*,\s*p_request_id\s+text\s*,\s*p_kind\s+text\s*,\s*p_payload\s+jsonb\s*\)/i,
  );
  const advisoryLock = definition.search(/pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*p_user_id::text\s*,\s*0\s*\)\s*\)/i);
  const firstTableAccess = definition.search(/\b(?:FROM|UPDATE|INSERT INTO|DELETE FROM)\s+public\./i);
  assert.notEqual(advisoryLock, -1, 'execute must take a per-user advisory transaction lock');
  assert.ok(advisoryLock < firstTableAccess, 'execute must take the advisory lock before table access');
  assert.match(definition, /FOR UPDATE/i);
  assert.match(definition, /(?:digest\s*\([\s\S]*?'sha256'|sha256\s*\()/i);
  assert.match(definition, /request id conflict/i);
  assert.match(
    definition,
    /IF FOUND THEN[\s\S]*?v_existing_fingerprint IS DISTINCT FROM v_fingerprint[\s\S]*?RETURN public\.playground_market_read\(p_user_id\)/i,
  );
  assert.doesNotMatch(definition, /RETURN COALESCE\(v_existing_response/i);
  for (const [field, type] of [
    ['stockId', 'string'],
    ['wished', 'boolean'],
    ['direction', 'string'],
    ['points', 'number'],
    ['quantityShares', 'number'],
    ['quotedPriceWon', 'number'],
  ]) {
    assert.match(
      definition,
      new RegExp(`jsonb_typeof\\(p_payload -> '${field}'\\)\\s+IS DISTINCT FROM '${type}'`, 'i'),
      `${field} must reject missing and wrong JSON types`,
    );
  }
  for (const kind of ['transfer', 'buy', 'sell', 'favorite', 'read-reason']) {
    assert.match(definition, new RegExp(`WHEN\\s+'${kind}'`, 'i'));
  }
  assert.match(definition, /9007199254740991/);
  assert.match(definition, /INSERT INTO public\.playground_value_ledger/i);
});

test('request IDs are canonical raw strings bounded to two hundred characters in table and RPC', () => {
  const sql = readMigration();
  const ledger = tableDefinition(sql, 'playground_value_ledger');
  const execute = functionDefinition(sql, 'playground_market_execute');

  assert.match(ledger, /char_length\s*\(request_id\)\s+BETWEEN\s+1\s+AND\s+200/i);
  assert.match(ledger, /char_length\s*\(btrim\s*\(request_id\)\)\s+BETWEEN\s+1\s+AND\s+200/i);
  assert.match(ledger, /request_id\s*=\s*btrim\s*\(request_id\)/i);
  assert.match(execute, /char_length\s*\(p_request_id\)\s+NOT\s+BETWEEN\s+1\s+AND\s+200/i);
  assert.match(execute, /char_length\s*\(btrim\s*\(p_request_id\)\)\s+NOT\s+BETWEEN\s+1\s+AND\s+200/i);
  assert.match(execute, /p_request_id\s+IS\s+DISTINCT\s+FROM\s+btrim\s*\(p_request_id\)/i);
});

test('migration documents the accepted test-only anon RPC trust boundary', () => {
  const sql = readMigration();

  assert.match(sql, /ACCEPTED TEST-ONLY THREAT MODEL/i);
  assert.match(sql, /가상 포인트|fake|non-monetary/i);
  assert.match(sql, /anon[\s\S]*?직접[\s\S]*?RPC|direct[\s\S]*?RPC/i);
  assert.match(sql, /Electron main[\s\S]*?신뢰 경계|trust boundary/i);
  assert.match(sql, /Supabase Auth[\s\S]*?(?:팀 공개|team-wide|확장 전)/i);
});

test('admin event RPCs re-verify the unique canonical Hansol identity before writes', () => {
  const sql = readMigration();

  for (const name of ['playground_market_create_event', 'playground_market_delete_event']) {
    const definition = functionDefinition(sql, name);
    assert.match(definition, /FROM public\.users/i);
    assert.match(definition, /name\s*=\s*'배한솔'/i);
    assert.match(definition, /slack_id\s*=\s*'U05DFV9UAN5'/i);
    assert.match(definition, /COUNT\s*\(\*\)[\s\S]*?(?:<>|!=)\s*1/i);
    assert.match(definition, /users\.id\s*=\s*p_user_id::text/i);
  }
});
