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
    CREATE TABLE public.users(id TEXT PRIMARY KEY, role TEXT DEFAULT 'user');
    INSERT INTO users VALUES('admin','admin'),('member','user'),('reviewer','user'),('outsider','user');
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
