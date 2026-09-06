import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { selectMyRetakes } from '../src/utils/myRetakes.ts';
import { revisionSetReadHarness, revisionSetRows } from './helpers/revisionSetReadHarness.ts';

test('revision sets pass both the default and lower server caps and keep creation-time ordering', async () => {
  for (const cap of [1000, 200]) {
    const rows = revisionSetRows(); rows[0].created_at = '2026-10-01T00:00:00Z';
    const h = revisionSetReadHarness(rows, { cap });
    const result = await h.ipcRead();
    assert.equal(result.length, 1101); assert.equal(new Set(result.map((row: any) => row.id)).size, 1101);
    assert.equal(result[0].id, 'set-00001'); assert.equal(result.at(-1).id, 'set-00000');
    assert.ok(result.some((row: any) => row.id === 'set-01100' && row.aggregatorId === 'me' && row.episodeNumber === 1));
    assert.ok(h.calls.every(call => call.order === 'id' && call.limit === 500));
    assert.equal(h.calls.length, cap === 200 ? 7 : 4, 'even a short page must be followed by an empty page');
  }
});

test('revision set later-page failures and A-B-A session changes reject partial results through the real IPC', async () => {
  const failed = revisionSetReadHarness(undefined, { cap: 200, failAt: 3 });
  await assert.rejects(failed.ipcRead(), /set page unavailable/); assert.equal(failed.calls.length, 3);
  const stale = revisionSetReadHarness(undefined, { cap: 200, afterQuery: call => { if (call === 2) stale.switchAwayAndBack(); } });
  await assert.rejects(stale.ipcRead(), /로그인이 변경/); assert.equal(stale.calls.length, 2);
  stale.logout(); await assert.rejects(stale.ipcRead(), /로그인이 필요/); assert.equal(stale.calls.length, 2);
});

function compile(source: string) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}

function loadFunctions(file: string, names: string[], bindings: Record<string, unknown>) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const nodes = ast.statements.filter((item) => ts.isFunctionDeclaration(item) && names.includes(item.name?.text ?? ''));
  assert.equal(nodes.length, names.length);
  const context = vm.createContext({ exports: {}, ...bindings });
  vm.runInContext(compile(nodes.map(node => node.getText(ast)).join('\n')
    + `\nglobalThis.loaded = { ${names.join(', ')} };`), context);
  return context.loaded as Record<string, (...args: any[]) => any>;
}

const baseTime = Date.parse('2026-09-07T00:00:00Z');
function makeRows(count = 1101) {
  return Array.from({ length: count }, (_, i) => ({
    id: `revision-${String(i).padStart(5, '0')}`, scene_id: 'EP01:A:1', revision_no: i + 1,
    description: `request ${i}`, status: 'resolved', notify_user_ids: ['me'], assignee_ids: ['me', 'ghost'],
    assignee_states: {}, requester_id: 'other', created_at: new Date(baseTime + (count - i) * 1000).toISOString(),
    set_id: 'set-a',
  }));
}

function databaseHarness(rows = makeRows(), options: { cap?: number; failAt?: number; afterQuery?: (call: number) => void } = {}) {
  const calls: Array<{ id: string | null; after: string | null; order: string; limit: number }> = [];
  const functions = loadFunctions('../electron/supabase.ts', ['readAllRevisions', 'readRevisionById', 'mapRevision'], {
    throwIfError: (error: unknown) => { if (error) throw error; },
    supabase: { from: (table: string) => {
      assert.equal(table, 'comp_revisions');
      const query = { id: null as string | null, after: null as string | null, order: '', limit: 1000 };
      const execute = () => {
        calls.push({ ...query }); options.afterQuery?.(calls.length);
        if (calls.length === options.failAt) return { data: null, error: new Error('database unavailable') };
        if (query.id !== null) return { data: rows.find(row => row.id === query.id) ?? null, error: null };
        const data = rows.filter(row => query.after === null || row.id > query.after)
          .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
          .slice(0, Math.min(query.limit, options.cap ?? 1000));
        return { data, error: null };
      };
      const builder = {
        select: (columns: string) => { assert.equal(columns, '*'); return builder; },
        order: (column: string, options: { ascending: boolean }) => {
          assert.equal(options.ascending, true); query.order = column; return builder;
        },
        limit: (limit: number) => { query.limit = limit; return builder; },
        gt: (column: string, after: string) => { assert.equal(column, 'id'); query.after = after; return builder; },
        eq: (column: string, id: string) => { assert.equal(column, 'id'); query.id = id; return builder; },
        maybeSingle: async () => execute(),
        then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => {
          try { resolve(execute()); } catch (error) { reject(error); }
        },
      };
      return builder;
    } },
  });
  return { ...functions, calls, rows };
}

test('full canonical read passes the 1000-row cap and preserves created-time ordering and canonical workflow state', async () => {
  const h = databaseHarness();
  const rows = await h.readAllRevisions();
  assert.equal(rows.length, 1101);
  assert.equal(new Set(rows.map((row: any) => row.id)).size, 1101);
  assert.equal(rows[0].id, 'revision-01100'); assert.equal(rows.at(-1).id, 'revision-00000');
  assert.deepEqual(h.calls.map(call => call.after), [null, 'revision-00499', 'revision-00999', 'revision-01100']);
  assert.ok(h.calls.every(call => call.order === 'id' && call.limit === 500 && call.id === null));
  assert.equal(rows[0].status, 'open');
  assert.deepEqual(Array.from(rows[0].assigneeIds), ['me']);
  assert.equal(selectMyRetakes(rows, 'me').length, 1101, 'the dashboard receives all outstanding assignments');
});

test('keyset traversal survives a lower server row cap and removal of an earlier page row', async () => {
  const rows = makeRows();
  const h = databaseHarness(rows, { cap: 200, afterQuery: call => { if (call === 2) rows.shift(); } });
  const result = await h.readAllRevisions();
  assert.equal(result.length, 1101);
  assert.equal(new Set(result.map((row: any) => row.id)).size, 1101);
  assert.equal(h.calls.length, 7);
});

test('a failed later page or changed session rejects the full read instead of exposing a partial list', async () => {
  const failed = databaseHarness(makeRows(), { failAt: 2 });
  await assert.rejects(failed.readAllRevisions(), /database unavailable/);
  let current = true;
  const stale = databaseHarness(makeRows(), { afterQuery: () => { current = false; } });
  await assert.rejects(stale.readAllRevisions(() => current), /로그인이 변경/);
  assert.equal(stale.calls.length, 1);
});

test('single lookup finds a target beyond row 1000 using ID directly and distinguishes absence from failure', async () => {
  const h = databaseHarness();
  const target = await h.readRevisionById('revision-01100');
  assert.equal(target.id, 'revision-01100'); assert.equal(target.status, 'open');
  assert.deepEqual(h.calls, [{ id: 'revision-01100', after: null, order: '', limit: 1000 }]);
  assert.equal(await h.readRevisionById('deleted'), null);
  const failed = databaseHarness(makeRows(), { failAt: 1 });
  await assert.rejects(failed.readRevisionById('revision-01100'), /database unavailable/);
});

test('single lookup rejects malformed IDs before querying and rejects a changed session after querying', async () => {
  const h = databaseHarness();
  for (const id of [null, undefined, 123, '', 'r,other', 'x'.repeat(129)]) await assert.rejects(h.readRevisionById(id), /ID/);
  assert.equal(h.calls.length, 0);
  let current = true;
  const stale = databaseHarness(makeRows(), { afterQuery: () => { current = false; } });
  await assert.rejects(stale.readRevisionById('revision-01100', () => current), /로그인이 변경/);
});

function ipcHarness() {
  const source = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const nodes = ast.statements.filter(node => ["ipcMain.handle('supabase:read-revisions'", "ipcMain.handle('supabase:read-revision-by-id'"]
    .some(start => node.getText(ast).startsWith(start)));
  assert.equal(nodes.length, 2);
  let userId: string | null = 'me'; let epoch = 1; let changeDuringRead = false;
  const calls: Array<string | null> = [];
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  const query = async (id: string | null, isCurrent: () => boolean) => {
    assert.equal(isCurrent(), true); calls.push(id);
    if (changeDuringRead) epoch += 2;
    return id ? { id } : [{ id: 'r1' }];
  };
  const context = vm.createContext({
    retakeNotificationService: { captureActor: async () => { if (!userId) throw new Error('로그인이 필요해요.'); return { id: userId, epoch }; } },
    sessionManager: { getCanonicalUserId: () => userId, getEpoch: () => epoch },
    sbReadRevisions: (guard: () => boolean) => query(null, guard),
    sbReadRevisionById: (id: string, guard: () => boolean) => query(id, guard),
    ipcMain: { handle: (name: string, callback: (...args: any[]) => Promise<any>) => handlers.set(name, callback) },
    wrapIpc: (callback: unknown) => callback,
  });
  vm.runInContext(compile(nodes.map(node => node.getText(ast)).join('\n')), context);
  return { calls, read: (id?: string) => id ? handlers.get('supabase:read-revision-by-id')!({}, id) : handlers.get('supabase:read-revisions')!({}),
    logout: () => { userId = null; }, switchDuringRead: () => { changeDuringRead = true; } };
}

test('both read IPCs require canonical login and reject A-B-A responses using the captured epoch', async () => {
  for (const id of [undefined, 'revision-01100']) {
    const h = ipcHarness(); await h.read(id);
    assert.deepEqual(h.calls, [id ?? null]);
    h.switchDuringRead(); await assert.rejects(h.read(id), /로그인이 변경/);
    h.logout(); await assert.rejects(h.read(id), /로그인이 필요/);
    assert.equal(h.calls.length, 2);
  }
});

test('renderer canonical single service never converts missing, malformed, mismatched, or failed responses into deleted rows', async () => {
  let response: unknown = { id: 'target', sceneKey: 'EP01:A:1' }; let failure = false;
  const ids: string[] = [];
  const service = loadFunctions('../src/services/revisionService.ts', ['getCanonicalRevision', 'rowToRevision'], {
    normalizeStoredRevisionSceneKey: (key: string) => key,
    window: { electronAPI: { supabaseReadRevisionById: async (id: string) => {
      ids.push(id); if (failure) throw new Error('offline'); return response;
    } } },
  });
  assert.equal((await service.getCanonicalRevision('target')).id, 'target');
  response = null; assert.equal(await service.getCanonicalRevision('target'), null);
  for (response of [undefined, {}, [], { id: 'different' }, false]) await assert.rejects(service.getCanonicalRevision('target'), /응답/);
  failure = true; await assert.rejects(service.getCanonicalRevision('target'), /offline/);
  assert.ok(ids.every(id => id === 'target'));
});

test('assignee transitions read the target state directly even when it is beyond the first 1000 rows', async () => {
  const database = databaseHarness();
  database.rows[1100].assignee_states = { me: { state: 'in_progress' } };
  const service = loadFunctions('../src/services/revisionService.ts', ['freshAssigneeStates', 'getCanonicalRevision', 'rowToRevision'], {
    sheetsMode: true, normalizeStoredRevisionSceneKey: (key: string) => key,
    window: { electronAPI: { supabaseReadRevisionById: database.readRevisionById } },
  });
  const states = await service.freshAssigneeStates({ id: 'revision-01100', assigneeStates: { me: { state: 'pending' } } });
  assert.equal(states.me.state, 'in_progress');
  assert.equal(database.calls.length, 1); assert.equal(database.calls[0].id, 'revision-01100');
});

test('preview revision and set reads use canonical login and return full-list tail targets without a row cap', async () => {
  const source = fs.readFileSync(new URL('../src/mocks/devElectronAPI.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('preview.ts', source, ts.ScriptTarget.Latest, true);
  const properties = new Map<string, ts.PropertyAssignment>();
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ['supabaseReadRevisions', 'supabaseReadRevisionById', 'supabaseReadRevisionSets'].includes(node.name.getText(ast))) properties.set(node.name.getText(ast), node);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(properties.size, 3);
  let loggedIn = true;
  const rows = makeRows();
  const sets = revisionSetRows().map(row => ({ id: row.id, createdAt: row.created_at })).reverse();
  const context = vm.createContext({ getMockRevisionRows: () => rows, getMockRevisionSets: () => sets,
    requireMockCalendarUser: () => { if (!loggedIn) throw new Error('로그인이 필요해요.'); return { id: 'me' }; },
  });
  for (const [name, node] of properties) vm.runInContext(compile(`globalThis.${name} = ${node.initializer.getText(ast)};`), context);
  assert.equal((await context.supabaseReadRevisions()).length, 1101);
  const previewSets = await context.supabaseReadRevisionSets();
  assert.equal(previewSets.length, 1101); assert.equal(previewSets.at(-1).id, 'set-01100');
  assert.equal(sets[0].id, 'set-01100', 'read ordering does not mutate preview storage');
  assert.equal((await context.supabaseReadRevisionById('revision-01100')).id, 'revision-01100');
  assert.equal(await context.supabaseReadRevisionById('deleted'), null);
  await assert.rejects(context.supabaseReadRevisionById(undefined), /ID/);
  loggedIn = false;
  await assert.rejects(context.supabaseReadRevisions(), /로그인이 필요/);
  await assert.rejects(context.supabaseReadRevisionSets(), /로그인이 필요/);
  await assert.rejects(context.supabaseReadRevisionById('revision-01100'), /로그인이 필요/);
});
