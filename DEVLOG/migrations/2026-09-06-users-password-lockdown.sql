-- 2026-09-06: users.password 를 anon/authenticated 에서 차단 (2단계)
--
-- ⚠️ 적용 시점: 팀 전원이 v1.111.0 이상으로 갱신된 뒤에만 적용한다.
--   컬럼 권한을 제한하면 그 테이블에 `select *` 를 쓰는 요청이 통째로 실패한다(Supabase 문서 명시).
--   v1.110.1 이하 앱은 users 를 `select('*')` 로 읽어 비밀번호를 로컬에서 대조하므로,
--   이 파일을 먼저 적용하면 구 버전 로그인이 즉시 깨진다. v1.111.0 은 명시 컬럼만 읽고
--   로그인 대조를 app_login RPC 에서 수행한다.
--
-- 왜 필요한가: 1단계(app_sessions)로 간트 RPC 가 세션 토큰을 요구해도, anon 이 비밀번호를
--   읽을 수 있으면 "비밀번호 읽기 → app_login → 토큰" 으로 우회할 수 있다. 이 파일이 그 경로를 닫는다.
--
-- 내용:
--   - users 테이블 단위 SELECT/UPDATE 회수 → password 와 is_initial_password 를 뺀 컬럼 단위 권한 재부여.
--   - INSERT/DELETE 는 기존 관리자 RPC(create_user_authorized / delete_user_cascade) 경로 때문에 유지.
--   - update_user_authorized 의 `SELECT * INTO v_target FROM users` 를 명시 컬럼으로 교체
--     (비밀번호 컬럼 없이도 anon 이 실행할 수 있게). 나머지 본문은 2026-08-24-shared-calendars.sql 과 동일.
-- 멱등: 반복 실행 안전.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $$ DECLARE role_name TEXT; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE SELECT, UPDATE ON TABLE public.users FROM %I', role_name);
      EXECUTE format($g$GRANT SELECT (id, name, role, slack_id, hire_date, birthday, is_initial_password, created_at, is_compositor, is_acting_supervisor)
        ON TABLE public.users TO %I$g$, role_name);
      EXECUTE format($g$GRANT UPDATE (name, role, slack_id, hire_date, birthday, is_compositor, is_acting_supervisor)
        ON TABLE public.users TO %I$g$, role_name);
    END IF;
  END LOOP;
END $$;

-- update_user_authorized: SELECT * → 명시 컬럼. password 자리는 NULL 로 채운다(이 함수는 비밀번호를 쓰지 않는다).
CREATE OR REPLACE FUNCTION public.update_user_authorized(p_actor_id TEXT, p_user_id TEXT, p_updates JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_allowed_keys CONSTANT TEXT[] := ARRAY[
    'name', 'role', 'slack_id', 'hire_date', 'birthday',
    'is_compositor', 'is_acting_supervisor'
  ];
  v_actor_role TEXT;
  v_target users%ROWTYPE;
  v_patch users%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = ''
     OR p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'User-management actor and target are required' USING ERRCODE = '42501';
  END IF;
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'User update must be an object' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_updates) AS key
    WHERE NOT (key = ANY(v_allowed_keys))
  ) THEN
    RAISE EXCEPTION 'User update contains unsupported fields' USING ERRCODE = '22023';
  END IF;

  LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;
  PERFORM id
  FROM users
  WHERE id IN (p_actor_id, p_user_id)
  ORDER BY id
  FOR UPDATE;

  SELECT role INTO v_actor_role FROM users WHERE id = p_actor_id;
  IF v_actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an admin can update users' USING ERRCODE = '42501';
  END IF;
  SELECT id, name, role, NULL::TEXT, slack_id, hire_date, birthday,
         is_initial_password, created_at, is_compositor, is_acting_supervisor
    INTO v_target FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
  END IF;

  v_patch := jsonb_populate_record(v_target, p_updates);
  IF v_patch.name IS NULL OR btrim(v_patch.name) = ''
     OR v_patch.role IS NULL OR v_patch.role NOT IN ('admin', 'user') THEN
    RAISE EXCEPTION 'Updated user name or role is invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE users SET
    name = v_patch.name,
    role = v_patch.role,
    slack_id = v_patch.slack_id,
    hire_date = v_patch.hire_date,
    birthday = v_patch.birthday,
    is_compositor = v_patch.is_compositor,
    is_acting_supervisor = v_patch.is_acting_supervisor
  WHERE id = p_user_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
