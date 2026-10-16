import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

// The editor list of the background library (2026-10-16): who besides the admins may edit it. The file is checked by its
// letters here, and with a PostgreSQL-compatible runner (BFLOW_PGLITE_MODULE, as tests/backgroundDatabaseContract.test.ts).
const migration = (name: string) => readFileSync(new URL(`../DEVLOG/migrations/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const base = migration('2026-09-21-background-library.sql'), sql3d = migration('2026-10-07-background-map-3d.sql');
const elements = migration('2026-10-09-background-map-elements.sql'), editors = migration('2026-10-16-background-editors.sql');
const runtime = process.env.BFLOW_PGLITE_MODULE;
const header = (text: string) => { const at = text.search(/^BEGIN;$/m); assert.ok(at >= 0); return text.slice(0, at); };
const fn = (text: string, name: string) => {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`), end = text.indexOf('$$;', text.indexOf('$$', start) + 2);
  assert.ok(start >= 0 && end > start, name); return text.slice(start, end + 3);
};
const RIGHT_BEFORE = "SELECT COALESCE(role='admin',false) INTO can_manage FROM public.users WHERE id=actor FOR SHARE;";
const RIGHT_AFTER = 'SELECT public.background_editors_can_edit(id) INTO can_manage FROM public.users WHERE id=actor FOR SHARE;';
const REFUSED_BEFORE = '배경 관리는 관리자만 할 수 있습니다.', REFUSED_AFTER = '배경을 고칠 권한이 없습니다. 관리자에게 배경 편집자로 지정해 달라고 요청해 주세요.';
/** The right asked again under the library's lock, which a change of the list takes too (a save already past the first check). */
const LOCK = ' PERFORM pg_advisory_xact_lock(2119212026,1);\n';
const RECHECK = " -- The right once more, under the lock a change of the editor list takes as well: an editor taken off the list while\n -- this request was being checked does not save after all. Episode usage needs no right.\n IF EXISTS(SELECT 1 FROM jsonb_array_elements(operations) item WHERE item->>'kind'<>'usage') AND NOT public.background_editors_can_edit(actor) THEN RAISE EXCEPTION '" + REFUSED_AFTER + "' USING ERRCODE='42501'; END IF;\n";

test('E-1: the editor file is the fourth of the chain, and every header says what a re-run of the base file undoes', () => {
  assert.match(header(editors), /^-- Chain: base -> 3D -> elements -> this file /m);
  assert.match(header(editors), /re-run this file after every run of the base file, after the 3D and elements\n-- files\./);
  assert.match(header(editors), /never background_library_\*: the earlier files revoke every\n-- background_library_% function/);
  // The earlier headers name it, each where it says what to run after it (only comment lines above BEGIN; may change there).
  for (const [name, text] of Object.entries({ base, sql3d, elements })) assert.ok(header(text).includes('2026-10-16-background-editors.sql'), name);
  assert.match(header(base), /^-- after EVERY run of this file run both again, in that order/m);
  assert.match(header(base), /^-- Last, run 2026-10-16-background-editors\.sql again too: this file puts back the admin-only/m);
});

test('E-2: snapshot and execute are the base bodies with only the edit right and the words of a refusal changed', () => {
  // The edit right is asked in one place, and the user row is still read under the same lock: a missing row is still 42501.
  assert.equal(fn(base, 'background_library_execute').split(LOCK).length, 2, 'the base takes the lock once');
  assert.equal(fn(editors, 'background_library_execute'), fn(base, 'background_library_execute').replace(RIGHT_BEFORE, RIGHT_AFTER).replaceAll(REFUSED_BEFORE, REFUSED_AFTER).replace(LOCK, LOCK + RECHECK));
  assert.equal(fn(editors, 'background_library_snapshot'), fn(base, 'background_library_snapshot').replace("'canManage',EXISTS(SELECT 1 FROM public.users WHERE id=actor AND role='admin'))", "'canManage',public.background_editors_can_edit(actor))"));
  assert.equal((fn(base, 'background_library_execute').match(new RegExp(REFUSED_BEFORE.replace('.', '\\.'), 'g')) ?? []).length, 2);
  assert.match(fn(editors, 'background_editors_can_edit'), /u\.role='admin' OR EXISTS\(SELECT 1 FROM public\.background_editors e WHERE e\.user_id=u\.id\)/);
  // No other function of the library is replaced: the validator stays the elements file's, read and the rest the base file's.
  const replaced = [...editors.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(match => match[1]);
  assert.deepEqual(replaced, ['background_editors_can_edit', 'background_library_snapshot', 'background_library_execute', 'background_editors_session_list', 'background_editors_session_set']);
});

test('E-3: the list is reached only through the two admin wrappers, and only four functions are granted', () => {
  assert.match(editors, /CREATE TABLE IF NOT EXISTS public\.background_editors \(/);
  assert.match(editors, /ALTER TABLE public\.background_editors ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(editors, /CREATE POLICY|REFERENCES public\.users/);
  const grants = [...editors.matchAll(/GRANT EXECUTE ON FUNCTION ([^']+) TO/g)].map(match => match[1].split(',').map(item => item.trim()));
  assert.deepEqual(grants, [['public.background_library_read(text)', 'public.background_library_execute(text', 'text', 'jsonb)', 'public.background_editors_session_list(text)', 'public.background_editors_session_set(text', 'text', 'boolean)']]);
  for (const name of ['background_editors_session_list', 'background_editors_session_set']) {
    const body = fn(editors, name);
    assert.match(body, /SECURITY DEFINER SET search_path = public, pg_temp/, name);
    assert.match(body, /IF NOT EXISTS\(SELECT 1 FROM public\.users WHERE id=actor AND role='admin'\) THEN RAISE EXCEPTION '[^']+' USING ERRCODE='42501'; END IF;/, name);
  }
  assert.match(fn(editors, 'background_editors_can_edit'), /SECURITY INVOKER/);
});

test('E-6: the applied body is as it was: production holds it (20261016105647), and only the comment lines above BEGIN; may change', () => {
  const at = editors.indexOf('\nBEGIN;\n'); assert.ok(at >= 0);
  assert.equal(createHash('sha256').update(editors.slice(at + 1)).digest('hex'), '9a5b9cfb018230364acdeb9ad0b023693f3bf5240055e2588658a8916e2ea722');
});

const tokens = { admin: 'a'.repeat(64), member: 'b'.repeat(64), editor: 'c'.repeat(64) };
async function boot() {
  const { PGlite } = await import(pathToFileURL(runtime!).href); const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
    CREATE TABLE public.users(id TEXT PRIMARY KEY,role TEXT DEFAULT 'user');
    CREATE TABLE public.episodes(episode_number INTEGER PRIMARY KEY);
    INSERT INTO users VALUES('admin','admin'),('member','user'),('editor','user');INSERT INTO episodes VALUES(1);
    CREATE SCHEMA realtime;CREATE TABLE realtime.messages(payload JSONB,event TEXT,topic TEXT,private BOOLEAN);
    CREATE FUNCTION realtime.send(payload JSONB,event TEXT,topic TEXT,private BOOLEAN) RETURNS VOID LANGUAGE SQL AS 'INSERT INTO realtime.messages VALUES(payload,event,topic,private)';`);
  const auth = readFileSync(new URL('../DEVLOG/migrations/2026-09-05-app-sessions-gantt-auth.sql', import.meta.url), 'utf8');
  await db.exec(auth.slice(0, auth.indexOf('-- ── 3)')));
  await db.exec('REVOKE ALL ON FUNCTION public.app_session_user_id(text) FROM PUBLIC,anon,authenticated');
  for (const who of ['admin', 'member', 'editor'] as const) await db.query("INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [createHash('sha256').update(tokens[who]).digest('hex'), who]);
  return db;
}

test('E-4: an admin puts a person on the list and takes them off, and the right follows at once', { skip: !runtime }, async () => {
  const db = await boot();
  try {
    await db.exec(base); await db.exec(sql3d); await db.exec(elements); await db.exec(editors); await db.exec(editors); await db.exec('SET ROLE anon');
    type Who = keyof typeof tokens;
    const read = async (who: Who) => (await db.query('SELECT background_library_read($1) AS value', [tokens[who]])).rows[0].value;
    const save = async (who: Who, entity: unknown, kind = 'place') => (await db.query('SELECT background_library_execute($1,$2,$3) AS value', [tokens[who], randomUUID(), { type: 'save', kind, entity, expectedRevision: null }])).rows[0].value;
    const list = async (who: Who) => (await db.query('SELECT background_editors_session_list($1) AS value', [tokens[who]])).rows[0].value;
    const set = async (who: Who, userId: string | null, editor: boolean | null) => (await db.query('SELECT background_editors_session_set($1,$2,$3) AS value', [tokens[who], userId, editor])).rows[0].value;
    const place = (name: string) => ({ id: randomUUID(), revision: 0, name, parentId: null, folderPath: '' });
    const signals = async () => { await db.exec('RESET ROLE'); const count = (await db.query("SELECT count(*)::int AS n FROM realtime.messages WHERE topic='background-library'")).rows[0].n; await db.exec('SET ROLE anon'); return count; };

    // Nobody on the list: the right is the admin's, as before.
    assert.deepEqual(await list('admin'), []);
    assert.equal((await read('admin')).canManage, true); assert.equal((await read('editor')).canManage, false);
    await assert.rejects(save('editor', place('편집자 전')), (error: { code?: string; message?: string }) => error.code === '42501' && error.message === REFUSED_AFTER);
    // Put on the list: the next read says so, and a save of a place and of a map goes through.
    const before = await signals();
    assert.deepEqual(await set('admin', 'editor', true), ['editor']);
    assert.equal(await signals(), before + 1, 'open screens are told to read again');
    assert.deepEqual(await set('admin', 'editor', true), ['editor'], 'twice is once');
    assert.equal((await read('editor')).canManage, true); assert.equal((await read('member')).canManage, false);
    const saved = await save('editor', place('편집자가 만든 장소'));
    assert.ok(saved.places.some((item: { name: string }) => item.name === '편집자가 만든 장소'));
    await save('editor', { id: randomUUID(), revision: 0, name: '편집자의 도면', placeId: null, parentId: null, imageUrl: '', nodes: [] }, 'map');
    // Only an admin reads or changes the list: not a member, not an editor, not a bad session.
    for (const who of ['member', 'editor'] as const) {
      await assert.rejects(list(who), { code: '42501' }); await assert.rejects(set(who, 'member', true), { code: '42501' });
    }
    await assert.rejects(db.query('SELECT background_editors_session_list($1)', ['invalid']), { code: '42501' });
    // Someone who does not exist, or no answer, is no change.
    await assert.rejects(set('admin', 'nobody', true), { code: '22023' }); await assert.rejects(set('admin', 'member', null), { code: '22023' });
    await assert.rejects(set('admin', null, true), { code: '22023' });
    // The table and the inner functions are out of reach.
    await assert.rejects(db.query('SELECT * FROM public.background_editors'), { code: '42501' });
    await assert.rejects(db.query('SELECT public.background_editors_can_edit($1)', ['editor']), { code: '42501' });
    await assert.rejects(db.query('INSERT INTO public.background_editors(user_id,granted_by) VALUES($1,$2)', ['member', 'member']), { code: '42501' });
    // Taken off: the right goes with the next read and the next save.
    assert.deepEqual(await set('admin', 'editor', false), []);
    assert.equal((await read('editor')).canManage, false);
    await assert.rejects(save('editor', place('편집자 뒤')), { code: '42501' });
    // Episode usage stays open to every member, as before.
    assert.equal((await read('member')).canManage, false);
  } finally { await db.close(); }
});

test('E-5: a run of the base file takes the editors\' right back until this file runs again, and a gone user gives none', { skip: !runtime }, async () => {
  const db = await boot();
  try {
    await db.exec(base); await db.exec(sql3d); await db.exec(elements); await db.exec(editors);
    await db.exec('SET ROLE anon');
    await db.query('SELECT background_editors_session_set($1,$2,$3)', [tokens.admin, 'editor', true]);
    const right = async () => (await db.query('SELECT background_library_read($1) AS value', [tokens.editor])).rows[0].value.canManage;
    assert.equal(await right(), true);
    // The base file alone: the admin-only right comes back (fail closed), and the list is kept.
    await db.exec('RESET ROLE'); await db.exec(base); await db.exec('SET ROLE anon');
    assert.equal(await right(), false);
    await db.exec('RESET ROLE'); await db.exec(sql3d); await db.exec(elements); await db.exec(editors); await db.exec('SET ROLE anon');
    assert.equal(await right(), true, 'the chain applied again gives the right back, from the list that was kept');
    // A user who is gone is neither listed nor given the right, though the row stays.
    await db.exec('RESET ROLE'); await db.exec("DELETE FROM app_sessions WHERE user_id='editor'"); await db.exec("DELETE FROM users WHERE id='editor'");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM background_editors WHERE user_id='editor'")).rows[0].n, 1);
    await db.exec('SET ROLE anon');
    assert.deepEqual((await db.query('SELECT background_editors_session_list($1) AS value', [tokens.admin])).rows[0].value, []);
  } finally { await db.close(); }
});
