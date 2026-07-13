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
  '2026-07-13-playground-arcade-v1.sql',
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

function tableDefinition(sql: string, tableName: string): string {
  const match = sql.match(new RegExp(
    `CREATE TABLE IF NOT EXISTS public\\.${tableName}\\s*\\([\\s\\S]*?\\n\\);`,
    'i',
  ));
  assert.ok(match, `${tableName} must be defined`);
  return match[0];
}

const NEW_TABLES = [
  'playground_game_runs',
  'playground_achievement_unlocks',
  'playground_arcade_config',
] as const;

const RPC_SIGNATURES = [
  ['playground_arcade_read', 'uuid'],
  ['playground_arcade_execute', 'uuid, text, text, jsonb'],
] as const;

const NEW_LEDGER_KINDS = [
  'game-entry',
  'game-reward',
  'scene-progress',
  'comment',
  'retake-done',
  'daily-login',
  'achievement',
  'arcade-grant',
] as const;

test('migration wraps everything in a single transaction and documents the accepted threat model', () => {
  const sql = readMigration();
  assert.match(sql, /\nBEGIN;/i);
  assert.match(sql, /COMMIT;\s*$/i);
  assert.match(sql, /ACCEPTED TEST-ONLY THREAT MODEL/i);
  assert.match(sql, /가상 포인트|fake|non-monetary/i);
  assert.match(sql, /Electron main/i);
});

test('migration creates the three private arcade tables with integer-safe invariants', () => {
  const sql = readMigration();

  for (const table of NEW_TABLES) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, 'i'));
  }

  const runs = tableDefinition(sql, 'playground_game_runs');
  const unlocks = tableDefinition(sql, 'playground_achievement_unlocks');
  const config = tableDefinition(sql, 'playground_arcade_config');

  // user_id foreign key with cascade delete (runs + unlocks)
  assert.match(runs, /user_id\s+text\s+NOT NULL\s+REFERENCES public\.users\s*\(id\)\s+ON DELETE CASCADE/i);
  assert.match(unlocks, /user_id\s+text\s+NOT NULL\s+REFERENCES public\.users\s*\(id\)\s+ON DELETE CASCADE/i);

  // duration lower bound of 1000ms is part of the run invariants
  assert.match(runs, /duration_ms\s+bigint\s+NOT NULL/i);
  assert.match(runs, /duration_ms\s*>=\s*1000/i);
  assert.match(runs, /duration_ms\s*<=\s*14400000/i);
  assert.match(runs, /score\s*>=\s*0\s+AND\s+score\s*<=\s*9007199254740991/i);
  assert.match(runs, /reward_points\s*>=\s*0/i);
  assert.match(runs, /entry_request_id\s+text\s+NOT NULL\s+UNIQUE/i);
  assert.match(runs, /game_id\s+IN\s*\(\s*'snake'\s*,\s*'tetris'\s*,\s*'sudoku'\s*\)/i);
  assert.match(runs, /grade\s+IN\s*\(\s*'none'\s*,\s*'bronze'\s*,\s*'silver'\s*,\s*'gold'\s*,\s*'platinum'\s*\)/i);
  assert.match(runs, /was_alltime_best\s+boolean\s+NOT NULL/i);

  // leaderboard + per-user indexes
  assert.match(sql, /CREATE INDEX IF NOT EXISTS playground_game_runs_leaderboard_idx[\s\S]*?\(game_id\s*,\s*score DESC\s*,\s*created_at ASC\)/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS playground_game_runs_user_idx/i);

  // achievement unlocks composite key + trimmed id check
  assert.match(unlocks, /PRIMARY KEY\s*\(user_id\s*,\s*achievement_id\)/i);
  assert.match(unlocks, /char_length\s*\(achievement_id\)\s+BETWEEN\s+1\s+AND\s+80/i);

  // config singleton
  assert.match(config, /id\s+smallint\s+PRIMARY KEY\s+DEFAULT\s+1/i);
  assert.match(config, /slack_notify_enabled\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i);
  assert.match(config, /CHECK\s*\(id\s*=\s*1\)/i);
  assert.match(sql, /INSERT INTO public\.playground_arcade_config\s*\(id\)\s*VALUES\s*\(1\)\s*ON CONFLICT\s*\(id\)\s*DO NOTHING/i);

  assert.doesNotMatch(sql, /CREATE SEQUENCE/i);
});

test('the ledger kind constraint is re-created to include every arcade earning and spend kind', () => {
  const sql = readMigration();

  assert.match(
    sql,
    /ALTER TABLE public\.playground_value_ledger\s+DROP CONSTRAINT IF EXISTS playground_ledger_kind_valid/i,
  );
  const kindConstraint = sql.match(
    /ADD CONSTRAINT playground_ledger_kind_valid CHECK \(\s*kind IN \(([\s\S]*?)\)\s*\)/i,
  );
  assert.ok(kindConstraint, 'kind CHECK must be re-added');
  const kindBody = kindConstraint[1];
  for (const kind of NEW_LEDGER_KINDS) {
    assert.match(kindBody, new RegExp(`'${kind}'`), `kind list must include ${kind}`);
  }
  // original market kinds must survive the re-creation
  for (const kind of ['initial-grant', 'favorite', 'read-reason', 'transfer', 'buy', 'sell']) {
    assert.match(kindBody, new RegExp(`'${kind}'`), `kind list must keep ${kind}`);
  }
});

test('every new arcade table enables RLS and rejects direct anon or authenticated table access', () => {
  const sql = readMigration();

  for (const table of NEW_TABLES) {
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

test('both arcade RPCs are hardened definer functions granted only to anon', () => {
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

test('both arcade RPCs re-verify the unique canonical Hansol identity by name and slack id', () => {
  const sql = readMigration();

  for (const [name] of RPC_SIGNATURES) {
    const definition = functionDefinition(sql, name);
    assert.match(definition, /name\s*=\s*'배한솔'/i);
    assert.match(definition, /slack_id\s*=\s*'U05DFV9UAN5'/i);
    assert.match(definition, /COUNT\s*\(\*\)[\s\S]*?(?:<>|!=)\s*1[\s\S]*?RAISE EXCEPTION/i);
    assert.match(definition, /users\.id\s*=\s*p_user_id::text/i);
  }
  // never hardcode a generated UUID
  assert.doesNotMatch(sql, /'\s*[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\s*'\s*::\s*uuid/i);
});

test('read RPC exposes the KST attendance, per-game leaderboard, and config snapshot', () => {
  const sql = readMigration();
  const read = functionDefinition(sql, 'playground_arcade_read');

  assert.match(
    read,
    /playground_arcade_read\s*\(\s*p_user_id\s+uuid\s*\)/i,
  );
  // per-user advisory lock exactly once
  const advisoryLocks = [...read.matchAll(
    /PERFORM\s+pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*p_user_id::text\s*,\s*0\s*\)\s*\)/gi,
  )];
  assert.equal(advisoryLocks.length, 1, 'read must take the per-user lock exactly once');

  // KST date + week expressions
  assert.match(read, /AT TIME ZONE\s+'Asia\/Seoul'/i);
  assert.match(read, /date_trunc\s*\(\s*'week'/i);

  // snapshot keys the renderer mirror depends on
  for (const key of [
    'walletPoints', 'lifetimeEarnedPoints', 'streakDays', 'todayGranted',
    'todayActivityCounts', 'myBestScore', 'myWeeklyBestScore', 'todayRewardedRuns',
    'leaderboardAll', 'leaderboardWeekly', 'achievements', 'aggregates',
    'arcadeEarnedPoints', 'walletLeaderboard', 'slackNotifyEnabled',
  ]) {
    assert.match(read, new RegExp(`'${key}'`), `read snapshot must expose ${key}`);
  }
  // distinct best-per-user leaderboard
  assert.match(read, /DISTINCT ON\s*\(\s*[a-z_.]*user_id\s*\)/i);
});

test('execute RPC owns idempotency, locking, and the replayed idempotency-key contract', () => {
  const sql = readMigration();
  const execute = functionDefinition(sql, 'playground_arcade_execute');

  assert.match(
    execute,
    /playground_arcade_execute\s*\(\s*p_user_id\s+uuid\s*,\s*p_request_id\s+text\s*,\s*p_kind\s+text\s*,\s*p_payload\s+jsonb\s*\)/i,
  );
  const advisoryLock = execute.search(/pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*p_user_id::text\s*,\s*0\s*\)\s*\)/i);
  const firstTableAccess = execute.search(/\b(?:FROM|UPDATE|INSERT INTO|DELETE FROM)\s+public\./i);
  assert.notEqual(advisoryLock, -1, 'execute must take a per-user advisory transaction lock');
  assert.ok(advisoryLock < firstTableAccess, 'execute must take the advisory lock before table access');
  assert.match(execute, /FOR UPDATE/i);
  assert.match(execute, /(?:digest\s*\([\s\S]*?'sha256'|sha256\s*\()/i);

  // fingerprint conflict + replayed replay of the stored response_state
  assert.match(execute, /IS DISTINCT FROM v_fingerprint[\s\S]*?RAISE EXCEPTION/i);
  assert.match(execute, /response_state/i);
  assert.match(execute, /jsonb_build_object\s*\(\s*'replayed'\s*,\s*true\s*\)/i);

  // every execute kind is dispatched
  for (const kind of ['daily-login', 'activity', 'game-start', 'game-finish', 'achievement-unlock', 'config-set']) {
    assert.match(execute, new RegExp(`'${kind}'`), `execute must handle the ${kind} command`);
  }
  assert.match(execute, /9007199254740991/);
  assert.match(execute, /INSERT INTO public\.playground_value_ledger/i);
  assert.match(execute, /INSERT INTO public\.playground_game_runs/i);
  assert.match(execute, /INSERT INTO public\.playground_achievement_unlocks/i);
  assert.match(execute, /UPDATE public\.playground_arcade_config/i);
});

test('request ids stay canonical raw strings bounded to two hundred characters in the execute RPC', () => {
  const sql = readMigration();
  const execute = functionDefinition(sql, 'playground_arcade_execute');

  assert.match(execute, /char_length\s*\(p_request_id\)\s+NOT\s+BETWEEN\s+1\s+AND\s+200/i);
  assert.match(execute, /char_length\s*\(btrim\s*\(p_request_id\)\)\s+NOT\s+BETWEEN\s+1\s+AND\s+200/i);
  assert.match(execute, /p_request_id\s+IS\s+DISTINCT\s+FROM\s+btrim\s*\(p_request_id\)/i);
});

test('execute RPC hardcodes the arcade balance so the SQL is the paying source of truth', () => {
  const sql = readMigration();
  const execute = functionDefinition(sql, 'playground_arcade_execute');

  // entry fees
  assert.match(execute, /'snake'\s+THEN\s+10\b/i);
  assert.match(execute, /'tetris'\s+THEN\s+15\b/i);

  // grade boundaries are inclusive (>=) — snake
  for (const min of [15, 25, 40, 55]) {
    assert.match(execute, new RegExp(`>=\\s*${min}\\b`), `snake grade boundary ${min} must be an inclusive comparison`);
  }
  // grade boundaries are inclusive (>=) — tetris
  for (const min of [3000, 10000, 25000, 50000]) {
    assert.match(execute, new RegExp(`>=\\s*${min}\\b`), `tetris grade boundary ${min} must be an inclusive comparison`);
  }

  // grade rewards
  for (const reward of [8, 18, 30, 45]) {
    assert.match(execute, new RegExp(`THEN\\s+${reward}\\b`), `snake reward ${reward} must be present`);
  }
  for (const reward of [12, 30, 55, 80]) {
    assert.match(execute, new RegExp(`THEN\\s+${reward}\\b`), `tetris reward ${reward} must be present`);
  }

  // score ceilings used at the DB boundary
  assert.match(execute, /441\b/);
  assert.match(execute, /3000000\b/);

  // daily rewarded-run cap of 5
  assert.match(execute, />=\s*5\b/);

  // activity points 20 / 5 / 10 / 5 / 30 and their caps
  assert.match(execute, /20\b/); // daily-login
  assert.match(execute, /'scene-stage'[\s\S]*?5\b/i);
  assert.match(execute, /'scene-phase-done'[\s\S]*?10\b/i);
  assert.match(execute, /'retake-done'[\s\S]*?30\b/i);

  // achievement bonus map (all ten ids with their bonuses)
  const achievementBonuses: Array<[string, number]> = [
    ['arcade-first-run', 10],
    ['arcade-runs-50', 30],
    ['arcade-earned-5k', 50],
    ['attend-7', 50],
    ['snake-30', 15],
    ['snake-55', 40],
    ['snake-golden-5', 20],
    ['tetris-tetris', 20],
    ['tetris-level-10', 30],
    ['tetris-30k', 40],
  ];
  for (const [id, bonus] of achievementBonuses) {
    assert.match(execute, new RegExp(`'${id}'\\s+THEN\\s+${bonus}\\b`), `achievement ${id} must award ${bonus}`);
  }
});

test('game finishes are bound to the game they were started as', () => {
  const execute = functionDefinition(readMigration(), 'playground_arcade_execute');
  // game-start 는 시작 게임을 원장(stock_id)에 남기고, game-finish 는 그것과 대조한다.
  assert.match(execute, /v_entry_stock_id\s*:=\s*v_game_id/i);
  assert.match(execute, /v_entry_game_id\s+IS DISTINCT FROM\s+v_game_id/i);
  assert.match(execute, /시작한 게임과 종료한 게임이 달라요/);
});

test('achievement bonuses are server-validated against the underlying condition', () => {
  const execute = functionDefinition(readMigration(), 'playground_arcade_execute');
  assert.match(execute, /v_condition_met/);
  assert.match(execute, /아직 달성하지 못한 도전과제/);
  // 조건은 원장/런/출석 실데이터에서 서버가 재도출한다.
  assert.match(execute, />=\s*5000/); // arcade-earned-5k
  assert.match(execute, /r\.score\s*>=\s*30000/i); // tetris-30k
  assert.match(execute, /r\.score\s*>=\s*30\b/i); // snake-30
  assert.match(execute, /goldenEaten/);
  assert.match(execute, /maxLineClear/);
  assert.match(execute, /v_streak\s*>=\s*7/i); // attend-7
});

test('migration re-runs safely with guard clauses on every new object', () => {
  const sql = readMigration();
  // constraint re-creation must be drop-guarded
  assert.match(sql, /DROP CONSTRAINT IF EXISTS playground_ledger_kind_valid/i);
  // config seed is conflict-guarded
  assert.match(sql, /ON CONFLICT\s*\(id\)\s*DO NOTHING/i);
  // the read overload is dropped before recreation to keep a single public signature
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.playground_arcade_read\(uuid\)/i);
});
