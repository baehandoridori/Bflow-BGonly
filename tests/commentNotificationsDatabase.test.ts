import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

import {
  commentNotificationEditRecipients,
  commentNotificationRecipients,
  type RecipientWorld,
  type RecipientWorldComment,
} from '../src/shared/commentNotificationRecipients.ts';
import { parseCommentNotificationRows } from '../src/shared/commentNotification.ts';

// 씬 댓글 서버 알림(씬 댓글 B안 PR 6). SQL 은 글자로 늘 검사하고, PostgreSQL 호환 실행기(BFLOW_PGLITE_MODULE)가 있으면
// 실제로 적용해 받는 사람·권한·실패 삼키기·커서·읽음을 돌린다. 같은 예제로 미리보기 짝(TypeScript)과 결과를 대조한다.
const sql = readFileSync(new URL('../DEVLOG/migrations/2026-11-05-comment-notifications.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const runtime = process.env.BFLOW_PGLITE_MODULE;
const code = (text: string) => text.replace(/--.*$/gm, '');
const fn = (name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf('$$;', sql.indexOf('$$', start) + 2);
  assert.ok(start >= 0 && end > start, name);
  return sql.slice(start, end + 3);
};

// ── 예제 세계 ─────────────────────────────────────────────────────────────
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const U = { han: 'u-han', kim: 'u-kim', lee: 'u-lee', park: 'u-park', won: 'u-won', dup1: 'u-dup1', dup2: 'u-dup2', act: 'u-act' } as const;
const users = [
  { id: U.han, name: '배한솔' }, { id: U.kim, name: '김어진' }, { id: U.lee, name: '이혜민' }, { id: U.park, name: '박정인' },
  { id: U.won, name: '원동우' }, { id: U.dup1, name: '최동명' }, { id: U.dup2, name: '최동명' }, { id: U.act, name: '액팅담당' },
];
const EP5 = uuid(5), EP4 = uuid(4);
const P = { aBg: uuid(51), aAct: uuid(52), bBg: uuid(53), oldBg: uuid(41), cBg: uuid(54) };
const S = { a1: uuid(511), a1Act: uuid(521), b1: uuid(531), old1: uuid(411), c1: uuid(541) };
const CHARACTER = uuid(900);
const world: RecipientWorld & { comments: RecipientWorldComment[] } = {
  users,
  episodes: [{ id: EP5, active: true }, { id: EP4, active: false }],
  parts: [
    { id: P.aBg, episodeId: EP5, partLetter: 'A', department: 'bg', active: true },
    { id: P.aAct, episodeId: EP5, partLetter: 'A', department: 'acting', active: true },
    { id: P.bBg, episodeId: EP5, partLetter: 'B', department: 'bg', active: true },
    { id: P.oldBg, episodeId: EP4, partLetter: 'A', department: 'bg', active: true },
    { id: P.cBg, episodeId: EP5, partLetter: 'C', department: 'bg', active: false },
  ],
  scenes: [
    { id: S.a1, partId: P.aBg, sceneNumber: 'a001', sortOrder: 1, assignee: '배한솔, 최동명' },
    // 대소문자·뒤 공백만 다른 상대 부서 씬(운영에 54쌍) — 같은 장면으로 본다.
    { id: S.a1Act, partId: P.aAct, sceneNumber: 'A001 ', sortOrder: 3, assignee: '액팅담당' },
    { id: S.b1, partId: P.bBg, sceneNumber: 'a001', sortOrder: 1, assignee: '박정인' },
    { id: S.old1, partId: P.oldBg, sceneNumber: 'a001', sortOrder: 1, assignee: '원동우' },
    { id: S.c1, partId: P.cBg, sceneNumber: 'c001', sortOrder: 1, assignee: '원동우' },
  ],
  comments: [],
  revisions: [{ id: 'rev-1', requesterId: U.kim, notifyUserIds: [U.lee, U.park], assigneeIds: [U.lee, U.won] }],
};
type Comment = RecipientWorldComment & { userName: string; text: string };
const comment = (id: string, userId: string, fields: Partial<Comment>): Comment => ({
  id, userId, userName: users.find((u) => u.id === userId)!.name, text: `${id} 본문`,
  partId: null, sceneId: null, sceneUuid: null, mentions: [], parentCommentId: null, revisionId: null, characterId: null, ...fields,
});
type Expected = Array<[string, string, string | null]>;
const sorted = (rows: Expected) => [...rows].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const steps: Array<{ comment: Comment; expected: Expected; why: string }> = [
  {
    why: '씬 댓글: 멘션 > 담당 > 상대 부서 담당(대소문자 다른 씬 번호), 이름이 같은 두 사람은 모두',
    comment: comment('c1', U.kim, { partId: P.aBg, sceneId: '1', sceneUuid: S.a1, mentions: ['이혜민'] }),
    expected: [[U.lee, 'mention', null], [U.han, 'auto', 'assignee'], [U.dup1, 'auto', 'assignee'], [U.dup2, 'auto', 'assignee'], [U.act, 'auto', 'counterpart']],
  },
  {
    why: '답글(씬 uuid 없이 파트·순서로 씬 찾기): 원댓글 작성자 reply, 자기 부서 담당, 상대 부서 담당',
    comment: comment('c2', U.won, { partId: P.aAct, sceneId: '3', parentCommentId: 'c1' }),
    expected: [[U.kim, 'reply', null], [U.act, 'auto', 'assignee'], [U.han, 'auto', 'counterpart'], [U.dup1, 'auto', 'counterpart'], [U.dup2, 'auto', 'counterpart']],
  },
  {
    why: '리테이크 댓글: 요청자·알림 대상만(알림 대상 밖 담당자는 빼고), 담당·참여자 자동 알림은 섞지 않는다',
    comment: comment('c3', U.han, { partId: P.aBg, sceneId: '1', sceneUuid: S.a1, revisionId: 'rev-1' }),
    expected: [[U.kim, 'retake', null], [U.lee, 'retake', null], [U.park, 'retake', null]],
  },
  {
    why: '캐릭터 댓글: 직접 멘션만, 모르는 이름은 버린다',
    comment: comment('c4', U.lee, { characterId: CHARACTER, mentions: ['배한솔', '없는사람'] }),
    expected: [[U.han, 'mention', null]],
  },
  {
    why: '보관한 에피소드의 씬은 자동 알림이 없다',
    comment: comment('c5', U.park, { partId: P.oldBg, sceneId: '1', sceneUuid: S.old1 }),
    expected: [],
  },
  {
    why: '작성자 본인 멘션은 빼고, 상대 부서 같은 씬에 댓글 단 사람은 참여자(리테이크 댓글 작성자는 이미 담당)',
    comment: comment('c6', U.kim, { partId: P.aBg, sceneId: '1', sceneUuid: S.a1, mentions: ['김어진'] }),
    expected: [[U.han, 'auto', 'assignee'], [U.dup1, 'auto', 'assignee'], [U.dup2, 'auto', 'assignee'], [U.act, 'auto', 'counterpart'], [U.won, 'auto', 'participant']],
  },
  {
    why: '같은 이름 멘션은 두 사람 모두, 상대 부서 파트가 없는 씬은 담당만',
    comment: comment('c7', U.han, { partId: P.bBg, sceneId: '1', sceneUuid: S.b1, mentions: ['최동명'] }),
    expected: [[U.dup1, 'mention', null], [U.dup2, 'mention', null], [U.park, 'auto', 'assignee']],
  },
  {
    why: '쉬는(활성 아닌) 파트의 씬은 자동 알림이 없다',
    comment: comment('c8', U.kim, { partId: P.cBg, sceneId: '1', sceneUuid: S.c1 }),
    expected: [],
  },
];

// ── 글자 검사 (실행기 없이 늘) ─────────────────────────────────────────────

test('N-1: 한 트랜잭션, RLS 켜고 정책·FK 없음, publication 에 넣지 않는다', () => {
  const body = code(sql);
  assert.match(body, /^BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';/m);
  assert.match(body, /^COMMIT;\s*$/m);
  assert.match(body, /ALTER TABLE public\.comment_notifications ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(body, /CREATE POLICY|REFERENCES |ADD TABLE/);
  assert.match(body, /ALTER PUBLICATION supabase_realtime DROP TABLE public\.comment_notifications;/);
  assert.match(body, /REVOKE ALL PRIVILEGES ON TABLE public\.comment_notifications FROM PUBLIC;/);
});

test('N-2: 트리거 셋은 모든 예외를 삼키고, 신호는 내용 없이 함수 하나에서만', () => {
  for (const name of ['comment_notifications_on_insert', 'comment_notifications_on_mentions', 'comment_notifications_on_delete']) {
    const body = fn(name);
    assert.match(body, /SECURITY DEFINER SET search_path = public, pg_temp/, name);
    assert.match(body, /EXCEPTION WHEN OTHERS THEN\n\s+RAISE WARNING/, name);
    assert.match(body, /RETURN NULL;/, name);
  }
  assert.equal((code(sql).match(/realtime\.send/g) ?? []).length, 2, 'to_regprocedure 확인과 실행 한 쌍뿐');
  assert.match(fn('comment_notifications_fanout'), /USING '\{\}'::JSONB, 'comment-notifications-changed', 'bflow-realtime', false;/);
  assert.match(code(sql), /AFTER UPDATE OF mentions ON public\.comments\n\s+FOR EACH ROW WHEN \(OLD\.mentions IS DISTINCT FROM NEW\.mentions\)/);
});

test('N-3: 공개 래퍼 두 개만 실행 권한, 둘 다 세션 토큰으로 호출자를 확정한다', () => {
  const grants = [...code(sql).matchAll(/GRANT EXECUTE ON FUNCTION([^%]+)TO %I/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
  assert.deepEqual(grants, ['public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER), public.comment_notifications_session_mark_read(TEXT, TEXT[], TEXT[])']);
  for (const name of ['comment_notifications_session_list', 'comment_notifications_session_mark_read']) {
    const body = fn(name);
    assert.match(body, /v_user := public\.app_session_user_id\(p_session_token\);/, name);
    assert.match(body, /WHERE recipient_id = v_user|WHERE n\.recipient_id = v_user/, name);
    assert.doesNotMatch(body, /p_actor|p_user_id|p_recipient/, name);
  }
});

test('N-4: 미리보기 짝(TypeScript)이 예제마다 기대한 받는 사람을 낸다', () => {
  const local = { ...world, comments: [] as RecipientWorldComment[] };
  for (const step of steps) {
    local.comments.push(step.comment);
    const actual = commentNotificationRecipients(local, step.comment.id).map((r) => [r.recipientId, r.reason, r.detail] as [string, string, string | null]);
    assert.deepEqual(sorted(actual), sorted(step.expected), step.why);
  }
  assert.deepEqual(commentNotificationEditRecipients(local, 'c1', ['이혜민'], ['이혜민', '박정인', '김어진']), [U.park], '수정: 새로 넣은 사람만, 작성자 본인은 빼고');
  assert.deepEqual(commentNotificationEditRecipients(local, 'c1', ['이혜민'], ['최동명']), [U.dup1, U.dup2]);
  assert.deepEqual(commentNotificationRecipients(local, 'nope'), []);
});

// ── 실제 실행 (BFLOW_PGLITE_MODULE) ───────────────────────────────────────

const tokens = Object.fromEntries(Object.values(U).map((id, i) => [id, (i + 1).toString(16).repeat(64).slice(0, 64)])) as Record<string, string>;

async function boot() {
  const { PGlite } = await import(pathToFileURL(runtime!).href);
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
    CREATE TABLE public.users(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT DEFAULT 'user');
    CREATE TABLE public.episodes(id UUID PRIMARY KEY, episode_number INTEGER NOT NULL, status TEXT DEFAULT 'active');
    CREATE TABLE public.parts(id UUID PRIMARY KEY, episode_id UUID NOT NULL, part_id TEXT NOT NULL, department TEXT NOT NULL, status TEXT DEFAULT 'active');
    CREATE TABLE public.scenes(id UUID PRIMARY KEY, part_id UUID NOT NULL, scene_number TEXT NOT NULL, sort_order INTEGER NOT NULL, assignee TEXT);
    CREATE TABLE public.comp_revisions(id TEXT PRIMARY KEY, revision_no INTEGER NOT NULL, requester_id TEXT,
      notify_user_ids JSONB DEFAULT '[]', assignee_ids JSONB NOT NULL DEFAULT '[]');
    CREATE TABLE public.comments(id TEXT PRIMARY KEY, part_id UUID, scene_id TEXT, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
      text TEXT NOT NULL, mentions JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT now(), edited_at TIMESTAMPTZ, scene_uuid UUID,
      images JSONB DEFAULT '[]', revision_id TEXT REFERENCES public.comp_revisions(id) ON DELETE CASCADE,
      parent_comment_id TEXT REFERENCES public.comments(id) ON DELETE SET NULL, character_id UUID, costume_id UUID);
    CREATE SCHEMA realtime; CREATE TABLE realtime.messages(payload JSONB, event TEXT, topic TEXT, private BOOLEAN);
    CREATE FUNCTION realtime.send(payload JSONB, event TEXT, topic TEXT, private BOOLEAN) RETURNS VOID LANGUAGE SQL
      AS 'INSERT INTO realtime.messages VALUES(payload, event, topic, private)';`);
  for (const u of users) await db.query('INSERT INTO users(id, name) VALUES($1, $2)', [u.id, u.name]);
  await db.query("INSERT INTO episodes VALUES($1, 5, 'active'), ($2, 4, 'archived')", [EP5, EP4]);
  for (const p of world.parts) await db.query('INSERT INTO parts VALUES($1, $2, $3, $4, $5)', [p.id, p.episodeId, p.partLetter, p.department, p.active ? 'active' : 'inactive']);
  for (const s of world.scenes) await db.query('INSERT INTO scenes VALUES($1, $2, $3, $4, $5)', [s.id, s.partId, s.sceneNumber, s.sortOrder, s.assignee]);
  for (const r of world.revisions) await db.query('INSERT INTO comp_revisions VALUES($1, 7, $2, $3, $4)', [r.id, r.requesterId, JSON.stringify(r.notifyUserIds), JSON.stringify(r.assigneeIds)]);
  const auth = readFileSync(new URL('../DEVLOG/migrations/2026-09-05-app-sessions-gantt-auth.sql', import.meta.url), 'utf8');
  await db.exec(auth.slice(0, auth.indexOf('-- ── 3)')));
  await db.exec('REVOKE ALL ON FUNCTION public.app_session_user_id(text) FROM PUBLIC, anon, authenticated');
  for (const [id, token] of Object.entries(tokens)) {
    await db.query("INSERT INTO app_sessions(token_hash, user_id, expires_at) VALUES($1, $2, now() + interval '1 day')", [createHash('sha256').update(token).digest('hex'), id]);
  }
  return db;
}

type Db = Awaited<ReturnType<typeof boot>>;
const asSuper = async <T>(db: Db, run: () => Promise<T>): Promise<T> => {
  await db.exec('RESET ROLE');
  try { return await run(); } finally { await db.exec('SET ROLE anon'); }
};
const insertComment = (db: Db, c: Comment, createdAt?: string) => db.query(
  `INSERT INTO comments(id, part_id, scene_id, scene_uuid, user_id, user_name, text, mentions, revision_id, parent_comment_id, character_id${createdAt ? ', created_at' : ''})
   VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11${createdAt ? ', $12' : ''})`,
  [c.id, c.partId, c.sceneId, c.sceneUuid, c.userId, c.userName, c.text, JSON.stringify(c.mentions), c.revisionId, c.parentCommentId, c.characterId, ...(createdAt ? [createdAt] : [])],
);
const rowsFor = async (db: Db, commentId: string) => asSuper(db, async () => (await db.query(
  'SELECT recipient_id, reason, detail, kind, read_at FROM comment_notifications WHERE comment_id = $1 ORDER BY recipient_id, kind', [commentId],
)).rows as Array<{ recipient_id: string; reason: string; detail: string | null; kind: string; read_at: unknown }>);
const signals = async (db: Db) => asSuper(db, async () => (await db.query("SELECT count(*)::int AS n FROM realtime.messages WHERE event = 'comment-notifications-changed'")).rows[0] as { n: number });
const list = async (db: Db, who: string, afterAt: string | null = null, afterId: string | null = null, limit = 200) =>
  parseCommentNotificationRows((await db.query('SELECT comment_notifications_session_list($1, $2, $3, $4) AS value', [tokens[who], afterAt, afterId, limit])).rows[0].value);
const markRead = async (db: Db, who: string, add: string[], edit: string[] = []) =>
  ((await db.query('SELECT comment_notifications_session_mark_read($1, $2, $3) AS value', [tokens[who], add, edit])).rows[0] as { value: { updated: number } }).value.updated;

test('N-5: 두 번 적용해도 같고, 댓글마다 서버 줄이 미리보기 짝·기대와 같다(신호는 줄이 생길 때만 한 번)', { skip: !runtime }, async () => {
  const db = await boot();
  try {
    await db.exec(sql); await db.exec(sql); await db.exec('SET ROLE anon');
    const local = { ...world, comments: [] as RecipientWorldComment[] };
    for (const step of steps) {
      const before = (await signals(db)).n;
      await insertComment(db, step.comment);
      local.comments.push(step.comment);
      const server = (await rowsFor(db, step.comment.id)).map((r) => [r.recipient_id, r.reason, r.detail] as [string, string, string | null]);
      assert.deepEqual(sorted(server), sorted(step.expected), step.why);
      const twin = commentNotificationRecipients(local, step.comment.id).map((r) => [r.recipientId, r.reason, r.detail] as [string, string, string | null]);
      assert.deepEqual(sorted(twin), sorted(server), `미리보기 짝과 서버가 같다: ${step.why}`);
      assert.equal((await signals(db)).n, before + (step.expected.length > 0 ? 1 : 0), `신호: ${step.comment.id}`);
    }

    // 수정으로 새로 넣은 @: 그 사람에게만 'edit' 멘션 줄. 빼기만 한 수정은 아무것도 없다. 다시 넣으면 그 줄을 안 읽음으로 새로.
    await db.query(`UPDATE comments SET mentions = '["이혜민","박정인","김어진"]', edited_at = now() WHERE id = 'c1'`);
    assert.deepEqual((await rowsFor(db, 'c1')).filter((r) => r.kind === 'edit').map((r) => [r.recipient_id, r.reason]), [[U.park, 'mention']]);
    assert.equal(await markRead(db, U.park, [], ['c1']), 1);
    const quiet = (await signals(db)).n;
    await db.query(`UPDATE comments SET mentions = '["김어진"]' WHERE id = 'c1'`);
    await db.query(`UPDATE comments SET text = '글만 고침' WHERE id = 'c1'`);
    assert.equal((await signals(db)).n, quiet, '빼기·글만 고친 수정은 신호가 없다');
    await db.query(`UPDATE comments SET mentions = '["박정인"]' WHERE id = 'c1'`);
    const again = (await rowsFor(db, 'c1')).find((r) => r.kind === 'edit' && r.recipient_id === U.park)!;
    assert.equal(again.read_at, null, '다시 넣으면 안 읽음으로');
    assert.equal((await signals(db)).n, quiet + 1);
    // 배열이 아닌 mentions 도 저장은 막지 않는다.
    await db.query(`INSERT INTO comments(id, user_id, user_name, text, mentions) VALUES('odd', $1, '배한솔', 'x', '{"a":1}')`, [U.han]);
    await db.query(`UPDATE comments SET mentions = '"이혜민"' WHERE id = 'odd'`);
    assert.deepEqual(await rowsFor(db, 'odd'), []);
  } finally { await db.close(); }
});

test('N-6: 앱이 닿는 길은 래퍼 둘 — 내 줄만, 커서·읽음, 표·내부 함수는 막힘', { skip: !runtime }, async () => {
  const db = await boot();
  try {
    await db.exec(sql); await db.exec('SET ROLE anon');
    for (const step of steps) await insertComment(db, step.comment);

    const mine = await list(db, U.han);
    assert.deepEqual(mine.map((r) => [r.commentId, r.reason, r.detail]), [
      ['c1', 'auto', 'assignee'], ['c2', 'auto', 'counterpart'], ['c4', 'mention', null], ['c6', 'auto', 'assignee'],
    ], '쓴 순서대로, 내 줄만(c3·c7 은 내가 쓴 것)');
    assert.equal(mine[2]!.comment.characterId, CHARACTER);
    assert.deepEqual(mine[2]!.comment.mentions, ['배한솔', '없는사람']);
    assert.equal(mine[0]!.comment.sceneUuid, S.a1);
    assert.equal(mine[0]!.comment.userName, '김어진');
    const retake = await list(db, U.lee);
    assert.equal(retake.find((r) => r.commentId === 'c3')?.revisionNo, 7, '리테이크 번호를 같이');

    // 커서: (시각, id) 뒤로만. id 없이 시각만 주면 그 시각보다 뒤.
    const after = await list(db, U.han, mine[1]!.eventAt, mine[1]!.id);
    assert.deepEqual(after.map((r) => r.commentId), ['c4', 'c6']);
    assert.deepEqual((await list(db, U.han, mine[3]!.eventAt, null)).map((r) => r.commentId), []);
    assert.deepEqual((await list(db, U.han, null, null, 1)).map((r) => r.commentId), ['c1'], '한 번에 받는 수 제한');

    // 읽음: 내 줄만, 이미 읽은 줄은 그대로. 남의 댓글 id 를 보내도 남의 줄은 바뀌지 않는다.
    assert.equal(await markRead(db, U.han, ['c1', 'c4', 'c3']), 2);
    assert.equal(await markRead(db, U.han, ['c1']), 0);
    assert.ok((await list(db, U.han)).find((r) => r.commentId === 'c1')?.readAt);
    assert.equal(await markRead(db, U.kim, ['c1']), 0, '김어진은 c1 줄이 없다(작성자)');
    assert.equal((await list(db, U.lee)).find((r) => r.commentId === 'c1')?.readAt, null, '이혜민의 c1 줄은 그대로');
    await assert.rejects(markRead(db, U.han, Array.from({ length: 501 }, (_, i) => `x${i}`)), { code: '22023' });

    // 세션: 잘못된 토큰·지워진 사용자는 42501.
    await assert.rejects(db.query('SELECT comment_notifications_session_list($1, NULL, NULL, 10)', ['bad']), { code: '42501' });
    await asSuper(db, async () => { await db.query('DELETE FROM app_sessions WHERE user_id = $1', [U.won]); });
    await assert.rejects(list(db, U.won), { code: '42501' });

    // 표와 내부 함수는 anon 이 못 쓴다.
    await assert.rejects(db.query('SELECT * FROM comment_notifications'), { code: '42501' });
    await assert.rejects(db.query(`INSERT INTO comment_notifications(recipient_id, comment_id, kind, reason, actor_id) VALUES('u-han', 'c1', 'add', 'mention', 'u-kim')`), { code: '42501' });
    await assert.rejects(db.query(`SELECT * FROM comment_notifications_recipients('c1')`), { code: '42501' });
    await assert.rejects(db.query(`SELECT comment_notifications_fanout('c1', 'add', NULL, NULL, true)`), { code: '42501' });

    // 댓글을 지우면 그 줄도 사라진다(리테이크를 지워 댓글이 함께 지워질 때도).
    await db.query(`DELETE FROM comments WHERE id = 'c6'`);
    assert.deepEqual(await rowsFor(db, 'c6'), []);
    assert.ok(!(await list(db, U.han)).some((r) => r.commentId === 'c6'));
    await db.query(`DELETE FROM comp_revisions WHERE id = 'rev-1'`);
    assert.deepEqual(await rowsFor(db, 'c3'), []);
  } finally { await db.close(); }
});

test('N-7: 알림 만들기가 실패해도 댓글은 저장·수정·삭제되고, 다시 적용하면 최근 30일 댓글을 신호 없이 채운다', { skip: !runtime }, async () => {
  const db = await boot();
  try {
    // 적용 전에 있던 댓글: 5일 전 것은 채우고, 40일 전 것은 채우지 않는다.
    const recent = comment('pre-recent', U.kim, { partId: P.aBg, sceneId: '1', sceneUuid: S.a1, mentions: ['이혜민'] });
    const old = comment('pre-old', U.kim, { partId: P.aBg, sceneId: '1', sceneUuid: S.a1, mentions: ['이혜민'] });
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
    await insertComment(db, recent, fiveDaysAgo);
    await insertComment(db, old, new Date(Date.now() - 40 * 86400000).toISOString());
    await db.exec(sql);
    await db.exec('SET ROLE anon');
    assert.deepEqual((await rowsFor(db, 'pre-recent')).map((r) => [r.recipient_id, r.reason]), [[U.act, 'auto'], [U.dup1, 'auto'], [U.dup2, 'auto'], [U.han, 'auto'], [U.lee, 'mention']]);
    assert.deepEqual(await rowsFor(db, 'pre-old'), []);
    assert.equal((await signals(db)).n, 0, '채우기는 신호를 보내지 않는다');
    const filled = (await list(db, U.lee)).find((r) => r.commentId === 'pre-recent')!;
    assert.equal(Date.parse(filled.eventAt), Date.parse(fiveDaysAgo), '채운 줄의 시각은 댓글을 쓴 시각');

    // 받는 사람 계산을 일부러 망가뜨린다 — 댓글 저장·수정은 그대로 된다.
    await asSuper(db, async () => {
      await db.exec(`CREATE OR REPLACE FUNCTION public.comment_notifications_recipients(p_comment_id TEXT)
        RETURNS TABLE(recipient_id TEXT, reason TEXT, detail TEXT) LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
        CREATE OR REPLACE FUNCTION public.comment_notifications_names(p_value JSONB) RETURNS TEXT[] LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;`);
    });
    const broken = comment('broken', U.kim, { partId: P.aBg, sceneId: '1', sceneUuid: S.a1, mentions: ['이혜민'] });
    await insertComment(db, broken);
    await db.query(`UPDATE comments SET mentions = '["박정인"]' WHERE id = 'broken'`);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM comments WHERE id = 'broken'`)).rows[0].n, 1);
    assert.deepEqual(await rowsFor(db, 'broken'), []);
    // 알림 표 자체가 없어도(이름이 바뀌어 넣기·지우기가 실패해도) 댓글 저장·삭제는 된다.
    await asSuper(db, async () => { await db.exec('ALTER TABLE public.comment_notifications RENAME TO comment_notifications_away'); });
    await insertComment(db, comment('lost', U.lee, { partId: P.bBg, sceneId: '1', sceneUuid: S.b1 }));
    await db.query(`DELETE FROM comments WHERE id = 'pre-old'`);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM comments WHERE id IN ('lost', 'pre-old')`)).rows[0].n, 1);
    await asSuper(db, async () => { await db.exec('ALTER TABLE public.comment_notifications_away RENAME TO comment_notifications'); });

    // 다시 적용하면 고쳐지고, 놓친 새 댓글도 채운다(신호 없음). 있던 줄은 겹치지 않는다.
    await asSuper(db, async () => { await db.exec(sql); });
    assert.deepEqual((await rowsFor(db, 'broken')).map((r) => [r.recipient_id, r.reason]), [[U.act, 'auto'], [U.dup1, 'auto'], [U.dup2, 'auto'], [U.han, 'auto'], [U.park, 'mention']]);
    assert.deepEqual((await rowsFor(db, 'lost')).map((r) => [r.recipient_id, r.reason, r.detail]), [[U.park, 'auto', 'assignee']]);
    assert.equal((await rowsFor(db, 'pre-recent')).length, 5);
    assert.equal((await signals(db)).n, 0);
  } finally { await db.close(); }
});
