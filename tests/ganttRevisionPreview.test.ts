import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewGateway } from '../src/features/gantt/previewGateway.ts';
import { createProject, createSpace, createTask } from '../src/features/gantt/domain.ts';
import { createGanttStore } from '../src/features/gantt/useGanttStore.ts';
import type { GanttCommand } from '../src/features/gantt/types.ts';

function setup() {
  const rows = new Map<string, string>();
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
  let tail = Promise.resolve();
  const locks = { request<T>(_key: string, run: () => Promise<T>) { const result = tail.then(run); tail = result.then(() => undefined, () => undefined); return result; } };
  const options = { storage, locks, seed: false };
  const gateway = createPreviewGateway('alice', options);
  const execute = (command: GanttCommand) => gateway.execute({ requestId: crypto.randomUUID(), command });
  return { options, gateway, execute };
}

test('persisted preview clocks reject stale project saves across repeated deletion and restoration', async () => {
  const { options, execute } = setup();
  const space = createSpace('폴더', 'alice'), project = createProject('프로젝트', space.id, 'alice');
  project.tasks = [createTask('이전 작업', '2026-09-06')];
  await execute({ type: 'saveSpace', space, expectedRevision: null });
  await execute({ type: 'saveProject', project, expectedRevision: null });
  let current = (await execute({ type: 'saveProject', project: { ...project, tasks: [...project.tasks, createTask('추가 작업', '2026-09-07')] }, expectedRevision: 1 })).projects[0];
  for (let attempt = 0; attempt < 3; attempt++) {
    await execute({ type: 'deleteProject', projectId: project.id, expectedRevision: current.revision });
    const fresh = createPreviewGateway('alice', options);
    const restored = (await fresh.execute({ requestId: crypto.randomUUID(), command: { type: 'saveProject', project: { ...current, revision: 1 }, expectedRevision: null } })).projects[0];
    assert.equal(restored.revision, current.revision + 1);
    await assert.rejects(execute({ type: 'saveProject', project, expectedRevision: 1 }), /다른 변경/);
    current = restored;
  }
  assert.equal(current.tasks.length, 2);
  assert.deepEqual(Object.keys(await createPreviewGateway('bob', options).read()).sort(), ['projects', 'spaces']);
});

test('undo and redo accept authoritative restoration clocks without losing earlier history', async () => {
  const { gateway } = setup(), store = createGanttStore();
  await store.getState().initialize('alice', gateway);
  const space = createSpace('원본', 'alice');
  await store.getState().execute({ type: 'saveSpace', space, expectedRevision: null });
  await store.getState().execute({ type: 'saveSpace', space: { ...space, name: '수정' }, expectedRevision: 1 });
  await store.getState().undo(); await store.getState().undo();
  for (let attempt = 0; attempt < 3; attempt++) {
    await store.getState().redo(); await store.getState().redo();
    assert.equal(store.getState().snapshot.spaces[0].name, '수정');
    const revision = store.getState().snapshot.spaces[0].revision;
    assert.ok(revision > 3);
    await store.getState().undo(); await store.getState().undo();
    assert.equal(store.getState().snapshot.spaces.length, 0);
  }
  await store.getState().initialize(null);
});

test('restoration never blesses remote project content returned alongside an allocated revision', async () => {
  const { gateway, execute } = setup(), store = createGanttStore();
  const space = createSpace('폴더', 'alice'), project = createProject('프로젝트', space.id, 'alice');
  await execute({ type: 'saveSpace', space, expectedRevision: null });
  let inject = false;
  await store.getState().initialize('alice', { read: gateway.read, execute: async request => {
    const committed = await gateway.execute(request);
    if (inject && request.command.type === 'saveProject') {
      inject = false;
      const restored = committed.projects[0];
      return execute({ type: 'saveProject', project: { ...restored, tasks: [createTask('다른 창의 작업', '2026-09-08')] }, expectedRevision: restored.revision });
    }
    return committed;
  } });
  await store.getState().execute({ type: 'saveProject', project, expectedRevision: null });
  await store.getState().undo();
  inject = true; await store.getState().redo();
  await assert.rejects(store.getState().undo(), /다른 변경/);
  assert.equal((await gateway.read()).projects[0].tasks[0].title, '다른 창의 작업');
  await store.getState().initialize(null);
});

test('legacy preview authority bootstraps clocks once from server-equivalent receipt revisions', async () => {
  const { options } = setup(), space = createSpace('폴더', 'alice');
  const key = 'bflow-gantt-preview-authority-v1';
  options.storage.setItem(key, JSON.stringify({ snapshot: { spaces: [space], projects: [] }, seededUsers: [], receipts: {
    previous: { actorId: 'alice', command: JSON.stringify({ type: 'saveSpace', space: { ...space, revision: 99999 }, expectedRevision: 4 }) },
  } }));
  const gateway = createPreviewGateway('alice', options);
  const upgraded = (await gateway.read()).spaces[0];
  assert.equal(upgraded.revision, 6);
  await assert.rejects(gateway.execute({ requestId: 'stale', command: { type: 'saveSpace', space, expectedRevision: 1 } }), /다른 변경/);
  const saved = await gateway.execute({ requestId: 'fresh', command: { type: 'saveSpace', space: upgraded, expectedRevision: upgraded.revision } });
  assert.equal(saved.spaces[0].revision, 7);
  assert.equal((await createPreviewGateway('alice', options).read()).spaces[0].revision, 7);
});

test('failed persistence does not consume a restoration revision', async () => {
  const { options, execute } = setup(), space = createSpace('폴더', 'alice');
  await execute({ type: 'saveSpace', space, expectedRevision: null });
  await execute({ type: 'deleteSpace', spaceId: space.id, expectedRevision: 1 });
  const failing = createPreviewGateway('alice', { ...options, storage: { ...options.storage, setItem() { throw new Error('disk full'); } } });
  const request = { requestId: 'restore', command: { type: 'saveSpace' as const, space, expectedRevision: null } };
  await assert.rejects(failing.execute(request), /disk full/);
  const restored = await createPreviewGateway('alice', options).execute(request);
  assert.equal(restored.spaces[0].revision, 2);
});

test('legacy deleted IDs are retired while post-upgrade tombstones remain restorable', async () => {
  const { options } = setup(), space = createSpace('과거 폴더', 'alice');
  options.storage.setItem('bflow-gantt-preview-authority-v1', JSON.stringify({ snapshot: { spaces: [], projects: [] }, seededUsers: [], receipts: {
    deleted: { actorId: 'alice', command: JSON.stringify({ type: 'deleteSpace', spaceId: space.id, expectedRevision: 4 }) },
  } }));
  const gateway = createPreviewGateway('alice', options);
  await assert.rejects(gateway.execute({ requestId: 'restore-old', command: { type: 'saveSpace', space, expectedRevision: null } }), /이전 버전.*복원/);
  const fresh = { ...space, id: crypto.randomUUID() };
  await gateway.execute({ requestId: 'new', command: { type: 'saveSpace', space: fresh, expectedRevision: null } });
  await gateway.execute({ requestId: 'delete-new', command: { type: 'deleteSpace', spaceId: fresh.id, expectedRevision: 1 } });
  const restored = await createPreviewGateway('alice', options).execute({ requestId: 'restore-new', command: { type: 'saveSpace', space: fresh, expectedRevision: null } });
  assert.equal(restored.spaces[0].revision, 2);
});
