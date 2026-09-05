import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { GanttCommand, GanttProject, GanttSnapshot, GanttSpace, GanttTask } from '../src/features/gantt/types.ts';

const runtime = process.env.BFLOW_PGLITE_MODULE;
const upgradeSql = () => readFileSync(new URL('../DEVLOG/migrations/20260905151837_gantt_release_acl.sql', import.meta.url), 'utf8');
const spaceId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const calendarId = '00000000-0000-4000-8000-000000000010';
const task: GanttTask = {
  id: '00000000-0000-4000-8000-000000000003', parentId: null, kind: 'task', title: '공유 일정', memo: '',
  startDate: '2026-09-05', endDate: '2026-09-05', allDay: true, startTime: '', endTime: '', mode: 'manual',
  predecessorId: null, progress: 0, progressMode: 'manual', sceneLinks: [], workers: [], attendees: [], color: null,
  calendarId, calendarEventId: null, completed: false, sortOrder: 0,
};
const space: GanttSpace = {
  id: spaceId, ownerId: 'alice', name: '공유 폴더', shared: true, revision: 1,
  members: [{ userId: 'bob', canEdit: true }, { userId: 'carol', canEdit: true }],
};
const project: GanttProject = {
  id: projectId, spaceId, ownerId: 'bob', name: '프로젝트', memo: '', color: '#6C5CE7', completed: false,
  revision: 1, memberIds: ['bob', 'carol'], editorIds: ['bob', 'carol'], linkedEpisode: null, tasks: [task],
};

async function harness() {
  const { PGlite } = await import(pathToFileURL(runtime!).href);
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT DEFAULT 'user',password TEXT,slack_id TEXT,hire_date TEXT,birthday TEXT,
      is_initial_password BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT now(),is_compositor BOOLEAN DEFAULT false,is_acting_supervisor BOOLEAN DEFAULT false);
    CREATE TABLE calendars(id UUID PRIMARY KEY,owner_id TEXT REFERENCES users(id),visibility TEXT,is_personal BOOLEAN DEFAULT false,
      name TEXT DEFAULT '',color TEXT DEFAULT '#6C5CE7');
    CREATE TABLE calendar_members(calendar_id UUID REFERENCES calendars(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      can_edit BOOLEAN,PRIMARY KEY(calendar_id,user_id));
    GRANT SELECT,INSERT,UPDATE,DELETE ON users,calendars,calendar_members TO anon,authenticated;
    INSERT INTO users(id,name,role,password) VALUES ('alice','alice','admin','pw'),('bob','bob','user','pw'),('carol','carol','user','pw');
    INSERT INTO calendars(id,owner_id,visibility,is_personal) VALUES ('${calendarId}','alice','team',false);
    INSERT INTO calendar_members VALUES ('${calendarId}','bob',true);
  `);
  for (const file of ['2026-09-05-gantt-workspaces.sql', '2026-09-05-gantt-containment.sql',
    '2026-09-05-app-sessions-gantt-auth.sql', '2026-09-06-users-password-lockdown.sql']) {
    await db.exec(readFileSync(new URL(`../DEVLOG/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.exec('SET ROLE anon');
  const tokens: Record<string, string> = {};
  for (const user of ['alice', 'bob', 'carol']) {
    const result = await db.query('SELECT public.app_login($1,$2) AS result', [user, 'pw']);
    tokens[user] = result.rows[0].result.token;
  }
  let request = 0;
  const execute = async (actor: string, command: GanttCommand): Promise<GanttSnapshot> => (
    await db.query('SELECT public.gantt_session_execute($1,$2,$3) AS result', [tokens[actor], `request-${++request}`, command])
  ).rows[0].result;
  const read = async (actor = 'alice'): Promise<GanttSnapshot> => (
    await db.query('SELECT public.gantt_session_read($1) AS result', [tokens[actor]])
  ).rows[0].result;
  const events = async (actor = 'alice'): Promise<Array<{ gantt_can_edit: boolean }>> => (
    await db.query('SELECT public.gantt_session_calendar_events($1) AS result', [tokens[actor]])
  ).rows[0].result;
  await execute('alice', { type: 'saveSpace', space, expectedRevision: null });
  await execute('bob', { type: 'saveProject', project, expectedRevision: null });
  return { db, execute, read, events };
}

test('removing a folder member transfers their projects and prunes ACLs atomically', { skip: !runtime }, async () => {
  const { db, execute, read } = await harness();
  try {
    const unaffected = { ...project, id: '00000000-0000-4000-8000-000000000020', ownerId: 'alice', memberIds: null, editorIds: null, tasks: [] };
    await execute('alice', { type: 'saveProject', project: unaffected, expectedRevision: null });
    const result = await execute('alice', { type: 'saveSpace', space: { ...space, members: [{ userId: 'carol', canEdit: true }] }, expectedRevision: 1 });
    const saved = result.projects.find(item => item.id === projectId)!;
    assert.equal(saved.ownerId, 'alice');
    assert.deepEqual(saved.memberIds, ['carol']);
    assert.deepEqual(saved.editorIds, ['carol']);
    assert.equal(saved.revision, 2);
    assert.equal(result.projects.find(item => item.id === unaffected.id)?.revision, 1);
    assert.deepEqual(await read('bob'), { spaces: [], projects: [] });
    const changed = await execute('alice', { type: 'saveProject', project: { ...saved, name: '수정 가능' }, expectedRevision: 2 });
    assert.equal(changed.projects.find(item => item.id === projectId)?.name, '수정 가능');
    await assert.rejects(execute('alice', { type: 'saveProject', project, expectedRevision: 1 }));
    const renamed = await execute('alice', { type: 'saveSpace', space: { ...result.spaces[0], name: '이름만 수정' }, expectedRevision: 2 });
    assert.equal(renamed.projects.find(item => item.id === projectId)?.revision, 3);
  } finally { await db.close(); }
});

test('disabling folder sharing reconciles project owners even if dormant members remain listed', { skip: !runtime }, async () => {
  const { db, execute, read } = await harness();
  try {
    const result = await execute('alice', { type: 'saveSpace', space: { ...space, shared: false }, expectedRevision: 1 });
    assert.equal(result.projects[0].ownerId, 'alice');
    assert.deepEqual(result.projects[0].memberIds, []);
    assert.deepEqual(result.projects[0].editorIds, []);
    assert.equal(result.projects[0].revision, 2);
    assert.deepEqual(await read('bob'), { spaces: [], projects: [] });
    await execute('alice', { type: 'saveProject', project: { ...result.projects[0], memo: '계속 편집' }, expectedRevision: 2 });
  } finally { await db.close(); }
});

test('calendar viewers cannot remove a projection by converting the linked task to a group', { skip: !runtime }, async () => {
  const { db, execute, read, events } = await harness();
  try {
    await db.exec("UPDATE public.calendar_members SET can_edit=false WHERE user_id='bob'");
    assert.equal((await events('bob'))[0].gantt_can_edit, false);
    await assert.rejects(execute('bob', {
      type: 'saveProject', expectedRevision: 1, project: { ...project, tasks: [{ ...task, kind: 'group' }] },
    }), /캘린더.*편집 권한/);
    assert.equal((await events()).length, 1);
    assert.equal((await read()).projects[0].revision, 1);
  } finally { await db.close(); }
});

test('anon calendar deletion unlinks canonical tasks without regranting Gantt table access', { skip: !runtime }, async () => {
  const { db, execute, read, events } = await harness();
  try {
    await db.query('DELETE FROM public.calendars WHERE id=$1', [calendarId]);
    const saved = (await read()).projects[0];
    assert.equal(saved.tasks.length, 1);
    assert.equal(saved.tasks[0].calendarId, null);
    assert.equal(saved.revision, 2);
    assert.equal((await events()).length, 0);
    await assert.rejects(execute('bob', { type: 'saveProject', project, expectedRevision: 1 }), /먼저 수정/);
    await assert.rejects(db.query('SELECT data FROM public.gantt_projects'), /permission denied/);
    const allowed = await db.query("SELECT has_function_privilege('anon','public.gantt_unlink_deleted_calendar()','EXECUTE') AS allowed");
    assert.equal(allowed.rows[0].allowed, false);
  } finally { await db.close(); }
});

test('anon user deletion preserves a shared Gantt and removes the deleted worker and ACL entries', { skip: !runtime }, async () => {
  const { db, execute, read } = await harness();
  try {
    await execute('bob', { type: 'saveProject', project: { ...project, tasks: [{ ...task, workers: ['bob'], attendees: ['bob'] }] }, expectedRevision: 1 });
    await db.query("DELETE FROM public.users WHERE id='bob'");
    const saved = (await read()).projects[0];
    assert.equal(saved.ownerId, 'alice');
    assert.deepEqual(saved.memberIds, ['carol']);
    assert.deepEqual(saved.editorIds, ['carol']);
    assert.deepEqual(saved.tasks[0].workers, []);
    assert.deepEqual(saved.tasks[0].attendees, []);
    assert.equal(saved.revision, 3);
    const allowed = await db.query("SELECT has_function_privilege('anon','public.gantt_before_user_delete()','EXECUTE') AS allowed");
    assert.equal(allowed.rows[0].allowed, false);
  } finally { await db.close(); }
});

test('the additive migration repairs existing projects once and retains private RPC boundaries', { skip: !runtime }, async () => {
  const { db, read, execute } = await harness();
  try {
    // State left by a pre-fix folder sharing change: hidden project owner/ACLs remain unchanged.
    await db.exec(`RESET ROLE;
      UPDATE public.gantt_spaces SET data=jsonb_set(data,'{shared}','false'::JSONB) WHERE id='${spaceId}';
      ALTER FUNCTION public.gantt_unlink_deleted_calendar() SECURITY INVOKER;
      ALTER FUNCTION public.gantt_before_user_delete() SECURITY INVOKER;
    `);
    await db.exec(upgradeSql());
    await db.exec('SET ROLE anon');
    const repaired = (await read()).projects[0];
    assert.equal(repaired.ownerId, 'alice');
    assert.deepEqual(repaired.memberIds, []);
    assert.deepEqual(repaired.editorIds, []);
    assert.equal(repaired.revision, 2);
    await db.exec('RESET ROLE');
    const row = await db.query('SELECT owner_id,revision FROM public.gantt_projects WHERE id=$1', [projectId]);
    assert.deepEqual(row.rows[0], { owner_id: 'alice', revision: 2 });
    await db.exec(upgradeSql());
    await db.exec('SET ROLE anon');
    assert.deepEqual((await read()).projects[0], repaired);
    await execute('alice', { type: 'saveProject', project: { ...repaired, name: '복구 후 편집' }, expectedRevision: 2 });
    await db.query('DELETE FROM public.calendars WHERE id=$1', [calendarId]);
    await db.query("DELETE FROM public.users WHERE id='bob'");
    await assert.rejects(db.query('SELECT data FROM public.gantt_projects'), /permission denied/);
    await assert.rejects(db.query("SELECT public.gantt_read('alice')"), /permission denied/);
    const privileges = await db.query(`SELECT
      has_function_privilege('anon','public.gantt_check_calendar_changes(text,jsonb,jsonb)','EXECUTE') AS calendar_check,
      has_function_privilege('anon','public.gantt_execute(text,text,jsonb)','EXECUTE') AS execute,
      has_function_privilege('anon','public.gantt_unlink_deleted_calendar()','EXECUTE') AS calendar_delete,
      has_function_privilege('anon','public.gantt_before_user_delete()','EXECUTE') AS user_delete`);
    assert.deepEqual(privileges.rows[0], { calendar_check: false, execute: false, calendar_delete: false, user_delete: false });
  } finally { await db.close(); }
});

test('a failed folder access update leaves child project ownership and revisions unchanged', { skip: !runtime }, async () => {
  const { db, execute, read } = await harness();
  try {
    const before = await read();
    await assert.rejects(execute('alice', {
      type: 'saveSpace', expectedRevision: 1, space: { ...space, members: [{ userId: 'unknown', canEdit: true }] },
    }), /멤버/);
    assert.deepEqual(await read(), before);
    await assert.rejects(execute('bob', {
      type: 'saveSpace', expectedRevision: 1, space: { ...space, members: [] },
    }), /소유자/);
    assert.deepEqual(await read(), before);
  } finally { await db.close(); }
});

test('the release smoke exercises anon boundaries and rolls back all fixtures', { skip: !runtime }, async () => {
  const { db, read } = await harness();
  try {
    const before = await read();
    await db.exec('RESET ROLE');
    await db.exec(upgradeSql());
    const counts = (await db.query('SELECT (SELECT count(*) FROM public.users) AS users,(SELECT count(*) FROM public.gantt_projects) AS projects')).rows[0];
    const smoke = readFileSync(new URL('../DEVLOG/verification/2026-09-06-gantt-release-smoke.sql', import.meta.url), 'utf8');
    const result = await db.exec(smoke);
    assert.equal(result.at(-1).rows[0].passed, true);
    assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM public.users) AS users,(SELECT count(*) FROM public.gantt_projects) AS projects')).rows[0], counts);
    await db.exec('SET ROLE anon');
    assert.deepEqual(await read(), before);
  } finally { await db.close(); }
});

test('folder creation undo cannot delete a project committed after its preflight read', { skip: !runtime }, async () => {
  const { db, execute, read } = await harness();
  try {
    // Project creation does not increment the folder revision; the empty-folder
    // inverse must therefore check children inside gantt_execute's write lock.
    await assert.rejects(execute('alice', {
      type: 'deleteSpace', spaceId, expectedRevision: 1, requireEmpty: true,
    }), (error: { code?: string }) => error.code === '40001');
    assert.equal((await read()).projects[0].id, projectId);
    assert.equal((await read()).spaces[0].revision, 1);
    const emptySpace = { ...space, id: '00000000-0000-4000-8000-000000000021', name: '빈 폴더' };
    await execute('alice', { type: 'saveSpace', space: emptySpace, expectedRevision: null });
    await execute('alice', { type: 'deleteSpace', spaceId: emptySpace.id, expectedRevision: 1, requireEmpty: true });
    assert.equal((await read()).spaces.length, 1);
    // An explicit cascade remains supported when the caller intentionally asks for it.
    await execute('alice', { type: 'deleteSpace', spaceId, expectedRevision: 1 });
    assert.deepEqual(await read(), { spaces: [], projects: [] });
  } finally { await db.close(); }
});
