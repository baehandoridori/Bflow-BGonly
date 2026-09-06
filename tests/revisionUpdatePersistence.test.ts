import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import { assertRevisionUpdated } from '../src/shared/revisionPersistence.ts';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const revision = { id: 'r1', sceneKey: 'EP01:A:1', status: 'open', revisionNo: 1, description: 'fix this', requesterId: 'requester',
  requesterName: 'Requester', assigneeIds: ['me'], notifyUserIds: ['me', 'requester'], assigneeStates: { me: { state: 'pending' } },
  createdAt: '2026-09-07T01:00:00Z', updatedAt: '2026-09-07T01:00:00Z' };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function loadSource(entry: string, dependencies: Record<string, any>) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['zustand', 'sonner', '@/stores/*', '@/services/*', '../stores/useDataStore'] });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)((id: string) => {
    assert.ok(id in dependencies, `unexpected dependency: ${id}`); return dependencies[id];
  }, module, module.exports);
  return module.exports;
}

function loadMainUpdate(persist: (id: string, updates: Record<string, string>) => Promise<{ affected: boolean }>) {
  const source = readFileSync('electron/main.ts', 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(item => item.getText(ast).startsWith("ipcMain.handle('supabase:update-revision'"));
  assert.ok(node);
  let handler!: (...args: any[]) => Promise<any>;
  const effects: string[] = [];
  const context = vm.createContext({
    ipcMain: { handle: (_name: string, callback: typeof handler) => { handler = callback; } },
    wrapIpc: (callback: unknown) => callback, sbUpdateRevision: persist,
    retakeNotificationService: { captureReassignment: async () => ({ id: 'capture' }),
      startReassignmentDelivery: () => effects.push('assignment') },
    arcadeService: { awardActivity: () => effects.push('award') }, currentActivityUser: null,
  });
  vm.runInContext(compile(node.getText(ast)), context);
  return { update: (id: string, updates: Record<string, string>) => handler({}, id, updates), effects };
}

async function workflowHarness(local = false) {
  let canonical: any[] = [clone(revision)]; let freshReads = 0; let listReads = 0; let localWrites = 0;
  let finishUpdate!: () => void;
  let gate = false;
  const dispatches: any[] = [];
  const updates: any[] = [];
  const main = loadMainUpdate(async (id, patch) => {
    updates.push({ id, patch });
    if (gate) await new Promise<void>(resolve => { finishUpdate = resolve; });
    const target = canonical.find(row => row.id === id);
    if (!target) return { affected: false };
    for (const [key, value] of Object.entries(patch)) target[key] = ['assigneeStates', 'assigneeIds'].includes(key) ? JSON.parse(value) : value;
    return { affected: true };
  });
  const dataStore = { getState: () => ({ episodes: [] }), subscribe: () => () => {} };
  const previousWindow = (globalThis as any).window;
  const api = {
    supabaseReadRevisions: async () => { listReads++; return clone(canonical); },
    supabaseReadRevisionById: async (id: string) => { freshReads++; return clone(canonical.find(row => row.id === id) ?? null); },
    supabaseUpdateRevision: main.update,
    supabaseDispatchRetakeAssigneeCompletionNotification: async (payload: any) => { dispatches.push(payload); },
    readSettings: async () => canonical.length ? { [revision.sceneKey]: clone(canonical) } : {},
    writeSettings: async () => { localWrites++; },
  };
  (globalThis as any).window = { electronAPI: api };
  const service = await loadSource('src/services/revisionService.ts', {
    '../stores/useDataStore': { useDataStore: dataStore }, sonner: { toast: { warning: () => { throw new Error('delivery reporting must not handle failed saves'); } } },
  });
  service.setRevisionsSheetsMode(!local);
  const { useRevisionStore: store } = await loadSource('src/stores/useRevisionStore.ts', {
    zustand: { create: createStore }, '@/services/revisionService': service, '@/stores/useDataStore': { useDataStore: dataStore },
  });
  return { service, store, api, main, dispatches, updates,
    listReads: () => listReads, freshReads: () => freshReads, localWrites: () => localWrites,
    deleteCanonical: () => { canonical = []; }, gateUpdate: () => { gate = true; }, releaseUpdate: () => finishUpdate(),
    cleanup: () => { (globalThis as any).window = previousWindow; },
  };
}

test('deletion after the fresh assignee read rolls back an optimistic completion and emits no completion notification', async () => {
  const h = await workflowHarness();
  try {
    await h.store.getState().loadRevisions();
    assert.equal(h.listReads(), 1); h.gateUpdate();
    const completion = h.store.getState().completeAssignee(clone(revision), 'me', 'finished', ['requester'], 'Me');
    await flush();
    assert.equal(h.freshReads(), 1); assert.equal(h.updates.length, 1);
    assert.equal(h.store.getState().revisions[0].status, 'assignee_done', 'optimistic state is visible while persistence is pending');
    h.deleteCanonical(); h.releaseUpdate(); await completion;
    assert.equal(h.listReads(), 2, 'rollback invalidates the cached pre-delete row and reads canonical data');
    assert.deepEqual(h.store.getState().revisions, []);
    assert.deepEqual(h.dispatches, []); assert.deepEqual(h.main.effects, []);
  } finally { h.cleanup(); }
});

test('an affected completion still publishes once and retains the successful optimistic state', async () => {
  const h = await workflowHarness();
  try {
    await h.store.getState().loadRevisions();
    await h.store.getState().completeAssignee(clone(revision), 'me', 'finished', ['requester'], 'Me');
    assert.equal(h.store.getState().revisions[0].status, 'assignee_done');
    assert.equal(h.dispatches.length, 1); assert.equal(h.dispatches[0].revisionId, revision.id);
    assert.deepEqual(h.main.effects, ['award']); assert.equal(h.listReads(), 1);
  } finally { h.cleanup(); }
});

test('start, reassignment, finalization, revert, and ordinary status changes reject missing rows and reload without success side effects', async () => {
  for (const action of ['start', 'reassign', 'final', 'revert-final', 'revert-assignee', 'status']) {
    const h = await workflowHarness();
    try {
      await h.store.getState().loadRevisions(); h.deleteCanonical();
      const state = h.store.getState();
      if (action === 'start') await state.startAssignee(clone(revision), 'me');
      if (action === 'reassign') await state.reassign(clone(revision), ['requester']);
      if (action === 'final') await state.finalResolve(clone(revision), 'Requester');
      if (action === 'revert-final') await state.revertFinalResolve(clone(revision));
      if (action === 'revert-assignee') await state.revertAssignee(clone(revision), 'me');
      if (action === 'status') await state.updateStatus(revision.id, revision.sceneKey, 'resolved');
      assert.deepEqual(h.store.getState().revisions, [], action);
      assert.equal(h.listReads(), 2, action); assert.deepEqual(h.dispatches, [], action); assert.deepEqual(h.main.effects, [], action);
    } finally { h.cleanup(); }
  }
});

test('unknown or malformed update receipts also fail before cache patching or completion delivery', async () => {
  for (const result of [undefined, null, {}, { affected: false }, { affected: 1 }]) {
    const h = await workflowHarness();
    try {
      await h.store.getState().loadRevisions();
      h.api.supabaseUpdateRevision = async () => result as any;
      await assert.rejects(h.service.updateRevisionDetails(clone(revision), { description: 'changed' }), /저장하지 못/);
      const rows = await h.service.getAllRevisions();
      assert.equal(h.listReads(), 2); assert.equal(rows[0].description, revision.description);
      assert.deepEqual(h.dispatches, []);
    } finally { h.cleanup(); }
  }
});

test('local mode refuses absent workflow and status updates without rewriting the settings file', async () => {
  const h = await workflowHarness(true);
  try {
    h.deleteCanonical();
    await assert.rejects(h.service.completeAssigneeWork(clone(revision), 'me', 'done'), /저장하지 못/);
    await assert.rejects(h.service.reassignRevision(clone(revision), ['requester']), /저장하지 못/);
    await assert.rejects(h.service.updateRevisionStatus(revision.id, revision.sceneKey, 'resolved'), /저장하지 못/);
    assert.equal(h.localWrites(), 0); assert.deepEqual(h.dispatches, []);
  } finally { h.cleanup(); }
});

test('the Supabase update adapter emits data-change signals only for actually updated rows', async () => {
  const source = readFileSync('electron/supabase.ts', 'utf8');
  const ast = ts.createSourceFile('supabase.ts', source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'updateRevision');
  assert.ok(node);
  const signals: unknown[] = []; let affected = false;
  const query = { update: () => query, eq: () => query, select: async () => ({ data: affected ? [{ id: 'r1' }] : [], error: null }) };
  const context = vm.createContext({ exports: {}, supabase: { from: () => query },
    throwIfError: (error: unknown) => { if (error) throw error; }, broadcastDataChange: (...args: unknown[]) => signals.push(args),
  });
  vm.runInContext(compile(node.getText(ast)), context);
  assert.equal((await context.exports.updateRevision('r1', { status: 'assignee_done' })).affected, false);
  assert.equal(signals.length, 0);
  affected = true;
  assert.equal((await context.exports.updateRevision('r1', { status: 'assignee_done' })).affected, true);
  assert.equal(signals.length, 1);
});

test('preview returns the same missing/affected receipt and never awards or notifies for a vanished target', async () => {
  const source = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
  const ast = ts.createSourceFile('preview.ts', source, ts.ScriptTarget.Latest, true);
  let property: ts.PropertyAssignment | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'supabaseUpdateRevision') property = node;
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(property);
  let rows: any[] = []; const effects: string[] = [];
  const context = vm.createContext({
    previewRetakeNotifications: { captureReassignment: async () => ({}), startReassignmentDelivery: () => effects.push('assignment') },
    getMockRevisionRows: () => rows, localStore: {},
    window: { dispatchEvent: () => effects.push('invalidate') }, CustomEvent: class {},
    maybeAwardPreviewActivity: () => effects.push('award'),
  });
  vm.runInContext(compile(`globalThis.update = ${property.initializer.getText(ast)}`), context);
  assert.equal((await context.update('r1', { status: 'assignee_done' })).affected, false);
  assert.equal((await context.update('r1', { assigneeIds: '["me"]' })).affected, false);
  assert.deepEqual(effects, []);
  rows = [clone(revision)];
  assert.equal((await context.update('r1', { status: 'assignee_done' })).affected, true);
  assert.deepEqual(effects, ['invalidate', 'award']);
});

test('the generic renderer update wrapper also refuses a missing-row success', async () => {
  const source = readFileSync('src/services/supabaseService.ts', 'utf8');
  const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'updateRevisionInSupabase');
  assert.ok(node);
  let affected = false;
  const context = vm.createContext({ exports: {}, assertRevisionUpdated,
    window: { electronAPI: { supabaseUpdateRevision: async () => ({ affected }) } },
  });
  vm.runInContext(compile(node.getText(ast)), context);
  await assert.rejects(context.exports.updateRevisionInSupabase('r1', { status: 'resolved' }), /저장하지 못/);
  affected = true; await context.exports.updateRevisionInSupabase('r1', { status: 'resolved' });
});
