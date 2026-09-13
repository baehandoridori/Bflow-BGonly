-- B flow 팀 할 일(comment_thread_todos) 세션 래퍼 smoke. 모든 쓰기는 ROLLBACK 된다.
-- 전제: 2026-09-14-comment-thread-todos.sql 이 적용돼 있다(예행연습은 마이그레이션 → 이 파일 순으로 같은 배치에서 실행해도 된다).
-- 이 파일 전체를 한 SQL 배치로 실행한다. 검증용 사용자 2명은 트랜잭션 안에서만 존재한다.
-- 기존 사용자·할 일 행은 읽지도 쓰지도 않는다. 마지막 SELECT 는 DO 블록과 ROLLBACK 이 모두 성공한 뒤에만 나온다.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

INSERT INTO public.users (id, name, role, password)
VALUES ('smoke-todo-writer-' || gen_random_uuid()::TEXT, '__할일검증 작성자', 'user',  'writer-pw'),
       ('smoke-todo-admin-'  || gen_random_uuid()::TEXT, '__할일검증 관리자', 'admin', 'admin-pw');

SET LOCAL ROLE anon;

DO $smoke$
DECLARE
  writer_login JSONB; admin_login JSONB;
  writer_token TEXT; admin_token TEXT; writer_id TEXT; admin_id TEXT;
  key TEXT := 'smoke:' || gen_random_uuid()::TEXT;
  row1 JSONB; row2 JSONB; row3 JSONB; result JSONB;
  msg TEXT; rejected BOOLEAN;
BEGIN
  IF current_user <> 'anon' THEN RAISE EXCEPTION 'smoke must run as anon'; END IF;

  -- 1) anon 은 테이블에 직접 닿을 수 없다.
  BEGIN PERFORM 1 FROM public.comment_thread_todos; RAISE EXCEPTION 'anon could read comment_thread_todos';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.comment_thread_todos (thread_key, text, created_by, created_by_name) VALUES (key, 'x', 'x', 'x');
    RAISE EXCEPTION 'anon could insert comment_thread_todos';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 2) 위조·빈 토큰은 래퍼에서 거부된다 (42501 + '다시 로그인' 문구).
  rejected := false;
  BEGIN PERFORM public.comment_thread_todos_session_list(repeat('0', 64), key);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE '%다시 로그인%' THEN RAISE; END IF; rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'forged token accepted'; END IF;
  rejected := false;
  BEGIN PERFORM public.comment_thread_todos_session_add(NULL, key, '할 일');
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'null token accepted'; END IF;

  -- 3) 로그인 2명 (작성자 user / 관리자 admin).
  writer_login := public.app_login('__할일검증 작성자', 'writer-pw');
  IF NOT (writer_login->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'writer login failed: %', writer_login; END IF;
  writer_token := writer_login->>'token'; writer_id := writer_login->'user'->>'id';
  admin_login := public.app_login('__할일검증 관리자', 'admin-pw');
  IF NOT (admin_login->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'admin login failed: %', admin_login; END IF;
  admin_token := admin_login->>'token'; admin_id := admin_login->'user'->>'id';

  -- 4) 추가: 공백 정리 + 작성자 이름·id 는 서버가 채운다.
  row1 := public.comment_thread_todos_session_add(writer_token, key, '  첫   할 일 ');
  IF row1->>'text' <> '첫 할 일' OR row1->>'created_by' <> writer_id OR row1->>'created_by_name' <> '__할일검증 작성자'
     OR row1->>'done_at' IS NOT NULL OR row1->>'done_by' IS NOT NULL OR row1->>'done_by_name' IS NOT NULL THEN
    RAISE EXCEPTION 'add payload wrong: %', row1;
  END IF;

  -- 5) 입력 검증은 22023.
  rejected := false;
  BEGIN PERFORM public.comment_thread_todos_session_add(writer_token, key, '   ');
  EXCEPTION WHEN invalid_parameter_value THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'empty text accepted'; END IF;
  rejected := false;
  BEGIN PERFORM public.comment_thread_todos_session_add(writer_token, key, repeat('가', 201));
  EXCEPTION WHEN invalid_parameter_value THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION '201 chars accepted'; END IF;
  rejected := false;
  BEGIN PERFORM public.comment_thread_todos_session_add(writer_token, '', '할 일');
  EXCEPTION WHEN invalid_parameter_value THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'empty thread key accepted'; END IF;
  rejected := false;
  BEGIN PERFORM public.comment_thread_todos_session_set_done(writer_token, (row1->>'id')::UUID, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'null done accepted'; END IF;

  -- 6) 완료: 최초 완료자 유지(COALESCE), 해제는 세 필드 모두 NULL.
  result := public.comment_thread_todos_session_set_done(admin_token, (row1->>'id')::UUID, true);
  IF result->>'done_at' IS NULL OR result->>'done_by' <> admin_id OR result->>'done_by_name' <> '__할일검증 관리자' THEN
    RAISE EXCEPTION 'set_done wrong: %', result;
  END IF;
  result := public.comment_thread_todos_session_set_done(writer_token, (row1->>'id')::UUID, true);
  IF result->>'done_by_name' <> '__할일검증 관리자' THEN RAISE EXCEPTION 'first finisher not kept: %', result; END IF;
  result := public.comment_thread_todos_session_set_done(writer_token, (row1->>'id')::UUID, false);
  IF result->>'done_at' IS NOT NULL OR result->>'done_by' IS NOT NULL OR result->>'done_by_name' IS NOT NULL THEN
    RAISE EXCEPTION 'undo wrong: %', result;
  END IF;

  -- 7) 삭제 권한: 남의 항목은 42501, 내 항목은 deleted:true, 재삭제는 deleted:false, 관리자는 남의 항목도 지운다.
  row2 := public.comment_thread_todos_session_add(admin_token, key, '관리자 항목');
  rejected := false;
  BEGIN PERFORM public.comment_thread_todos_session_delete(writer_token, (row2->>'id')::UUID);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE '%내가 추가한%' THEN RAISE; END IF; rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'writer deleted admin item'; END IF;
  result := public.comment_thread_todos_session_delete(writer_token, (row1->>'id')::UUID);
  IF NOT (result->>'deleted')::BOOLEAN THEN RAISE EXCEPTION 'own delete failed: %', result; END IF;
  result := public.comment_thread_todos_session_delete(writer_token, (row1->>'id')::UUID);
  IF (result->>'deleted')::BOOLEAN THEN RAISE EXCEPTION 'double delete reported deleted: %', result; END IF;
  result := public.comment_thread_todos_session_delete(admin_token, (row2->>'id')::UUID);
  IF NOT (result->>'deleted')::BOOLEAN THEN RAISE EXCEPTION 'admin delete failed: %', result; END IF;

  -- 8) 지운 항목 완료 시도 → P0002.
  rejected := false;
  BEGIN PERFORM public.comment_thread_todos_session_set_done(writer_token, (row1->>'id')::UUID, true);
  EXCEPTION WHEN no_data_found THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'set_done on deleted item succeeded'; END IF;

  -- 9) 목록: 비어 있음 → 두 개 추가하면 두 개가 다 보인다.
  --    (한 트랜잭션 안에서는 now() 가 같아 created_at 이 동일하므로 순서는 검증하지 않는다. 실제 앱은 추가마다 별도 요청.)
  result := public.comment_thread_todos_session_list(writer_token, key);
  IF result <> '[]'::JSONB THEN RAISE EXCEPTION 'list should be empty: %', result; END IF;
  row2 := public.comment_thread_todos_session_add(writer_token, key, '둘째');
  row3 := public.comment_thread_todos_session_add(admin_token, key, '셋째');
  result := public.comment_thread_todos_session_list(writer_token, key);
  IF jsonb_array_length(result) <> 2
     OR NOT (result @> jsonb_build_array(jsonb_build_object('id', row2->>'id', 'text', '둘째', 'created_by_name', '__할일검증 작성자')))
     OR NOT (result @> jsonb_build_array(jsonb_build_object('id', row3->>'id', 'text', '셋째', 'created_by_name', '__할일검증 관리자'))) THEN
    RAISE EXCEPTION 'list content wrong: %', result;
  END IF;
  -- 다른 스레드 키에는 보이지 않는다.
  result := public.comment_thread_todos_session_list(writer_token, key || ':other');
  IF result <> '[]'::JSONB THEN RAISE EXCEPTION 'thread isolation broken: %', result; END IF;
END $smoke$;

RESET ROLE;

ROLLBACK;

SELECT '2026-09-14-comment-thread-todos-smoke'::TEXT AS verification_name,
       true AS passed,
       'All transactional changes rolled back'::TEXT AS result;
