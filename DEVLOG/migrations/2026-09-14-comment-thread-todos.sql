-- 2026-09-14: 씬/캐릭터 댓글 스레드의 팀 공유 할 일 (피드백 58)
--
-- 배경:
--   댓글 패널("댓글 및 활동" / 캐릭터는 "이 캐릭터에 대한 이야기") 위쪽에 팀이 같이 보는 체크리스트를 둔다.
--   스레드 키 = CommentPanel 의 effectiveSceneThreadKey (씬 `EP05:A:a001`, 캐릭터 `char:{uuid}`).
-- 경계(CLAUDE.md 규칙 7):
--   테이블은 anon/authenticated 직접 권한 없음(RLS 켜고 정책 0개 + 권한 회수). 앱이 닿는 길은
--   SECURITY DEFINER 래퍼 4개뿐이며, 래퍼는 app_session_user_id(토큰) 으로 호출자를 확정하고
--   작성자·완료자 이름을 서버가 users(명시 컬럼)에서 채운다. 클라이언트 신원 주장은 받지 않는다.
--   users FK 는 두지 않는다(사용자 삭제 cascade 가 다른 삭제 트리거를 막았던 회귀 회피). 퇴사자 항목은 admin 이 지운다.
-- 실시간: publication 에 넣지 않고 statement 트리거가 내용 없는 신호('thread-todos-changed')만 보낸다.
-- 호환성: 추가 전용. 기존 앱(v1.117.x)이 쓰는 객체는 건드리지 않는다.
-- 멱등: 반복 실행해도 안전하다. 이 프로젝트의 default privileges 가 새 테이블/함수에 anon 권한을
--   자동 부여하므로 명시적으로 회수한다. 라이브 적용은 코드 PR 머지 전 한솔 게이트(계획서 부록 A-2).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

-- ── 1) 테이블 ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comment_thread_todos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_key      TEXT NOT NULL CHECK (btrim(thread_key) <> '' AND length(thread_key) <= 200),
  text            TEXT NOT NULL CHECK (btrim(text) <> '' AND length(text) <= 200),
  created_by      TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at         TIMESTAMPTZ,
  done_by         TEXT,
  done_by_name    TEXT,
  -- 완료 정보 세 칸은 함께 채워지거나 함께 비어 있다.
  CONSTRAINT comment_thread_todos_done_pair
    CHECK ((done_at IS NULL) = (done_by IS NULL) AND (done_by IS NULL) = (done_by_name IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_comment_thread_todos_thread
  ON public.comment_thread_todos (thread_key, created_at);

-- RLS 켜고 정책은 만들지 않는다. anon 은 어떤 행도 볼 수 없고, 래퍼(SECURITY DEFINER)만 통과한다.
ALTER TABLE public.comment_thread_todos ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE role_name TEXT; BEGIN
  REVOKE ALL PRIVILEGES ON TABLE public.comment_thread_todos FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.comment_thread_todos FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

-- ── 2) 공개 래퍼 4개 (세션 토큰 → 호출자 확정 → 본문) ─────────────────────
-- 호출자 확정 3줄은 네 함수에 그대로 반복한다(별도 헬퍼 없음 — 읽는 사람이 한 함수 안에서 경계를 다 본다).
-- 세션 실패는 app_session_user_id 가 42501 로 던지고, users 에 없는 사용자(삭제된 계정)도 42501 로 통일한다.

CREATE OR REPLACE FUNCTION public.comment_thread_todos_session_list(p_session_token TEXT, p_thread_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_name TEXT; v_role TEXT;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  SELECT u.name, u.role INTO v_name, v_role FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  IF p_thread_key IS NULL OR btrim(p_thread_key) = '' OR length(p_thread_key) > 200 THEN
    RAISE EXCEPTION '할 일 대상이 올바르지 않습니다.' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id)
                   FROM public.comment_thread_todos t WHERE t.thread_key = p_thread_key), '[]'::JSONB);
END $$;

CREATE OR REPLACE FUNCTION public.comment_thread_todos_session_add(p_session_token TEXT, p_thread_key TEXT, p_text TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_name TEXT; v_role TEXT; v_text TEXT; t public.comment_thread_todos;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  SELECT u.name, u.role INTO v_name, v_role FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  IF p_thread_key IS NULL OR btrim(p_thread_key) = '' OR length(p_thread_key) > 200 THEN
    RAISE EXCEPTION '할 일 대상이 올바르지 않습니다.' USING ERRCODE = '22023';
  END IF;
  -- 연속 공백은 한 칸으로, 앞뒤 공백은 제거 (렌더러·main 의 sanitizeThreadTodoText 와 같은 규칙).
  v_text := btrim(regexp_replace(COALESCE(p_text, ''), '\s+', ' ', 'g'));
  IF v_text = '' OR length(v_text) > 200 THEN
    RAISE EXCEPTION '할 일은 1~200자로 적어 주세요.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.comment_thread_todos (thread_key, text, created_by, created_by_name)
  VALUES (p_thread_key, v_text, v_user, v_name)
  RETURNING * INTO t;
  RETURN to_jsonb(t);
END $$;

-- 완료: 같은 항목을 둘이 동시에 체크하면 먼저 체크한 사람이 남는다(COALESCE). 해제는 누구나. 없는 항목은 P0002.
CREATE OR REPLACE FUNCTION public.comment_thread_todos_session_set_done(p_session_token TEXT, p_id UUID, p_done BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_name TEXT; v_role TEXT; t public.comment_thread_todos;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  SELECT u.name, u.role INTO v_name, v_role FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_done IS NULL THEN
    RAISE EXCEPTION '할 일 요청이 올바르지 않습니다.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.comment_thread_todos SET
    done_at      = CASE WHEN p_done THEN COALESCE(done_at, now()) ELSE NULL END,
    done_by      = CASE WHEN p_done THEN COALESCE(done_by, v_user) ELSE NULL END,
    done_by_name = CASE WHEN p_done THEN COALESCE(done_by_name, v_name) ELSE NULL END
  WHERE id = p_id
  RETURNING * INTO t;
  IF NOT FOUND THEN RAISE EXCEPTION '이미 지워진 할 일이에요.' USING ERRCODE = 'P0002'; END IF;
  RETURN to_jsonb(t);
END $$;

-- 삭제: 작성자 본인 또는 users.role = 'admin'. 권한·부재를 DELETE 한 문장으로 판정한다(SELECT→DELETE 경합 없음).
--   이미 없는 항목은 멱등 성공({deleted:false}), 남의 항목은 42501.
CREATE OR REPLACE FUNCTION public.comment_thread_todos_session_delete(p_session_token TEXT, p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_name TEXT; v_role TEXT; v_deleted UUID;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  SELECT u.name, u.role INTO v_name, v_role FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION '할 일 요청이 올바르지 않습니다.' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.comment_thread_todos
   WHERE id = p_id AND (created_by = v_user OR v_role = 'admin')
  RETURNING id INTO v_deleted;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'deleted', true); END IF;
  IF EXISTS (SELECT 1 FROM public.comment_thread_todos WHERE id = p_id) THEN
    RAISE EXCEPTION '내가 추가한 할 일만 지울 수 있어요.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('ok', true, 'deleted', false);
END $$;

COMMENT ON FUNCTION public.comment_thread_todos_session_list(TEXT, TEXT) IS '세션 토큰으로 호출자를 확정한 뒤 스레드의 팀 할 일 목록을 돌려주는 공개 래퍼.';
COMMENT ON FUNCTION public.comment_thread_todos_session_add(TEXT, TEXT, TEXT) IS '세션 토큰으로 호출자를 확정한 뒤 팀 할 일을 추가하는 공개 래퍼(작성자 이름은 서버가 채움).';
COMMENT ON FUNCTION public.comment_thread_todos_session_set_done(TEXT, UUID, BOOLEAN) IS '세션 토큰으로 호출자를 확정한 뒤 완료/해제를 기록하는 공개 래퍼(최초 완료자 유지).';
COMMENT ON FUNCTION public.comment_thread_todos_session_delete(TEXT, UUID) IS '세션 토큰으로 호출자를 확정한 뒤 작성자 또는 관리자만 지우는 공개 래퍼.';

-- ── 3) 권한: 래퍼만 anon/authenticated/service_role 에 EXECUTE ────────────

DO $$ DECLARE role_name TEXT; BEGIN
  REVOKE ALL PRIVILEGES ON FUNCTION
    public.comment_thread_todos_session_list(TEXT, TEXT),
    public.comment_thread_todos_session_add(TEXT, TEXT, TEXT),
    public.comment_thread_todos_session_set_done(TEXT, UUID, BOOLEAN),
    public.comment_thread_todos_session_delete(TEXT, UUID)
  FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format($g$GRANT EXECUTE ON FUNCTION
        public.comment_thread_todos_session_list(TEXT, TEXT),
        public.comment_thread_todos_session_add(TEXT, TEXT, TEXT),
        public.comment_thread_todos_session_set_done(TEXT, UUID, BOOLEAN),
        public.comment_thread_todos_session_delete(TEXT, UUID) TO %I$g$, role_name);
    END IF;
  END LOOP;
END $$;

-- ── 4) Realtime: 내용 없는 변경 신호 (gantt_notify_change 미러) ───────────
-- 테이블을 publication 에 넣으면 행 내용이 anon 구독자에게 흘러간다. 대신 statement 단위 트리거가
-- 공개 채널 'bflow-realtime' 에 테이블 이름만 broadcast 한다. 앱은 신호를 받으면 래퍼로 다시 읽는다.
-- 0행 DELETE(이미 지워진 항목 재삭제)에도 신호가 나가지만 20명 규모라 허용한다.

CREATE OR REPLACE FUNCTION public.comment_thread_todos_notify_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP), 'thread-todos-changed', 'bflow-realtime', false);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[thread-todos] realtime 변경 신호 전송 실패: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL PRIVILEGES ON FUNCTION public.comment_thread_todos_notify_change() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.comment_thread_todos_notify_change() FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS comment_thread_todos_notify_change ON public.comment_thread_todos;
CREATE TRIGGER comment_thread_todos_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON public.comment_thread_todos
  FOR EACH STATEMENT EXECUTE FUNCTION public.comment_thread_todos_notify_change();

-- 방어: 누군가 publication 에 넣었다면 뺀다(행 내용 노출 방지).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comment_thread_todos') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.comment_thread_todos;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
