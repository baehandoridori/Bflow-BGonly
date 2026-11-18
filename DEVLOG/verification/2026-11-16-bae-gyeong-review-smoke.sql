-- BAE경 8단계 SQL(DEVLOG/migrations/2026-11-16-bae-gyeong-review.sql)의 확인. 아무것도 남기지 않는다: 끝에서 일부러 오류를 내어 모두 되돌린다.
-- 쓰는 법 (운영 예행연습, tasks/lessons.md 2026-09-05 · 2026-10-08, 2026-11-13-bae-gyeong-smoke.sql 과 같음):
--   1) 8단계 SQL 파일에서 맨 위 BEGIN; 과 맨 아래 COMMIT; 두 줄만 뺀 본문 + 이 파일을 한 묶음으로 실행한다 (명시 BEGIN 없이).
--      기본 SQL(2026-11-13-bae-gyeong-base.sql)이 먼저 깔려 있어야 한다.
--   2) 끝의 'BAE REVIEW SMOKE OK' 오류가 나오면 모든 확인이 통과했고, 그 묶음은 모두 되돌려졌다.
--   3) 뒤에 SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'; 이 0인지 본다.
-- 시험용 사용자 · 세션 · 작업 · 장부 줄은 이 묶음 안에서만 만든다. 이미 있는 운영 기록은 읽기만 한다 (사람으로 거른다).
DO $$
DECLARE
  t_admin TEXT := repeat('1', 64); t_a TEXT := repeat('2', 64); t_b TEXT := repeat('3', 64); t_rev TEXT := repeat('4', 64);
  ja TEXT := '5b0c4f1e-0000-4000-8000-00000008a001'; ja2 TEXT := '5b0c4f1e-0000-4000-8000-00000008a002'; jb TEXT := '5b0c4f1e-0000-4000-8000-00000008b001';
  jlive TEXT := '5b0c4f1e-0000-4000-8000-00000008a003';
  r JSONB; n INTEGER; fn TEXT; s1 NUMERIC; s2 NUMERIC; s3 NUMERIC;
BEGIN
  INSERT INTO public.users(id, name, role) VALUES ('bae-review-smoke-admin', 'review smoke admin', 'admin'), ('bae-review-smoke-a', 'review smoke a', 'user'),
    ('bae-review-smoke-b', 'review smoke b', 'user'), ('bae-review-smoke-rev', 'review smoke rev', 'user');
  INSERT INTO public.app_sessions(token_hash, user_id, expires_at) VALUES
    (encode(sha256(convert_to(t_admin, 'UTF8')), 'hex'), 'bae-review-smoke-admin', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_a, 'UTF8')), 'hex'), 'bae-review-smoke-a', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_b, 'UTF8')), 'hex'), 'bae-review-smoke-b', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_rev, 'UTF8')), 'hex'), 'bae-review-smoke-rev', now() + interval '1 hour');
  PERFORM public.bae_gyeong_session_members_set(t_admin, 'bae-review-smoke-a', 'user');
  PERFORM public.bae_gyeong_session_members_set(t_admin, 'bae-review-smoke-b', 'user');
  PERFORM public.bae_gyeong_session_members_set(t_admin, 'bae-review-smoke-rev', 'reviewer');

  -- 1. anon/authenticated: 세션 래퍼만 실행, 새 표는 직접 못 읽음, 정책 · 실시간 목록 없음
  FOR fn IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname LIKE 'bae_gyeong_%' LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') <> (fn LIKE 'bae_gyeong_session_%') THEN RAISE EXCEPTION 'grant wrong: %', fn; END IF;
    IF has_function_privilege('authenticated', fn, 'EXECUTE') <> (fn LIKE 'bae_gyeong_session_%') THEN RAISE EXCEPTION 'grant wrong (authenticated): %', fn; END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.bae_gyeong_stamps', 'SELECT') OR has_table_privilege('authenticated', 'public.bae_gyeong_stamp_seen', 'INSERT') THEN RAISE EXCEPTION 'table open'; END IF;
  IF NOT (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.bae_gyeong_stamps'::regclass, 'public.bae_gyeong_stamp_seen'::regclass)) THEN RAISE EXCEPTION 'RLS off'; END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE tablename IN ('bae_gyeong_stamps', 'bae_gyeong_stamp_seen')) THEN RAISE EXCEPTION 'policy exists'; END IF;
  IF EXISTS(SELECT 1 FROM pg_publication_tables WHERE tablename IN ('bae_gyeong_stamps', 'bae_gyeong_stamp_seen')) THEN RAISE EXCEPTION 'table in publication'; END IF;

  -- 2. 시험 계정 둘의 기록 + 장부 줄
  PERFORM public.bae_gyeong_session_job_upsert(t_a, jsonb_build_object('id', ja, 'kind', 'new', 'status', 'done', 'summary', jsonb_build_object('request', 'smoke 주차장'), 'pd', jsonb_build_object('prompt', 'A SMOKEWORD parking lot'), 'costUsd', 0.1));
  PERFORM public.bae_gyeong_session_job_upsert(t_a, jsonb_build_object('id', ja2, 'kind', 'same', 'status', 'done', 'summary', jsonb_build_object('request', 'smoke 거실')));
  PERFORM public.bae_gyeong_session_job_upsert(t_a, jsonb_build_object('id', jlive, 'kind', 'new', 'status', 'drawing'));
  PERFORM public.bae_gyeong_session_job_upsert(t_b, jsonb_build_object('id', jb, 'kind', 'edit', 'status', 'done', 'summary', jsonb_build_object('request', 'smoke 교실')));
  PERFORM public.bae_gyeong_session_usage_log(t_a, jsonb_build_object('jobId', ja, 'kind', 'order', 'model', 'gpt-6.1-sol', 'usd', 0.0241, 'requestId', 'smoke-review-1'));
  PERFORM public.bae_gyeong_session_usage_log(t_a, jsonb_build_object('jobId', ja, 'kind', 'image', 'model', 'gpt-image-2.5-sunburst', 'usd', 0.0752, 'requestId', 'smoke-review-2'));
  PERFORM public.bae_gyeong_session_usage_log(t_b, jsonb_build_object('jobId', jb, 'kind', 'image', 'model', 'gpt-image-2.5-sunburst', 'usd', 0.0813, 'requestId', 'smoke-review-3'));

  -- 3. 서로의 기록: 팀 목록 · 거르기 · 한 건 · 도장 차례 모두 거절, 검수자는 둘 다 봄
  BEGIN PERFORM public.bae_gyeong_session_job_find_team(t_a, '{}'::jsonb, NULL, 50); RAISE EXCEPTION 'member read the team list'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_job_list_team(t_b, NULL, 50); RAISE EXCEPTION 'member read the base team list'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_job_get(t_b, ja::uuid); RAISE EXCEPTION 'b read a''s job'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_job_stamps(t_b, ja::uuid); RAISE EXCEPTION 'b read a''s stamps'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  r := public.bae_gyeong_session_job_list_mine(t_b, NULL, 50);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') e WHERE e->>'userId' <> 'bae-review-smoke-b') THEN RAISE EXCEPTION 'b''s own list carries another''s job'; END IF;
  r := public.bae_gyeong_session_job_find_team(t_rev, jsonb_build_object('userId', 'bae-review-smoke-a'), NULL, 50);
  IF jsonb_array_length(r->'rows') <> 3 THEN RAISE EXCEPTION 'reviewer find by person wrong: %', jsonb_array_length(r->'rows'); END IF;
  r := public.bae_gyeong_session_job_find_team(t_rev, jsonb_build_object('q', 'SMOKEWORD'), NULL, 50);
  IF jsonb_array_length(r->'rows') <> 1 OR r->'rows'->0->>'id' <> ja OR r->'rows'->0 ? 'pd' THEN RAISE EXCEPTION 'search over the order text wrong: %', r; END IF;
  r := public.bae_gyeong_session_job_find_team(t_rev, jsonb_build_object('userId', 'bae-review-smoke-a', 'kind', 'same'), NULL, 50);
  IF jsonb_array_length(r->'rows') <> 1 THEN RAISE EXCEPTION 'kind filter wrong'; END IF;
  r := public.bae_gyeong_session_job_find_team(t_rev, jsonb_build_object('userId', 'bae-review-smoke-a'), NULL, 2);
  IF (r->>'more')::boolean IS NOT TRUE OR r->'next' IS NULL OR jsonb_array_length(r->'rows') <> 2 THEN RAISE EXCEPTION 'paging wrong: %', r; END IF;
  r := public.bae_gyeong_session_job_find_team(t_rev, jsonb_build_object('userId', 'bae-review-smoke-a'), r->'next', 2);
  IF (r->>'more')::boolean OR jsonb_array_length(r->'rows') <> 1 THEN RAISE EXCEPTION 'second page wrong: %', r; END IF;
  IF (public.bae_gyeong_session_job_get(t_rev, jb::uuid))->>'userId' <> 'bae-review-smoke-b' THEN RAISE EXCEPTION 'reviewer get wrong'; END IF;

  -- 4. 도장: 검수자만, 다시는 메모가 있어야, 만드는 중인 작업은 안 됨, 다시 찍으면 바뀌고 차례는 남음
  BEGIN PERFORM public.bae_gyeong_session_job_stamp(t_b, ja::uuid, 'good', NULL); RAISE EXCEPTION 'member stamped'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_job_stamp(t_rev, ja::uuid, 'again', '   '); RAISE EXCEPTION 'again without a memo'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_job_stamp(t_rev, jlive::uuid, 'seen', NULL); RAISE EXCEPTION 'stamped a job being made'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_job_stamp(t_rev, ja::uuid, 'gold', NULL); RAISE EXCEPTION 'bad stamp passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.bae_gyeong_session_job_stamp(t_rev, ja::uuid, 'good', E'좋아요\n이 방향');
  IF r->>'stamp' <> 'good' OR r->>'stampBy' <> 'bae-review-smoke-rev' OR r->>'stampNote' <> '좋아요 이 방향' THEN RAISE EXCEPTION 'stamp wrong: %', r; END IF;
  r := public.bae_gyeong_session_job_stamp(t_rev, ja::uuid, 'good', '좋아요 이 방향');
  IF jsonb_array_length(public.bae_gyeong_session_job_stamps(t_a, ja::uuid)) <> 1 THEN RAISE EXCEPTION 'a double click added a line'; END IF;
  r := public.bae_gyeong_session_job_stamp(t_admin, ja::uuid, 'again', '창문을 더 크게');
  IF r->>'stamp' <> 'again' OR r->>'stampBy' <> 'bae-review-smoke-admin' THEN RAISE EXCEPTION 're-stamp wrong: %', r; END IF;
  r := public.bae_gyeong_session_job_stamps(t_a, ja::uuid);
  IF jsonb_array_length(r) <> 2 OR r->0->>'stamp' <> 'again' OR r->1->>'stamp' <> 'good' OR r->1->>'byName' <> 'review smoke rev' THEN RAISE EXCEPTION 'history wrong: %', r; END IF;

  -- 5. 새 도장 숫자: 만든 사람에게만, 확인한 뒤에는 0, 다시 찍으면 다시 1
  r := public.bae_gyeong_session_stamp_unseen(t_a);
  IF (r->>'count')::int <> 1 OR r->'jobIds'->>0 <> ja THEN RAISE EXCEPTION 'unseen for a wrong: %', r; END IF;
  IF (public.bae_gyeong_session_stamp_unseen(t_b)->>'count')::int <> 0 THEN RAISE EXCEPTION 'b got a''s stamp'; END IF;
  r := public.bae_gyeong_session_stamp_seen(t_a, (r->>'upto')::bigint);
  IF (r->>'count')::int <> 0 THEN RAISE EXCEPTION 'seen did not clear: %', r; END IF;
  PERFORM public.bae_gyeong_session_job_stamp(t_rev, ja2::uuid, 'seen', NULL);
  IF (public.bae_gyeong_session_stamp_unseen(t_a)->>'count')::int <> 0 THEN RAISE EXCEPTION '확인함 is quiet'; END IF;
  PERFORM public.bae_gyeong_session_job_stamp(t_rev, ja2::uuid, 'good', NULL);
  IF (public.bae_gyeong_session_stamp_unseen(t_a)->>'count')::int <> 1 THEN RAISE EXCEPTION 'a new 좋아요 is counted'; END IF;

  -- 6. 여러 건 확인함: 이미 도장이 있는 것과 만드는 중인 것은 그대로
  r := public.bae_gyeong_session_job_stamp_bulk(t_rev, ARRAY[ja, jb, jlive]::uuid[], 'seen');
  IF jsonb_array_length(r->'stamped') <> 1 OR r->'stamped'->>0 <> jb OR (r->>'skipped')::int <> 2 THEN RAISE EXCEPTION 'bulk wrong: %', r; END IF;
  IF (SELECT stamp FROM public.bae_gyeong_jobs WHERE id = ja::uuid) <> 'again' THEN RAISE EXCEPTION 'bulk covered a 다시'; END IF;
  BEGIN PERFORM public.bae_gyeong_session_job_stamp_bulk(t_a, ARRAY[ja2]::uuid[], 'seen'); RAISE EXCEPTION 'member bulk stamped'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_job_stamp_bulk(t_rev, ARRAY[ja2]::uuid[], 'good'); RAISE EXCEPTION 'bulk good passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.bae_gyeong_session_job_find_team(t_rev, jsonb_build_object('userId', 'bae-review-smoke-b', 'unstamped', true), NULL, 50);
  IF jsonb_array_length(r->'rows') <> 0 THEN RAISE EXCEPTION 'unstamped filter wrong'; END IF;

  -- 7. 팀 비용: 검수자만, 표의 합 = 장부 줄의 합
  BEGIN PERFORM public.bae_gyeong_session_usage_team(t_a, NULL, NULL, 'day'); RAISE EXCEPTION 'member read the team cost'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_usage_team(t_rev, now() - interval '200 days', now(), 'day'); RAISE EXCEPTION 'too long a span passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.bae_gyeong_session_usage_team(t_rev, now() - interval '1 hour', now() + interval '1 minute', 'day');
  SELECT COALESCE(sum((e->>'usd')::numeric), 0) INTO s1 FROM jsonb_array_elements(r->'rows') e;
  SELECT COALESCE(sum(usd), 0) INTO s2 FROM public.bae_gyeong_usage WHERE created_at >= now() - interval '1 hour' AND created_at < now() + interval '1 minute';
  IF s1 <> s2 OR (r->'total'->>'usd')::numeric <> s2 THEN RAISE EXCEPTION 'table % / total % / ledger %', s1, r->'total'->>'usd', s2; END IF;
  SELECT COALESCE(sum((e->>'usd')::numeric), 0) INTO s3 FROM jsonb_array_elements(r->'rows') e WHERE e->>'userId' LIKE 'bae-review-smoke-%';
  IF s3 <> 0.1806 THEN RAISE EXCEPTION 'smoke lines sum wrong: %', s3; END IF;
  SELECT count(*) INTO n FROM jsonb_array_elements(r->'rows') e WHERE e->>'userId' = 'bae-review-smoke-a';
  IF n <> 2 THEN RAISE EXCEPTION 'a''s kinds wrong: %', n; END IF;

  RAISE EXCEPTION 'BAE REVIEW SMOKE OK (all checks passed; everything rolled back)';
END $$;
