import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as summary from '../src/shared/characterCommentSummary.ts';
import { __resetCommentReadStateServiceForTests, __setCommentReadStatePersistenceForTests, getCommentReadStateForUser } from '../src/services/commentReadStateService.ts';

function compile(source: string) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}

function loadFunction(file: string, name: string, bindings: Record<string, unknown>) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node);
  const context = vm.createContext({ exports: {}, ...summary, ...bindings });
  vm.runInContext(compile(node.getText(ast)), context);
  return context.exports[name] as (...args: any[]) => Promise<summary.CharacterCommentSummaries>;
}

type Row = { id: string; character_id: string; user_id: string | null; created_at: string; text?: string };
function databaseHarness(rows: Row[], afterQuery?: (call: number) => void, serverCap = 1000) {
  const calls: Array<{ columns: string; ids: string[]; limit: number; after: string | null; order: string }> = [];
  const read = loadFunction('../electron/supabase.ts', 'readCharacterCommentSummaries', {
    throwIfError: (error: unknown) => { if (error) throw error; },
    supabase: { from: (table: string) => {
      assert.equal(table, 'comments');
      const query = { columns: '', ids: [] as string[], limit: 0, after: null as string | null, order: '' };
      const builder = {
        select: (columns: string) => { query.columns = columns; return builder; },
        in: (column: string, ids: string[]) => { assert.equal(column, 'character_id'); query.ids = [...ids]; return builder; },
        order: (column: string, options: { ascending: boolean }) => { assert.equal(options.ascending, true); query.order = column; return builder; },
        limit: (limit: number) => { query.limit = limit; return builder; },
        gt: (column: string, after: string) => { assert.equal(column, 'id'); query.after = after; return builder; },
        then: (resolve: (result: unknown) => void, reject: (error: unknown) => void) => {
          try {
            calls.push({ ...query }); afterQuery?.(calls.length);
            const data = rows.filter((row) => query.ids.includes(row.character_id) && (!query.after || row.id > query.after))
              .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, Math.min(query.limit, serverCap))
              .map((row) => Object.fromEntries(query.columns.split(',').map((column) => [column, row[column as keyof Row]])));
            resolve({ data, error: null });
          } catch (error) { reject(error); }
        },
      };
      return builder;
    } },
  });
  return { read, calls };
}

test('summary request IDs are bounded, validated, and deduplicated without changing order', () => {
  assert.deepEqual(summary.validateCharacterCommentIds(['char-2', 'char-1', 'char-2']), ['char-2', 'char-1']);
  assert.equal(summary.validateCharacterCommentIds(Array.from({ length: 200 }, (_, i) => `char-${i}`)).length, 200);
  for (const invalid of [null, {}, 'char-1', [''], [' char-1'], ['id,other'], [7], ['a'.repeat(129)], Array(201).fill('char-1')]) {
    assert.throws(() => summary.validateCharacterCommentIds(invalid));
  }
});

test('shared summaries count all comments while latest unread excludes own comments and invalid timestamps', () => {
  const result = summary.createCharacterCommentSummaries(['char-1', 'empty', 'constructor']);
  summary.addCharacterCommentSummaryRows(result, [
    { characterId: 'char-1', userId: 'other', createdAt: '2026-09-07T10:00:00+09:00' },
    { characterId: 'char-1', userId: 'self', createdAt: '2026-09-08T00:00:00Z' },
    { characterId: 'char-1', userId: 'other', createdAt: 'invalid' },
    { characterId: 'char-1', userId: null, createdAt: '2026-09-07T02:00:00Z' },
    { characterId: 'unrequested', userId: 'other', createdAt: '2026-09-09T00:00:00Z' },
    { characterId: 'toString', userId: 'other' },
    { characterId: 'constructor', userId: 'self' },
  ], 'self');
  assert.deepEqual(result['char-1'], { count: 4, latestOtherCreatedAt: '2026-09-07T02:00:00.000Z' });
  assert.deepEqual(result.empty, { count: 0, latestOtherCreatedAt: null });
  assert.deepEqual(result.constructor, { count: 1, latestOtherCreatedAt: null });
  assert.equal(Object.hasOwn(result, 'toString'), false);
});

test('bulk query passes 1000 rows using ordered cursors and never selects comment bodies', async () => {
  const base = Date.parse('2026-09-07T00:00:00Z');
  const rows: Row[] = Array.from({ length: 1101 }, (_, i) => ({
    id: String(i).padStart(5, '0'), character_id: 'char-1', user_id: i % 2 ? 'other' : 'self',
    created_at: new Date(base + i).toISOString(), text: 'body must not be fetched',
  }));
  rows.push({ id: '99999', character_id: 'char-2', user_id: 'self', created_at: '2026-09-08T00:00:00Z' });
  rows.push({ id: '99998', character_id: 'unrequested', user_id: 'other', created_at: '2026-09-08T00:00:00Z' });
  const h = databaseHarness(rows.reverse());
  const result = await h.read(['char-1', 'char-2', 'empty'], 'self');
  assert.equal(result['char-1'].count, 1101);
  assert.equal(result['char-1'].latestOtherCreatedAt, new Date(base + 1099).toISOString());
  assert.equal(result['char-2'].count, 1); assert.equal(result['char-2'].latestOtherCreatedAt, null);
  assert.equal(result.empty.count, 0);
  assert.equal(h.calls.length, 4);
  assert.deepEqual(h.calls.map((call) => call.after), [null, '00499', '00999', '99999']);
  for (const call of h.calls) {
    assert.equal(call.columns, 'id,character_id,user_id,created_at');
    assert.equal(call.limit, 500); assert.equal(call.order, 'id');
    assert.deepEqual(call.ids, ['char-1', 'char-2', 'empty']);
  }
});

test('a lower server cap still counts every comment and finds the latest other-author timestamp', async () => {
  const base = Date.parse('2026-09-07T00:00:00Z');
  const rows: Row[] = Array.from({ length: 451 }, (_, i) => ({
    id: String(i).padStart(5, '0'), character_id: 'char-1', user_id: i % 2 ? 'other' : 'self',
    created_at: new Date(base + i).toISOString(),
  }));
  const h = databaseHarness(rows.reverse(), undefined, 200);
  const result = await h.read(['char-1', 'empty'], 'self');
  assert.equal(result['char-1'].count, 451);
  assert.equal(result['char-1'].latestOtherCreatedAt, new Date(base + 449).toISOString());
  assert.equal(result.empty.count, 0);
  assert.deepEqual(h.calls.map(call => call.after), [null, '00199', '00399', '00450']);
});

test('bulk query bounds filter URL size and an empty request performs no database read', async () => {
  const h = databaseHarness([]);
  const ids = Array.from({ length: 200 }, (_, i) => `char-${i}`);
  const result = await h.read(ids, 'self');
  assert.equal(Object.keys(result).length, 200);
  assert.deepEqual(h.calls.map((call) => call.ids.length), [100, 100]);
  const empty = databaseHarness([]);
  assert.equal(Object.keys(await empty.read([], 'self')).length, 0);
  assert.equal(empty.calls.length, 0);
  await assert.rejects(empty.read(Array(201).fill('char-1'), 'self'));
  assert.equal(empty.calls.length, 0);
});

test('failed later pages and session changes reject the whole summary rather than returning partial counts', async () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({ id: String(i).padStart(5, '0'), character_id: 'char-1', user_id: 'other', created_at: '2026-09-07T00:00:00Z' }));
  const failed = databaseHarness(rows, (call) => { if (call === 2) throw new Error('page failed'); });
  await assert.rejects(failed.read(['char-1'], 'self'), /page failed/);
  let current = true;
  const switched = databaseHarness(rows, () => { current = false; });
  await assert.rejects(switched.read(['char-1'], 'self', () => current), /로그인이 변경/);
  assert.equal(switched.calls.length, 1);
});

function ipcHarness() {
  const source = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find((item) => item.getText(ast).startsWith("ipcMain.handle('supabase:character-comment-summaries'"));
  assert.ok(node);
  let userId: string | null = 'self'; let epoch = 1; let switchAfterQuery = false;
  const calls: Array<{ ids: string[]; actorId: string }> = [];
  let handler!: (...args: unknown[]) => Promise<summary.CharacterCommentSummaries>;
  const context = vm.createContext({ ...summary,
    ipcMain: { handle: (_name: string, callback: typeof handler) => { handler = callback; } },
    wrapIpc: (callback: unknown) => callback,
    sessionManager: {
      ensure: async () => ({ ok: true, payload: { user: userId ? { id: userId } : null, epoch } }),
      getCanonicalUserId: () => userId, getEpoch: () => epoch,
    },
    sbReadCharacterCommentSummaries: async (ids: string[], actorId: string, isCurrent: () => boolean) => {
      calls.push({ ids: [...ids], actorId }); assert.equal(isCurrent(), true);
      if (switchAfterQuery) epoch += 2;
      return summary.createCharacterCommentSummaries(ids);
    },
  });
  vm.runInContext(compile(node.getText(ast)), context);
  return { calls, read: (...args: unknown[]) => handler({}, ...args), logout: () => { userId = null; }, switchAfterQuery: () => { switchAfterQuery = true; } };
}

test('main uses only canonical user identity and validates inputs before any query', async () => {
  const h = ipcHarness();
  await h.read(['char-1', 'char-1'], 'forged-user');
  assert.deepEqual(h.calls, [{ ids: ['char-1'], actorId: 'self' }]);
  await assert.rejects(h.read(['invalid,query']));
  assert.equal(h.calls.length, 1);
  h.logout();
  await assert.rejects(h.read(['char-1']), /로그인이 필요/);
  assert.equal(h.calls.length, 1);
});

test('main refuses a completed summary after an A-B-A session transition', async () => {
  const h = ipcHarness(); h.switchAfterQuery();
  await assert.rejects(h.read(['char-1']), /로그인이 변경/);
});

test('preview uses the same validation and aggregation with its canonical actor', async () => {
  const source = fs.readFileSync(new URL('../src/mocks/devElectronAPI.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('preview.ts', source, ts.ScriptTarget.Latest, true);
  let property: ts.PropertyAssignment | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'getCharacterCommentSummaries') property = node;
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(property);
  const context = vm.createContext({ ...summary, previewCanonicalUserId: 'self', previewCanonicalEpoch: 1,
    requireMockCalendarUser: () => ({ id: 'self' }),
    getMockCommentRows: () => [
      { characterId: 'mock-char-1', userId: 'self', createdAt: '2026-09-08T00:00:00Z', text: 'own' },
      { characterId: 'mock-char-1', userId: 'other', createdAt: '2026-09-07T00:00:00Z', text: 'other' },
    ],
  });
  vm.runInContext(compile(`globalThis.read = ${property.initializer.getText(ast)};`), context);
  const result = await context.read(['mock-char-1', 'empty']);
  assert.deepEqual(result['mock-char-1'], { count: 2, latestOtherCreatedAt: '2026-09-07T00:00:00.000Z' });
  assert.deepEqual(result.empty, { count: 0, latestOtherCreatedAt: null });
  await assert.rejects(context.read(Array(201).fill('mock-char-1')));
});

function readStateDatabaseHarness(options: { serverCap?: number; failAt?: number; afterQuery?: (call: number) => void } = {}) {
  const base = Date.parse('2026-09-07T00:00:00Z');
  const rows = Array.from({ length: 1101 }, (_, i) => ({ user_id: 'self', scene_thread_key: `char:${String(i).padStart(5, '0')}`,
    last_read_at: new Date(base + i).toISOString(), updated_at: new Date(base + i).toISOString() }));
  rows.push({ ...rows[0], user_id: 'other' });
  const calls: Array<{ userId: string; after: string | null; limit: number }> = [];
  const read = loadFunction('../electron/supabase.ts', 'readCommentReadStates', {
    throwIfError: (error: unknown) => { if (error) throw error; },
    supabase: { from: (table: string) => {
      assert.equal(table, 'comment_read_states');
      const query = { userId: '', after: null as string | null, limit: 1000 };
      const builder = {
        select: (columns: string) => { assert.equal(columns, 'user_id, scene_thread_key, last_read_at, updated_at'); return builder; },
        eq: (column: string, userId: string) => { assert.equal(column, 'user_id'); query.userId = userId; return builder; },
        order: (column: string, options: { ascending: boolean }) => {
          assert.equal(column, 'scene_thread_key'); assert.equal(options.ascending, true); return builder;
        },
        gt: (column: string, key: string) => { assert.equal(column, 'scene_thread_key'); query.after = key; return builder; },
        limit: (limit: number) => { query.limit = limit; return builder; },
        then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => {
          try {
            calls.push({ ...query }); options.afterQuery?.(calls.length);
            if (calls.length === options.failAt) return resolve({ data: null, error: new Error('read-state page failed') });
            const data = rows.filter(row => row.user_id === query.userId && (query.after === null || row.scene_thread_key > query.after))
              .sort((a, b) => a.scene_thread_key < b.scene_thread_key ? -1 : 1).slice(0, Math.min(query.limit, options.serverCap ?? 1000));
            resolve({ data, error: null });
          } catch (error) { reject(error); }
        },
      };
      return builder;
    } },
  }) as (...args: any[]) => Promise<any[]>;
  return { read, calls, rows };
}

test('read-state pages pass 1000 keys and a lower server cap while retaining unique keys and newest-update ordering', async () => {
  for (const serverCap of [1000, 200]) {
    const h = readStateDatabaseHarness({ serverCap });
    const states = await h.read(' self ');
    assert.equal(states.length, 1101); assert.ok(states.every(row => row.userId === 'self'));
    assert.equal(new Set(states.map(row => row.sceneThreadKey)).size, 1101);
    assert.equal(states[0].sceneThreadKey, 'char:01100'); assert.equal(states.at(-1).sceneThreadKey, 'char:00000');
    assert.equal(h.calls.at(-1)?.after, 'char:01100', 'the final empty page proves the lower cap did not truncate the result');
    assert.equal(h.calls.length, serverCap === 200 ? 7 : 4);
    assert.ok(h.calls.every(call => call.userId === 'self' && call.limit === 500));
  }
});

test('read-state paging rejects later-page failures and session changes without returning partial state', async () => {
  const failed = readStateDatabaseHarness({ serverCap: 200, failAt: 2 });
  await assert.rejects(failed.read('self'), /read-state page failed/);
  let current = true;
  const stale = readStateDatabaseHarness({ serverCap: 200, afterQuery: call => { if (call === 2) current = false; } });
  await assert.rejects(stale.read('self', () => current), /로그인이 변경/);
  assert.equal(stale.calls.length, 2);
});

test('canonical read-state IPC rejects another user and discards late A-B-A results before renderer cache hydration', async () => {
  const source = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(item => item.getText(ast).startsWith("ipcMain.handle('supabase:read-comment-read-states'"));
  assert.ok(node);
  let actorId: string | null = 'self'; let epoch = 1; let finish!: () => void; let queryCalls = 0;
  let handler!: (...args: any[]) => Promise<any[]>;
  const context = vm.createContext({
    ipcMain: { handle: (_name: string, callback: typeof handler) => { handler = callback; } }, wrapIpc: (callback: unknown) => callback,
    sessionManager: { ensure: async () => ({ ok: true, payload: { user: actorId ? { id: actorId } : null, epoch } }),
      getCanonicalUserId: () => actorId, getEpoch: () => epoch },
    sbReadCommentReadStates: async (userId: string, isCurrent: () => boolean) => {
      assert.equal(userId, 'self'); assert.equal(isCurrent(), true); queryCalls++;
      await new Promise<void>(resolve => { finish = resolve; });
      return [{ userId, sceneThreadKey: 'char:late', lastReadAt: '2026-09-07T00:00:00Z' }];
    },
  });
  vm.runInContext(compile(node.getText(ast)), context);
  await assert.rejects(handler({}, 'other'), /현재 로그인한 사용자/); assert.equal(queryCalls, 0);
  __resetCommentReadStateServiceForTests();
  try {
    __setCommentReadStatePersistenceForTests({ read: userId => handler({}, userId), upsert: async () => {} });
    const pending = getCommentReadStateForUser('self', { throwOnReadError: true });
    const rejected = assert.rejects(pending, /로그인이 변경/);
    await new Promise<void>(resolve => setImmediate(resolve));
    epoch += 2; finish(); await rejected;
    __setCommentReadStatePersistenceForTests({ read: async () => [], upsert: async () => {} });
    assert.deepEqual(await getCommentReadStateForUser('self'), {});
    assert.deepEqual(await getCommentReadStateForUser('other'), {});
    actorId = null; await assert.rejects(handler({}, 'self'), /로그인이 필요/); assert.equal(queryCalls, 1);
  } finally { __resetCommentReadStateServiceForTests(); }
});

test('preview read-state requests accept only the canonical user while keeping all existing rows', async () => {
  const source = fs.readFileSync(new URL('../src/mocks/devElectronAPI.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('preview.ts', source, ts.ScriptTarget.Latest, true);
  let property: ts.PropertyAssignment | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'supabaseReadCommentReadStates') property = node;
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(property);
  const calls: string[] = [];
  const rows = Array.from({ length: 1101 }, (_, i) => ({ userId: 'self', sceneThreadKey: `char:${i}` }));
  const context = vm.createContext({ requireMockCalendarUser: () => ({ id: 'self' }),
    getMockCommentReadStates: (id: string) => { calls.push(id); return rows; } });
  vm.runInContext(compile(`globalThis.read = ${property.initializer.getText(ast)};`), context);
  assert.equal((await context.read('self')).length, 1101);
  await assert.rejects(context.read('other'), /현재 로그인한 사용자/);
  assert.deepEqual(calls, ['self']);
});
