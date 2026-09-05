-- B flow 로그인 세션 토큰 + 간트 래퍼 smoke. 모든 쓰기는 ROLLBACK 된다.
-- 전제: 2026-09-05-app-sessions-gantt-auth.sql 이 적용돼 있다. 이 파일 전체를 한 SQL 배치로 실행한다.
-- 검증용 사용자 3명은 트랜잭션 안에서만 존재한다. 기존 사용자·간트·캘린더 행은 읽지도 쓰지도 않는다.
-- 마지막 SELECT 는 DO 블록과 ROLLBACK 이 모두 성공한 뒤에만 나온다.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

INSERT INTO public.users (id, name, role, password)
VALUES ('smoke-owner-'  || gen_random_uuid()::TEXT, '__세션검증 소유자', 'user', 'owner-pw'),
       ('smoke-viewer-' || gen_random_uuid()::TEXT, '__세션검증 보기',   'user', 'viewer-pw'),
       ('smoke-lock-'   || gen_random_uuid()::TEXT, '__세션검증 잠금',   'user', 'lock-pw');

-- 토큰 원문이 저장되지 않는지 확인하기 위한 트랜잭션 한정 임시 표.
CREATE TEMP TABLE smoke_tokens(kind TEXT PRIMARY KEY, token TEXT) ON COMMIT DROP;
GRANT INSERT, SELECT ON smoke_tokens TO anon;

SET LOCAL ROLE anon;

DO $smoke$
DECLARE
  owner_login JSONB; viewer_login JSONB; result JSONB;
  owner_token TEXT; viewer_token TEXT; owner_id TEXT; viewer_id TEXT;
  space_id TEXT := gen_random_uuid()::TEXT;
  project_id TEXT := gen_random_uuid()::TEXT;
  task_id TEXT := gen_random_uuid()::TEXT;
  base_task JSONB; project_doc JSONB;
  msg TEXT; rejected BOOLEAN; i INTEGER;
BEGIN
  IF current_user <> 'anon' THEN RAISE EXCEPTION 'smoke must run as anon'; END IF;

  -- 1) anon 은 테이블·내부 함수에 직접 닿을 수 없다.
  BEGIN PERFORM 1 FROM public.gantt_spaces; RAISE EXCEPTION 'anon could read gantt_spaces';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.gantt_projects; RAISE EXCEPTION 'anon could read gantt_projects';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.app_sessions; RAISE EXCEPTION 'anon could read app_sessions';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.app_login_throttle; RAISE EXCEPTION 'anon could read app_login_throttle';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.gantt_read('anyone'); RAISE EXCEPTION 'anon could execute gantt_read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.gantt_execute('anyone', 'r', '{}'::JSONB); RAISE EXCEPTION 'anon could execute gantt_execute';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.app_session_user_id(repeat('0', 64)); RAISE EXCEPTION 'anon could execute app_session_user_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 2) 위조·빈 토큰은 래퍼에서 거부된다.
  rejected := false;
  BEGIN PERFORM public.gantt_session_read(repeat('0', 64));
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE '%다시 로그인%' THEN RAISE; END IF; rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'forged token accepted'; END IF;
  rejected := false;
  BEGIN PERFORM public.gantt_session_execute(NULL, 'r', '{}'::JSONB);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'null token accepted'; END IF;

  -- 3) 로그인 실패는 예외가 아니라 ok:false 다.
  result := public.app_login('__세션검증 없는 사람', 'x');
  IF (result->>'ok')::BOOLEAN OR result->>'error' <> '등록되지 않은 사용자입니다.' THEN RAISE EXCEPTION 'unknown user: %', result; END IF;
  result := public.app_login('__세션검증 소유자', 'wrong');
  IF (result->>'ok')::BOOLEAN OR result->>'error' <> '비밀번호가 일치하지 않습니다.' THEN RAISE EXCEPTION 'wrong password: %', result; END IF;

  -- 4) 정상 로그인: 64자 hex 토큰, 비밀번호 없는 사용자 정보.
  owner_login := public.app_login('__세션검증 소유자', 'owner-pw');
  IF NOT (owner_login->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'owner login failed: %', owner_login; END IF;
  owner_token := owner_login->>'token'; owner_id := owner_login->'user'->>'id';
  IF owner_token !~ '^[0-9a-f]{64}$' OR owner_id NOT LIKE 'smoke-owner-%' THEN RAISE EXCEPTION 'bad login payload'; END IF;
  IF owner_login->'user' ? 'password' OR owner_login->'user'->>'name' <> '__세션검증 소유자' THEN RAISE EXCEPTION 'login payload leaked or wrong'; END IF;
  viewer_login := public.app_login('__세션검증 보기', 'viewer-pw');
  IF NOT (viewer_login->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'viewer login failed: %', viewer_login; END IF;
  viewer_token := viewer_login->>'token'; viewer_id := viewer_login->'user'->>'id';
  IF owner_token = viewer_token THEN RAISE EXCEPTION 'tokens collide'; END IF;
  INSERT INTO smoke_tokens VALUES ('owner', owner_token), ('viewer', viewer_token);

  -- 5) 간트: 소유자가 공유 폴더(보기 멤버 = viewer)와 프로젝트를 만든다.
  result := public.gantt_session_execute(owner_token, 'smoke:space', jsonb_build_object(
    'type', 'saveSpace', 'expectedRevision', NULL,
    'space', jsonb_build_object('id', space_id, 'ownerId', owner_id, 'name', 'ROLLBACK ONLY 세션 smoke', 'shared', true, 'revision', 1,
      'members', jsonb_build_array(jsonb_build_object('userId', viewer_id, 'canEdit', false)))));
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'spaces') s WHERE s->>'id' = space_id) THEN RAISE EXCEPTION 'space not saved'; END IF;

  base_task := jsonb_build_object(
    'id', task_id, 'parentId', NULL, 'kind', 'task', 'title', '롤백 검증 작업', 'memo', '',
    'startDate', CURRENT_DATE::TEXT, 'endDate', CURRENT_DATE::TEXT, 'allDay', true, 'startTime', '', 'endTime', '',
    'mode', 'manual', 'predecessorId', NULL, 'progress', 0, 'progressMode', 'manual', 'sceneLinks', '[]'::JSONB,
    'workers', jsonb_build_array(owner_id), 'attendees', '[]'::JSONB, 'color', NULL,
    'calendarId', NULL, 'calendarEventId', NULL, 'completed', false, 'sortOrder', 0);
  project_doc := jsonb_build_object(
    'id', project_id, 'spaceId', space_id, 'ownerId', owner_id, 'name', '롤백 검증 프로젝트', 'memo', '',
    'color', '#6C5CE7', 'completed', false, 'revision', 1, 'memberIds', NULL, 'editorIds', NULL, 'linkedEpisode', NULL,
    'tasks', jsonb_build_array(base_task));
  result := public.gantt_session_execute(owner_token, 'smoke:project', jsonb_build_object('type', 'saveProject', 'expectedRevision', NULL, 'project', project_doc));
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'projects') p WHERE p->>'id' = project_id) THEN RAISE EXCEPTION 'project not saved'; END IF;

  -- 보기 멤버는 읽을 수 있지만 쓸 수 없다. 토큰이 곧 신원이므로 다른 actor 를 주장할 방법이 없다.
  result := public.gantt_session_read(viewer_token);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'projects') p WHERE p->>'id' = project_id) THEN RAISE EXCEPTION 'viewer cannot read shared project'; END IF;
  rejected := false;
  BEGIN PERFORM public.gantt_session_execute(viewer_token, 'smoke:viewer-write', jsonb_build_object('type', 'saveProject', 'expectedRevision', 1, 'project', project_doc));
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg <> '폴더 편집 권한이 필요합니다' THEN RAISE; END IF; rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'viewer write accepted'; END IF;
  IF jsonb_typeof(public.gantt_session_calendar_events(viewer_token, NULL, NULL, NULL)) <> 'array' THEN RAISE EXCEPTION 'calendar wrapper failed'; END IF;

  -- 6) 비밀번호 변경은 토큰 소유자 본인만, 현재 비밀번호를 알 때만.
  result := public.app_change_password(viewer_token, 'wrong', 'new-pw');
  IF (result->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'password change with wrong current accepted'; END IF;
  result := public.app_change_password(viewer_token, 'viewer-pw', 'new-pw');
  IF NOT (result->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'password change failed: %', result; END IF;
  IF NOT (public.app_login('__세션검증 보기', 'new-pw')->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'new password rejected'; END IF;
  IF (public.app_login('__세션검증 보기', 'viewer-pw')->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'old password still accepted'; END IF;
  PERFORM public.gantt_session_read(viewer_token); -- 변경을 수행한 기기의 토큰은 유지된다.

  -- 7) 로그아웃하면 토큰은 즉시 무효다.
  PERFORM public.app_logout(owner_token);
  rejected := false;
  BEGIN PERFORM public.gantt_session_read(owner_token);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE '%만료%' THEN RAISE; END IF; rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'logged-out token accepted'; END IF;

  -- 8) 5회 실패 뒤에는 맞는 비밀번호도 잠금 안내를 받는다.
  FOR i IN 1..5 LOOP
    result := public.app_login('__세션검증 잠금', 'wrong');
    IF (result->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'wrong password accepted on attempt %', i; END IF;
  END LOOP;
  result := public.app_login('__세션검증 잠금', 'lock-pw');
  IF (result->>'ok')::BOOLEAN OR result->>'error' NOT LIKE '%너무 많%' THEN RAISE EXCEPTION 'lockout missing: %', result; END IF;
END $smoke$;

RESET ROLE;

-- 잠금 카운터와 토큰 저장 형태는 anon 이 읽을 수 없으므로(그게 경계다) 역할을 되돌린 뒤 확인한다.
DO $counters$
DECLARE n INTEGER; lock_until TIMESTAMPTZ; raw_hits INTEGER;
BEGIN
  SELECT failures INTO n FROM public.app_login_throttle WHERE user_name = '__세션검증 소유자';
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'owner counter should reset after success, got %', n; END IF;
  SELECT failures, locked_until INTO n, lock_until FROM public.app_login_throttle WHERE user_name = '__세션검증 잠금';
  IF n IS DISTINCT FROM 5 OR lock_until IS NULL OR lock_until <= now() THEN
    RAISE EXCEPTION 'lock counter wrong: failures=% locked_until=%', n, lock_until;
  END IF;
  SELECT count(*) INTO raw_hits FROM public.app_sessions s JOIN smoke_tokens t ON s.token_hash = t.token;
  IF raw_hits <> 0 THEN RAISE EXCEPTION 'raw tokens were stored'; END IF;
END $counters$;

ROLLBACK;

SELECT '2026-09-05-app-sessions-live-smoke'::TEXT AS verification_name,
       true AS passed,
       'All transactional changes rolled back'::TEXT AS result;
