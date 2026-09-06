import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

export function revisionSetRows(count = 1101) {
  return Array.from({ length: count }, (_, index) => ({
    id: `set-${String(index).padStart(5, '0')}`, title: `Set ${index}`, status: 'open',
    episode_number: 1, department: 'bg', aggregator_id: 'me', created_by: 'me',
    created_at: new Date(Date.UTC(2026, 8, 7) + index * 1000).toISOString(), updated_at: '',
  }));
}

/** Runs the real paginated reader and the real IPC handler without a database or Electron. */
export function revisionSetReadHarness(rows = revisionSetRows(), options: {
  cap?: number; failAt?: number; afterQuery?: (call: number) => void;
} = {}) {
  const source = fs.readFileSync(new URL('../../electron/supabase.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('supabase.ts', source, ts.ScriptTarget.Latest, true);
  const nodes = ast.statements.filter(node => ts.isFunctionDeclaration(node)
    && ['mapRevisionSet', 'readAllRevisionSets'].includes(node.name?.text ?? ''));
  assert.equal(nodes.length, 2);
  const calls: Array<{ after: string | null; order: string; limit: number }> = [];
  let failAt = options.failAt;
  const context = vm.createContext({ exports: {},
    throwIfError: (error: unknown) => { if (error) throw error; },
    supabase: { from: (table: string) => {
      assert.equal(table, 'comp_revision_sets');
      const query = { after: null as string | null, order: '', limit: 1000 };
      const builder = {
        select: (columns: string) => { assert.equal(columns, '*'); return builder; },
        order: (column: string, direction?: { ascending: boolean }) => {
          assert.notEqual(direction?.ascending, false); query.order = column; return builder;
        },
        limit: (limit: number) => { query.limit = limit; return builder; },
        gt: (column: string, after: string) => { assert.equal(column, 'id'); query.after = after; return builder; },
        then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => {
          try {
            calls.push({ ...query }); options.afterQuery?.(calls.length);
            if (calls.length === failAt) { resolve({ data: null, error: new Error('set page unavailable') }); return; }
            const data = rows.filter(row => query.after === null || row.id > query.after)
              .sort((a, b) => {
                const left = a[query.order as keyof typeof a], right = b[query.order as keyof typeof b];
                return left < right ? -1 : left > right ? 1 : 0;
              }).slice(0, Math.min(query.limit, options.cap ?? 1000));
            resolve({ data, error: null });
          } catch (error) { reject(error); }
        },
      };
      return builder;
    } },
  });
  vm.runInContext(compile(nodes.map(node => node.getText(ast)).join('\n')
    + '\nglobalThis.read = readAllRevisionSets;'), context);

  const mainSource = fs.readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const mainAst = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);
  const handler = mainAst.statements.find(node => node.getText(mainAst).startsWith("ipcMain.handle('supabase:read-revision-sets'"));
  assert.ok(handler);
  let userId: string | null = 'me', epoch = 1;
  let ipcRead: () => Promise<any> = async () => { throw new Error('handler not registered'); };
  const mainContext = vm.createContext({
    retakeNotificationService: { captureActor: async () => {
      if (!userId) throw new Error('로그인이 필요해요.'); return { id: userId, epoch };
    } },
    sessionManager: { getCanonicalUserId: () => userId, getEpoch: () => epoch },
    sbReadRevisionSets: context.read,
    ipcMain: { handle: (name: string, callback: () => Promise<any>) => { assert.equal(name, 'supabase:read-revision-sets'); ipcRead = callback; } },
    wrapIpc: (callback: unknown) => callback,
  });
  vm.runInContext(compile(handler.getText(mainAst)), mainContext);
  return { rows, calls, read: context.read as (isCurrent?: () => boolean) => Promise<any[]>,
    ipcRead: () => ipcRead(), clearFailure: () => { failAt = undefined; },
    logout: () => { userId = null; ++epoch; }, switchAwayAndBack: () => { epoch += 2; } };
}
