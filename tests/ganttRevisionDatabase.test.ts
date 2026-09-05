import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createProject, createSpace, createTask } from '../src/features/gantt/domain.ts';
import { createGanttStore } from '../src/features/gantt/useGanttStore.ts';
import type { GanttCommand, GanttSnapshot } from '../src/features/gantt/types.ts';

const runtime = process.env.BFLOW_PGLITE_MODULE;
const migration = '20260905173804_gantt_revision_ledger.sql';
const sql = (file: string) => readFileSync(new URL(`../DEVLOG/migrations/${file}`, import.meta.url), 'utf8');

async function harness(upgrade = true) {
  const { PGlite } = await import(pathToFileURL(runtime!).href);
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT DEFAULT 'user',password TEXT,slack_id TEXT,hire_date TEXT,birthday TEXT,
      is_initial_password BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT now(),is_compositor BOOLEAN DEFAULT false,is_acting_supervisor BOOLEAN DEFAULT false);
    CREATE TABLE calendars(id UUID PRIMARY KEY,owner_id TEXT REFERENCES users(id),visibility TEXT,is_personal BOOLEAN DEFAULT false,name TEXT,color TEXT);
    CREATE TABLE calendar_members(calendar_id UUID REFERENCES calendars(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      can_edit BOOLEAN,PRIMARY KEY(calendar_id,user_id));
    GRANT SELECT,INSERT,UPDATE,DELETE ON users,calendars,calendar_members TO anon;
    INSERT INTO users(id,name,password) VALUES ('alice','alice','pw'),('bob','bob','pw');
  `);
  for (const file of ['2026-09-05-gantt-workspaces.sql', '2026-09-05-gantt-containment.sql',
    '2026-09-05-app-sessions-gantt-auth.sql', '20260905151837_gantt_release_acl.sql']) await db.exec(sql(file));
  if (upgrade) await db.exec(sql(migration));
  await db.exec('SET ROLE anon');
  const token = (await db.query('SELECT app_login($1,$2) AS result', ['alice', 'pw'])).rows[0].result.token;
  let request = 0;
  const execute = async (command: GanttCommand, requestId = `revision-${++request}`): Promise<GanttSnapshot> =>
    (await db.query('SELECT gantt_session_execute($1,$2,$3) AS result', [token, requestId, command])).rows[0].result;
  const read = async (): Promise<GanttSnapshot> =>
    (await db.query('SELECT gantt_session_read($1) AS result', [token])).rows[0].result;
  const space = createSpace('공유 폴더', 'alice'); space.shared = true; space.members = [{ userId: 'bob', canEdit: true }];
  const project = createProject('프로젝트', space.id, 'alice'); project.tasks = [createTask('기존 작업', '2026-09-06')];
  await execute({ type: 'saveSpace', space, expectedRevision: null });
  await execute({ type: 'saveProject', project, expectedRevision: null });
  return { db, token, execute, read, space, project };
}

test('anon stale saves cannot erase tasks after deleting and restoring the same project ID', { skip: !runtime }, async () => {
  const { db, execute, read, project } = await harness();
  try {
    const edited = { ...project, tasks: [...project.tasks, createTask('추가 작업', '2026-09-07')] };
    const latest = (await execute({ type: 'saveProject', project: edited, expectedRevision: 1 })).projects[0];
    await execute({ type: 'deleteProject', projectId: project.id, expectedRevision: latest.revision });
    const restored = (await execute({ type: 'saveProject', project: latest, expectedRevision: null })).projects[0];
    assert.ok(restored.revision > latest.revision);
    await assert.rejects(execute({ type: 'saveProject', project, expectedRevision: 1 }), /먼저 수정/);
    await assert.rejects(execute({ type: 'deleteProject', projectId: project.id, expectedRevision: 1 }), /먼저 수정/);
    assert.deepEqual((await read()).projects[0], restored);
  } finally { await db.close(); }
});

test('repeated resurrection ignores forged payload revisions and request replay consumes no revision', { skip: !runtime }, async () => {
  const { db, execute, project } = await harness();
  try {
    let current = project;
    for (const supplied of [1, 999999, 1]) {
      await execute({ type: 'deleteProject', projectId: project.id, expectedRevision: current.revision });
      const command: GanttCommand = { type: 'saveProject', project: { ...project, revision: supplied }, expectedRevision: null };
      const requestId = `restore-${current.revision}`;
      const restored = (await execute(command, requestId)).projects[0];
      assert.equal(restored.revision, current.revision + 1);
      assert.deepEqual((await execute(command, requestId)).projects[0], restored);
      current = restored;
    }
  } finally { await db.close(); }
});

test('folder cascade retains both entity clocks, including matching IDs in separate entity kinds', { skip: !runtime }, async () => {
  const { db, execute, space, project } = await harness();
  try {
    const sameId = { ...project, id: space.id };
    await execute({ type: 'saveProject', project: sameId, expectedRevision: null });
    const changed = await execute({ type: 'saveSpace', space: { ...space, name: '수정' }, expectedRevision: 1 });
    await execute({ type: 'deleteSpace', spaceId: space.id, expectedRevision: 2 });
    const restored = await execute({ type: 'saveSpace', space: changed.spaces[0], expectedRevision: null });
    assert.equal(restored.spaces[0].revision, 3);
    await assert.rejects(execute({ type: 'deleteSpace', spaceId: space.id, expectedRevision: 1 }), /먼저 수정/);
    const result = await execute({ type: 'saveProject', project: sameId, expectedRevision: null });
    assert.equal(result.projects[0].revision, 2);
  } finally { await db.close(); }
});

test('calendar-trigger revisions survive deletion, and failed writes do not advance the private ledger', { skip: !runtime }, async () => {
  const { db, execute, read, project } = await harness();
  try {
    const calendarId = crypto.randomUUID();
    await db.query("INSERT INTO calendars(id,owner_id,visibility) VALUES($1,'alice','team')", [calendarId]);
    const linked = (await execute({ type: 'saveProject', project: { ...project, tasks: [{ ...project.tasks[0], calendarId }] }, expectedRevision: 1 })).projects[0];
    await db.query('DELETE FROM calendars WHERE id=$1', [calendarId]);
    const unlinked = (await read()).projects[0];
    assert.equal(unlinked.revision, linked.revision + 1);
    await execute({ type: 'deleteProject', projectId: project.id, expectedRevision: unlinked.revision });
    await assert.rejects(execute({ type: 'saveProject', project: linked, expectedRevision: null }), /캘린더/);
    const restored = (await execute({ type: 'saveProject', project: unlinked, expectedRevision: null })).projects[0];
    assert.equal(restored.revision, unlinked.revision + 1);
    await assert.rejects(db.query('SELECT * FROM gantt_entity_revisions'), /permission denied/);
    assert.deepEqual(Object.keys(await read()).sort(), ['projects', 'spaces']);
  } finally { await db.close(); }
});

test('upgrade seeds historical receipts, repairs live reset revisions, and is idempotent', { skip: !runtime }, async () => {
  const { db, execute, read, project } = await harness(false);
  try {
    const edited = (await execute({ type: 'saveProject', project: { ...project, name: '과거 최신' }, expectedRevision: 1 })).projects[0];
    await execute({ type: 'deleteProject', projectId: project.id, expectedRevision: 2 });
    await execute({ type: 'saveProject', project: edited, expectedRevision: null });
    await db.exec('RESET ROLE'); await db.exec(sql(migration)); await db.exec('SET ROLE anon');
    const repaired = (await read()).projects[0];
    assert.ok(repaired.revision > 2);
    await assert.rejects(execute({ type: 'saveProject', project, expectedRevision: 1 }), /먼저 수정/);
    await db.exec('RESET ROLE'); await db.exec(sql(migration)); await db.exec('SET ROLE anon');
    assert.deepEqual((await read()).projects[0], repaired);
  } finally { await db.close(); }
});

test('real session RPC restoration keeps undo/redo usable and rejects both racing stale writers', { skip: !runtime }, async () => {
  const { db, execute, read, project } = await harness();
  const store = createGanttStore();
  try {
    await store.getState().initialize('alice', { read, execute: request => execute(request.command, request.requestId) });
    await store.getState().execute({ type: 'saveProject', project: { ...project, tasks: [...project.tasks, createTask('복원할 작업', '2026-09-08')] }, expectedRevision: 1 });
    await store.getState().execute({ type: 'deleteProject', projectId: project.id, expectedRevision: 2 });
    await store.getState().undo(); assert.equal(store.getState().snapshot.projects[0].revision, 3);
    await store.getState().undo(); assert.equal(store.getState().snapshot.projects[0].tasks.length, 1);
    await store.getState().redo(); assert.equal(store.getState().snapshot.projects[0].tasks.length, 2);
    const stale = await Promise.allSettled([
      execute({ type: 'saveProject', project: { ...project, name: '낡은 저장 A' }, expectedRevision: 1 }),
      execute({ type: 'deleteProject', projectId: project.id, expectedRevision: 2 }),
    ]);
    assert.equal(stale.filter(result => result.status === 'rejected').length, 2);
    const current = (await read()).projects[0];
    const racing = await Promise.allSettled(['A', 'B'].map(name => execute({ type: 'saveProject', project: { ...current, name }, expectedRevision: current.revision })));
    assert.equal(racing.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await read()).projects[0].revision, current.revision + 1);
  } finally { await store.getState().initialize(null); await db.close(); }
});

test('calendar projection exposes canonical milestone kind without exposing private revision history', { skip: !runtime }, async () => {
  const { db, execute, token, project } = await harness();
  try {
    const calendarId = crypto.randomUUID();
    await db.query("INSERT INTO calendars(id,owner_id,visibility) VALUES($1,'alice','team')", [calendarId]);
    await execute({ type: 'saveProject', project: { ...project, tasks: [{ ...project.tasks[0], kind: 'milestone', allDay: false, startTime: '10:00', endTime: '10:00', calendarId }] }, expectedRevision: 1 });
    const rows = (await db.query('SELECT gantt_session_calendar_events($1) AS result', [token])).rows[0].result;
    assert.equal(rows[0].linked_gantt_task_kind, 'milestone');
    assert.equal(rows[0].start_time, rows[0].end_time);
    assert.equal('revisions' in rows[0], false);
    await assert.rejects(db.query('SELECT gantt_calendar_events($1)', ['alice']), /permission denied/);
  } finally { await db.close(); }
});

test('upgrade retires previously deleted IDs but replay never retires a new supported tombstone', { skip: !runtime }, async () => {
  const { db, execute, project } = await harness(false);
  try {
    await execute({ type: 'deleteProject', projectId: project.id, expectedRevision: 1 });
    await db.exec('RESET ROLE'); await db.exec(sql(migration)); await db.exec('SET ROLE anon');
    await assert.rejects(execute({ type: 'saveProject', project, expectedRevision: null }), /이전 버전.*복원/);
    const fresh = { ...project, id: crypto.randomUUID() };
    await execute({ type: 'saveProject', project: fresh, expectedRevision: null });
    await execute({ type: 'deleteProject', projectId: fresh.id, expectedRevision: 1 });
    await db.exec('RESET ROLE'); await db.exec(sql(migration)); await db.exec('SET ROLE anon');
    const restored = (await execute({ type: 'saveProject', project: fresh, expectedRevision: null })).projects[0];
    assert.equal(restored.revision, 2);
  } finally { await db.close(); }
});

test('migration rollback restores pre-upgrade rows and leaves no private ledger behind', { skip: !runtime }, async () => {
  const { db, read } = await harness(false);
  try {
    const before = await read();
    await db.exec('RESET ROLE; BEGIN'); await db.exec(sql(migration)); await db.exec('ROLLBACK; SET ROLE anon');
    assert.deepEqual(await read(), before);
    assert.equal((await db.query("SELECT to_regclass('public.gantt_entity_revisions') AS name")).rows[0].name, null);
  } finally { await db.close(); }
});

test('the operational revision smoke passes as anon and rolls back users, sessions and tombstones', { skip: !runtime }, async () => {
  const { db } = await harness();
  try {
    await db.exec('RESET ROLE');
    const counts = () => db.query('SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM app_sessions) AS sessions,(SELECT count(*) FROM gantt_entity_revisions) AS revisions');
    const before = await counts();
    const smoke = readFileSync(new URL('../DEVLOG/verification/2026-09-06-gantt-revision-smoke.sql', import.meta.url), 'utf8');
    const result = await db.exec(smoke);
    assert.equal(result.at(-1).rows[0].passed, true);
    assert.deepEqual((await counts()).rows, before.rows);
  } finally { await db.close(); }
});

test('operational smoke rejects missing RPC results instead of treating SQL NULL as success', { skip: !runtime }, async (t) => {
  const { db } = await harness();
  const smoke = readFileSync(new URL('../DEVLOG/verification/2026-09-06-gantt-revision-smoke.sql', import.meta.url), 'utf8');
  const projection = "result:=public.gantt_session_calendar_events(token,NULL,NULL,'gantt:'||project_id||':'||task_id);";
  const login = "result:=public.app_login('__gantt_revision_'||f.run_id,'revision-smoke-pw');";
  const folder = "result:=public.gantt_session_execute(token,'folder-restore',jsonb_build_object('type','saveSpace','space',space_doc,'expectedRevision',NULL));";
  const child = "result:=public.gantt_session_execute(token,'child-restore',jsonb_build_object('type','saveProject','project',project_doc,'expectedRevision',NULL));";
  const probes = [
    { name: 'empty projection', anchor: projection, mutation: "result:='[]'::JSONB;", error: /milestone projection mismatch/ },
    { name: 'missing milestone kind', anchor: projection, mutation: "result:=result #- '{0,linked_gantt_task_kind}';", error: /milestone projection mismatch/ },
    { name: 'missing both milestone times', anchor: projection, mutation: "result:=(result #- '{0,start_time}') #- '{0,end_time}';", error: /milestone projection mismatch/ },
    { name: 'missing login success flag', anchor: login, mutation: "result:=result-'ok';", error: /fixture login failed/ },
    { name: 'empty restored folder list', anchor: folder, mutation: "result:=jsonb_set(result,'{spaces}','[]'::JSONB);", error: /folder clock reset/ },
    { name: 'empty restored project list', anchor: child, mutation: "result:=jsonb_set(result,'{projects}','[]'::JSONB);", error: /cascade reset child clock/ },
    { name: 'missing restored project revision', anchor: child, mutation: "result:=result #- '{projects,0,revision}';", error: /cascade reset child clock/ },
  ];
  try {
    await db.exec('RESET ROLE');
    for (const probe of probes) await t.test(probe.name, async () => {
      assert.ok(smoke.includes(probe.anchor), 'probe anchor must stay attached to the actual RPC result');
      const changed = smoke.replace(probe.anchor, `${probe.anchor}\n  ${probe.mutation}`);
      try { await assert.rejects(db.exec(changed), probe.error); }
      finally { await db.exec('ROLLBACK; RESET ROLE'); }
    });
  } finally { await db.close(); }
});
