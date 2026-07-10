import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(
  root,
  'DEVLOG',
  'migrations',
  '2026-07-11-personal-todo-personalization.sql',
);

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8');
}

function readStoredMigration(fileName: string): string {
  return readFileSync(path.join(root, 'DEVLOG', 'migrations', fileName), 'utf8');
}

function functionDefinition(sql: string, functionName: string): string {
  const match = sql.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`, 'i'),
  );
  assert.ok(match, `${functionName} must be defined`);
  return match[0];
}

test('migration adds canonical personal todo columns and compatibility constraints', () => {
  const sql = readMigration();

  assert.match(sql, /ADD COLUMN IF NOT EXISTS status\s+text\s+NOT NULL\s+DEFAULT\s+'todo'/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS priority\s+text\s+NOT NULL\s+DEFAULT\s+'none'/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS pinned\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS label_ids\s+uuid\[\]\s+NOT NULL\s+DEFAULT\s+(?:'\{\}'|ARRAY\[\]::uuid\[\])/i);
  assert.match(sql, /CHECK\s*\(status\s+IN\s*\('todo',\s*'doing',\s*'done'\)\)/i);
  assert.match(sql, /CHECK\s*\(priority\s+IN\s*\('high',\s*'medium',\s*'low',\s*'none'\)\)/i);
});

test('status trigger keeps legacy completed writes compatible and prefers status writes', () => {
  const sql = readMigration();
  const triggerFunction = functionDefinition(sql, 'sync_personal_todo_status_completed');

  assert.match(
    triggerFunction,
    /NEW\.status\s+IS DISTINCT FROM\s+OLD\.status[\s\S]*?NEW\.completed\s*:=\s*\(NEW\.status\s*=\s*'done'\)[\s\S]*?NEW\.completed\s+IS DISTINCT FROM\s+OLD\.completed[\s\S]*?NEW\.status\s*:=\s*CASE/i,
  );
  assert.match(triggerFunction, /NEW\.completed\s*:=\s*\(NEW\.status\s*=\s*'done'\)/i);
  assert.match(sql, /DROP TRIGGER IF EXISTS personal_todos_status_completed_sync ON public\.personal_todos/i);
  assert.match(
    sql,
    /CREATE TRIGGER personal_todos_status_completed_sync\s+BEFORE INSERT OR UPDATE ON public\.personal_todos/i,
  );
});

test('patch RPC scopes writes to the owner and preserves validated label order', () => {
  const sql = readMigration();
  const definition = functionDefinition(sql, 'patch_personal_todo');

  assert.match(
    definition,
    /patch_personal_todo\s*\(\s*p_todo_id\s+uuid\s*,\s*p_user_id\s+text\s*,\s*p_patch\s+jsonb\s*\)/i,
  );
  assert.match(definition, /SECURITY INVOKER/i);
  assert.match(definition, /WITH ORDINALITY\s+AS\s+requested\s*\(raw_id,\s*ord\)/i);
  assert.match(definition, /array_agg\(label\.id\s+ORDER BY\s+ord\)/i);
  assert.match(definition, /label\.user_id\s*=\s*p_user_id/i);
  assert.match(
    definition,
    /WHERE\s+todo\.id\s*=\s*p_todo_id\s+AND\s+todo\.user_id\s*=\s*p_user_id/i,
  );
});

test('order RPC validates unique owned full-set ids before reindexing every row', () => {
  const sql = readMigration();
  const definition = functionDefinition(sql, 'mutate_personal_todo_order');

  assert.match(
    definition,
    /mutate_personal_todo_order\s*\(\s*p_user_id\s+text\s*,\s*p_mutation\s+jsonb\s*,\s*p_ordered_ids\s+uuid\[\]\s*\)/i,
  );
  assert.match(definition, /SECURITY INVOKER/i);
  assert.match(definition, /COUNT\s*\(DISTINCT\s+ordered_id\)/i);
  assert.match(definition, /todo\.user_id\s*=\s*p_user_id/i);
  assert.match(definition, /cardinality\s*\(p_ordered_ids\)\s*<>\s*v_server_count/i);
  for (const mutationType of ['add', 'delete', 'pin', 'status', 'reorder']) {
    assert.match(definition, new RegExp(`WHEN\\s+'${mutationType}'`, 'i'));
  }
  assert.match(definition, /WITH ORDINALITY\s+AS\s+requested\s*\(todo_id,\s*ord\)/i);
  assert.match(definition, /SET\s+sort_order\s*=\s*requested\.ord\s*-\s*1/i);
});

test('label schema is user-owned, cascade-cleaned, normalized, and non-deletable by clients', () => {
  const sql = readMigration();

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.personal_todo_labels/i);
  assert.match(sql, /user_id\s+text\s+NOT NULL\s+REFERENCES public\.users\s*\(id\)\s+ON DELETE CASCADE/i);
  assert.match(sql, /CHECK\s*\(color_key\s+IN\s*\('violet',\s*'blue',\s*'green',\s*'yellow',\s*'orange',\s*'red',\s*'pink',\s*'gray'\)\)/i);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS personal_todo_labels_user_normalized_name_key[\s\S]*?\(user_id,\s*lower\s*\(btrim\s*\(name\)\)\)/i,
  );
  assert.match(sql, /ALTER TABLE public\.personal_todo_labels ENABLE ROW LEVEL SECURITY/i);
  assert.match(
    sql,
    /CREATE POLICY "?allow_all"? ON public\.personal_todo_labels\s+FOR ALL\s+USING \(true\)\s+WITH CHECK \(true\)/i,
  );
  assert.match(
    sql,
    /REVOKE ALL PRIVILEGES ON TABLE public\.personal_todo_labels FROM anon, authenticated/i,
  );
  assert.match(
    sql,
    /GRANT SELECT, INSERT, UPDATE ON TABLE public\.personal_todo_labels TO anon, authenticated/i,
  );
  assert.doesNotMatch(
    sql,
    /GRANT[^;]*\bDELETE\b[^;]*ON TABLE public\.personal_todo_labels[^;]*TO (?:anon|authenticated)/i,
  );
});

test('label mutations enforce user ownership and attach without reordering existing ids', () => {
  const sql = readMigration();
  const createAndAttach = functionDefinition(sql, 'create_or_reuse_personal_todo_label_and_attach');
  const updateLabel = functionDefinition(sql, 'update_personal_todo_label');

  for (const definition of [createAndAttach, updateLabel]) {
    assert.match(definition, /SECURITY INVOKER/i);
    assert.match(definition, /user_id\s*=\s*p_user_id/i);
  }
  assert.match(createAndAttach, /array_append\s*\(todo\.label_ids,\s*v_label\.id\)/i);
  assert.match(createAndAttach, /v_label\.id\s*=\s*ANY\s*\(todo\.label_ids\)/i);
  assert.match(updateLabel, /label\.id\s*=\s*p_label_id/i);
});

test('all public RPCs are invoker functions with PUBLIC execute revoked', () => {
  const sql = readMigration();
  const rpcNames = [
    'patch_personal_todo',
    'mutate_personal_todo_order',
    'create_or_reuse_personal_todo_label_and_attach',
    'update_personal_todo_label',
  ];

  for (const rpcName of rpcNames) {
    assert.match(functionDefinition(sql, rpcName), /SECURITY INVOKER/i);
    assert.match(
      sql,
      new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${rpcName}\\([^;]+\\) FROM PUBLIC`, 'i'),
    );
  }
});

test('stored delete-user RPCs rely on label FK cascade instead of direct label deletes', () => {
  for (const fileName of [
    '2026-04-30_delete_user_cascade_rpc.sql',
    '2026-06-29-character-board-asset-workflow.sql',
  ]) {
    const sql = readStoredMigration(fileName);
    assert.match(sql, /DELETE FROM personal_todos\s+WHERE user_id\s*=\s*p_user_id/i);
    assert.match(sql, /DELETE FROM users WHERE id\s*=\s*p_user_id/i);
    assert.doesNotMatch(sql, /DELETE FROM (?:public\.)?personal_todo_labels/i);
  }
});
