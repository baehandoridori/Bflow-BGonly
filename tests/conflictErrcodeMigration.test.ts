import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// '다른 사용자가 먼저 바꿈' 같은 충돌은 PT409 로 낸다(2026-11-16). 함수가 40001(serialization_failure)을 내면 서버 API
// (PostgREST 14)가 같은 요청을 처음부터 끝없이 다시 실행해, 앱은 답을 못 받고 DB 는 연결을 끊을 때까지 계속 돈다
// (BAE경 개발 DB 에서 9분에 약 530번). 이 파일은 셋을 본다.
//   1. 바꾸는 파일의 대상 목록이 레포 마이그레이션에서 40001 을 내는 함수 전부다.
//   2. 그 뒤로 40001·40P01 을 직접 내는 마이그레이션이 새로 들어오지 않는다(새 파일은 PT409).
//   3. PostgreSQL 호환 실행기(BFLOW_PGLITE_MODULE)에서 글자만 바꾸고 권한·설명·설정은 남기며, 남은 곳이 있으면 전부 되돌린다.
// 실제 함수가 PT409 로 답하는지는 각 기능의 DB 시험(배경·반복 일정·외부 구독·간트)이 사슬 끝에 이 파일을 붙여 본다.
const dir = new URL('../DEVLOG/migrations/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8').replace(/\r\n/g, '\n');
const FIX = '2026-11-16-conflict-errcode-pt409.sql';
const fix = read(FIX);
const runtime = process.env.BFLOW_PGLITE_MODULE;
/** SQL 주석을 뺀 본문(머리말이 40001 을 말하는 것은 괜찮다). */
const code = (text: string) => text.replace(/--[^\n]*/g, '');
/** 서버 API 가 다시 실행하는 번호를 직접 내는 곳. EXCEPTION WHEN serialization_failure 로 받는 것은 해당하지 않는다. */
const RETRIED = /ERRCODE\s*=\s*'(?:40001|40P01|serialization_failure|deadlock_detected)'|RAISE[^;]*(?:SQLSTATE\s*'(?:40001|40P01)'|\bserialization_failure\b|\bdeadlock_detected\b)/i;
/** 이미 운영에 적용된 파일들 — 기록이라 그대로 두고, 바꾸는 파일이 뒤에서 고친다. 여기에 새 파일을 더하지 않는다. */
const HISTORY = [
  '2026-08-24-shared-calendars.sql', '2026-09-05-gantt-workspaces.sql', '2026-09-17-calendar-linked-gantt.sql',
  '2026-09-21-background-library.sql', '2026-10-16-background-editors.sql', '20260905151837_gantt_release_acl.sql',
  '20260905173804_gantt_revision_ledger.sql', '20260905193555_gantt_project_pair.sql', '20260919170351_calendar_external_feed.sql',
  '20260920061229_calendar_recurrence.sql',
];
const files = readdirSync(dir).filter(name => name.endsWith('.sql') && name !== FIX).sort();
const targets = [...fix.matchAll(/^\s*'public\.(\w+)\(([^)]*)\)',?$/gm)].map(match => ({ name: match[1], args: match[2] }));

test('새 마이그레이션은 충돌을 40001·40P01 로 내지 않는다 — 운영에 적용된 기록 파일만 남아 있다', () => {
  const raising = files.filter(name => RETRIED.test(code(read(name))));
  assert.deepEqual(raising, [...HISTORY].sort(), '새 파일의 충돌은 RAISE ... USING ERRCODE=\'PT409\' 로 낸다(CLAUDE.md 필수 규칙 11)');
});

test('바꾸는 파일의 대상은 레포에서 40001 을 내는 함수 전부이고, 기록 파일 머리말은 다시 실행하라고 말한다', () => {
  const raisingFunctions = new Set<string>();
  for (const name of HISTORY) {
    const text = code(read(name));
    const starts = [...text.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)];
    starts.forEach((match, index) => {
      const body = text.slice(match.index, starts[index + 1]?.index ?? text.length);
      if (RETRIED.test(body)) raisingFunctions.add(match[1]);
    });
    // 이 파일을 다시 실행하면 40001 이 돌아오므로, 그 자리(머리말)에서 바꾸는 파일을 다시 실행하라고 말한다.
    assert.ok(read(name).split('\n').filter(line => line.startsWith('--')).some(line => line.includes(FIX)), name);
  }
  assert.deepEqual(targets.map(target => target.name).sort(), [...raisingFunctions].sort());
  assert.equal(new Set(targets.map(target => target.name)).size, targets.length);
  // 바꾸는 파일은 함수 본문을 다시 붙이지 않는다: DB 에 있는 정의에서 글자만 바꾼다(운영과 기록이 달라도 다른 곳을 되돌리지 않게).
  assert.doesNotMatch(code(fix), /CREATE OR REPLACE FUNCTION/);
  assert.match(fix, /pg_get_functiondef\(fn\)/);
  assert.match(fix, /^BEGIN;$/m);
  assert.match(fix, /^COMMIT;$/m);
});

test('CLAUDE.md·AGENTS.md 가 새 규칙과 배경 사슬의 마지막 파일을 말한다', () => {
  for (const doc of ['CLAUDE.md', 'AGENTS.md']) {
    const text = readFileSync(new URL(`../${doc}`, import.meta.url), 'utf8');
    assert.match(text, /RPC 충돌은 40001 로 내지 않는다/, doc);
    assert.ok(text.includes(`편집자(\`2026-10-16-background-editors.sql\``) && text.includes(`→ 충돌 번호(\`${FIX}\``), doc);
  }
});

test('DB 에 있는 정의에서 충돌 번호만 바꾸고 권한·설명·설정은 남기며, 남은 곳이 있으면 전부 되돌린다', { skip: !runtime }, async () => {
  const { PGlite } = await import(pathToFileURL(runtime!).href);
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;
      CREATE TABLE public.items(id INTEGER);
      CREATE FUNCTION public.background_library_execute(p_session_token TEXT,p_request_id TEXT,p_command JSONB) RETURNS JSONB
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      BEGIN
        IF p_command->>'stale'='true' THEN RAISE EXCEPTION '다른 사용자가 먼저 변경했습니다. 다시 불러와 주세요.' USING ERRCODE='40001'; END IF;
        IF p_command->>'gone'='true' THEN RAISE EXCEPTION '이미 존재하거나 삭제된 식별자입니다.' USING ERRCODE = '40001'; END IF;
        IF p_command->>'denied'='true' THEN RAISE EXCEPTION '권한이 없습니다.' USING ERRCODE='42501'; END IF;
        RETURN '{}'::JSONB;
      END $$;
      REVOKE ALL ON FUNCTION public.background_library_execute(TEXT,TEXT,JSONB) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.background_library_execute(TEXT,TEXT,JSONB) TO anon;
      COMMENT ON FUNCTION public.background_library_execute(TEXT,TEXT,JSONB) IS '설명은 남는다';
      CREATE FUNCTION public.gantt_assign_insert_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id<0 THEN RAISE EXCEPTION '이전 버전에서 삭제한 항목은 복원할 수 없습니다.' USING ERRCODE='40001'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER items_revision BEFORE INSERT ON public.items FOR EACH ROW EXECUTE FUNCTION public.gantt_assign_insert_revision();
      -- 받기만 하는 곳은 그대로 둔다.
      CREATE FUNCTION public.catches_conflict() RETURNS BOOLEAN LANGUAGE plpgsql AS $$
      BEGIN PERFORM 1; RETURN true; EXCEPTION WHEN serialization_failure THEN RETURN false; END $$;`);
    const meta = async () => (await db.query(`SELECT p.proacl::TEXT AS acl,p.proconfig AS config,p.prosecdef AS definer,
      obj_description(p.oid,'pg_proc') AS comment FROM pg_proc p WHERE p.oid='public.background_library_execute(text,text,jsonb)'::regprocedure`)).rows[0];
    const before = await meta();
    const call = (command: object) => db.query('SELECT public.background_library_execute($1,$2,$3) AS value', ['token', 'request', command]);
    await assert.rejects(call({ stale: 'true' }), { code: '40001' });

    // 두 번 돌려도 같다. 없는 대상(간트·캘린더 함수)은 건너뛴다.
    await db.exec(fix); await db.exec(fix);
    await assert.rejects(call({ stale: 'true' }), { code: 'PT409', message: '다른 사용자가 먼저 변경했습니다. 다시 불러와 주세요.' });
    await assert.rejects(call({ gone: 'true' }), { code: 'PT409', message: '이미 존재하거나 삭제된 식별자입니다.' });
    await assert.rejects(call({ denied: 'true' }), { code: '42501' });
    assert.deepEqual((await call({})).rows[0].value, {});
    await assert.rejects(db.query('INSERT INTO public.items VALUES(-1)'), { code: 'PT409' });
    assert.deepEqual(await meta(), before);
    assert.equal((await db.query(`SELECT count(*)::INT AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosrc ~ '40001'`)).rows[0].n, 0);

    // 목록에 없는 함수가 40001 을 직접 내면 실패하고, 그 사이 바꾼 대상까지 전부 되돌린다.
    await db.exec(`CREATE FUNCTION public.calendar_session_feed_manage(p_session_token TEXT,p_calendar_id UUID,p_action TEXT,
        p_token_hash TEXT DEFAULT NULL,p_expected_revision UUID DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION '외부 구독 설정이 변경되었습니다.' USING ERRCODE='40001'; END $$;
      CREATE FUNCTION public.unlisted_conflict() RETURNS VOID LANGUAGE plpgsql AS $$
      BEGIN RAISE SQLSTATE '40001' USING MESSAGE='목록에 없는 충돌'; END $$;`);
    await assert.rejects(db.exec(fix), { message: /unlisted_conflict\(\)/ });
    await db.exec('ROLLBACK');
    const feed = () => db.query('SELECT public.calendar_session_feed_manage($1,$2,$3)', ['token', '00000000-0000-4000-8000-000000000001', 'revoke']);
    await assert.rejects(feed(), { code: '40001' });
    await db.exec('DROP FUNCTION public.unlisted_conflict()');
    await db.exec(fix);
    await assert.rejects(feed(), { code: 'PT409' });

    // 대상인데 충돌 번호가 아예 없으면 정의가 예상과 다른 것이니 멈춘다.
    await db.exec(`CREATE FUNCTION public.delete_calendar_event_authorized(p_actor_id TEXT,p_event_id UUID,p_expected_calendar_id UUID)
      RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;`);
    await assert.rejects(db.exec(fix), { message: /delete_calendar_event_authorized.*정의가 예상과 다르니/ });
    await db.exec('ROLLBACK');
  } finally { await db.close(); }
});
