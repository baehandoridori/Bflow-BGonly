import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// BAE경 서버 (DEVLOG/migrations/2026-11-13-bae-gyeong-base.sql). 글자로 보는 검사는 늘 돌고, 실제 실행은
// PostgreSQL 호환 실행기(BFLOW_PGLITE_MODULE, tests/backgroundDatabaseContract.test.ts 와 같은 방식)가 있을 때 돈다.
const sql = readFileSync(new URL('../DEVLOG/migrations/2026-11-13-bae-gyeong-base.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const runtime = process.env.BFLOW_PGLITE_MODULE;
const FAKE_KEY = 'sk-test-local-only-0123456789abcdef';

test('every table is closed (RLS on, no policy) and only the session wrappers are granted', () => {
  for (const t of ['bae_gyeong_members', 'bae_gyeong_settings', 'bae_gyeong_settings_history', 'bae_gyeong_keys', 'bae_gyeong_jobs', 'bae_gyeong_usage']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY;`), t);
  }
  assert.doesNotMatch(sql, /CREATE POLICY/);
  assert.doesNotMatch(sql, /ALTER PUBLICATION/, 'no table goes into the realtime publication');
  assert.match(sql, /p\.proname LIKE 'bae_gyeong_session_%' LOOP\n\s*EXECUTE format\('GRANT EXECUTE ON FUNCTION %s TO %I', fn, role_name\);/);
  // every function is named bae_gyeong_* (the background files revoke their own prefixes only)
  for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)) assert.ok(m[1].startsWith('bae_gyeong_'), m[1]);
  // the actor comes from the session token, never from an id the caller sends
  assert.doesNotMatch(sql, /p_actor_id|p_user_name/);
  assert.match(sql, /public\.app_session_user_id\(p_session_token\)/);
});

const tokens = { admin: 'a'.repeat(64), member: 'b'.repeat(64), reviewer: 'c'.repeat(64), outsider: 'd'.repeat(64) };
async function boot() {
  const { PGlite } = await import(pathToFileURL(runtime!).href); const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
    CREATE TABLE public.users(id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', role TEXT DEFAULT 'user');
    INSERT INTO users(id, role, name) VALUES('admin','admin','관리자'),('member','user','팀원'),('reviewer','user','검수자'),('outsider','user','바깥');
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
  for (const who of Object.keys(tokens) as Array<keyof typeof tokens>) {
    await db.query("INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [createHash('sha256').update(tokens[who]).digest('hex'), who]);
  }
  await db.exec(sql);
  return db;
}
const asAnon = async (db: any, q: string, args: unknown[] = []) => { await db.exec('SET ROLE anon'); try { return (await db.query(q, args)).rows; } finally { await db.exec('RESET ROLE'); } };
const rpc = async (db: any, name: string, who: keyof typeof tokens, extra = '', args: unknown[] = []) =>
  (await asAnon(db, `SELECT public.${name}($1${extra}) AS r`, [tokens[who], ...args]))[0].r;

test('the base file runs: rights, revisions, the key vault and contentless signals', { skip: !runtime }, async (t) => {
  const db = await boot();
  try {
    await t.test('anon can execute the wrappers and nothing else, and reads no table directly', async () => {
      const open = (await db.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'bae_gyeong_%' AND has_function_privilege('anon',p.oid,'EXECUTE') ORDER BY 1")).rows.map((r: any) => r.proname);
      assert.ok(open.length > 0 && open.every((n: string) => n.startsWith('bae_gyeong_session_')), open.join(','));
      for (const tbl of ['bae_gyeong_settings', 'bae_gyeong_keys', 'bae_gyeong_members', 'bae_gyeong_jobs', 'bae_gyeong_usage']) {
        await assert.rejects(asAnon(db, `SELECT * FROM public.${tbl}`), /permission denied/, tbl);
      }
      await assert.rejects(asAnon(db, 'SELECT public.bae_gyeong_can_use($1)', ['admin']), /permission denied/);
      await assert.rejects(asAnon(db, 'SELECT * FROM vault.decrypted_secrets'), /permission denied/);
    });
    await t.test('a bad or missing session gets nothing', async () => {
      await assert.rejects(asAnon(db, 'SELECT public.bae_gyeong_session_access($1)', ['e'.repeat(64)]), /로그인 세션/);
      await assert.rejects(asAnon(db, 'SELECT public.bae_gyeong_session_access($1)', ['nope']), /로그인 세션/);
    });
    await t.test('who may use and review', async () => {
      assert.deepEqual(await rpc(db, 'bae_gyeong_session_access', 'admin'), { canUse: true, canReview: true, isAdmin: true, open: false });
      assert.deepEqual(await rpc(db, 'bae_gyeong_session_access', 'member'), { canUse: false, canReview: false, isAdmin: false, open: false });
      await assert.rejects(rpc(db, 'bae_gyeong_session_members_set', 'member', ',$2,$3', ['member', 'user']), /관리자만/);
      await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['member', 'user']);
      const list = await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['reviewer', 'reviewer']);
      assert.deepEqual(list, [{ userId: 'member', role: 'user' }, { userId: 'reviewer', role: 'reviewer' }]);
      assert.deepEqual(await rpc(db, 'bae_gyeong_session_access', 'member'), { canUse: true, canReview: false, isAdmin: false, open: false });
      assert.deepEqual(await rpc(db, 'bae_gyeong_session_access', 'reviewer'), { canUse: true, canReview: true, isAdmin: false, open: false });
      await assert.rejects(rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['ghost', 'user']), /찾을 수 없습니다/);
      await assert.rejects(rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['member', 'owner']), /역할/);
    });
    await t.test('the bookshelf: admin saves against the revision, others read, history keeps every revision', async () => {
      await assert.rejects(rpc(db, 'bae_gyeong_session_settings_get', 'outsider'), /권한이 없습니다/);
      await assert.rejects(rpc(db, 'bae_gyeong_session_settings_save', 'member', ',$2,$3::jsonb,$4', ['manual', JSON.stringify({ text: '# BAE PD manual v1.7' }), 0]), /관리자만/);
      const r1 = await rpc(db, 'bae_gyeong_session_settings_save', 'admin', ',$2,$3::jsonb,$4', ['manual', JSON.stringify({ text: '# BAE PD manual v1.7\nA' }), 0]);
      assert.equal(r1.revision, 1);
      await assert.rejects(rpc(db, 'bae_gyeong_session_settings_save', 'admin', ',$2,$3::jsonb,$4', ['manual', JSON.stringify({ text: '# BAE PD manual v1.8\nB' }), 0]), /먼저 바꿨습니다/);
      const r2 = await rpc(db, 'bae_gyeong_session_settings_save', 'admin', ',$2,$3::jsonb,$4', ['manual', JSON.stringify({ text: '# BAE PD manual v1.8\nB' }), 1]);
      assert.equal(r2.revision, 2);
      await assert.rejects(rpc(db, 'bae_gyeong_session_settings_save', 'admin', ',$2,$3::jsonb,$4', ['nope', JSON.stringify({}), 0]), /알 수 없는/);
      await assert.rejects(rpc(db, 'bae_gyeong_session_settings_save', 'admin', ',$2,$3::jsonb,$4', ['manual', JSON.stringify({ text: '   ' }), 2]), /모양/);
      await assert.rejects(rpc(db, 'bae_gyeong_session_settings_save', 'admin', ',$2,$3::jsonb,$4', ['api_base', JSON.stringify('http://x'), 0]), /모양/);
      const rows = await rpc(db, 'bae_gyeong_session_settings_get', 'member');
      assert.equal(rows.length, 1); assert.equal(rows[0].revision, 2);
      const hist = await rpc(db, 'bae_gyeong_session_settings_history', 'admin', ',$2', ['manual']);
      assert.deepEqual(hist.map((h: any) => h.revision), [2, 1]);
      await assert.rejects(rpc(db, 'bae_gyeong_session_settings_history', 'member', ',$2', ['manual']), /관리자만/);
    });
    await t.test('the key: only an admin puts it in, the status never carries it, only a user who may use BAE경 gets it', async () => {
      assert.deepEqual(await rpc(db, 'bae_gyeong_session_key_status', 'member'), { hasKey: false, updatedAt: null, label: 'team' });
      await assert.rejects(rpc(db, 'bae_gyeong_session_get_key', 'member'), /키가 아직 없습니다/);
      await assert.rejects(rpc(db, 'bae_gyeong_session_set_key', 'member', ',$2', [FAKE_KEY]), /관리자만/);
      await assert.rejects(rpc(db, 'bae_gyeong_session_set_key', 'admin', ',$2', ['hello']), /키 모양/);
      const st = await rpc(db, 'bae_gyeong_session_set_key', 'admin', ',$2', [`  ${FAKE_KEY} `]);
      assert.equal(st.hasKey, true); assert.ok(!JSON.stringify(st).includes('0123456789'));
      const status = await rpc(db, 'bae_gyeong_session_key_status', 'member');
      assert.equal(status.hasKey, true); assert.ok(!JSON.stringify(status).includes('0123456789'));
      assert.deepEqual(await rpc(db, 'bae_gyeong_session_get_key', 'member'), { key: FAKE_KEY, label: 'team' });
      await assert.rejects(rpc(db, 'bae_gyeong_session_get_key', 'outsider'), /권한이 없습니다/, 'no right, no key');
      // replacing keeps one vault row
      await rpc(db, 'bae_gyeong_session_set_key', 'admin', ',$2', [FAKE_KEY + 'x2']);
      assert.equal((await db.query('SELECT count(*)::int n FROM vault.secrets')).rows[0].n, 1);
      assert.deepEqual(await rpc(db, 'bae_gyeong_session_get_key', 'reviewer'), { key: FAKE_KEY + 'x2', label: 'team' });
    });
    await t.test('jobs: the maker writes their own, a reviewer reads all, late writes never reopen a finished job', async () => {
      const J1 = '11111111-1111-4111-8111-111111111111', J2 = '22222222-2222-4222-8222-222222222222';
      const up = (who: keyof typeof tokens, job: unknown) => rpc(db, 'bae_gyeong_session_job_upsert', who, ',$2::jsonb', [JSON.stringify(job)]);
      await assert.rejects(up('outsider', { id: J2, kind: 'new', status: 'drawing' }), /권한이 없습니다/);
      await assert.rejects(up('member', { id: 'not-a-uuid', kind: 'new', status: 'drawing' }), /작업 번호/);
      await assert.rejects(up('member', { id: J1, kind: 'paint', status: 'drawing' }), /작업 종류/);
      await assert.rejects(up('member', { id: J1, kind: 'new', status: 'drawing', name: '가'.repeat(81) }), /80자/);
      const made = await up('member', { id: J1, kind: 'new', status: 'drawing', summary: { request: '주차장' }, pd: { prompt: 'A parking lot' }, createdAt: '2999-01-01T00:00:00Z', userId: 'admin', userName: '관리자' });
      assert.equal(made.userId, 'member'); assert.equal(made.userName, '팀원', 'the server names the maker');
      assert.equal(made.status, 'drawing'); assert.equal(made.pd, undefined, 'the list shape leaves the PD words out');
      assert.ok(Date.parse(made.createdAt) < Date.now() + 60_000, 'a time far ahead becomes now');
      const first = await rpc(db, 'bae_gyeong_session_job_list_mine', 'member', ',$2,$3', [null, 50]);
      assert.equal(first.rows.length, 1); assert.equal(first.total, 1); assert.equal(first.more, false);
      await assert.rejects(up('reviewer', { id: J1, kind: 'new', status: 'failed' }), /다른 사람/);
      const done = await up('member', { id: J1, status: 'done', result: { w: 2048, h: 1152 }, images: { thumb: 'bae/' + J1 + '/result_320.jpg' }, costUsd: 0.0912 });
      assert.equal(done.status, 'done'); assert.ok(done.finishedAt); assert.equal(Number(done.costUsd), 0.0912);
      assert.equal(done.summary.request, '주차장', 'parts not sent stay as they were');
      const late = await up('member', { id: J1, status: 'drawing' });
      assert.equal(late.status, 'done', 'a late write does not reopen a finished job');
      const since = await rpc(db, 'bae_gyeong_session_job_list_mine', 'member', ',$2,$3', [first.serverTime, 50]);
      assert.deepEqual(since.rows.map((r: any) => r.id), [J1], 'the cursor brings what changed after it');
      const none = await rpc(db, 'bae_gyeong_session_job_list_mine', 'member', ',$2,$3', [late.updatedAt, 50]);
      assert.equal(none.rows.length, 0);
      assert.equal((await rpc(db, 'bae_gyeong_session_job_get', 'member', ',$2::uuid', [J1])).pd.prompt, 'A parking lot');
      assert.equal((await rpc(db, 'bae_gyeong_session_job_get', 'reviewer', ',$2::uuid', [J1])).userId, 'member');
      await assert.rejects(rpc(db, 'bae_gyeong_session_job_get', 'outsider', ',$2::uuid', [J1]), /볼 수 없습니다/);
      await assert.rejects(rpc(db, 'bae_gyeong_session_job_list_team', 'member', ',$2,$3', [null, 50]), /검수자만/);
      assert.deepEqual((await rpc(db, 'bae_gyeong_session_job_list_team', 'reviewer', ',$2,$3', [null, 50])).rows.map((r: any) => r.userId), ['member']);
      assert.deepEqual((await rpc(db, 'bae_gyeong_session_job_list_mine', 'outsider', ',$2,$3', [null, 50])).rows, [], 'nobody else sees my jobs in their list');
      await assert.rejects(rpc(db, 'bae_gyeong_session_job_hide', 'reviewer', ',$2::uuid,$3', [J1, true]), /내 BAE경 작업 기록만/);
      assert.equal((await rpc(db, 'bae_gyeong_session_job_hide', 'member', ',$2::uuid,$3', [J1, true])).hidden, true);
      assert.equal((await rpc(db, 'bae_gyeong_session_job_list_team', 'reviewer', ',$2,$3', [null, 50])).rows[0].hidden, true, 'a reviewer still sees a hidden job');
      // a member taken off the list may finish a job already started, but not start a new one
      await up('member', { id: J2, kind: 'new', status: 'drawing' });
      await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['member', null]);
      assert.equal((await up('member', { id: J2, status: 'stopped' })).status, 'stopped');
      await assert.rejects(up('member', { id: '33333333-3333-4333-8333-333333333333', kind: 'new', status: 'drawing' }), /권한이 없습니다/);
      await rpc(db, 'bae_gyeong_session_members_set', 'admin', ',$2,$3', ['member', 'user']);
    });
    await t.test('the ledger: one line per call, the server decides who and which key, the same request id once', async () => {
      const log = (who: keyof typeof tokens, row: unknown) => rpc(db, 'bae_gyeong_session_usage_log', who, ',$2::jsonb', [JSON.stringify(row)]);
      const line = { jobId: '11111111-1111-4111-8111-111111111111', kind: 'image', model: 'gpt-image-2.5-sunburst', tokens: { input: 1600, output: 1631 }, usd: 0.0752, requestId: 'r-1', keyLabel: 'stolen', userId: 'admin' };
      assert.deepEqual(await log('member', line), { ok: true, duplicate: false });
      assert.deepEqual(await log('member', line), { ok: true, duplicate: true });
      await log('member', { kind: 'order', model: 'gpt-6.1-sol', tokens: { input: 9000, output: 800 }, usd: 0.026, requestId: 'r-2' });
      await assert.rejects(log('member', { kind: 'gift', model: 'x', usd: 1, requestId: 'r-3' }), /종류/);
      await assert.rejects(log('member', { kind: 'image', model: 'x', usd: -1, requestId: 'r-3' }), /금액/);
      await assert.rejects(log('member', { kind: 'image', model: 'x', usd: 1 }), /모양/);
      const rows = (await db.query('SELECT user_id, key_label, request_id FROM bae_gyeong_usage ORDER BY id')).rows;
      assert.deepEqual(rows, [{ user_id: 'member', key_label: 'team', request_id: 'r-1' }, { user_id: 'member', key_label: 'team', request_id: 'r-2' }]);
      const sum = await rpc(db, 'bae_gyeong_session_usage_summary', 'member', ',$2,$3', [null, null]);
      assert.equal(Number(sum.usd).toFixed(4), '0.1012'); assert.equal(sum.images, 1); assert.equal(sum.orders, 1); assert.equal(sum.lines.length, 2);
      assert.equal((await rpc(db, 'bae_gyeong_session_usage_summary', 'reviewer', ',$2,$3', [null, null])).images, 0, 'only my own lines');
    });
    await t.test('the open switch lets every signed-in member use it, and nobody review', async () => {
      await rpc(db, 'bae_gyeong_session_settings_save', 'admin', ',$2,$3::jsonb,$4', ['access', JSON.stringify({ open: true }), 0]);
      assert.deepEqual(await rpc(db, 'bae_gyeong_session_access', 'outsider'), { canUse: true, canReview: false, isAdmin: false, open: true });
    });
    await t.test('signals carry no content', async () => {
      const msgs = (await db.query('SELECT payload, event, topic, private FROM realtime.messages')).rows;
      assert.ok(msgs.length >= 4);
      for (const m of msgs) { assert.deepEqual(m.payload, {}); assert.equal(m.topic, 'bae-gyeong'); assert.equal(m.private, false); assert.match(m.event, /^(settings|members|jobs)-changed$/); }
    });
    await t.test('a second run of the file keeps the data and the lockdown', async () => {
      await db.exec(sql);
      assert.equal((await rpc(db, 'bae_gyeong_session_settings_get', 'member')).length, 2);
      await assert.rejects(asAnon(db, 'SELECT * FROM public.bae_gyeong_settings'), /permission denied/);
    });
  } finally { await db.close(); }
});
