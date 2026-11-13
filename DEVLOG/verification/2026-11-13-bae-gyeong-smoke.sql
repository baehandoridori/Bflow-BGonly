-- BAE경 기본 SQL(2026-11-13-bae-gyeong-base.sql)의 확인. 아무것도 남기지 않는다: 끝에서 일부러 오류를 내어 모두 되돌린다.
-- 쓰는 법 (운영 예행연습, tasks/lessons.md 2026-09-05 · 2026-10-08):
--   1) 기본 SQL 파일에서 맨 위 BEGIN; 과 맨 아래 COMMIT; 두 줄만 뺀 본문 + 이 파일을 한 묶음으로 실행한다 (명시 BEGIN 없이).
--   2) 끝의 'BAE SMOKE OK' 오류가 나오면 모든 확인이 통과했고, 그 묶음은 모두 되돌려졌다.
--   3) 뒤에 SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'; 이 0인지 본다.
-- 시험용 사용자 · 세션은 이 묶음 안에서만 만든다. 진짜 키는 넣지 않는다 (가짜 키 sk-test-local-only…).
DO $$
DECLARE
  t_admin TEXT := repeat('a', 64); t_user TEXT := repeat('b', 64); t_out TEXT := repeat('c', 64);
  r JSONB; ok BOOLEAN; n INTEGER; fn TEXT;
BEGIN
  INSERT INTO public.users(id, name, role) VALUES ('bae-smoke-admin', 'bae smoke admin', 'admin'), ('bae-smoke-user', 'bae smoke user', 'user'), ('bae-smoke-out', 'bae smoke out', 'user');
  INSERT INTO public.app_sessions(token_hash, user_id, expires_at) VALUES
    (encode(sha256(convert_to(t_admin, 'UTF8')), 'hex'), 'bae-smoke-admin', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_user, 'UTF8')), 'hex'), 'bae-smoke-user', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_out, 'UTF8')), 'hex'), 'bae-smoke-out', now() + interval '1 hour');

  -- 1. anon/authenticated: 세션 래퍼만 실행, 표는 직접 못 읽음
  FOR fn IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname LIKE 'bae_gyeong_%' LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') <> (fn LIKE 'bae_gyeong_session_%') THEN RAISE EXCEPTION 'grant wrong: %', fn; END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.bae_gyeong_settings', 'SELECT') OR has_table_privilege('authenticated', 'public.bae_gyeong_keys', 'SELECT') THEN RAISE EXCEPTION 'table readable'; END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE tablename LIKE 'bae_gyeong_%') THEN RAISE EXCEPTION 'policy exists'; END IF;
  IF EXISTS(SELECT 1 FROM pg_publication_tables WHERE tablename LIKE 'bae_gyeong_%') THEN RAISE EXCEPTION 'table in publication'; END IF;

  -- 2. 권리: 명단에 없으면 못 씀, 관리자만 명단 · 설정 · 키
  r := public.bae_gyeong_session_access(t_out); IF (r->>'canUse')::boolean THEN RAISE EXCEPTION 'outsider can use'; END IF;
  BEGIN PERFORM public.bae_gyeong_session_members_set(t_user, 'bae-smoke-user', 'user'); RAISE EXCEPTION 'user set members'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.bae_gyeong_session_members_set(t_admin, 'bae-smoke-user', 'user');
  r := public.bae_gyeong_session_access(t_user); IF NOT (r->>'canUse')::boolean OR (r->>'canReview')::boolean THEN RAISE EXCEPTION 'member access wrong: %', r; END IF;

  -- 3. 설정 책장: 판 번호, 충돌, 기록 (이미 줄이 있으면 그 판에서 이어서)
  n := COALESCE((SELECT revision FROM public.bae_gyeong_settings WHERE key = 'guidance'), 0);
  r := public.bae_gyeong_session_settings_save(t_admin, 'guidance', '{"text":"smoke"}'::jsonb, n);
  IF (r->>'revision')::int <> n + 1 THEN RAISE EXCEPTION 'revision wrong'; END IF;
  BEGIN PERFORM public.bae_gyeong_session_settings_save(t_admin, 'guidance', '{"text":"smoke2"}'::jsonb, n); RAISE EXCEPTION 'stale save passed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_settings_save(t_user, 'guidance', '{"text":"x"}'::jsonb, n + 1); RAISE EXCEPTION 'user saved settings'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 4. 키: 상태에는 글자가 없고, 권리가 없으면 못 받음 (가짜 키로만)
  r := public.bae_gyeong_session_set_key(t_admin, 'sk-test-local-only-smoke-0123456789');
  IF r::text LIKE '%0123456789%' THEN RAISE EXCEPTION 'status carries the key'; END IF;
  r := public.bae_gyeong_session_get_key(t_user); IF r->>'key' <> 'sk-test-local-only-smoke-0123456789' OR r->>'label' <> 'team' THEN RAISE EXCEPTION 'get_key wrong'; END IF;
  BEGIN PERFORM public.bae_gyeong_session_get_key(t_out); RAISE EXCEPTION 'outsider got the key'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 5. 작업 기록: 만든 사람만 쓰고, 다른 사람은 못 보고, 끝난 작업은 늦은 쓰기로 되돌아가지 않음
  r := public.bae_gyeong_session_job_upsert(t_user, '{"id":"5b0c4f1e-0000-4000-8000-00000000a001","kind":"new","status":"drawing","summary":{"request":"smoke"}}'::jsonb);
  IF r->>'userId' <> 'bae-smoke-user' OR r->>'userName' <> 'bae smoke user' THEN RAISE EXCEPTION 'job owner wrong: %', r; END IF;
  r := public.bae_gyeong_session_job_upsert(t_user, '{"id":"5b0c4f1e-0000-4000-8000-00000000a001","status":"done","costUsd":0.09}'::jsonb);
  r := public.bae_gyeong_session_job_upsert(t_user, '{"id":"5b0c4f1e-0000-4000-8000-00000000a001","status":"drawing"}'::jsonb);
  IF r->>'status' <> 'done' THEN RAISE EXCEPTION 'late write reopened the job'; END IF;
  BEGIN PERFORM public.bae_gyeong_session_job_get(t_out, '5b0c4f1e-0000-4000-8000-00000000a001'); RAISE EXCEPTION 'outsider read the job'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_job_upsert(t_out, '{"id":"5b0c4f1e-0000-4000-8000-00000000a002","kind":"new","status":"drawing"}'::jsonb); RAISE EXCEPTION 'outsider made a job'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_job_list_team(t_user, NULL, 10); RAISE EXCEPTION 'member read the team list'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  r := public.bae_gyeong_session_job_list_mine(t_user, NULL, 10); IF jsonb_array_length(r->'rows') <> 1 THEN RAISE EXCEPTION 'list_mine wrong: %', r; END IF;

  -- 6. 장부: 같은 번호표는 한 줄, 누가 · 어느 키는 서버가 정함
  r := public.bae_gyeong_session_usage_log(t_user, '{"kind":"image","model":"gpt-image-2.5-sunburst","usd":0.0752,"requestId":"bae-smoke-r1","keyLabel":"x"}'::jsonb);
  r := public.bae_gyeong_session_usage_log(t_user, '{"kind":"image","model":"gpt-image-2.5-sunburst","usd":0.0752,"requestId":"bae-smoke-r1"}'::jsonb);
  IF NOT (r->>'duplicate')::boolean THEN RAISE EXCEPTION 'duplicate usage line'; END IF;
  IF (SELECT count(*) FROM public.bae_gyeong_usage WHERE user_id = 'bae-smoke-user') <> 1 OR (SELECT key_label FROM public.bae_gyeong_usage WHERE user_id = 'bae-smoke-user') <> 'team' THEN RAISE EXCEPTION 'usage line wrong'; END IF;

  RAISE EXCEPTION 'BAE SMOKE OK (all checks passed; everything rolled back)';
END $$;
