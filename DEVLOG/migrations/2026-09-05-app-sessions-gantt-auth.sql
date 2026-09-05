-- 2026-09-05: 로그인 세션 토큰과 간트 RPC 호출자 검증 경계 (1단계)
--
-- 배경:
--   gantt_workspaces(20260905124058)는 anon 역할에 테이블 직접 접근과 allow-all RLS 를 주고,
--   RPC 는 호출자가 보낸 p_actor_id 를 그대로 믿었다. 배포되는 anon 키만 있으면 Data API 로
--   소유자/편집자/보기 전용 검사를 우회할 수 있어 gantt_security_containment(20260905125843)로
--   anon 권한을 전부 회수한 상태다(기능도 함께 멈춤).
--
-- 이 마이그레이션:
--   1) 서버가 발급·검증하는 로그인 세션 토큰(app_sessions, app_login/app_logout/app_change_password).
--   2) 토큰을 받아 내부 gantt_* 함수를 실행하는 SECURITY DEFINER 래퍼 3개.
--      테이블과 내부 함수는 차단 상태(anon 권한 없음)를 유지한다. 앱이 닿을 수 있는 경로는 래퍼뿐이다.
--   3) 행 내용을 흘리지 않는 Realtime 신호(realtime.send 공개 broadcast). publication 에는 다시 넣지 않는다.
--
-- 호환성: 기존 앱(v1.110.1)이 쓰는 객체는 건드리지 않는다. users 컬럼 권한 축소는
--   2026-09-06-users-password-lockdown.sql (2단계, 앱 배포 뒤) 에서 수행한다.
-- 멱등: 반복 실행해도 안전하다. 이 프로젝트의 default privileges 가 새 테이블/함수에 anon
--   권한을 자동 부여하므로 내부 객체는 반드시 명시적으로 회수한다.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

-- ── 1) 세션 저장소 ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_sessions (
  token_hash   TEXT PRIMARY KEY,                                   -- sha256(token) hex. 원문은 저장하지 않는다.
  user_id      TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx ON public.app_sessions (user_id);
COMMENT ON TABLE public.app_sessions IS
  '앱 로그인 세션. app_login 이 발급한 토큰의 해시만 보관하며 anon/authenticated 는 접근할 수 없다. 사용자 삭제 시 함께 삭제.';

CREATE TABLE IF NOT EXISTS public.app_login_throttle (
  user_name    TEXT PRIMARY KEY,
  failures     INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.app_login_throttle IS
  '이름 단위 로그인 실패 횟수와 잠금. 5회 실패부터 1·2·4·8·15분 지수 잠금.';

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_login_throttle ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE role_name TEXT; BEGIN
  REVOKE ALL PRIVILEGES ON TABLE public.app_sessions, public.app_login_throttle FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.app_sessions, public.app_login_throttle FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

-- ── 2) 토큰 → 사용자 (내부 전용) ──────────────────────────────────────────────
-- 래퍼(SECURITY DEFINER) 안에서만 호출된다. 만료 검사 후 1시간 간격으로 사용 시각과
-- 만료(+90일)를 연장한다. 실패는 모두 SQLSTATE 42501.

CREATE OR REPLACE FUNCTION public.app_session_user_id(p_token TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_hash TEXT; v_user TEXT; v_last TIMESTAMPTZ;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION '로그인 세션이 필요합니다. 다시 로그인해 주세요.' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT s.user_id, s.last_seen_at INTO v_user, v_last
    FROM public.app_sessions s
    WHERE s.token_hash = v_hash AND s.expires_at > now();
  IF v_user IS NULL THEN
    RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501';
  END IF;
  IF v_last < now() - interval '1 hour' THEN
    UPDATE public.app_sessions
       SET last_seen_at = now(), expires_at = now() + interval '90 days'
     WHERE token_hash = v_hash;
  END IF;
  RETURN v_user;
END $$;
COMMENT ON FUNCTION public.app_session_user_id(TEXT) IS
  '내부 전용: 세션 토큰을 사용자 id 로 바꾼다. anon 은 실행할 수 없다.';

-- ── 3) 로그인 / 로그아웃 / 비밀번호 변경 (공개 엔드포인트) ────────────────────
-- 인증 실패는 예외가 아니라 {ok:false,error} 로 돌려준다. 예외로 끝내면 실패 횟수 기록이
-- 같은 트랜잭션과 함께 롤백되기 때문이다. 입력 형식 오류만 예외(22023)다.

CREATE OR REPLACE FUNCTION public.app_login(p_name TEXT, p_password TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_throttle public.app_login_throttle%ROWTYPE;
  v_token TEXT;
  v_next_failures INTEGER;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' OR p_password IS NULL OR length(p_name) > 200 OR length(p_password) > 200 THEN
    RAISE EXCEPTION '이름과 비밀번호를 입력해 주세요.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.app_login_throttle (user_name) VALUES (p_name) ON CONFLICT (user_name) DO NOTHING;
  SELECT * INTO v_throttle FROM public.app_login_throttle WHERE user_name = p_name FOR UPDATE;
  IF v_throttle.locked_until IS NOT NULL AND v_throttle.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false,
      'error', '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      'lockedUntil', v_throttle.locked_until);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.name = p_name) THEN
    RETURN jsonb_build_object('ok', false, 'error', '등록되지 않은 사용자입니다.');
  END IF;

  SELECT * INTO v_user FROM public.users u
   WHERE u.name = p_name AND COALESCE(u.password, '') = p_password
   ORDER BY u.created_at, u.id LIMIT 1;
  IF v_user.id IS NULL THEN
    v_next_failures := v_throttle.failures + 1;
    UPDATE public.app_login_throttle
       SET failures = v_next_failures, updated_at = now(),
           locked_until = CASE WHEN v_next_failures >= 5
             THEN now() + least(interval '15 minutes', interval '1 minute' * power(2, v_next_failures - 5))
             ELSE NULL END
     WHERE user_name = p_name;
    RETURN jsonb_build_object('ok', false, 'error', '비밀번호가 일치하지 않습니다.');
  END IF;

  UPDATE public.app_login_throttle SET failures = 0, locked_until = NULL, updated_at = now() WHERE user_name = p_name;

  -- gen_random_uuid() 는 CSPRNG 기반. 두 개를 이어 64자 hex(약 244비트)로 만든다.
  v_token := replace(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', '');
  INSERT INTO public.app_sessions (token_hash, user_id, expires_at)
  VALUES (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_user.id, now() + interval '90 days');

  RETURN jsonb_build_object('ok', true, 'token', v_token, 'user', jsonb_build_object(
    'id', v_user.id, 'name', v_user.name, 'role', COALESCE(v_user.role, 'user'),
    'slackId', COALESCE(v_user.slack_id, ''), 'hireDate', COALESCE(v_user.hire_date, ''),
    'birthday', COALESCE(v_user.birthday, ''), 'isInitialPassword', COALESCE(v_user.is_initial_password, true),
    'createdAt', COALESCE(v_user.created_at::TEXT, ''),
    'isCompositor', COALESCE(v_user.is_compositor, false),
    'isActingSupervisor', COALESCE(v_user.is_acting_supervisor, false)));
END $$;
COMMENT ON FUNCTION public.app_login(TEXT, TEXT) IS
  '이름·비밀번호를 서버에서 대조하고 세션 토큰을 발급한다. 의도된 공개 엔드포인트(anon 호출 가능).';

CREATE OR REPLACE FUNCTION public.app_logout(p_token TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
  DELETE FROM public.app_sessions WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
END $$;
COMMENT ON FUNCTION public.app_logout(TEXT) IS '세션 토큰을 폐기한다. 모르는 토큰은 무시.';

CREATE OR REPLACE FUNCTION public.app_change_password(p_token TEXT, p_current TEXT, p_new TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_stored TEXT; v_hash TEXT;
BEGIN
  v_user := public.app_session_user_id(p_token);
  IF p_new IS NULL OR btrim(p_new) = '' OR length(p_new) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'error', '새 비밀번호를 입력해 주세요.');
  END IF;
  SELECT COALESCE(u.password, '') INTO v_stored FROM public.users u WHERE u.id = v_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '로그인 사용자를 찾을 수 없습니다' USING ERRCODE = '42501';
  END IF;
  IF v_stored <> COALESCE(p_current, '') THEN
    RETURN jsonb_build_object('ok', false, 'error', '현재 비밀번호가 일치하지 않습니다.');
  END IF;
  UPDATE public.users SET password = p_new, is_initial_password = false WHERE id = v_user;
  -- 다른 기기의 세션은 종료한다. 지금 이 토큰은 유지.
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  DELETE FROM public.app_sessions WHERE user_id = v_user AND token_hash <> v_hash;
  RETURN jsonb_build_object('ok', true);
END $$;
COMMENT ON FUNCTION public.app_change_password(TEXT, TEXT, TEXT) IS
  '세션 토큰으로 본인을 확인한 뒤 비밀번호를 바꾸고 다른 기기 세션을 종료한다.';

-- ── 4) 간트 RPC 래퍼 ──────────────────────────────────────────────────────────
-- 내부 함수(gantt_read/gantt_execute/gantt_calendar_events)는 anon 권한이 없다.
-- 래퍼는 토큰을 사용자 id 로 바꾼 뒤 소유자 권한으로 내부 함수를 실행한다.

CREATE OR REPLACE FUNCTION public.gantt_session_read(p_session_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.gantt_read(public.app_session_user_id(p_session_token));
END $$;

CREATE OR REPLACE FUNCTION public.gantt_session_execute(p_session_token TEXT, p_request_id TEXT, p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.gantt_execute(public.app_session_user_id(p_session_token), p_request_id, p_command);
END $$;

CREATE OR REPLACE FUNCTION public.gantt_session_calendar_events(
  p_session_token TEXT, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL, p_event_id TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.gantt_calendar_events(public.app_session_user_id(p_session_token), p_from, p_to, p_event_id);
END $$;

COMMENT ON FUNCTION public.gantt_session_read(TEXT) IS '세션 토큰으로 호출자를 확정한 뒤 gantt_read 를 실행하는 공개 래퍼.';
COMMENT ON FUNCTION public.gantt_session_execute(TEXT, TEXT, JSONB) IS '세션 토큰으로 호출자를 확정한 뒤 gantt_execute 를 실행하는 공개 래퍼.';
COMMENT ON FUNCTION public.gantt_session_calendar_events(TEXT, DATE, DATE, TEXT) IS '세션 토큰으로 호출자를 확정한 뒤 gantt_calendar_events 를 실행하는 공개 래퍼.';

-- ── 5) 권한: 공개 래퍼만 anon/authenticated/service_role 에 EXECUTE ──────────

DO $$ DECLARE role_name TEXT; BEGIN
  REVOKE ALL PRIVILEGES ON FUNCTION public.app_session_user_id(TEXT) FROM PUBLIC;
  REVOKE ALL PRIVILEGES ON FUNCTION
    public.app_login(TEXT, TEXT), public.app_logout(TEXT), public.app_change_password(TEXT, TEXT, TEXT),
    public.gantt_session_read(TEXT), public.gantt_session_execute(TEXT, TEXT, JSONB),
    public.gantt_session_calendar_events(TEXT, DATE, DATE, TEXT)
  FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.app_session_user_id(TEXT) FROM %I', role_name);
      EXECUTE format($g$GRANT EXECUTE ON FUNCTION
        public.app_login(TEXT, TEXT), public.app_logout(TEXT), public.app_change_password(TEXT, TEXT, TEXT),
        public.gantt_session_read(TEXT), public.gantt_session_execute(TEXT, TEXT, JSONB),
        public.gantt_session_calendar_events(TEXT, DATE, DATE, TEXT) TO %I$g$, role_name);
    END IF;
  END LOOP;
  -- 내부 gantt_* 함수와 세 테이블은 차단 상태를 유지한다(gantt_security_containment 와 동일).
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.gantt_spaces, public.gantt_projects, public.gantt_requests FROM %I', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_read(TEXT), public.gantt_execute(TEXT, TEXT, JSONB), public.gantt_calendar_events(TEXT, DATE, DATE, TEXT) FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
DROP POLICY IF EXISTS gantt_app_access ON public.gantt_spaces;
DROP POLICY IF EXISTS gantt_app_access ON public.gantt_projects;
DROP POLICY IF EXISTS gantt_app_access ON public.gantt_requests;

-- ── 6) Realtime: 내용 없는 변경 신호 ─────────────────────────────────────────
-- 테이블을 publication 에 넣으면 행 내용이 anon 구독자에게 흘러간다. 대신 statement 단위
-- 트리거가 공개 채널 'bflow-realtime' 에 테이블 이름만 broadcast 한다. 앱은 신호를 받으면 RPC 로 재조회한다.

CREATE OR REPLACE FUNCTION public.gantt_notify_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP), 'gantt-changed', 'bflow-realtime', false);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[gantt] realtime 변경 신호 전송 실패: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_notify_change() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_notify_change() FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS gantt_spaces_notify_change ON public.gantt_spaces;
DROP TRIGGER IF EXISTS gantt_projects_notify_change ON public.gantt_projects;
CREATE TRIGGER gantt_spaces_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON public.gantt_spaces
  FOR EACH STATEMENT EXECUTE FUNCTION public.gantt_notify_change();
CREATE TRIGGER gantt_projects_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON public.gantt_projects
  FOR EACH STATEMENT EXECUTE FUNCTION public.gantt_notify_change();

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['gantt_spaces','gantt_projects','gantt_requests'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
