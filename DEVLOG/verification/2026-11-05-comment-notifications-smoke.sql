-- B flow 씬 댓글 서버 알림(comment_notifications, 씬 댓글 B안 PR 6) smoke. 모든 쓰기는 ROLLBACK 된다.
-- 전제: 2026-11-05-comment-notifications.sql 이 적용돼 있다(예행연습은 마이그레이션 본문 → 이 파일 순으로 같은 배치에서 실행해도 된다).
-- 이 파일 전체를 한 SQL 배치로 실행한다. 검증용 사용자 2명·댓글 1개는 트랜잭션 안에서만 존재한다(롤백되면 실시간 신호도 나가지 않는다).
-- 기존 사용자·댓글·알림 줄은 읽지도 쓰지도 않는다. 마지막 SELECT 는 DO 블록과 ROLLBACK 이 모두 성공한 뒤에만 나온다.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

INSERT INTO public.users (id, name, role, password)
VALUES ('smoke-cn-author-' || gen_random_uuid()::TEXT, '__알림검증 작성자', 'user', 'author-pw'),
       ('smoke-cn-reader-' || gen_random_uuid()::TEXT, '__알림검증 받는이', 'user', 'reader-pw');

SET LOCAL ROLE anon;

DO $smoke$
DECLARE
  author_login JSONB; reader_login JSONB;
  author_id TEXT; reader_token TEXT; author_token TEXT;
  comment_id TEXT := 'smoke-cn-' || gen_random_uuid()::TEXT;
  result JSONB; rejected BOOLEAN;
BEGIN
  IF current_user <> 'anon' THEN RAISE EXCEPTION 'smoke must run as anon'; END IF;

  -- 1) anon 은 표·내부 함수에 닿을 수 없다.
  BEGIN PERFORM 1 FROM public.comment_notifications; RAISE EXCEPTION 'anon could read comment_notifications';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.comment_notifications (recipient_id, comment_id, kind, reason, actor_id) VALUES ('x', 'x', 'add', 'mention', 'x');
    RAISE EXCEPTION 'anon could insert comment_notifications';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.comment_notifications_fanout('x', 'add', NULL, NULL, false); RAISE EXCEPTION 'anon could run fanout';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.comment_notifications_recipients('x'); RAISE EXCEPTION 'anon could run recipients';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 2) 위조 토큰은 래퍼에서 거부된다.
  rejected := false;
  BEGIN PERFORM public.comment_notifications_session_list(repeat('0', 64), NULL, NULL, 10);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'forged token accepted'; END IF;

  author_login := public.app_login('__알림검증 작성자', 'author-pw');
  IF NOT (author_login->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'author login failed: %', author_login; END IF;
  author_id := author_login->'user'->>'id'; author_token := author_login->>'token';
  reader_login := public.app_login('__알림검증 받는이', 'reader-pw');
  IF NOT (reader_login->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'reader login failed: %', reader_login; END IF;
  reader_token := reader_login->>'token';

  -- 3) anon 이 댓글을 쓰면(앱과 같은 길) 트리거가 받는 사람 줄을 만든다 — 작성자 본인 줄은 없다.
  INSERT INTO public.comments (id, user_id, user_name, text, mentions)
  VALUES (comment_id, author_id, '__알림검증 작성자', '@__알림검증 받는이 확인', '["__알림검증 받는이","__알림검증 작성자"]'::JSONB);
  result := public.comment_notifications_session_list(reader_token, now() - interval '1 minute', NULL, 50);
  IF jsonb_array_length(result) <> 1 OR result->0->>'commentId' <> comment_id OR result->0->>'reason' <> 'mention'
     OR result->0->>'kind' <> 'add' OR result->0->>'readAt' IS NOT NULL OR result->0->'comment'->>'userName' <> '__알림검증 작성자' THEN
    RAISE EXCEPTION 'mention row wrong: %', result;
  END IF;
  result := public.comment_notifications_session_list(author_token, now() - interval '1 minute', NULL, 50);
  IF result <> '[]'::JSONB THEN RAISE EXCEPTION 'author got own notification: %', result; END IF;

  -- 4) 읽음: 내 줄만, 다시 하면 0.
  result := public.comment_notifications_session_mark_read(reader_token, ARRAY[comment_id], '[]'::JSONB);
  IF (result->>'updated')::INT <> 1 THEN RAISE EXCEPTION 'mark read wrong: %', result; END IF;
  result := public.comment_notifications_session_mark_read(reader_token, ARRAY[comment_id], '[]'::JSONB);
  IF (result->>'updated')::INT <> 0 THEN RAISE EXCEPTION 'mark read twice: %', result; END IF;

  -- 5) 수정으로 다시 부르면 수정 줄(안 읽음), 지우면 줄도 사라진다.
  UPDATE public.comments SET mentions = '["__알림검증 작성자"]'::JSONB WHERE id = comment_id;
  UPDATE public.comments SET mentions = '["__알림검증 받는이"]'::JSONB, edited_at = now() WHERE id = comment_id;
  result := public.comment_notifications_session_list(reader_token, now() - interval '1 minute', NULL, 50);
  IF NOT (result @> jsonb_build_array(jsonb_build_object('commentId', comment_id, 'kind', 'edit', 'reason', 'mention'))) THEN
    RAISE EXCEPTION 'edit row missing: %', result;
  END IF;
  DELETE FROM public.comments WHERE id = comment_id;
  result := public.comment_notifications_session_list(reader_token, now() - interval '1 minute', NULL, 50);
  IF result <> '[]'::JSONB THEN RAISE EXCEPTION 'rows kept after delete: %', result; END IF;
END $smoke$;

RESET ROLE;

-- 6) 경계: RLS 켜짐·정책 0개·publication 밖·트리거 셋.
DO $boundary$ BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.comment_notifications'::regclass) THEN RAISE EXCEPTION 'RLS off'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comment_notifications') THEN RAISE EXCEPTION 'policy exists'; END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE tablename = 'comment_notifications') THEN RAISE EXCEPTION 'in publication'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.comments'::regclass AND tgname LIKE 'comment_notifications_after_%' AND NOT tgisinternal) <> 3 THEN
    RAISE EXCEPTION 'triggers missing';
  END IF;
END $boundary$;

ROLLBACK;

SELECT '2026-11-05-comment-notifications-smoke'::TEXT AS verification_name,
       true AS passed,
       'All transactional changes rolled back'::TEXT AS result;
