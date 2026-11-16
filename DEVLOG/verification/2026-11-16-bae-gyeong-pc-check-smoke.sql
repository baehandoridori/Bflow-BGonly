-- BAE경 '이 PC 점검' SQL(DEVLOG/migrations/2026-11-16-bae-gyeong-pc-check.sql)의 확인. 아무것도 남기지 않는다: 끝에서 일부러 오류를 내어 모두 되돌린다.
-- 쓰는 법 (운영 예행연습, tasks/lessons.md 2026-09-05 · 2026-10-08, 2026-11-13-bae-gyeong-smoke.sql 과 같음):
--   1) 이 PC 점검 SQL 파일에서 맨 위 BEGIN; 과 맨 아래 COMMIT; 두 줄만 뺀 본문 + 이 파일을 한 묶음으로 실행한다 (명시 BEGIN 없이).
--      기본 SQL(2026-11-13-bae-gyeong-base.sql)이 먼저 깔려 있어야 한다.
--   2) 끝의 'BAE PCCHECK SMOKE OK' 오류가 나오면 모든 확인이 통과했고, 그 묶음은 모두 되돌려졌다.
--   3) 뒤에 SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'; 이 0인지 본다.
-- 시험용 사용자 · 세션 · PC 번호는 이 묶음 안에서만 만든다.
DO $$
DECLARE
  t_admin TEXT := repeat('5', 64); t_user TEXT := repeat('6', 64); t_out TEXT := repeat('7', 64); t_rev TEXT := repeat('8', 64);
  pc1 TEXT := '5b0c4f1e-0000-4000-8000-0000000c0001'; pc2 TEXT := '5b0c4f1e-0000-4000-8000-0000000c0002';
  r JSONB; n INTEGER; fn TEXT;
BEGIN
  INSERT INTO public.users(id, name, role) VALUES ('bae-pccheck-smoke-admin', 'pccheck smoke admin', 'admin'), ('bae-pccheck-smoke-user', 'pccheck smoke user', 'user'),
    ('bae-pccheck-smoke-out', 'pccheck smoke out', 'user'), ('bae-pccheck-smoke-rev', 'pccheck smoke rev', 'user');
  INSERT INTO public.app_sessions(token_hash, user_id, expires_at) VALUES
    (encode(sha256(convert_to(t_admin, 'UTF8')), 'hex'), 'bae-pccheck-smoke-admin', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_user, 'UTF8')), 'hex'), 'bae-pccheck-smoke-user', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_out, 'UTF8')), 'hex'), 'bae-pccheck-smoke-out', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_rev, 'UTF8')), 'hex'), 'bae-pccheck-smoke-rev', now() + interval '1 hour');
  PERFORM public.bae_gyeong_session_members_set(t_admin, 'bae-pccheck-smoke-user', 'user');
  PERFORM public.bae_gyeong_session_members_set(t_admin, 'bae-pccheck-smoke-rev', 'reviewer');

  -- 1. anon/authenticated: 세션 래퍼만 실행, 표는 직접 못 읽음, 정책 · 실시간 목록 없음
  FOR fn IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname LIKE 'bae_gyeong_%' LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') <> (fn LIKE 'bae_gyeong_session_%') THEN RAISE EXCEPTION 'grant wrong: %', fn; END IF;
    IF has_function_privilege('authenticated', fn, 'EXECUTE') <> (fn LIKE 'bae_gyeong_session_%') THEN RAISE EXCEPTION 'grant wrong (authenticated): %', fn; END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.bae_gyeong_pc_checks', 'SELECT') OR has_table_privilege('authenticated', 'public.bae_gyeong_pc_checks', 'INSERT') THEN RAISE EXCEPTION 'table open'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bae_gyeong_pc_checks'::regclass) THEN RAISE EXCEPTION 'RLS off'; END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE tablename = 'bae_gyeong_pc_checks') THEN RAISE EXCEPTION 'policy exists'; END IF;
  IF EXISTS(SELECT 1 FROM pg_publication_tables WHERE tablename = 'bae_gyeong_pc_checks') THEN RAISE EXCEPTION 'table in publication'; END IF;

  -- 2. 올리기: 서버가 사람을 정함 (보낸 userId 는 무시), 같은 PC 는 한 줄
  r := public.bae_gyeong_session_pc_check_put(t_user, jsonb_build_object('pcId', pc1, 'userId', 'bae-pccheck-smoke-admin', 'pcName', 'SMOKE-PC', 'appVersion', 'smoke', 'level', 'ok', 'summary', 'smoke', 'result', '{"version":1}'::jsonb));
  IF r->>'userId' <> 'bae-pccheck-smoke-user' OR r->>'userName' <> 'pccheck smoke user' OR r->>'level' <> 'ok' THEN RAISE EXCEPTION 'put owner wrong: %', r; END IF;
  r := public.bae_gyeong_session_pc_check_put(t_user, jsonb_build_object('pcId', pc1, 'level', 'warn', 'summary', 'smoke2', 'result', '{}'::jsonb));
  IF r->>'level' <> 'warn' THEN RAISE EXCEPTION 'update wrong: %', r; END IF;
  IF (SELECT count(*) FROM public.bae_gyeong_pc_checks WHERE user_id = 'bae-pccheck-smoke-user') <> 1 THEN RAISE EXCEPTION 'one row per PC broken'; END IF;
  PERFORM public.bae_gyeong_session_pc_check_put(t_user, jsonb_build_object('pcId', pc2, 'level', 'bad', 'result', '{}'::jsonb));
  IF (SELECT count(*) FROM public.bae_gyeong_pc_checks WHERE user_id = 'bae-pccheck-smoke-user') <> 2 THEN RAISE EXCEPTION 'second PC missing'; END IF;

  -- 3. 권리 · 모양: BAE경 사용자가 아니면 못 올림, 모양이 틀리면 22023
  BEGIN PERFORM public.bae_gyeong_session_pc_check_put(t_out, jsonb_build_object('pcId', pc1, 'level', 'ok')); RAISE EXCEPTION 'outsider put a row'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_pc_check_put(t_user, jsonb_build_object('pcId', 'x', 'level', 'ok')); RAISE EXCEPTION 'bad pc id passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_pc_check_put(t_user, jsonb_build_object('pcId', pc1, 'level', 'great')); RAISE EXCEPTION 'bad level passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_pc_check_put(t_user, jsonb_build_object('pcId', pc1, 'level', 'ok', 'result', jsonb_build_object('big', repeat('x', 17000)))); RAISE EXCEPTION 'big result passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 4. 표: 관리자 · 검수자만
  BEGIN PERFORM public.bae_gyeong_session_pc_check_list(t_user); RAISE EXCEPTION 'member read the table'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  r := public.bae_gyeong_session_pc_check_list(t_rev);
  SELECT count(*) INTO n FROM jsonb_array_elements(r) e WHERE e->>'userId' = 'bae-pccheck-smoke-user';
  IF n <> 2 THEN RAISE EXCEPTION 'reviewer list wrong: %', n; END IF;
  r := public.bae_gyeong_session_pc_check_list(t_admin);
  SELECT count(*) INTO n FROM jsonb_array_elements(r) e WHERE e->>'userId' = 'bae-pccheck-smoke-user';
  IF n <> 2 THEN RAISE EXCEPTION 'admin list wrong: %', n; END IF;

  RAISE EXCEPTION 'BAE PCCHECK SMOKE OK (all checks passed; everything rolled back)';
END $$;
