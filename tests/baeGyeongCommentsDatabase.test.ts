import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

import { commentNotificationEditRecipients, commentNotificationRecipients, type RecipientWorld, type RecipientWorldComment } from '../src/shared/commentNotificationRecipients.ts';
import { parseCommentNotificationRows } from '../src/shared/commentNotification.ts';

// BAE경 9단계 코멘트 (DEVLOG/migrations/2026-11-16-bae-gyeong-comments.sql · 되돌리기 · 확인 SQL).
// 글자로 보는 검사는 늘 돌고, 실제 실행은 PostgreSQL 호환 실행기(BFLOW_PGLITE_MODULE)가 있을 때 돈다. 실행은 개발 브랜치와 같은 사슬로 깐다:
//   BAE 바탕(사용자 · 세션) → BAE 기본 · PC 점검 · 8단계 → 댓글 바탕(2026-11-16-bae-gyeong-dev-comments-base.sql) → 9단계.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sql = read('DEVLOG/migrations/2026-11-16-bae-gyeong-comments.sql');
const rollback = read('DEVLOG/migrations/2026-11-16-bae-gyeong-comments-rollback.sql');
const smoke = read('DEVLOG/verification/2026-11-16-bae-gyeong-comments-smoke.sql');
const devBase = read('DEVLOG/verification/2026-11-16-bae-gyeong-dev-base.sql');
const devComments = read('DEVLOG/verification/2026-11-16-bae-gyeong-dev-comments-base.sql');
const notificationsFile = read('DEVLOG/migrations/2026-11-05-comment-notifications.sql');
const runtime = process.env.BFLOW_PGLITE_MODULE;
const strip = (text: string) => text.replace(/^BEGIN;\n/m, '').replace(/\nCOMMIT;\n?$/, '\n');
const body = strip(sql);
const rollbackBody = strip(rollback);

/** 운영 DB 의 댓글 함수 지문 (C:\BAE_stage0\comments_port\prod_shape.md, 2026-11-16 읽기 전용 조회). */
const PRODUCTION_FINGERPRINTS: Record<string, string> = {
  comment_notifications_fanout: 'd116b354368ef1899145146660aa2a4f',
  comment_notifications_names: 'c27bec95073d0b5024ea913cd2122a68',
  comment_notifications_on_delete: '2cfca4cabb58d4e6542cf26ad9c135a4',
  comment_notifications_on_insert: 'c1653f8c22b65b84efb865b299ea828a',
  comment_notifications_on_mentions: '987f05de601b36e989a4af849a9b9a53',
  comment_notifications_recipients: 'a9efba98c6e892caf3b49307190047da',
  comment_notifications_session_list: 'a0bd8a79a9fd91e9405d63b2b24b962e',
  comment_notifications_session_mark_read: '1a3e70b4dd9f019daac1b2ba3e91e7eb',
  comment_thread_todos_notify_change: 'cce37d2699bb689c8ebd6a12e28591bf',
  comment_thread_todos_session_add: '8c9d392634179f41ab40d64e3dce234c',
  comment_thread_todos_session_delete: 'ab44183c841aaa0a9c6586596750663e',
  comment_thread_todos_session_list: '6350dbc0d3dfd796376d5fc41340268c',
  comment_thread_todos_session_set_done: '60662416b123dafc70c8a2551049c91d',
  remove_emoji_from_reaction_notification: '88159343873d128858cac44e68f8696d',
  upsert_comment_reaction_notification: 'c57eb51a3eff60dba57b1a63c75ea822',
};
const PRODUCTION_COMMENT_COLUMNS = ['id', 'part_id', 'scene_id', 'user_id', 'user_name', 'text', 'mentions', 'created_at', 'edited_at',
  'scene_uuid', 'images', 'revision_id', 'parent_comment_id', 'character_id', 'costume_id'];

const fnBody = (text: string, name: string) => {
  const start = text.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start >= 0, name);
  const open = text.indexOf('$$', start);
  return text.slice(open + 2, text.indexOf('$$', open + 2));
};

test('the migration: one transaction, only restrictive policies, PT409 never 40001, no comments inside bodies', () => {
  assert.match(sql, /^BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';/m);
  assert.match(sql, /\nCOMMIT;\n$/);
  assert.doesNotMatch(sql, /ERRCODE\s*=\s*'40(001|P01)'/);
  assert.match(sql, /USING ERRCODE = 'PT409'/);
  assert.doesNotMatch(sql, /ALTER PUBLICATION|DROP POLICY IF EXISTS allow_all|ALTER POLICY/);
  const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON public\.(\w+) AS (\w+)/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(policies, [['bae_gyeong_comments_private', 'comments', 'RESTRICTIVE'], ['bae_gyeong_comment_reactions_private', 'comment_reactions', 'RESTRICTIVE']]);
  assert.equal((sql.match(/CREATE POLICY/g) ?? []).length, 2);
  const names = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)].map((m) => m[1]);
  const shared = names.filter((n) => !n.startsWith('bae_gyeong_'));
  assert.deepEqual(shared.sort(), ['comment_notifications_on_insert', 'comment_notifications_on_mentions', 'comment_notifications_session_list']);
  for (const name of names) assert.doesNotMatch(fnBody(sql, name), /--/, `no '--' inside ${name} (the apply tool strips them)`);
  // the scene path inside the two trigger functions is the very same call as in the 2026-11-05 file
  assert.ok(fnBody(sql, 'comment_notifications_on_insert').includes("PERFORM public.comment_notifications_fanout(NEW.id, 'add', NULL, NULL, true);"));
  assert.ok(fnBody(sql, 'comment_notifications_on_mentions').includes("PERFORM public.comment_notifications_fanout(NEW.id, 'edit', v_added, NULL, true);"));
  // the people are decided by the session, never by an id the caller sends
  assert.doesNotMatch(sql, /p_actor_id|p_user_id|p_user_name/);
  for (const m of sql.matchAll(/FUNCTION public\.(bae_gyeong_session_[a-z_]+)\(p_session_token TEXT/g)) {
    assert.match(fnBody(sql, m[1]), /public\.bae_gyeong_actor\(p_session_token\)/, m[1]);
  }
  assert.doesNotMatch(sql, /SELECT \* FROM public\.users/);
});

test('the rollback puts back the 2026-11-05 bodies letter for letter, and the smoke embeds the rollback body as it is', () => {
  for (const name of ['comment_notifications_on_insert', 'comment_notifications_on_mentions', 'comment_notifications_session_list']) {
    assert.equal(fnBody(rollback, name), fnBody(notificationsFile, name), name);
    assert.equal(createHash('md5').update(fnBody(rollback, name)).digest('hex'), PRODUCTION_FINGERPRINTS[name], `${name} = production`);
  }
  assert.match(rollback, /^BEGIN;\n/m);
  const start = smoke.indexOf('-- ▼ 되돌리기 본문');
  const end = smoke.indexOf('-- ▲ 되돌리기 본문 끝');
  assert.ok(start > 0 && end > start);
  const embedded = smoke.slice(smoke.indexOf('\n', start) + 1, end);
  assert.equal(embedded, rollbackBody.slice(rollbackBody.indexOf('SET LOCAL lock_timeout')), 'the smoke carries the rollback body unchanged');
  assert.match(smoke, /RAISE EXCEPTION 'BAE COMMENTS SMOKE OK/);
  assert.doesNotMatch(smoke, /^\s*(BEGIN|COMMIT)\s*;/m);
  assert.doesNotMatch(body, /^BEGIN;|^COMMIT;/m);
});

// ── 미리보기 짝(TypeScript): 실행기가 없어도 늘 ─────────────────────────────
const J = { a: '5b0c4f1e-0000-4000-8000-0000000a0001', b: '5b0c4f1e-0000-4000-8000-0000000b0001' };
const people = [
  { id: 'admin', name: '관리자', role: 'admin' }, { id: 'maker', name: '장삐쭈', role: 'user' }, { id: 'reviewer', name: '안류천', role: 'user' },
  { id: 'member', name: '허혜원', role: 'user' }, { id: 'outsider', name: '바깥', role: 'user' },
];
const baeWorld = (): RecipientWorld & { comments: RecipientWorldComment[] } => ({
  users: people.map(({ id, name }) => ({ id, name })), episodes: [], parts: [], scenes: [], revisions: [], comments: [],
  baeJobs: [{ id: J.a, makerId: 'maker' }, { id: J.b, makerId: 'member' }], baeReviewerIds: ['admin', 'reviewer'],
});
const baeComment = (id: string, userId: string, jobId: string, fields: Partial<RecipientWorldComment> = {}): RecipientWorldComment => ({
  id, userId, partId: null, sceneId: null, sceneUuid: null, mentions: [], parentCommentId: null, revisionId: null, characterId: null, baeJobId: jobId, ...fields,
});
type Row = [string, string, string | null];
const baeSteps: Array<{ comment: RecipientWorldComment; expected: Row[]; why: string }> = [
  { why: '검수자의 댓글: 만든 사람(자동 · assignee), 볼 수 없는 사람의 멘션은 버린다',
    comment: baeComment('baec_00000000-0000-4000-8000-000000000001', 'reviewer', J.a, { mentions: ['허혜원', '바깥'] }), expected: [['maker', 'auto', 'assignee']] },
  { why: '만든 사람의 답글: 원댓글 작성자(reply)',
    comment: baeComment('baec_00000000-0000-4000-8000-000000000002', 'maker', J.a, { parentCommentId: 'baec_00000000-0000-4000-8000-000000000001' }), expected: [['reviewer', 'reply', null]] },
  { why: '관리자의 댓글: 만든 사람 + 쓴 적 있는 검수자(participant), 멘션이 가장 세다',
    comment: baeComment('baec_00000000-0000-4000-8000-000000000003', 'admin', J.a, { mentions: ['안류천'] }), expected: [['maker', 'auto', 'assignee'], ['reviewer', 'mention', null]] },
  { why: '다른 기록의 스레드는 섞이지 않는다',
    comment: baeComment('baec_00000000-0000-4000-8000-000000000004', 'reviewer', J.b), expected: [['member', 'auto', 'assignee']] },
];
const sortRows = (rows: Row[]) => [...rows].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));

test('the TypeScript twin: BAE comments reach the maker, replies and mentions, never anyone outside the thread', () => {
  const world = baeWorld();
  for (const step of baeSteps) {
    world.comments.push(step.comment);
    assert.deepEqual(sortRows(commentNotificationRecipients(world, step.comment.id).map((r) => [r.recipientId, r.reason, r.detail] as Row)), sortRows(step.expected), step.why);
  }
  assert.deepEqual(commentNotificationEditRecipients(world, 'baec_00000000-0000-4000-8000-000000000002', [], ['안류천', '바깥', '허혜원']), ['reviewer'], 'edit: only readers');
  // a scene comment in the same world still follows the scene rule (mention of anyone)
  world.comments.push({ id: 'scene-1', userId: 'member', partId: null, sceneId: null, sceneUuid: null, mentions: ['바깥'], parentCommentId: null, revisionId: null, characterId: null });
  assert.deepEqual(commentNotificationRecipients(world, 'scene-1').map((r) => r.recipientId), ['outsider']);
});

// ── 실제 실행 ───────────────────────────────────────────────────────────────
const tokens: Record<string, string> = { admin: 'a'.repeat(64), maker: 'b'.repeat(64), reviewer: 'c'.repeat(64), member: 'd'.repeat(64), outsider: 'e'.repeat(64) };
async function boot(opts: { stage9?: boolean } = {}) {
  const { PGlite } = await import(pathToFileURL(runtime!).href);
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE PUBLICATION supabase_realtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
    CREATE SCHEMA realtime; CREATE TABLE realtime.messages(payload JSONB, event TEXT, topic TEXT, private BOOLEAN);
    CREATE FUNCTION realtime.send(payload JSONB, event TEXT, topic TEXT, private BOOLEAN) RETURNS VOID LANGUAGE SQL AS 'INSERT INTO realtime.messages VALUES(payload,event,topic,private)';
    CREATE SCHEMA vault; CREATE TABLE vault.secrets(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), secret TEXT, name TEXT, description TEXT);
    CREATE FUNCTION vault.create_secret(s TEXT, n TEXT, d TEXT) RETURNS UUID LANGUAGE SQL AS 'INSERT INTO vault.secrets(secret,name,description) VALUES(s,n,d) RETURNING id';
    CREATE FUNCTION vault.update_secret(i UUID, s TEXT) RETURNS VOID LANGUAGE SQL AS 'UPDATE vault.secrets SET secret=s WHERE id=i';
    CREATE VIEW vault.decrypted_secrets AS SELECT id, secret AS decrypted_secret FROM vault.secrets;
    REVOKE ALL ON SCHEMA vault FROM PUBLIC; REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC, anon, authenticated;`);
  // the dev branch chain, file by file, each in one transaction as apply_migration runs it
  await db.exec(`BEGIN;\n${devBase}\nCOMMIT;`);
  for (const file of ['2026-11-13-bae-gyeong-base.sql', '2026-11-16-bae-gyeong-pc-check.sql', '2026-11-16-bae-gyeong-review.sql']) await db.exec(read(`DEVLOG/migrations/${file}`));
  await db.exec(`BEGIN;\n${devComments}\nCOMMIT;`);
  for (const p of people) await db.query('INSERT INTO users(id, name, role) VALUES($1, $2, $3)', [p.id, p.name, p.role]);
  for (const [id, token] of Object.entries(tokens)) {
    await db.query("INSERT INTO app_sessions(token_hash, user_id, expires_at) VALUES($1, $2, now() + interval '1 day')", [createHash('sha256').update(token).digest('hex'), id]);
  }
  if (opts.stage9 !== false) await db.exec(sql);
  return db;
}
type Db = Awaited<ReturnType<typeof boot>>;
const asAnon = async <T>(db: Db, run: () => Promise<T>): Promise<T> => {
  await db.exec('SET ROLE anon');
  try { return await run(); } finally { await db.exec('RESET ROLE'); }
};
const rpc = async (db: Db, name: string, who: string, extra = '', args: unknown[] = []) =>
  asAnon(db, async () => ((await db.query(`SELECT public.${name}($1${extra}) AS r`, [tokens[who], ...args])).rows[0] as { r: any }).r);
const fingerprints = async (db: Db) => Object.fromEntries(((await db.query(`SELECT p.proname, md5(p.prosrc) AS m FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND (p.proname LIKE 'comment%' OR p.proname IN ('remove_emoji_from_reaction_notification', 'upsert_comment_reaction_notification'))`)).rows as Array<{ proname: string; m: string }>).map((r) => [r.proname, r.m]));
const setup = async (db: Db) => {
  await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['maker', 'user']);
  await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['member', 'user']);
  await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['reviewer', 'reviewer']);
  await rpc(db, 'bae_gyeong_session_job_upsert', 'maker', ',$2::jsonb', [JSON.stringify({ id: J.a, kind: 'new', status: 'done' })]);
  await rpc(db, 'bae_gyeong_session_job_upsert', 'member', ',$2::jsonb', [JSON.stringify({ id: J.b, kind: 'new', status: 'done' })]);
};
const add = (db: Db, who: string, jobId: string, comment: Record<string, unknown>) =>
  rpc(db, 'bae_gyeong_session_comment_add', who, ',$2::uuid,$3::jsonb', [jobId, JSON.stringify(comment)]);
const notificationRows = async (db: Db, commentId: string): Promise<Row[]> =>
  ((await db.query('SELECT recipient_id, reason, detail FROM comment_notifications WHERE comment_id = $1 AND kind = $2 ORDER BY recipient_id', [commentId, 'add'])).rows as Array<{ recipient_id: string; reason: string; detail: string | null }>)
    .map((r) => [r.recipient_id, r.reason, r.detail]);

test('production fingerprint: the dev comment base gives every comment function the production body', { skip: !runtime }, async () => {
  const db = await boot({ stage9: false });
  try {
    assert.deepEqual(await fingerprints(db), PRODUCTION_FINGERPRINTS);
    const cols = (await db.query("SELECT attname FROM pg_attribute WHERE attrelid = 'public.comments'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum")).rows.map((r: any) => r.attname);
    assert.deepEqual(cols, PRODUCTION_COMMENT_COLUMNS);
    const triggers = (await db.query("SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.comments'::regclass AND NOT tgisinternal ORDER BY 1")).rows.map((r: any) => r.tgname);
    assert.deepEqual(triggers, ['comment_notifications_after_delete', 'comment_notifications_after_insert', 'comment_notifications_after_mentions']);
    const published = (await db.query("SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename LIKE 'comment%' ORDER BY 1")).rows.map((r: any) => r.tablename);
    assert.deepEqual(published, ['comment_reaction_notifications', 'comment_reactions', 'comments']);
    const fks = (await db.query(`SELECT a.attname, c.confrelid::regclass::text AS ref, c.confdeltype FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.conrelid = 'public.comments'::regclass AND c.contype = 'f' ORDER BY 1`)).rows.map((r: any) => `${r.attname}>${r.ref}:${r.confdeltype}`);
    assert.deepEqual(fks, ['character_id>characters:c', 'costume_id>character_costumes:n', 'parent_comment_id>comments:n', 'part_id>parts:c', 'revision_id>comp_revisions:c', 'scene_uuid>scenes:c']);
  } finally { await db.close(); }
});

test('the migration applies on the dev chain, twice is the same, and the BAE rule matches the TypeScript twin', { skip: !runtime }, async () => {
  const db = await boot();
  try {
    await db.exec(sql);
    const after = await fingerprints(db);
    for (const [name, md5] of Object.entries(PRODUCTION_FINGERPRINTS)) {
      if (['comment_notifications_on_insert', 'comment_notifications_on_mentions', 'comment_notifications_session_list'].includes(name)) assert.notEqual(after[name], md5, name);
      else assert.equal(after[name], md5, `${name} untouched`);
    }
    await setup(db);
    const world = baeWorld();
    for (const step of baeSteps) {
      const c = step.comment;
      const saved = await add(db, c.userId, c.baeJobId!, { id: c.id, text: `${c.id} 본문`, mentions: c.mentions, parentCommentId: c.parentCommentId });
      // the server keeps only the names that may read the thread; the twin is given what was stored
      world.comments.push({ ...c, mentions: saved.comment.mentions });
      const server = await notificationRows(db, c.id);
      assert.deepEqual(sortRows(server), sortRows(step.expected), step.why);
      assert.deepEqual(sortRows(commentNotificationRecipients(world, c.id).map((r) => [r.recipientId, r.reason, r.detail] as Row)), sortRows(server), `twin = server: ${step.why}`);
    }
    // anon (the app's key) sees no BAE comment and no BAE reaction through the tables; scene comments as before
    await rpc(db, 'bae_gyeong_session_comment_react', 'maker', ',$2,$3,$4', [baeSteps[0]!.comment.id, '👍', true]);
    await asAnon(db, async () => {
      assert.equal((await db.query('SELECT count(*)::int n FROM comments')).rows[0].n, 0);
      assert.equal((await db.query('SELECT count(*)::int n FROM comment_reactions')).rows[0].n, 0);
      await db.query("INSERT INTO comments(id, user_id, user_name, text, mentions) VALUES('scene-x', 'member', '허혜원', '@바깥', '[\"바깥\"]')");
      assert.equal((await db.query('SELECT count(*)::int n FROM comments')).rows[0].n, 1);
      await assert.rejects(db.query("INSERT INTO comments(id, user_id, user_name, text, bae_job_id) VALUES('baec_00000000-0000-4000-8000-0000000000ff', 'member', 'x', 'x', $1)", [J.a]), /row-level security/);
    });
    assert.deepEqual(await notificationRows(db, 'scene-x'), [['outsider', 'mention', null]]);
    // the bell rows: the maker's list carries the BAE row with baeJobId; the app's parser keeps it
    const listed = parseCommentNotificationRows(await rpc(db, 'comment_notifications_session_list', 'maker', ',$2,$3,$4', [null, null, 200]));
    const row = listed.find((r) => r.commentId === baeSteps[0]!.comment.id);
    assert.equal(row?.comment.baeJobId, J.a);
    assert.equal(row?.reason, 'auto');
    assert.equal(row?.detail, 'assignee');
    // contentless signals only
    const sent = (await db.query("SELECT DISTINCT topic, event, payload::text AS p FROM realtime.messages WHERE topic = 'bae-gyeong-comments' OR event = 'comment-notifications-changed' ORDER BY 1")).rows;
    assert.deepEqual(sent.map((r: any) => `${r.topic}:${r.event}:${r.p}`), ['bae-gyeong-comments:comments-changed:{}', 'bflow-realtime:comment-notifications-changed:{}']);
  } finally { await db.close(); }
});

test('the smoke passes as the owner runs it (body + smoke in one batch) and leaves nothing behind', { skip: !runtime }, async () => {
  const db = await boot({ stage9: false });
  try {
    await assert.rejects(db.exec(body + '\n' + smoke), /BAE COMMENTS SMOKE OK/);
    assert.equal((await db.query("SELECT count(*)::int n FROM public.users WHERE id LIKE 'bae-comments-smoke-%'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_attribute WHERE attrelid = 'public.comments'::regclass AND attname = 'bae_job_id'")).rows[0].n, 0);
    assert.deepEqual(await fingerprints(db), PRODUCTION_FINGERPRINTS);
    // and once more on top of an applied stage 9 (the smoke's body is idempotent)
    await db.exec(sql);
    await assert.rejects(db.exec(body + '\n' + smoke), /BAE COMMENTS SMOKE OK/);
  } finally { await db.close(); }
});

test('rollback (twice) keeps scene comments working and archives BAE comments; then the migration applies again', { skip: !runtime }, async () => {
  const db = await boot();
  try {
    await setup(db);
    const c = baeSteps[0]!.comment;
    await add(db, 'reviewer', J.a, { id: c.id, text: '창문 확인' });
    await rpc(db, 'bae_gyeong_session_job_stamp', 'reviewer', ',$2::uuid,$3,$4', [J.a, 'again', '창문 크게']);
    await db.exec(rollback);
    await db.exec(rollback);
    assert.deepEqual(await fingerprints(db), PRODUCTION_FINGERPRINTS, 'every comment function is the production one again');
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_policies WHERE policyname LIKE 'bae_gyeong_%'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'bae_gyeong_%comment%'")).rows[0].n, 0);
    const archived = (await db.query('SELECT id, comment_row->>\'text\' AS text FROM bae_gyeong_comment_archive ORDER BY comment_row->>\'created_at\'')).rows as Array<{ id: string; text: string }>;
    assert.deepEqual(archived.map((r) => r.text), ['창문 확인', '다시 도장을 찍었어요.\n창문 크게']);
    await asAnon(db, async () => {
      await assert.rejects(db.query('SELECT * FROM bae_gyeong_comment_archive'), /permission denied/);
      await db.query("INSERT INTO comments(id, user_id, user_name, text, mentions) VALUES('scene-after', 'member', '허혜원', '@장삐쭈', '[\"장삐쭈\"]')");
    });
    assert.deepEqual(await notificationRows(db, 'scene-after'), [['maker', 'mention', null]]);
    // a stamp still works after the rollback and leaves no comment
    await rpc(db, 'bae_gyeong_session_job_stamp', 'reviewer', ',$2::uuid,$3,$4', [J.a, 'good', null]);
    assert.equal((await db.query("SELECT count(*)::int n FROM comments WHERE left(id, 5) = 'baec_'")).rows[0].n, 0);
    // apply again: the thread starts empty (archived comments are not put back by themselves)
    await db.exec(sql);
    assert.deepEqual((await rpc(db, 'bae_gyeong_session_comment_list', 'maker', ',$2::uuid', [J.a])).comments, []);
    await add(db, 'reviewer', J.a, { id: 'baec_00000000-0000-4000-8000-0000000000aa', text: '다시 시작' });
    assert.deepEqual(await notificationRows(db, 'baec_00000000-0000-4000-8000-0000000000aa'), [['maker', 'auto', 'assignee']]);
  } finally { await db.close(); }
});
