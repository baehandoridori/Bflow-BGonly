-- B flow: 삭제 경로 복구 + users.password 잠금 검증. 모든 쓰기는 ROLLBACK 된다.
-- 전제: 2026-09-06-gantt-delete-triggers-security-definer.sql 과
--       2026-09-06-users-password-lockdown.sql 이 모두 적용돼 있다.
-- 이 파일 전체를 한 SQL 배치로 실행한다. 검증용 사용자·캘린더는 트랜잭션 안에서만 존재한다.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

INSERT INTO public.users (id, name, role, password)
VALUES ('verify-admin-'  || gen_random_uuid()::TEXT, '__검증 관리자', 'admin', 'pw'),
       ('verify-target-' || gen_random_uuid()::TEXT, '__검증 대상',   'user',  'pw');

SET LOCAL ROLE anon;

DO $verify$
DECLARE
  admin_id TEXT; target_id TEXT; cal_id UUID; tok TEXT; login JSONB; result JSONB;
  space_id TEXT := gen_random_uuid()::TEXT; project_id TEXT := gen_random_uuid()::TEXT;
  task_id TEXT := gen_random_uuid()::TEXT; project_doc JSONB; snap JSONB; remaining JSONB;
  created_id TEXT := 'verify-new-' || gen_random_uuid()::TEXT;
  n INTEGER; rejected BOOLEAN;
BEGIN
  IF current_user <> 'anon' THEN RAISE EXCEPTION 'must run as anon'; END IF;
  SELECT id INTO admin_id  FROM public.users WHERE name = '__검증 관리자';
  SELECT id INTO target_id FROM public.users WHERE name = '__검증 대상';

  -- ── 1) users 컬럼 권한: 비밀번호는 읽기·쓰기 모두 차단, 앱이 쓰는 조회는 유지 ──
  SELECT count(*) INTO n FROM (
    SELECT id, name, role, slack_id, hire_date, birthday,
           is_initial_password, created_at, is_compositor, is_acting_supervisor
    FROM public.users) u;
  IF n < 1 THEN RAISE EXCEPTION '앱 사용자 디렉터리 조회가 막혔다'; END IF;
  PERFORM id, name FROM public.users LIMIT 1;
  PERFORM name FROM public.users LIMIT 1;
  PERFORM role FROM public.users LIMIT 1;

  rejected := false; BEGIN PERFORM password FROM public.users LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'anon 이 아직 비밀번호를 읽는다'; END IF;

  rejected := false; BEGIN PERFORM * FROM public.users LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'anon 의 select * 가 아직 통한다'; END IF;

  rejected := false; BEGIN UPDATE public.users SET password = 'hijack' WHERE id = target_id;
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'anon 이 아직 비밀번호를 쓴다'; END IF;

  rejected := false; BEGIN UPDATE public.users SET is_initial_password = false WHERE id = target_id;
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'anon 이 아직 초기비밀번호 표시를 바꾼다'; END IF;

  -- ── 2) 로그인·간트·비밀번호 변경은 계속 동작한다 ──
  IF (public.app_login('__검증 대상', 'wrong')->>'ok')::BOOLEAN THEN RAISE EXCEPTION '틀린 비밀번호가 통과했다'; END IF;
  login := public.app_login('__검증 대상', 'pw');
  IF NOT (login->>'ok')::BOOLEAN THEN RAISE EXCEPTION '잠금 뒤 로그인이 깨졌다: %', login; END IF;
  tok := login->>'token';
  IF login->'user' ? 'password' THEN RAISE EXCEPTION '로그인 응답에 비밀번호가 들어있다'; END IF;
  PERFORM public.gantt_session_read(tok);
  IF jsonb_typeof(public.gantt_session_calendar_events(tok, NULL, NULL, NULL)) <> 'array' THEN
    RAISE EXCEPTION '간트 캘린더 조회가 깨졌다';
  END IF;

  -- ── 3) 캘린더 삭제 → 연결된 간트 작업의 연결 해제 (SECURITY DEFINER 트리거) ──
  INSERT INTO public.calendars(name, color, visibility, owner_id, is_personal)
  VALUES ('ROLLBACK ONLY 검증', '#6C5CE7', 'team', target_id, false) RETURNING id INTO cal_id;

  PERFORM public.gantt_session_execute(tok, 'verify:space', jsonb_build_object(
    'type','saveSpace','expectedRevision',NULL,
    'space', jsonb_build_object('id',space_id,'ownerId',target_id,'name','ROLLBACK ONLY 폴더',
      'shared',true,'revision',1,
      'members', jsonb_build_array(jsonb_build_object('userId',admin_id,'canEdit',true)))));

  project_doc := jsonb_build_object(
    'id',project_id,'spaceId',space_id,'ownerId',target_id,'name','ROLLBACK ONLY 프로젝트','memo','',
    'color','#6C5CE7','completed',false,'revision',1,'memberIds',NULL,'editorIds',NULL,'linkedEpisode',NULL,
    'tasks', jsonb_build_array(jsonb_build_object(
      'id',task_id,'parentId',NULL,'kind','task','title','연결된 작업','memo','',
      'startDate',CURRENT_DATE::TEXT,'endDate',CURRENT_DATE::TEXT,'allDay',true,'startTime','','endTime','',
      'mode','manual','predecessorId',NULL,'progress',0,'progressMode','manual','sceneLinks','[]'::JSONB,
      'workers',jsonb_build_array(target_id),'attendees','[]'::JSONB,'color',NULL,
      'calendarId',cal_id::TEXT,'calendarEventId',NULL,'completed',false,'sortOrder',0)));
  PERFORM public.gantt_session_execute(tok, 'verify:project',
    jsonb_build_object('type','saveProject','expectedRevision',NULL,'project',project_doc));

  PERFORM public.delete_calendar_authorized(target_id, cal_id);
  snap := public.gantt_session_read(tok);
  SELECT value INTO remaining FROM jsonb_array_elements(snap->'projects') WHERE value->>'id' = project_id;
  IF remaining IS NULL THEN RAISE EXCEPTION '캘린더 삭제가 프로젝트까지 지웠다'; END IF;
  IF (remaining->'tasks'->0->>'calendarId') IS NOT NULL THEN
    RAISE EXCEPTION '캘린더 연결이 해제되지 않았다: %', remaining->'tasks'->0->>'calendarId';
  END IF;

  -- ── 4) 관리자 사용자 추가/수정/삭제 (삭제는 SECURITY DEFINER 트리거를 탄다) ──
  PERFORM public.update_user_authorized(admin_id, target_id, '{"birthday": "2000-01-01"}'::JSONB);
  IF (SELECT birthday FROM public.users WHERE id = target_id) <> '2000-01-01' THEN
    RAISE EXCEPTION '사용자 수정이 반영되지 않았다';
  END IF;
  PERFORM public.create_user_authorized(admin_id, jsonb_build_object(
    'id', created_id, 'name', '__검증 신규', 'role', 'user',
    'slack_id', '', 'hire_date', '', 'birthday', ''));
  IF NOT (public.app_login('__검증 신규', '1234')->>'ok')::BOOLEAN THEN
    RAISE EXCEPTION '새 사용자가 초기 비밀번호로 로그인하지 못한다';
  END IF;
  PERFORM public.delete_user_authorized(admin_id, created_id);
  IF EXISTS (SELECT 1 FROM public.users WHERE id = created_id) THEN RAISE EXCEPTION '사용자 삭제가 되지 않았다'; END IF;

  -- 공유 폴더를 가진 사용자 삭제 → 관리자에게 인계
  PERFORM public.delete_user_authorized(admin_id, target_id);
  IF EXISTS (SELECT 1 FROM public.users WHERE id = target_id) THEN RAISE EXCEPTION '대상 사용자 삭제가 되지 않았다'; END IF;
END $verify$;

ROLLBACK;

SELECT '2026-09-06-delete-paths-and-lockdown'::TEXT AS verification_name,
       true AS passed,
       'All transactional changes rolled back'::TEXT AS result;
