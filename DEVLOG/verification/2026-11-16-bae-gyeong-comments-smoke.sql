-- BAE경 9단계 코멘트 SQL(DEVLOG/migrations/2026-11-16-bae-gyeong-comments.sql)의 확인. 아무것도 남기지 않는다: 끝에서 일부러 오류를 내어 모두 되돌린다.
-- 쓰는 법 (운영 예행연습, 2026-11-16-bae-gyeong-review-smoke.sql 과 같음):
--   1) 9단계 SQL 파일에서 맨 위 BEGIN; 과 맨 아래 COMMIT; 두 줄만 뺀 본문 + 이 파일을 한 묶음으로 실행한다 (명시 BEGIN 없이).
--      BAE경 기본 · 8단계 SQL 과 댓글 알림 SQL(2026-11-05)이 먼저 깔려 있어야 한다.
--   2) 끝의 'BAE COMMENTS SMOKE OK' 오류가 나오면 모든 확인이 통과했고, 그 묶음은 모두 되돌려졌다.
--   3) 뒤에 SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'; 이 0인지 본다.
-- 이 파일 가운데에는 되돌리기 파일(2026-11-16-bae-gyeong-comments-rollback.sql)의 본문이 그대로 들어 있다 — 되돌린 뒤 씬 댓글이
--   그대로 도는지까지 한 묶음에서 본다(tests/baeGyeongCommentsDatabase.test.ts 가 두 글이 같은지 확인한다).
-- 시험용 사용자 · 세션 · 기록 · 댓글은 이 묶음 안에서만 만든다. 이미 있는 운영 기록은 읽기만 한다 (사람으로 거른다).
DO $$
DECLARE
  t_admin TEXT := repeat('5', 64); t_a TEXT := repeat('6', 64); t_b TEXT := repeat('7', 64); t_rev TEXT := repeat('8', 64); t_out TEXT := repeat('9', 64);
  ja UUID := '5b0c4f1e-0000-4000-8000-00000009a001'; jb UUID := '5b0c4f1e-0000-4000-8000-00000009b001'; jc UUID := '5b0c4f1e-0000-4000-8000-00000009c001';
  c1 TEXT := 'baec_5b0c4f1e-0000-4000-8000-0000000c0001'; c2 TEXT := 'baec_5b0c4f1e-0000-4000-8000-0000000c0002';
  c3 TEXT := 'baec_5b0c4f1e-0000-4000-8000-0000000c0003'; c4 TEXT := 'baec_5b0c4f1e-0000-4000-8000-0000000c0004';
  c5 TEXT := 'baec_5b0c4f1e-0000-4000-8000-0000000c0005'; c6 TEXT := 'baec_5b0c4f1e-0000-4000-8000-0000000c0006';
  s1 TEXT := 'bae-comments-smoke-scene-1'; s2 TEXT := 'bae-comments-smoke-scene-2';
  img TEXT; r JSONB; n INTEGER; fn TEXT;
BEGIN
  INSERT INTO public.users(id, name, role) VALUES ('bae-comments-smoke-admin', 'bae comments smoke admin', 'admin'),
    ('bae-comments-smoke-a', 'bae comments smoke a', 'user'), ('bae-comments-smoke-b', 'bae comments smoke b', 'user'),
    ('bae-comments-smoke-rev', 'bae comments smoke rev', 'user'), ('bae-comments-smoke-out', 'bae comments smoke out', 'user');
  INSERT INTO public.app_sessions(token_hash, user_id, expires_at) VALUES
    (encode(sha256(convert_to(t_admin, 'UTF8')), 'hex'), 'bae-comments-smoke-admin', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_a, 'UTF8')), 'hex'), 'bae-comments-smoke-a', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_b, 'UTF8')), 'hex'), 'bae-comments-smoke-b', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_rev, 'UTF8')), 'hex'), 'bae-comments-smoke-rev', now() + interval '1 hour'),
    (encode(sha256(convert_to(t_out, 'UTF8')), 'hex'), 'bae-comments-smoke-out', now() + interval '1 hour');
  PERFORM public.bae_gyeong_session_members_set(t_admin, 'bae-comments-smoke-a', 'user');
  PERFORM public.bae_gyeong_session_members_set(t_admin, 'bae-comments-smoke-b', 'user');
  PERFORM public.bae_gyeong_session_members_set(t_admin, 'bae-comments-smoke-rev', 'reviewer');

  -- 1. 권한: BAE 함수는 세션 래퍼만 anon/authenticated 가 실행, 공용 표에는 RESTRICTIVE 정책 둘만 더해졌고 기존 허용 정책은 그대로
  FOR fn IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname LIKE 'bae_gyeong_%' LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') <> (fn LIKE 'bae_gyeong_session_%') THEN RAISE EXCEPTION 'grant wrong: %', fn; END IF;
    IF has_function_privilege('authenticated', fn, 'EXECUTE') <> (fn LIKE 'bae_gyeong_session_%') THEN RAISE EXCEPTION 'grant wrong (authenticated): %', fn; END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.comment_notifications_on_insert()', 'EXECUTE') OR NOT has_function_privilege('anon', 'public.comment_notifications_session_list(text,timestamp with time zone,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'shared function grants changed';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comments' AND policyname = 'bae_gyeong_comments_private' AND permissive = 'RESTRICTIVE')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comment_reactions' AND policyname = 'bae_gyeong_comment_reactions_private' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'restrictive policies missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comments' AND permissive = 'PERMISSIVE')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comment_reactions' AND permissive = 'PERMISSIVE') THEN
    RAISE EXCEPTION 'the existing permissive policy is gone';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('comments', 'comment_reactions') AND policyname LIKE 'bae_gyeong_%' AND permissive <> 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'a BAE policy is permissive';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comments')
    OR EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comment_notifications') THEN
    RAISE EXCEPTION 'publication membership changed';
  END IF;

  -- 2. 시험 기록: a 의 ja · jc (끝난 것), b 의 jb
  PERFORM public.bae_gyeong_session_job_upsert(t_a, jsonb_build_object('id', ja, 'kind', 'new', 'status', 'done', 'summary', jsonb_build_object('request', 'smoke 골목')));
  PERFORM public.bae_gyeong_session_job_upsert(t_a, jsonb_build_object('id', jc, 'kind', 'new', 'status', 'done'));
  PERFORM public.bae_gyeong_session_job_upsert(t_b, jsonb_build_object('id', jb, 'kind', 'edit', 'status', 'done'));

  -- 3. 누가 읽고 쓰나: 만든 사람 · 검수자 · 관리자는 되고, 다른 팀원 · 바깥 사람은 안 된다
  r := public.bae_gyeong_session_comment_list(t_a, ja);
  IF jsonb_array_length(r->'comments') <> 0 OR (r->>'canModerate')::boolean THEN RAISE EXCEPTION 'maker list wrong: %', r; END IF;
  IF NOT (r->'audience') @> '[{"id":"bae-comments-smoke-a"},{"id":"bae-comments-smoke-rev"},{"id":"bae-comments-smoke-admin"}]'::jsonb
    OR (r->'audience') @> '[{"id":"bae-comments-smoke-b"}]'::jsonb OR (r->'audience') @> '[{"id":"bae-comments-smoke-out"}]'::jsonb THEN
    RAISE EXCEPTION 'audience wrong: %', r->'audience';
  END IF;
  PERFORM public.bae_gyeong_session_comment_list(t_rev, ja);
  IF NOT (public.bae_gyeong_session_comment_list(t_admin, ja)->>'canModerate')::boolean THEN RAISE EXCEPTION 'admin cannot moderate'; END IF;
  BEGIN PERFORM public.bae_gyeong_session_comment_list(t_b, ja); RAISE EXCEPTION 'b read a''s thread'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_comment_list(t_out, ja); RAISE EXCEPTION 'outsider read a''s thread'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_comment_add(t_b, ja, jsonb_build_object('id', c6, 'text', 'b 가 끼어듦')); RAISE EXCEPTION 'b wrote in a''s thread'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_comment_list(t_a, jb); RAISE EXCEPTION 'a read b''s thread'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_comment_list(t_a, '5b0c4f1e-0000-4000-8000-00000009dead'); RAISE EXCEPTION 'missing job passed'; EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_comment_list('nope', ja); RAISE EXCEPTION 'bad session passed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 4. 알림: 검수자의 댓글 → 만든 사람(자동 · 'assignee'), 멘션은 스레드를 볼 수 있는 사람만 남는다
  r := public.bae_gyeong_session_comment_add(t_rev, ja, jsonb_build_object('id', c1, 'text', '@bae comments smoke a @bae comments smoke b 창문 확인',
    'mentions', jsonb_build_array('bae comments smoke a', 'bae comments smoke b')));
  IF r->'comment'->'mentions' <> '["bae comments smoke a"]'::jsonb OR r->'mentioned' <> '["bae-comments-smoke-a"]'::jsonb
    OR r->'comment'->>'userId' <> 'bae-comments-smoke-rev' OR r->'comment'->>'baeJobId' <> ja::text THEN RAISE EXCEPTION 'add wrong: %', r; END IF;
  IF (SELECT array_agg(recipient_id || ':' || reason ORDER BY recipient_id) FROM public.comment_notifications WHERE comment_id = c1) <> ARRAY['bae-comments-smoke-a:mention'] THEN
    RAISE EXCEPTION 'c1 rows wrong: %', (SELECT array_agg(recipient_id || ':' || reason) FROM public.comment_notifications WHERE comment_id = c1);
  END IF;
  r := public.bae_gyeong_session_comment_add(t_rev, ja, jsonb_build_object('id', c2, 'text', '두 번째 의견'));
  IF (SELECT array_agg(recipient_id || ':' || reason || ':' || COALESCE(detail, '') ORDER BY recipient_id) FROM public.comment_notifications WHERE comment_id = c2)
     <> ARRAY['bae-comments-smoke-a:auto:assignee'] THEN RAISE EXCEPTION 'maker was not notified for c2'; END IF;
  -- 같은 번호를 다시 보내면 같은 댓글(응답을 잃은 다시 보내기), 다른 사람이 같은 번호면 충돌
  IF NOT (public.bae_gyeong_session_comment_add(t_rev, ja, jsonb_build_object('id', c2, 'text', '두 번째 의견'))->>'duplicate')::boolean THEN RAISE EXCEPTION 'retry was not idempotent'; END IF;
  BEGIN PERFORM public.bae_gyeong_session_comment_add(t_a, ja, jsonb_build_object('id', c2, 'text', '가로채기')); RAISE EXCEPTION 'id taken over';
  EXCEPTION WHEN OTHERS THEN IF SQLSTATE <> 'PT409' THEN RAISE; END IF; END;
  BEGIN PERFORM public.bae_gyeong_session_comment_add(t_rev, ja, jsonb_build_object('id', 'c-not-bae', 'text', 'x')); RAISE EXCEPTION 'bad id passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_comment_add(t_rev, ja, jsonb_build_object('id', c6, 'text', '   ')); RAISE EXCEPTION 'empty passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 5. 답글: 원댓글 작성자(reply), 같은 스레드의 댓글에만 · 만든 사람이 답하면 검수자는 답글 상대
  r := public.bae_gyeong_session_comment_add(t_a, ja, jsonb_build_object('id', c3, 'text', '네 고칠게요', 'parentCommentId', c1));
  IF r->'comment'->>'parentCommentId' <> c1 THEN RAISE EXCEPTION 'reply parent lost'; END IF;
  IF (SELECT array_agg(recipient_id || ':' || reason ORDER BY recipient_id) FROM public.comment_notifications WHERE comment_id = c3) <> ARRAY['bae-comments-smoke-rev:reply'] THEN
    RAISE EXCEPTION 'reply rows wrong';
  END IF;
  -- 그림 첨부: 이 기록의 댓글 그림 자리만
  img := 'https://smoke.supabase.co/storage/v1/object/public/scene-images/bae/' || ja::text || '/comments/comment_1731700000000_ab12cd34.jpg';
  r := public.bae_gyeong_session_comment_add(t_admin, ja, jsonb_build_object('id', c4, 'text', '', 'images', jsonb_build_array(img)));
  IF r->'comment'->'images' <> jsonb_build_array(img) THEN RAISE EXCEPTION 'image lost'; END IF;
  IF (SELECT array_agg(recipient_id || ':' || reason || ':' || COALESCE(detail, '') ORDER BY recipient_id) FROM public.comment_notifications WHERE comment_id = c4)
     <> ARRAY['bae-comments-smoke-a:auto:assignee', 'bae-comments-smoke-rev:auto:participant'] THEN RAISE EXCEPTION 'participant rows wrong'; END IF;
  BEGIN PERFORM public.bae_gyeong_session_comment_add(t_admin, ja, jsonb_build_object('id', c6, 'text', 'x', 'images', jsonb_build_array('https://evil.example/x.jpg')));
    RAISE EXCEPTION 'foreign image passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_comment_add(t_admin, ja, jsonb_build_object('id', c6, 'text', 'x', 'images',
    jsonb_build_array('https://smoke.supabase.co/storage/v1/object/public/scene-images/bae/' || jb::text || '/comments/comment_1.jpg')));
    RAISE EXCEPTION 'another job''s image passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 6. 반응: 래퍼로만, 스레드를 볼 수 있는 사람만
  r := public.bae_gyeong_session_comment_react(t_a, c1, '👍', true);
  IF jsonb_array_length(r) <> 1 OR r->0->>'userId' <> 'bae-comments-smoke-a' THEN RAISE EXCEPTION 'react wrong: %', r; END IF;
  IF jsonb_array_length(public.bae_gyeong_session_comment_react(t_a, c1, '👍', true)) <> 1 THEN RAISE EXCEPTION 'double react'; END IF;
  r := public.bae_gyeong_session_comment_reactions(t_rev, ARRAY[c1, c2, s1]);
  IF jsonb_array_length(r->c1) <> 1 OR jsonb_array_length(r->c2) <> 0 OR r ? s1 THEN RAISE EXCEPTION 'reactions wrong: %', r; END IF;
  IF public.bae_gyeong_session_comment_reactions(t_b, ARRAY[c1]) <> '{}'::jsonb THEN RAISE EXCEPTION 'b read the reactions'; END IF;
  BEGIN PERFORM public.bae_gyeong_session_comment_react(t_b, c1, '👍', true); RAISE EXCEPTION 'b reacted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 7. 표로는 BAE 댓글 · 반응이 보이지 않는다(앱의 anon 열쇠 그대로). 씬 댓글은 예전처럼 보이고 쓸 수 있다.
  SET LOCAL ROLE anon;
  IF (SELECT count(*) FROM public.comments WHERE id IN (c1, c2, c3, c4)) <> 0 THEN RAISE EXCEPTION 'anon sees BAE comments'; END IF;
  IF (SELECT count(*) FROM public.comments WHERE bae_job_id IS NOT NULL) <> 0 THEN RAISE EXCEPTION 'anon sees BAE comments by column'; END IF;
  IF (SELECT count(*) FROM public.comment_reactions WHERE comment_id = c1) <> 0 THEN RAISE EXCEPTION 'anon sees BAE reactions'; END IF;
  BEGIN
    INSERT INTO public.comments(id, user_id, user_name, text, bae_job_id) VALUES (c6, 'bae-comments-smoke-b', 'x', 'sneak', ja);
    RAISE EXCEPTION 'anon inserted a BAE comment';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.comment_reactions(comment_id, user_id, user_name, emoji) VALUES (c1, 'bae-comments-smoke-b', 'x', '😀');
    RAISE EXCEPTION 'anon reacted on a BAE comment';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.comments SET text = 'hijack' WHERE id = c1;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 0 THEN RAISE EXCEPTION 'anon updated a BAE comment'; END IF;
  DELETE FROM public.comments WHERE id = c2;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 0 THEN RAISE EXCEPTION 'anon deleted a BAE comment'; END IF;
  -- 씬 댓글 규칙은 그대로: 멘션(mention) · 답글 상대(reply)
  INSERT INTO public.comments(id, user_id, user_name, text, mentions) VALUES (s1, 'bae-comments-smoke-b', 'bae comments smoke b', '@bae comments smoke out 봐 주세요', '["bae comments smoke out"]');
  INSERT INTO public.comments(id, user_id, user_name, text, parent_comment_id) VALUES (s2, 'bae-comments-smoke-out', 'bae comments smoke out', '확인', s1);
  IF (SELECT count(*) FROM public.comments WHERE id IN (s1, s2)) <> 2 THEN RAISE EXCEPTION 'anon cannot see scene comments'; END IF;
  INSERT INTO public.comment_reactions(comment_id, user_id, user_name, emoji) VALUES (s1, 'bae-comments-smoke-out', 'x', '😀');
  RESET ROLE;
  IF (SELECT array_agg(recipient_id || ':' || reason ORDER BY recipient_id) FROM public.comment_notifications WHERE comment_id = s1) <> ARRAY['bae-comments-smoke-out:mention']
    OR (SELECT array_agg(recipient_id || ':' || reason ORDER BY recipient_id) FROM public.comment_notifications WHERE comment_id = s2) <> ARRAY['bae-comments-smoke-b:reply'] THEN
    RAISE EXCEPTION 'scene comment rules changed';
  END IF;
  BEGIN PERFORM public.bae_gyeong_session_comment_add(t_rev, ja, jsonb_build_object('id', c6, 'text', 'x', 'parentCommentId', s1)); RAISE EXCEPTION 'replied to a scene comment'; EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_comment_delete(t_b, s1); RAISE EXCEPTION 'the BAE wrapper deleted a scene comment'; EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN INSERT INTO public.comments(id, user_id, user_name, text, bae_job_id) VALUES ('not-prefixed', 'bae-comments-smoke-a', 'x', 'x', ja); RAISE EXCEPTION 'prefix rule missing';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 8. 알림 목록: 만든 사람에게 BAE 줄(baeJobId 실림), 다른 팀원 · 바깥 사람에게는 없음, 검수자 권한이 빠지면 그 줄도 감춘다
  r := public.comment_notifications_session_list(t_a, NULL, NULL, 200);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r) e WHERE e->>'commentId' = c2 AND e->'comment'->>'baeJobId' = ja::text AND e->>'reason' = 'auto' AND e->>'detail' = 'assignee') THEN
    RAISE EXCEPTION 'maker list lacks the BAE row';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.comment_notifications_session_list(t_b, NULL, NULL, 200)) e WHERE e->'comment'->>'baeJobId' IS NOT NULL)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(public.comment_notifications_session_list(t_out, NULL, NULL, 200)) e WHERE e->'comment'->>'baeJobId' IS NOT NULL) THEN
    RAISE EXCEPTION 'a BAE row reached someone outside the thread';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.comment_notifications_session_list(t_out, NULL, NULL, 200)) e WHERE e->>'commentId' = s1 AND e->'comment'->'baeJobId' = 'null'::jsonb) THEN
    RAISE EXCEPTION 'scene row lost or misshaped';
  END IF;

  -- 9. 도장: 좋아요 · 다시는 도장 찍은 사람의 댓글 한 줄로 남고 만든 사람에게 알림, 확인함은 조용히
  PERFORM public.bae_gyeong_session_job_stamp(t_rev, ja, 'good', '이 방향');
  r := public.bae_gyeong_session_comment_list(t_a, ja);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'comments') e WHERE e->>'userId' = 'bae-comments-smoke-rev' AND e->>'text' = E'좋아요 도장을 찍었어요.\n이 방향') THEN
    RAISE EXCEPTION 'stamp line missing: %', r->'comments';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comment_notifications n JOIN public.comments c ON c.id = n.comment_id
     WHERE c.bae_job_id = ja AND c.text LIKE '좋아요 도장%' AND n.recipient_id = 'bae-comments-smoke-a' AND n.reason = 'auto') THEN
    RAISE EXCEPTION 'maker was not notified for the stamp';
  END IF;
  n := (SELECT count(*) FROM public.comments WHERE bae_job_id = jb);
  PERFORM public.bae_gyeong_session_job_stamp(t_rev, jb, 'seen', NULL);
  IF (SELECT count(*) FROM public.comments WHERE bae_job_id = jb) <> n THEN RAISE EXCEPTION 'seen stamp wrote a comment'; END IF;

  -- 10. 수정: 쓴 사람만, 새로 넣은 @ 는 볼 수 있는 사람에게만 수정 멘션
  r := public.bae_gyeong_session_comment_edit(t_a, c3, '네 고칠게요 @bae comments smoke rev @bae comments smoke out', '["bae comments smoke rev","bae comments smoke out"]'::jsonb, NULL);
  IF r->'comment'->'mentions' <> '["bae comments smoke rev"]'::jsonb OR r->'addedMentioned' <> '["bae-comments-smoke-rev"]'::jsonb OR r->'comment'->>'editedAt' IS NULL THEN
    RAISE EXCEPTION 'edit wrong: %', r;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comment_notifications WHERE comment_id = c3 AND recipient_id = 'bae-comments-smoke-rev' AND kind = 'edit' AND reason = 'mention')
    OR EXISTS(SELECT 1 FROM public.comment_notifications WHERE comment_id = c3 AND recipient_id = 'bae-comments-smoke-out') THEN RAISE EXCEPTION 'edit mention rows wrong'; END IF;
  BEGIN PERFORM public.bae_gyeong_session_comment_edit(t_rev, c3, '남의 글', '[]'::jsonb, NULL); RAISE EXCEPTION 'edited another''s comment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 11. 지우기: 쓴 사람 · 관리자만, 알림 줄도 함께
  BEGIN PERFORM public.bae_gyeong_session_comment_delete(t_rev, c3); RAISE EXCEPTION 'reviewer deleted the maker''s comment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.bae_gyeong_session_comment_delete(t_b, c3); RAISE EXCEPTION 'b deleted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF NOT (public.bae_gyeong_session_comment_delete(t_a, c3)->>'deleted')::boolean THEN RAISE EXCEPTION 'maker could not delete'; END IF;
  IF EXISTS(SELECT 1 FROM public.comment_notifications WHERE comment_id = c3) THEN RAISE EXCEPTION 'rows of a deleted comment stayed'; END IF;
  IF (public.bae_gyeong_session_comment_delete(t_a, c3)->>'deleted')::boolean THEN RAISE EXCEPTION 'deleted twice'; END IF;
  IF NOT (public.bae_gyeong_session_comment_delete(t_admin, c2)->>'deleted')::boolean THEN RAISE EXCEPTION 'admin could not delete'; END IF;

  -- 12. 기록을 지우면 그 스레드도(FK), 검수자 권한이 빠지면 읽을 수 없다
  PERFORM public.bae_gyeong_session_comment_add(t_rev, jc, jsonb_build_object('id', c5, 'text', 'jc 의견'));
  DELETE FROM public.bae_gyeong_jobs WHERE id = jc;
  IF EXISTS(SELECT 1 FROM public.comments WHERE id = c5) OR EXISTS(SELECT 1 FROM public.comment_notifications WHERE comment_id = c5) THEN RAISE EXCEPTION 'job delete left the thread'; END IF;
  PERFORM public.bae_gyeong_session_members_set(t_admin, 'bae-comments-smoke-rev', 'user');
  BEGIN PERFORM public.bae_gyeong_session_comment_list(t_rev, ja); RAISE EXCEPTION 'demoted reviewer still reads'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.comment_notifications_session_list(t_rev, NULL, NULL, 200)) e WHERE e->'comment'->>'baeJobId' IS NOT NULL) THEN
    RAISE EXCEPTION 'demoted reviewer still lists BAE rows';
  END IF;
  PERFORM public.bae_gyeong_session_members_set(t_admin, 'bae-comments-smoke-rev', 'reviewer');
END $$;

-- ▼ 되돌리기 본문 (DEVLOG/migrations/2026-11-16-bae-gyeong-comments-rollback.sql 에서 BEGIN; · COMMIT; 두 줄만 뺀 것 그대로)
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1) 공용 함수 셋 — 지금 본문이 9단계 것이거나 이미 원래 것일 때만.
DO $$
DECLARE f TEXT; src TEXT; want TEXT;
BEGIN
 FOREACH f IN ARRAY ARRAY['comment_notifications_on_insert()', 'comment_notifications_on_mentions()',
   'comment_notifications_session_list(text,timestamp with time zone,uuid,integer)'] LOOP
  want := CASE f WHEN 'comment_notifications_on_insert()' THEN 'c1653f8c22b65b84efb865b299ea828a'
    WHEN 'comment_notifications_on_mentions()' THEN '987f05de601b36e989a4af849a9b9a53' ELSE 'a0bd8a79a9fd91e9405d63b2b24b962e' END;
  SELECT p.prosrc INTO src FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || f);
  IF src IS NOT NULL AND md5(src) <> want AND position('bae_gyeong_comment' IN src) = 0 THEN
   RAISE EXCEPTION 'BAE경 코멘트 되돌리기: %의 본문이 9단계 본문도 원래 본문도 아닙니다. 누가 고쳤는지 먼저 확인해 주세요.', f;
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.comment_notifications_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.comment_notifications_fanout(NEW.id, 'add', NULL, NULL, true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[comment-notifications] 새 댓글 알림 만들기 실패(댓글은 저장됨): %', SQLERRM;
  END;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.comment_notifications_on_mentions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_added TEXT[];
BEGIN
  BEGIN
    v_added := ARRAY(
      SELECT DISTINCT n FROM unnest(public.comment_notifications_names(NEW.mentions)) n
       WHERE NOT (n = ANY (public.comment_notifications_names(OLD.mentions)))
    );
    IF cardinality(v_added) > 0 THEN
      PERFORM public.comment_notifications_fanout(NEW.id, 'edit', v_added, NULL, true);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[comment-notifications] 수정 멘션 알림 만들기 실패(수정은 저장됨): %', SQLERRM;
  END;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.comment_notifications_session_list(
  p_session_token TEXT, p_after_at TIMESTAMPTZ, p_after_id UUID, p_limit INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_limit INTEGER;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  PERFORM 1 FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  RETURN COALESCE((
    SELECT jsonb_agg(s.item ORDER BY s.event_at, s.id)
      FROM (
        SELECT n.event_at, n.id, jsonb_build_object(
                 'id', n.id, 'commentId', n.comment_id, 'kind', n.kind, 'reason', n.reason, 'detail', n.detail,
                 'eventAt', n.event_at, 'editAt', n.edit_at, 'readAt', n.read_at, 'revisionNo', r.revision_no,
                 'comment', jsonb_build_object(
                   'partId', c.part_id, 'sceneId', c.scene_id, 'sceneUuid', c.scene_uuid,
                   'userId', c.user_id, 'userName', c.user_name, 'text', c.text,
                   'mentions', CASE WHEN jsonb_typeof(c.mentions) = 'array' THEN c.mentions ELSE '[]'::JSONB END,
                   'imageCount', CASE WHEN jsonb_typeof(c.images) = 'array' THEN jsonb_array_length(c.images) ELSE 0 END,
                   'parentCommentId', c.parent_comment_id, 'revisionId', c.revision_id, 'characterId', c.character_id,
                   'createdAt', c.created_at, 'editedAt', c.edited_at)
               ) AS item
          FROM public.comment_notifications n
          JOIN public.comments c ON c.id = n.comment_id
          LEFT JOIN public.comp_revisions r ON r.id = c.revision_id
         WHERE n.recipient_id = v_user
           AND (p_after_at IS NULL
                OR n.event_at > p_after_at
                OR (p_after_id IS NOT NULL AND n.event_at = p_after_at AND n.id > p_after_id))
         ORDER BY n.event_at, n.id
         LIMIT v_limit
      ) s
  ), '[]'::JSONB);
END $$;

DO $$ DECLARE role_name TEXT; BEGIN
 REVOKE ALL PRIVILEGES ON FUNCTION public.comment_notifications_on_insert(), public.comment_notifications_on_mentions(),
   public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER) FROM PUBLIC;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.comment_notifications_on_insert(), public.comment_notifications_on_mentions() FROM %I', role_name);
  END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER) TO %I', role_name);
  END IF;
 END LOOP;
END $$;

-- 2) 도장 → 코멘트
DO $$ BEGIN
 IF to_regclass('public.bae_gyeong_stamps') IS NOT NULL THEN
  EXECUTE 'DROP TRIGGER IF EXISTS bae_gyeong_stamp_comment ON public.bae_gyeong_stamps';
 END IF;
END $$;

-- 3) BAE 댓글 보관 → 지우기
CREATE TABLE IF NOT EXISTS public.bae_gyeong_comment_archive (
  id TEXT PRIMARY KEY,
  job_id UUID,
  comment_row JSONB NOT NULL,
  reactions JSONB NOT NULL DEFAULT '[]'::jsonb,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bae_gyeong_comment_archive ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE role_name TEXT; BEGIN
 REVOKE ALL PRIVILEGES ON TABLE public.bae_gyeong_comment_archive FROM PUBLIC;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.bae_gyeong_comment_archive FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid = 'public.comments'::regclass AND attname = 'bae_job_id' AND NOT attisdropped) THEN
  EXECUTE $q$
   INSERT INTO public.bae_gyeong_comment_archive (id, job_id, comment_row, reactions)
   SELECT c.id, c.bae_job_id, to_jsonb(c),
     COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id) FROM public.comment_reactions r WHERE r.comment_id = c.id), '[]'::jsonb)
     FROM public.comments c WHERE c.bae_job_id IS NOT NULL
   ON CONFLICT (id) DO UPDATE SET comment_row = EXCLUDED.comment_row, reactions = EXCLUDED.reactions, archived_at = now()$q$;
  EXECUTE 'DELETE FROM public.comments WHERE bae_job_id IS NOT NULL';
 END IF;
END $$;

-- 4) 두 RESTRICTIVE 정책
DROP POLICY IF EXISTS bae_gyeong_comments_private ON public.comments;
DROP POLICY IF EXISTS bae_gyeong_comment_reactions_private ON public.comment_reactions;

-- 5) CHECK · 색인 · 칸
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_bae_job_id_prefix;
DROP INDEX IF EXISTS public.idx_comments_bae_job;
ALTER TABLE public.comments DROP COLUMN IF EXISTS bae_job_id;

-- 6) 9단계 함수
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_list(TEXT, UUID);
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_add(TEXT, UUID, JSONB);
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_edit(TEXT, TEXT, TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_delete(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_react(TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_reactions(TEXT, TEXT[]);
DROP FUNCTION IF EXISTS public.bae_gyeong_stamp_comment();
DROP FUNCTION IF EXISTS public.bae_gyeong_stamp_comment_text(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_notify(TEXT, TEXT, TEXT[]);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_signal();
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_reached(UUID, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_clean(UUID, TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_reactions_json(TEXT);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_json(public.comments);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_id_ok(TEXT);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_audience(UUID);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_can_read(TEXT, UUID);
NOTIFY pgrst, 'reload schema';
-- ▲ 되돌리기 본문 끝

DO $$
DECLARE
  t_a TEXT := repeat('6', 64); t_rev TEXT := repeat('8', 64);
  ja UUID := '5b0c4f1e-0000-4000-8000-00000009a001'; s3 TEXT := 'bae-comments-smoke-scene-3';
  f TEXT;
BEGIN
  -- 13. 되돌린 뒤: 칸 · 정책 · 함수 · 도장 트리거가 없고, 공용 함수 셋은 운영 본문 그대로
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid = 'public.comments'::regclass AND attname = 'bae_job_id' AND NOT attisdropped) THEN RAISE EXCEPTION 'column stayed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('comments', 'comment_reactions') AND policyname LIKE 'bae_gyeong_%') THEN RAISE EXCEPTION 'policy stayed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public'
     AND (p.proname LIKE 'bae_gyeong_comment%' OR p.proname LIKE 'bae_gyeong_session_comment%' OR p.proname LIKE 'bae_gyeong_stamp_comment%')) THEN RAISE EXCEPTION 'a stage-9 function stayed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'bae_gyeong_stamp_comment') THEN RAISE EXCEPTION 'stamp trigger stayed'; END IF;
  FOR f IN SELECT unnest(ARRAY['comment_notifications_on_insert():c1653f8c22b65b84efb865b299ea828a', 'comment_notifications_on_mentions():987f05de601b36e989a4af849a9b9a53',
      'comment_notifications_session_list(text,timestamp with time zone,uuid,integer):a0bd8a79a9fd91e9405d63b2b24b962e']) LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || split_part(f, ':', 1))) <> split_part(f, ':', 2) THEN
      RAISE EXCEPTION 'shared function not restored: %', f;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.comment_notifications_on_insert()', 'EXECUTE') OR NOT has_function_privilege('anon', 'public.comment_notifications_session_list(text,timestamp with time zone,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'shared function grants changed by the rollback';
  END IF;
  IF (SELECT count(*) FROM public.bae_gyeong_comment_archive WHERE job_id = ja) < 3 THEN RAISE EXCEPTION 'BAE comments were not archived'; END IF;
  IF EXISTS(SELECT 1 FROM public.comments WHERE left(id, 5) = 'baec_' AND id IN (SELECT a.id FROM public.bae_gyeong_comment_archive a WHERE a.job_id = ja)) THEN RAISE EXCEPTION 'BAE comments stayed'; END IF;
  -- 씬 댓글은 그대로 돈다: 멘션 알림 줄이 생기고 anon 이 읽는다, 앞서 만든 씬 댓글 · 반응도 그대로
  INSERT INTO public.comments(id, user_id, user_name, text, mentions) VALUES (s3, 'bae-comments-smoke-b', 'bae comments smoke b', '@bae comments smoke a', '["bae comments smoke a"]');
  IF NOT EXISTS(SELECT 1 FROM public.comment_notifications WHERE comment_id = s3 AND recipient_id = 'bae-comments-smoke-a' AND reason = 'mention') THEN RAISE EXCEPTION 'scene notifications stopped after the rollback'; END IF;
  SET LOCAL ROLE anon;
  IF (SELECT count(*) FROM public.comments WHERE id IN ('bae-comments-smoke-scene-1', 'bae-comments-smoke-scene-2', s3)) <> 3 THEN RAISE EXCEPTION 'scene comments lost'; END IF;
  IF (SELECT count(*) FROM public.comment_reactions WHERE comment_id = 'bae-comments-smoke-scene-1') <> 1 THEN RAISE EXCEPTION 'scene reaction lost'; END IF;
  RESET ROLE;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.comment_notifications_session_list(t_a, NULL, NULL, 200)) e WHERE e->>'commentId' = s3) THEN RAISE EXCEPTION 'session list broken after the rollback'; END IF;
  -- 도장은 그대로 찍힌다(댓글 줄은 더 남지 않는다)
  PERFORM public.bae_gyeong_session_job_stamp(t_rev, ja, 'again', '창문 크게');
END $$;

DO $$ BEGIN RAISE EXCEPTION 'BAE COMMENTS SMOKE OK — all checks passed, everything rolled back'; END $$;
