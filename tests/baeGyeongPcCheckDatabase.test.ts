import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// BAE경 '이 PC 점검' 표 (DEVLOG/migrations/2026-11-16-bae-gyeong-pc-check.sql). 글자로 보는 검사는 늘 돌고, 실제 실행은
// PostgreSQL 호환 실행기(BFLOW_PGLITE_MODULE, tests/baeGyeongDatabase.test.ts 와 같은 방식)가 있을 때 돈다.
const base = readFileSync(new URL('../DEVLOG/migrations/2026-11-13-bae-gyeong-base.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sql = readFileSync(new URL('../DEVLOG/migrations/2026-11-16-bae-gyeong-pc-check.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const smoke = readFileSync(new URL('../DEVLOG/verification/2026-11-16-bae-gyeong-pc-check-smoke.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const runtime = process.env.BFLOW_PGLITE_MODULE;

test('the pc-check table is closed (RLS on, no policy) and only the session wrappers are granted', () => {
  assert.match(sql, /ALTER TABLE public\.bae_gyeong_pc_checks ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(sql, /CREATE POLICY/);
  assert.doesNotMatch(sql, /ALTER PUBLICATION/, 'no table goes into the realtime publication');
  assert.match(sql, /p\.proname LIKE 'bae_gyeong_session_%' LOOP\n\s*EXECUTE format\('GRANT EXECUTE ON FUNCTION %s TO %I', fn, role_name\);/);
  for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)) assert.ok(m[1].startsWith('bae_gyeong_'), m[1]);
  assert.deepEqual([...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(bae_gyeong_session_[a-z_]+)\(/g)].map((m) => m[1]), ['bae_gyeong_session_pc_check_put', 'bae_gyeong_session_pc_check_list']);
  // 사람은 세션 토큰으로만 — 부르는 쪽이 보낸 id 를 믿지 않는다
  assert.doesNotMatch(sql, /p_actor_id|p_user_id|p_check->>'userId'/);
  assert.match(sql, /public\.bae_gyeong_actor\(p_session_token\)/);
  // 서버 API 가 스스로 다시 부르는 오류 번호(40001 · 40P01)는 쓰지 않는다 (2026-11-16 개발 브랜치)
  assert.doesNotMatch(sql, /ERRCODE\s*=\s*'40(001|P01)'/);
  // users 는 명시 칸만 (select * 금지, CLAUDE.md 필수 규칙 7)
  assert.doesNotMatch(sql, /FROM public\.users u\b[^;]*SELECT \*/);
  assert.doesNotMatch(sql, /SELECT \* FROM public\.users/);
  // 확인 파일은 끝에서 일부러 오류를 내 모두 되돌린다
  assert.match(smoke, /RAISE EXCEPTION 'BAE PCCHECK SMOKE OK/);
  assert.doesNotMatch(smoke, /^\s*(BEGIN|COMMIT)\s*;/m);
});

const tokens = { admin: 'a'.repeat(64), member: 'b'.repeat(64), reviewer: 'c'.repeat(64), outsider: 'd'.repeat(64) };
async function boot() {
  const { PGlite } = await import(pathToFileURL(runtime!).href); const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
    CREATE TABLE public.users(id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', role TEXT DEFAULT 'user', password TEXT);
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
  await db.exec(base);
  await db.exec(sql);
  return db;
}
const asAnon = async (db: any, q: string, args: unknown[] = []) => { await db.exec('SET ROLE anon'); try { return (await db.query(q, args)).rows; } finally { await db.exec('RESET ROLE'); } };
const put = async (db: any, who: keyof typeof tokens, check: unknown) => (await asAnon(db, 'SELECT public.bae_gyeong_session_pc_check_put($1, $2::jsonb) AS r', [tokens[who], JSON.stringify(check)]))[0].r;
const list = async (db: any, who: keyof typeof tokens) => (await asAnon(db, 'SELECT public.bae_gyeong_session_pc_check_list($1) AS r', [tokens[who]]))[0].r;
const PC1 = '1b4e28ba-2fa1-41d2-883f-0016d3cca427', PC2 = '6fa459ea-ee8a-4ca4-894e-db77e160355e';
const check = (pcId: string, extra: Record<string, unknown> = {}) => ({
  pcId, pcName: 'JBBJ-PC-07', appVersion: '1.151.0', level: 'ok', summary: '4K로 키우기 돼요 · 레이어로 나누기 돼요 · 다른 각도로 돼요',
  result: { version: 1, gpu: { name: 'NVIDIA GeForce RTX 4080 SUPER', vramMB: 16376 }, dml: { ok: true, ms: 300 }, rows: [] }, ...extra,
});

test('the pc-check file runs: anyone who may use BAE경 writes their own row, admins and reviewers read the table', { skip: !runtime }, async (t) => {
  const db = await boot();
  try {
    await rpcSetup(db);
    await t.test('anon can execute the wrappers and nothing else, and reads no table directly', async () => {
      const open = (await db.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'bae_gyeong_%' AND has_function_privilege('anon',p.oid,'EXECUTE') ORDER BY 1")).rows.map((r: any) => r.proname);
      assert.ok(open.includes('bae_gyeong_session_pc_check_put') && open.includes('bae_gyeong_session_pc_check_list'));
      assert.ok(open.every((n: string) => n.startsWith('bae_gyeong_session_')), open.join(','));
      await assert.rejects(asAnon(db, 'SELECT * FROM public.bae_gyeong_pc_checks'), /permission denied/);
      await assert.rejects(asAnon(db, 'SELECT public.bae_gyeong_pc_check_json(NULL::public.bae_gyeong_pc_checks)'), /permission denied/);
      await assert.rejects(asAnon(db, 'SELECT public.bae_gyeong_session_pc_check_put($1, $2::jsonb)', ['e'.repeat(64), JSON.stringify(check(PC1))]), /로그인 세션/);
    });
    await t.test('put: the server decides whose row it is; one row per person and PC', async () => {
      const r = await put(db, 'member', { ...check(PC1), userId: 'admin', userName: '가짜' });
      assert.equal(r.userId, 'member'); assert.equal(r.userName, '팀원'); assert.equal(r.pcId, PC1); assert.equal(r.level, 'ok');
      assert.equal(r.result.gpu.vramMB, 16376);
      const again = await put(db, 'member', check(PC1, { level: 'warn', summary: '4K로 키우기 돼요 (그래픽카드가 없어서 느려요)' }));
      assert.equal(again.level, 'warn');
      assert.ok(Date.parse(again.checkedAt) >= Date.parse(r.checkedAt));
      await put(db, 'member', check(PC2));
      await put(db, 'reviewer', check(PC1));
      const n = (await db.query("SELECT user_id, count(*)::int n FROM public.bae_gyeong_pc_checks GROUP BY 1 ORDER BY 1")).rows;
      assert.deepEqual(n, [{ user_id: 'member', n: 2 }, { user_id: 'reviewer', n: 1 }]);
      const sig = (await db.query("SELECT payload, event, topic, private FROM realtime.messages WHERE event = 'pc-check-changed'")).rows;
      assert.ok(sig.length >= 4);
      assert.ok(sig.every((s: any) => JSON.stringify(s.payload) === '{}' && s.topic === 'bae-gyeong' && s.private === false), 'the signal carries nothing');
    });
    await t.test('put: someone who may not use BAE경 gets no row, and a wrong shape is refused', async () => {
      await assert.rejects(put(db, 'outsider', check(PC1)), /권한이 없습니다/);
      await assert.rejects(put(db, 'member', check('not-a-uuid')), (e: { code?: string; message?: string }) => e.code === '22023' && /PC 번호/.test(e.message ?? ''));
      await assert.rejects(put(db, 'member', check(PC1, { level: 'great' })), (e: { code?: string }) => e.code === '22023');
      await assert.rejects(put(db, 'member', check(PC1, { result: [1, 2] })), (e: { code?: string }) => e.code === '22023');
      await assert.rejects(put(db, 'member', check(PC1, { result: { big: 'x'.repeat(17000) } })), /너무 큽니다/);
      await assert.rejects(put(db, 'member', 'nope'), (e: { code?: string }) => e.code === '22023');
      const long = await put(db, 'member', check(PC2, { pcName: 'P'.repeat(300), appVersion: 'v'.repeat(80), summary: 's'.repeat(400) }));
      assert.equal(long.pcName.length, 120); assert.equal(long.appVersion.length, 40); assert.equal(long.summary.length, 300);
      assert.equal((await db.query("SELECT count(*)::int n FROM public.bae_gyeong_pc_checks WHERE user_id = 'outsider'")).rows[0].n, 0);
    });
    await t.test('list: admins and reviewers only, newest first, a removed user is not listed', async () => {
      await assert.rejects(list(db, 'member'), /관리자와 BAE경 검수자만/);
      await assert.rejects(list(db, 'outsider'), /관리자와 BAE경 검수자만/);
      const rows = await list(db, 'admin');
      assert.equal(rows.length, 3);
      assert.deepEqual(rows.map((r: any) => Date.parse(r.checkedAt)), rows.map((r: any) => Date.parse(r.checkedAt)).slice().sort((a: number, b: number) => b - a));
      assert.deepEqual(new Set(rows.map((r: any) => r.userName)), new Set(['팀원', '검수자']));
      assert.equal((await list(db, 'reviewer')).length, 3);
      await db.query("DELETE FROM public.users WHERE id = 'reviewer'");
      assert.equal((await list(db, 'admin')).length, 2, 'a removed user drops out of the table (the row stays, no right comes from it)');
      await db.query("INSERT INTO public.users(id, role, name) VALUES('reviewer','user','검수자')");
    });
    await t.test('a person keeps at most 20 PCs: a 21st replaces their oldest', async () => {
      await db.query("DELETE FROM public.bae_gyeong_pc_checks WHERE user_id = 'admin'");
      const ids: string[] = [];
      for (let i = 0; i < 21; i++) {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`; ids.push(id);
        await put(db, 'admin', check(id));
        await db.query("UPDATE public.bae_gyeong_pc_checks SET checked_at = now() - make_interval(secs => $1::int) WHERE user_id = 'admin' AND pc_id = $2::uuid", [100 - i, id]);
      }
      const kept = (await db.query("SELECT pc_id::text id FROM public.bae_gyeong_pc_checks WHERE user_id = 'admin' ORDER BY checked_at")).rows.map((r: any) => r.id);
      assert.equal(kept.length, 20);
      assert.ok(!kept.includes(ids[0]), 'the oldest PC row went');
      assert.ok(kept.includes(ids[20]));
      // 이미 있는 PC 를 다시 올리면 지우지 않는다
      await put(db, 'admin', check(ids[5]));
      assert.equal((await db.query("SELECT count(*)::int n FROM public.bae_gyeong_pc_checks WHERE user_id = 'admin'")).rows[0].n, 20);
    });
    await t.test('rerunning the file keeps the rows and the grants', async () => {
      const before = (await db.query('SELECT count(*)::int n FROM public.bae_gyeong_pc_checks')).rows[0].n;
      await db.exec(sql);
      await db.exec(base);   // the base file's lockdown leaves this file's wrappers granted
      assert.equal((await db.query('SELECT count(*)::int n FROM public.bae_gyeong_pc_checks')).rows[0].n, before);
      assert.equal((await list(db, 'admin')).length > 0, true);
      await assert.rejects(asAnon(db, 'SELECT * FROM public.bae_gyeong_pc_checks'), /permission denied/);
    });
    await t.test('the smoke file passes and leaves nothing behind', async () => {
      const before = (await db.query('SELECT count(*)::int n FROM public.bae_gyeong_pc_checks')).rows[0].n;
      await assert.rejects(db.exec(smoke), /BAE PCCHECK SMOKE OK/);
      assert.equal((await db.query('SELECT count(*)::int n FROM public.bae_gyeong_pc_checks')).rows[0].n, before);
      assert.equal((await db.query("SELECT count(*)::int n FROM public.users WHERE id LIKE 'bae-pccheck-smoke-%'")).rows[0].n, 0);
    });
  } finally { await db.close(); }
});

/** BAE경 사용자 · 검수자를 기본 SQL 의 명단 함수로 정한다 (관리자 세션). */
async function rpcSetup(db: any) {
  await asAnon(db, 'SELECT public.bae_gyeong_session_members_set($1,$2,$3)', [tokens.admin, 'member', 'user']);
  await asAnon(db, 'SELECT public.bae_gyeong_session_members_set($1,$2,$3)', [tokens.admin, 'reviewer', 'reviewer']);
}
