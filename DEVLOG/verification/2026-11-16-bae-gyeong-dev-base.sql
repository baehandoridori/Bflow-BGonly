-- 개발 브랜치(bae-gyeong-dev) 전용 바탕. 운영 DB에는 실행하지 않는다 (운영에는 이미 있다).
-- 왜: 개발 브랜치는 운영의 마이그레이션 기록만 다시 쌓는데, 사용자 표 등 바탕은 예전에 SQL 편집기로 만들어
--   기록에 없다 (2026-11-16 브랜치 상태 MIGRATIONS_FAILED, 표 0개). BAE경 기본 SQL이 기대는 것만 레포 파일에서
--   줄 그대로 떼어 온다. 간트 래퍼 · 다른 기능 표는 넣지 않는다.
-- 출처 (줄 번호는 커밋 83252ed9 기준):
--   1) DEVLOG/supabase-init.sql 113-124 (users 표), 241-246 (users RLS · allow_all)
--   2) DEVLOG/2026-05-03-revision-compositor-simplify.sql 17 · DEVLOG/migrations/2026-05-11-acting-phase-toggle.sql 25-26 (users 칸 둘)
--   3) DEVLOG/migrations/2026-09-05-app-sessions-gantt-auth.sql 20-179 (세션 표 · app_session_user_id · app_login · app_logout · app_change_password)
--      + 같은 파일 209-224 (권한)에서 간트 함수 이름만 뺀 것
--   4) DEVLOG/migrations/2026-09-06-users-password-lockdown.sql 19-32 (비밀번호 칸을 anon 에서 막는 칸 단위 권한)

-- ── 1) users ──
-- 6. users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  password TEXT,
  slack_id TEXT,
  hire_date TEXT,
  birthday TEXT,
  is_initial_password BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON users FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 2) users 칸 둘 ──
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_compositor BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS is_acting_supervisor BOOLEAN DEFAULT false NOT NULL;

-- ── 3) 로그인 세션 ──
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

  -- DO UPDATE(no-op)로 upsert해야 동시 로그인에서도 항상 잠긴 행을 돌려받는다.
  -- DO NOTHING + 별도 SELECT 는 다른 트랜잭션이 롤백한 순간 행을 못 찾아 failures 가 NULL 이 되고,
  -- 이어지는 UPDATE 가 NOT NULL 을 위반해 로그인 실패가 예외로 터진다.
  INSERT INTO public.app_login_throttle (user_name) VALUES (p_name)
  ON CONFLICT (user_name) DO UPDATE SET user_name = EXCLUDED.user_name
  RETURNING * INTO v_throttle;
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

-- 같은 파일 209-224 (권한)에서 간트 함수 이름만 뺀 것: app_session_user_id 는 아무도 직접 못 부르고,
-- 로그인 · 로그아웃 · 비밀번호 변경만 anon/authenticated/service_role 이 부른다.
DO $$ DECLARE role_name TEXT; BEGIN
  REVOKE ALL PRIVILEGES ON FUNCTION public.app_session_user_id(TEXT) FROM PUBLIC;
  REVOKE ALL PRIVILEGES ON FUNCTION
    public.app_login(TEXT, TEXT), public.app_logout(TEXT), public.app_change_password(TEXT, TEXT, TEXT)
  FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.app_session_user_id(TEXT) FROM %I', role_name);
      EXECUTE format($g$GRANT EXECUTE ON FUNCTION
        public.app_login(TEXT, TEXT), public.app_logout(TEXT), public.app_change_password(TEXT, TEXT, TEXT) TO %I$g$, role_name);
    END IF;
  END LOOP;
END $$;

-- ── 4) 비밀번호 칸 막기 ──
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
