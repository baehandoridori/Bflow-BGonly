import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// BAE경 8단계 서버 (DEVLOG/migrations/2026-11-16-bae-gyeong-review.sql): 확인 도장 · 팀 기록 거르기 · 새 도장 숫자 · 팀 비용.
// 글자로 보는 검사는 늘 돌고, 실제 실행은 PostgreSQL 호환 실행기(BFLOW_PGLITE_MODULE, tests/baeGyeongDatabase.test.ts 와 같은 방식)가 있을 때 돈다.
const base = readFileSync(new URL('../DEVLOG/migrations/2026-11-13-bae-gyeong-base.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sql = readFileSync(new URL('../DEVLOG/migrations/2026-11-16-bae-gyeong-review.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const smoke = readFileSync(new URL('../DEVLOG/verification/2026-11-16-bae-gyeong-review-smoke.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const runtime = process.env.BFLOW_PGLITE_MODULE;
/** 이 파일에서 맨 위 BEGIN; 과 맨 아래 COMMIT; 두 줄만 뺀 본문 (운영 예행연습과 같은 묶음). */
const body = sql.replace(/^BEGIN;\n/m, '').replace(/\nCOMMIT;\n?$/, '\n');

test('the review tables are closed (RLS on, no policy) and only the session wrappers are granted', () => {
  for (const t of ['bae_gyeong_stamps', 'bae_gyeong_stamp_seen']) assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY;`), t);
  assert.doesNotMatch(sql, /CREATE POLICY/);
  assert.doesNotMatch(sql, /ALTER PUBLICATION/, 'no table goes into the realtime publication');
  assert.match(sql, /p\.proname LIKE 'bae_gyeong_session_%' LOOP\n\s*EXECUTE format\('GRANT EXECUTE ON FUNCTION %s TO %I', fn, role_name\);/);
  for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)) assert.ok(m[1].startsWith('bae_gyeong_'), m[1]);
  assert.deepEqual([...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(bae_gyeong_session_[a-z_]+)\(/g)].map((m) => m[1]).sort(), [
    'bae_gyeong_session_job_find_team', 'bae_gyeong_session_job_stamp', 'bae_gyeong_session_job_stamp_bulk', 'bae_gyeong_session_job_stamps',
    'bae_gyeong_session_stamp_seen', 'bae_gyeong_session_stamp_unseen', 'bae_gyeong_session_usage_team'].sort());
  // nothing of the base file is redefined here (rerunning the base file must not undo this file)
  for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)) assert.ok(!base.includes(`FUNCTION public.${m[1]}(`), m[1]);
  // 사람은 세션 토큰으로만 — 부르는 쪽이 보낸 id 를 믿지 않는다 (거르기의 userId 는 '누구의 기록을 볼까'일 뿐)
  assert.doesNotMatch(sql, /p_actor_id|p_user_name/);
  assert.match(sql, /public\.bae_gyeong_actor\(p_session_token\)/);
  // 서버 API 가 스스로 다시 부르는 오류 번호(40001 · 40P01)는 쓰지 않는다
  assert.doesNotMatch(sql, /ERRCODE\s*=\s*'40(001|P01)'/);
  // users 는 명시 칸만
  assert.doesNotMatch(sql, /SELECT \* FROM public\.users/);
  // a stamp keeps updated_at moving (the lists read 'what changed after')
  assert.match(sql, /stamp_note = nt, updated_at = now\(\)/);
  assert.match(sql, /stamp_note = NULL, updated_at = now\(\)/);
  assert.match(smoke, /RAISE EXCEPTION 'BAE REVIEW SMOKE OK/);
  assert.doesNotMatch(smoke, /^\s*(BEGIN|COMMIT)\s*;/m);
  assert.ok(!/^BEGIN;|^COMMIT;/m.test(body), 'the body leaves out BEGIN and COMMIT');
});

const tokens = { admin: 'a'.repeat(64), maker1: 'b'.repeat(64), maker2: 'c'.repeat(64), reviewer: 'd'.repeat(64), outsider: 'e'.repeat(64) };
type Who = keyof typeof tokens;
async function boot(withReview = true) {
  const { PGlite } = await import(pathToFileURL(runtime!).href); const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
    CREATE TABLE public.users(id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', role TEXT DEFAULT 'user', password TEXT);
    INSERT INTO users(id, role, name) VALUES('admin','admin','관리자'),('maker1','user','장삐쭈'),('maker2','user','허혜원'),('reviewer','user','안류천'),('outsider','user','바깥');
    CREATE SCHEMA realtime; CREATE TABLE realtime.messages(payload JSONB, event TEXT, topic TEXT, private BOOLEAN);
    CREATE FUNCTION realtime.send(payload JSONB, event TEXT, topic TEXT, private BOOLEAN) RETURNS VOID LANGUAGE SQL AS 'INSERT INTO realtime.messages VALUES(payload,event,topic,private)';
    CREATE SCHEMA vault; CREATE TABLE vault.secrets(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), secret TEXT, name TEXT, description TEXT);
    CREATE FUNCTION vault.create_secret(s TEXT, n TEXT, d TEXT) RETURNS UUID LANGUAGE SQL AS 'INSERT INTO vault.secrets(secret,name,description) VALUES(s,n,d) RETURNING id';
    CREATE FUNCTION vault.update_secret(i UUID, s TEXT) RETURNS VOID LANGUAGE SQL AS 'UPDATE vault.secrets SET secret=s WHERE id=i';
    CREATE VIEW vault.decrypted_secrets AS SELECT id, secret AS decrypted_secret FROM vault.secrets;
    REVOKE ALL ON SCHEMA vault FROM PUBLIC; REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC, anon, authenticated;`);
  const auth = readFileSync(new URL('../DEVLOG/migrations/2026-09-05-app-sessions-gantt-auth.sql', import.meta.url), 'utf8');
  await db.exec(auth.slice(0, auth.indexOf('-- ── 3)')));
  await db.exec('REVOKE ALL ON FUNCTION public.app_session_user_id(text) FROM PUBLIC,anon,authenticated');
  for (const who of Object.keys(tokens) as Who[]) {
    await db.query("INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [createHash('sha256').update(tokens[who]).digest('hex'), who]);
  }
  await db.exec(base);
  if (withReview) await db.exec(sql);
  return db;
}
const asAnon = async (db: any, q: string, args: unknown[] = []) => { await db.exec('SET ROLE anon'); try { return (await db.query(q, args)).rows; } finally { await db.exec('RESET ROLE'); } };
const rpc = async (db: any, name: string, who: Who, extra = '', args: unknown[] = []) =>
  (await asAnon(db, `SELECT public.${name}($1${extra}) AS r`, [tokens[who], ...args]))[0].r;
const J = { a1: '11111111-1111-4111-8111-111111111111', a2: '11111111-1111-4111-8111-111111111112', a3: '11111111-1111-4111-8111-111111111113',
  b1: '22222222-2222-4222-8222-222222222221', b2: '22222222-2222-4222-8222-222222222222' };
const up = (db: any, who: Who, job: unknown) => rpc(db, 'bae_gyeong_session_job_upsert', who, ',$2::jsonb', [JSON.stringify(job)]);
const log = (db: any, who: Who, row: unknown) => rpc(db, 'bae_gyeong_session_usage_log', who, ',$2::jsonb', [JSON.stringify(row)]);
const find = (db: any, who: Who, filter: unknown, before: unknown = null, limit = 50) => rpc(db, 'bae_gyeong_session_job_find_team', who, ',$2::jsonb,$3::jsonb,$4', [JSON.stringify(filter), before === null ? null : JSON.stringify(before), limit]);
const stamp = (db: any, who: Who, jobId: string, s: string | null, note: string | null = null) => rpc(db, 'bae_gyeong_session_job_stamp', who, ',$2::uuid,$3,$4', [jobId, s, note]);
const code = (c: string) => (e: { code?: string }) => e.code === c;

async function setup(db: any) {
  await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['maker1', 'user']);
  await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['maker2', 'user']);
  await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['reviewer', 'reviewer']);
  await up(db, 'maker1', { id: J.a1, kind: 'new', status: 'done', name: '주차장 저녁', summary: { request: '아파트 지하 주차장' }, pd: { summaryKo: '지하 주차장 요약', prompt: 'An underground ZEBRA parking lot' }, costUsd: 0.0993 });
  await up(db, 'maker1', { id: J.a2, kind: 'same', status: 'done', summary: { request: '거실 50%_할인 포스터' } });
  await up(db, 'maker1', { id: J.a3, kind: 'new', status: 'drawing', summary: { request: '그리는 중인 교실' } });
  await up(db, 'maker2', { id: J.b1, kind: 'edit', status: 'done', summary: { request: '교실 고치기' } });
  await up(db, 'maker2', { id: J.b2, kind: 'import', status: 'failed', summary: { request: '불러온 사진' } });
  await log(db, 'maker1', { jobId: J.a1, kind: 'order', model: 'gpt-6.1-sol', usd: 0.0241, requestId: 'a1-order' });
  await log(db, 'maker1', { jobId: J.a1, kind: 'image', model: 'gpt-image-2.5-sunburst', usd: 0.0752, requestId: 'a1-image' });
  await log(db, 'maker1', { jobId: J.a2, kind: 'image', model: 'gpt-image-2.5-sunburst', usd: 0.0801, requestId: 'a2-image' });
  await log(db, 'maker2', { jobId: J.b1, kind: 'order', model: 'gpt-6.1-sol', usd: 0.0198, requestId: 'b1-order' });
  await log(db, 'maker2', { jobId: J.b1, kind: 'image', model: 'gpt-image-2.5-sunburst', usd: 0.0834, requestId: 'b1-image' });
}

test('the review file runs: two makers never see each other, a reviewer sees and stamps both, the maker counts new stamps, costs add up', { skip: !runtime }, async (t) => {
  const db = await boot();
  try {
    await setup(db);
    await t.test('anon can execute the wrappers and nothing else, and reads no new table directly', async () => {
      const open = (await db.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'bae_gyeong_%' AND has_function_privilege('anon',p.oid,'EXECUTE') ORDER BY 1")).rows.map((r: any) => r.proname);
      for (const n of ['bae_gyeong_session_job_stamp', 'bae_gyeong_session_job_find_team', 'bae_gyeong_session_usage_team', 'bae_gyeong_session_stamp_unseen']) assert.ok(open.includes(n), n);
      assert.ok(open.every((n: string) => n.startsWith('bae_gyeong_session_')), open.join(','));
      for (const tbl of ['bae_gyeong_stamps', 'bae_gyeong_stamp_seen']) await assert.rejects(asAnon(db, `SELECT * FROM public.${tbl}`), /permission denied/, tbl);
      await assert.rejects(asAnon(db, 'SELECT public.bae_gyeong_stamp_unseen_of($1)', ['maker1']), /permission denied/);
      await assert.rejects(asAnon(db, 'SELECT public.bae_gyeong_session_stamp_unseen($1)', ['f'.repeat(64)]), /로그인 세션/);
    });

    await t.test('two test accounts: neither sees the other\'s records through any door — the server refuses', async () => {
      for (const [who, other] of [['maker1', J.b1], ['maker2', J.a1]] as const) {
        await assert.rejects(find(db, who, {}), (e: { code?: string; message?: string }) => e.code === '42501' && /검수자만/.test(e.message ?? ''));
        await assert.rejects(rpc(db, 'bae_gyeong_session_job_list_team', who, ',$2,$3', [null, 50]), code('42501'));
        await assert.rejects(rpc(db, 'bae_gyeong_session_job_get', who, ',$2::uuid', [other]), code('42501'));
        await assert.rejects(rpc(db, 'bae_gyeong_session_job_stamps', who, ',$2::uuid', [other]), code('42501'));
        await assert.rejects(rpc(db, 'bae_gyeong_session_usage_team', who, ',$2,$3,$4', [null, null, 'day']), code('42501'));
        const mine = await rpc(db, 'bae_gyeong_session_job_list_mine', who, ',$2,$3', [null, 50]);
        assert.ok(mine.rows.every((r: any) => r.userId === who), `${who} sees only their own`);
      }
      await assert.rejects(find(db, 'outsider', {}), code('42501'));
    });

    await t.test('the reviewer sees both makers as the team, filtered on the server, paged with a cursor', async () => {
      const all = await find(db, 'reviewer', {});
      assert.deepEqual(new Set(all.rows.map((r: any) => r.userId)), new Set(['maker1', 'maker2']));
      assert.equal(all.rows.length, 5); assert.equal(all.more, false); assert.equal(all.next, null);
      assert.ok(all.rows.every((r: any) => !('pd' in r)), 'the list shape leaves the PD words out');
      assert.deepEqual((await find(db, 'admin', { userId: 'maker2' })).rows.map((r: any) => r.id).sort(), [J.b1, J.b2].sort());
      assert.deepEqual((await find(db, 'reviewer', { kind: 'same' })).rows.map((r: any) => r.id), [J.a2]);
      // words in the description, the name, the PD summary or the English order; % and _ are plain letters
      assert.deepEqual((await find(db, 'reviewer', { q: 'zebra' })).rows.map((r: any) => r.id), [J.a1], 'the order text');
      assert.deepEqual((await find(db, 'reviewer', { q: '저녁' })).rows.map((r: any) => r.id), [J.a1], 'the name');
      assert.deepEqual((await find(db, 'reviewer', { q: '요약' })).rows.map((r: any) => r.id), [J.a1], 'the PD summary');
      assert.deepEqual((await find(db, 'reviewer', { q: '50%_' })).rows.map((r: any) => r.id), [J.a2]);
      assert.deepEqual((await find(db, 'reviewer', { q: '%' })).rows.map((r: any) => r.id), [J.a2], '% is a letter, not a wildcard');
      // 도장 없음 = finished and not stamped (the job being drawn is not waiting for a stamp)
      assert.deepEqual((await find(db, 'reviewer', { unstamped: true })).rows.map((r: any) => r.id).sort(), [J.a1, J.a2, J.b1, J.b2].sort());
      // period: made between from and to
      await db.query("UPDATE public.bae_gyeong_jobs SET created_at = now() - interval '40 days' WHERE id = $1", [J.b2]);
      const recent = await find(db, 'reviewer', { from: new Date(Date.now() - 7 * 86400_000).toISOString() });
      assert.ok(!recent.rows.some((r: any) => r.id === J.b2));
      assert.deepEqual((await find(db, 'reviewer', { to: new Date(Date.now() - 30 * 86400_000).toISOString() })).rows.map((r: any) => r.id), [J.b2]);
      // paging: 2 + 2 + 1, no row twice, newest made first
      const seen: string[] = []; let before: unknown = null; let pages = 0;
      for (;;) { const p = await find(db, 'reviewer', {}, before, 2); pages++; seen.push(...p.rows.map((r: any) => r.id)); if (!p.more) break; before = p.next; }
      assert.equal(pages, 3); assert.equal(new Set(seen).size, 5); assert.equal(seen.at(-1), J.b2);
      // bad filters are refused, not ignored
      await assert.rejects(find(db, 'reviewer', { kind: 'paint' }), code('22023'));
      await assert.rejects(find(db, 'reviewer', { from: 'yesterday-ish' }), code('22023'));
      await assert.rejects(find(db, 'reviewer', { unstamped: 'yes' }), code('22023'));
      await assert.rejects(find(db, 'reviewer', { q: 'x'.repeat(101) }), code('22023'));
      await assert.rejects(find(db, 'reviewer', {}, { createdAt: 'nope', id: J.a1 }), code('22023'));
    });

    await t.test('stamps: reviewers only, one per job, a new stamp replaces the old one, the history keeps every one', async () => {
      await assert.rejects(stamp(db, 'maker2', J.a1, 'good'), (e: { code?: string; message?: string }) => e.code === '42501' && /검수자만/.test(e.message ?? ''), 'a member may not stamp');
      await assert.rejects(stamp(db, 'maker1', J.a1, 'good'), code('42501'), 'not even their own job');
      await assert.rejects(stamp(db, 'reviewer', J.a1, 'gold'), code('22023'));
      await assert.rejects(stamp(db, 'reviewer', J.a1, 'again', '  \n '), (e: { message?: string }) => /메모/.test(e.message ?? ''), '다시 needs a memo');
      await assert.rejects(stamp(db, 'reviewer', J.a1, 'seen', 'x'.repeat(401)), code('22023'));
      await assert.rejects(stamp(db, 'reviewer', J.a3, 'seen'), code('22023'), 'a job still being drawn');
      await assert.rejects(stamp(db, 'reviewer', '99999999-9999-4999-8999-999999999999', 'seen'), code('P0002'));
      const before = (await rpc(db, 'bae_gyeong_session_job_get', 'maker1', ',$2::uuid', [J.a1])).updatedAt;
      const s1 = await stamp(db, 'reviewer', J.a1, 'good', '좋아요\n이 방향  그대로');
      assert.equal(s1.stamp, 'good'); assert.equal(s1.stampBy, 'reviewer'); assert.equal(s1.stampNote, '좋아요 이 방향 그대로', 'one line');
      assert.ok(s1.updatedAt > before, 'updated_at moves so the lists read it again');
      await stamp(db, 'reviewer', J.a1, 'good', '좋아요 이 방향 그대로');   // double click
      const s2 = await stamp(db, 'admin', J.a1, 'again', '창문을 더 크게');
      assert.equal(s2.stamp, 'again'); assert.equal(s2.stampBy, 'admin');
      const h = await rpc(db, 'bae_gyeong_session_job_stamps', 'maker1', ',$2::uuid', [J.a1]);
      assert.deepEqual(h.map((x: any) => [x.stamp, x.by, x.byName, x.note]), [['again', 'admin', '관리자', '창문을 더 크게'], ['good', 'reviewer', '안류천', '좋아요 이 방향 그대로']]);
      assert.deepEqual(await rpc(db, 'bae_gyeong_session_job_stamps', 'reviewer', ',$2::uuid', [J.a1]), h, 'a reviewer reads the same history');
      // the maker sees the stamp on their own list row and in the one-job view
      const mine = await rpc(db, 'bae_gyeong_session_job_list_mine', 'maker1', ',$2,$3', [null, 50]);
      assert.equal(mine.rows.find((r: any) => r.id === J.a1).stamp, 'again');
      assert.equal((await rpc(db, 'bae_gyeong_session_job_get', 'maker1', ',$2::uuid', [J.a1])).stampNote, '창문을 더 크게');
      // taking a stamp back leaves the job without one and the history with a line
      const back = await stamp(db, 'admin', J.a1, null, 'ignored');
      assert.equal(back.stamp, null); assert.equal(back.stampNote, null); assert.equal(back.stampBy, null);
      assert.equal((await rpc(db, 'bae_gyeong_session_job_stamps', 'maker1', ',$2::uuid', [J.a1])).length, 3);
      await stamp(db, 'admin', J.a1, 'again', '창문을 더 크게');
      const sig = (await db.query("SELECT payload, event FROM realtime.messages WHERE event = 'jobs-changed'")).rows;
      assert.ok(sig.length > 0 && sig.every((s: any) => JSON.stringify(s.payload) === '{}'), 'contentless signal');
    });

    await t.test('the number on the maker\'s 景 icon: new 좋아요 · 다시 by someone else, until looked at', async () => {
      const u1 = await rpc(db, 'bae_gyeong_session_stamp_unseen', 'maker1');
      assert.equal(u1.count, 1); assert.deepEqual(u1.jobIds, [J.a1]); assert.ok(u1.upto > 0);
      assert.equal((await rpc(db, 'bae_gyeong_session_stamp_unseen', 'maker2')).count, 0, 'the other maker gets nothing');
      assert.equal((await rpc(db, 'bae_gyeong_session_stamp_unseen', 'reviewer')).count, 0);
      // 확인함 is quiet: shown in the records, no number
      await stamp(db, 'reviewer', J.a2, 'seen');
      assert.equal((await rpc(db, 'bae_gyeong_session_stamp_unseen', 'maker1')).count, 1);
      // looked at up to what was read: a1's 다시 is seen; the quiet 확인함 on a2 after it adds nothing
      const seen = await rpc(db, 'bae_gyeong_session_stamp_seen', 'maker1', ',$2', [u1.upto]);
      assert.equal(seen.count, 0); assert.deepEqual(seen.jobIds, []);
    });

    await t.test('looking at the stamps clears the number, a later stamp brings it back', async () => {
      const now = await rpc(db, 'bae_gyeong_session_stamp_unseen', 'maker1');
      const cleared = await rpc(db, 'bae_gyeong_session_stamp_seen', 'maker1', ',$2', [now.upto]);
      assert.equal(cleared.count, 0); assert.deepEqual(cleared.jobIds, []);
      assert.equal((await rpc(db, 'bae_gyeong_session_stamp_seen', 'maker1', ',$2', [0])).count, 0, 'never moves back');
      await assert.rejects(rpc(db, 'bae_gyeong_session_stamp_seen', 'maker1', ',$2', [-1]), code('22023'));
      await stamp(db, 'reviewer', J.a2, 'good');
      const again = await rpc(db, 'bae_gyeong_session_stamp_unseen', 'maker1');
      assert.equal(again.count, 1); assert.deepEqual(again.jobIds, [J.a2]);
      // a stamp that lands between reading and marking is not marked seen unread
      await stamp(db, 'reviewer', J.a1, 'good');
      const after = await rpc(db, 'bae_gyeong_session_stamp_seen', 'maker1', ',$2', [again.upto]);
      assert.equal(after.count, 1); assert.deepEqual(after.jobIds, [J.a1]);
      // NULL = everything there is now
      assert.equal((await rpc(db, 'bae_gyeong_session_stamp_seen', 'maker1', ',$2', [null])).count, 0);
      // a reviewer stamping their own job does not count for themselves
      await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['maker2', 'reviewer']);
      await stamp(db, 'maker2', J.b1, 'good');
      assert.equal((await rpc(db, 'bae_gyeong_session_stamp_unseen', 'maker2')).count, 0);
      await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['maker2', 'user']);
    });

    await t.test('bulk 확인함: unstamped finished jobs only, never covering a 좋아요 or a 다시', async () => {
      await rpc(db, 'bae_gyeong_session_job_stamp', 'admin', ',$2::uuid,$3,$4', [J.b1, null, null]);
      const r = await rpc(db, 'bae_gyeong_session_job_stamp_bulk', 'reviewer', ',$2::uuid[],$3', [[J.a1, J.a3, J.b1, J.b2, J.b2], 'seen']);
      assert.deepEqual([...r.stamped].sort(), [J.b1, J.b2].sort()); assert.equal(r.skipped, 2);
      assert.equal((await rpc(db, 'bae_gyeong_session_job_get', 'reviewer', ',$2::uuid', [J.a1])).stamp, 'good');
      await assert.rejects(rpc(db, 'bae_gyeong_session_job_stamp_bulk', 'maker1', ',$2::uuid[],$3', [[J.b1], 'seen']), code('42501'));
      await assert.rejects(rpc(db, 'bae_gyeong_session_job_stamp_bulk', 'reviewer', ',$2::uuid[],$3', [[J.b1], 'good']), code('22023'));
      await assert.rejects(rpc(db, 'bae_gyeong_session_job_stamp_bulk', 'reviewer', ',$2::uuid[],$3', [[], 'seen']), code('22023'));
      await assert.rejects(rpc(db, 'bae_gyeong_session_job_stamp_bulk', 'reviewer', ',$2::uuid[],$3', [Array.from({ length: 201 }, () => J.b1), 'seen']), code('22023'));
      assert.deepEqual((await find(db, 'reviewer', { unstamped: true })).rows, [], 'nothing left waiting');
      assert.equal((await rpc(db, 'bae_gyeong_session_stamp_unseen', 'maker2')).count, 0, 'bulk 확인함 is quiet too');
    });

    await t.test('team cost: reviewers only, person × period × kind × model, the table adds up to the ledger lines', async () => {
      const r = await rpc(db, 'bae_gyeong_session_usage_team', 'reviewer', ',$2,$3,$4', [null, null, 'day']);
      const ledger = (await db.query('SELECT sum(usd)::text s, count(*)::int n FROM public.bae_gyeong_usage')).rows[0];
      assert.equal(r.total.n, ledger.n); assert.equal(Number(r.total.usd).toFixed(6), Number(ledger.s).toFixed(6));
      const tableSum = (await db.query("SELECT sum((e->>'usd')::numeric)::text s FROM jsonb_array_elements($1::jsonb) e", [JSON.stringify(r.rows)])).rows[0].s;
      assert.equal(Number(tableSum).toFixed(6), Number(ledger.s).toFixed(6), 'sum of the table = sum of the ledger lines');
      assert.equal(Number(ledger.s).toFixed(4), '0.2826');
      assert.equal(r.rows.reduce((a: number, x: any) => a + x.n, 0), ledger.n, 'every line counted once');
      const m1 = r.rows.filter((x: any) => x.userId === 'maker1');
      assert.deepEqual(m1.map((x: any) => [x.kind, x.n]).sort(), [['image', 2], ['order', 1]]);
      assert.equal(m1[0].userName, '장삐쭈');
      assert.equal(Number(r.month.usd).toFixed(4), '0.2826');
      assert.ok(r.periods.length >= 1 && r.rows.every((x: any) => r.periods.includes(x.period)), 'every row falls in a listed period');
      assert.equal(r.tz, 'Asia/Seoul');
      // a removed user's lines stay in the sum (money spent), with no name
      await db.query("DELETE FROM public.users WHERE id = 'maker2'");
      const r2 = await rpc(db, 'bae_gyeong_session_usage_team', 'admin', ',$2,$3,$4', [null, null, 'month']);
      assert.equal(Number(r2.total.usd).toFixed(4), '0.2826');
      assert.ok(r2.rows.some((x: any) => x.userId === 'maker2' && x.userName === ''));
      await db.query("INSERT INTO public.users(id, role, name) VALUES('maker2','user','허혜원')");
      // a period outside the lines has nothing; spans are bounded per period size
      const old = await rpc(db, 'bae_gyeong_session_usage_team', 'reviewer', ',$2,$3,$4', [new Date(Date.now() - 80 * 86400_000).toISOString(), new Date(Date.now() - 50 * 86400_000).toISOString(), 'week']);
      assert.deepEqual(old.rows, []); assert.equal(Number(old.total.usd), 0); assert.ok(old.periods.length >= 4);
      await assert.rejects(rpc(db, 'bae_gyeong_session_usage_team', 'reviewer', ',$2,$3,$4', [new Date(Date.now() - 200 * 86400_000).toISOString(), null, 'day']), code('22023'));
      await assert.rejects(rpc(db, 'bae_gyeong_session_usage_team', 'reviewer', ',$2,$3,$4', [null, null, 'hour']), code('22023'));
      await assert.rejects(rpc(db, 'bae_gyeong_session_usage_team', 'reviewer', ',$2,$3,$4', [new Date().toISOString(), new Date(Date.now() - 1000).toISOString(), 'day']), code('22023'));
    });

    await t.test('taking a reviewer off the list takes the team view away at once (the server decides on each call)', async () => {
      await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['reviewer', 'user']);
      await assert.rejects(find(db, 'reviewer', {}), code('42501'));
      await assert.rejects(stamp(db, 'reviewer', J.b1, 'good'), code('42501'));
      await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['maker1', 'reviewer']);
      assert.equal((await find(db, 'maker1', {})).rows.length, 5, 'a member made reviewer sees the team at once');
      await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['maker1', 'user']);
      await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['reviewer', 'reviewer']);
    });

    await t.test('rerunning the file (and the base file after it) keeps the rows and the grants', async () => {
      const before = (await db.query('SELECT count(*)::int n FROM public.bae_gyeong_stamps')).rows[0].n;
      await db.exec(sql);
      await db.exec(base);
      assert.equal((await db.query('SELECT count(*)::int n FROM public.bae_gyeong_stamps')).rows[0].n, before);
      assert.equal((await rpc(db, 'bae_gyeong_session_job_stamps', 'reviewer', ',$2::uuid', [J.a1])).length > 0, true);
      await assert.rejects(asAnon(db, 'SELECT * FROM public.bae_gyeong_stamps'), /permission denied/);
      await assert.rejects(asAnon(db, 'SELECT public.bae_gyeong_stamp_note($1)', ['x']), /permission denied/);
    });

    await t.test('the smoke file passes on top of the applied file and leaves nothing behind', async () => {
      const before = (await db.query('SELECT (SELECT count(*) FROM public.bae_gyeong_stamps)::int s, (SELECT count(*) FROM public.bae_gyeong_usage)::int u')).rows[0];
      await assert.rejects(db.exec(smoke), /BAE REVIEW SMOKE OK/);
      assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM public.bae_gyeong_stamps)::int s, (SELECT count(*) FROM public.bae_gyeong_usage)::int u')).rows[0], before);
      assert.equal((await db.query("SELECT count(*)::int n FROM public.users WHERE id LIKE 'bae-review-smoke-%'")).rows[0].n, 0);
    });
  } finally { await db.close(); }
});

test('the dry run as the owner runs it: base file, then this file\'s body + the smoke in one batch, all rolled back', { skip: !runtime }, async () => {
  const db = await boot(false);
  try {
    await assert.rejects(db.exec(body + '\n' + smoke), /BAE REVIEW SMOKE OK/);
    assert.equal((await db.query("SELECT to_regclass('public.bae_gyeong_stamps') IS NULL AS gone")).rows[0].gone, true, 'the batch left nothing');
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_proc WHERE proname = 'bae_gyeong_session_job_stamp'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT to_regclass('public.bae_gyeong_jobs') IS NOT NULL AS kept")).rows[0].kept, true, 'the base file stays');
  } finally { await db.close(); }
});
