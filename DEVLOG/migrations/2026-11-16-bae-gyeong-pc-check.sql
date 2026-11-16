-- BAE경 '이 PC 점검' 표 (계획 14 9-4): 점검 결과 한 줄을 사람 · PC 마다 하나 올려서, 관리자 · 검수자가 '누구 PC 에서 무엇이 되는지'를 본다.
-- Prerequisites: DEVLOG/migrations/2026-11-13-bae-gyeong-base.sql (bae_gyeong_actor · bae_gyeong_require_use · bae_gyeong_can_review ·
-- bae_gyeong_signal), public.users(id text, name text, role text).
-- Same conventions as the base file: the table has RLS on and no policy, and anon/authenticated get no direct right on it; it is
-- reached only through the two bae_gyeong_session_* wrappers below, which take the server-issued session token and decide the
-- actor themselves (the row's user is never taken from the caller). No table goes into the realtime publication: a save sends a
-- contentless broadcast 'pc-check-changed' on channel 'bae-gyeong'; the admin screen reads again through its session.
-- The PC id is a random UUID the app keeps on the PC (%LOCALAPPDATA%\Bflow-BGonly\bae\pc-id); it says nothing about the person.
-- Rerunning this file is safe (IF NOT EXISTS / OR REPLACE); it keeps data. Rerunning the base file keeps this file's grants right
-- (its lockdown revokes every bae_gyeong_* function and grants only bae_gyeong_session_*), so this file need not follow it.
-- Applied 2026-11-16 (stage 4): dev branch bae-gyeong-dev, then production as migration 20261116084919 bae_gyeong_pc_check after a
-- rolled-back dry run ('BAE PCCHECK SMOKE OK'); smoke passed again after apply. Smoke: DEVLOG/verification/2026-11-16-bae-gyeong-pc-check-smoke.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

-- One row per person and PC. No foreign key to users (deleting a user is never blocked); a row whose user is gone is not listed.
CREATE TABLE IF NOT EXISTS public.bae_gyeong_pc_checks (
  user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  pc_id UUID NOT NULL,
  pc_name TEXT NOT NULL DEFAULT '' CHECK (length(pc_name) <= 120),
  app_version TEXT NOT NULL DEFAULT '' CHECK (length(app_version) <= 40),
  level TEXT NOT NULL CHECK (level IN ('ok','warn','bad')),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 300),
  result JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pc_id)
);
CREATE INDEX IF NOT EXISTS bae_gyeong_pc_checks_checked ON public.bae_gyeong_pc_checks (checked_at DESC);
ALTER TABLE public.bae_gyeong_pc_checks ENABLE ROW LEVEL SECURITY;

-- One row as the screens see it (internal: no role is granted it). Only the name column of users is read.
CREATE OR REPLACE FUNCTION public.bae_gyeong_pc_check_json(r public.bae_gyeong_pc_checks)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT jsonb_build_object('userId', r.user_id, 'userName', COALESCE((SELECT u.name FROM public.users u WHERE u.id = r.user_id), ''),
   'pcId', r.pc_id, 'pcName', r.pc_name, 'appVersion', r.app_version, 'level', r.level, 'summary', r.summary,
   'result', r.result, 'checkedAt', r.checked_at)
$$;

-- My check on this PC, by anyone who may use BAE경. The server decides whose row it is. A person keeps at most 20 PCs: a 21st
-- PC replaces their oldest row.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_pc_check_put(p_session_token TEXT, p_check JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); pid UUID; lvl TEXT; res JSONB; r public.bae_gyeong_pc_checks;
BEGIN
 PERFORM public.bae_gyeong_require_use(actor);
 IF p_check IS NULL OR jsonb_typeof(p_check) <> 'object' THEN RAISE EXCEPTION '이 PC 점검 결과의 모양이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 IF COALESCE(p_check->>'pcId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION '이 PC 번호가 올바르지 않습니다.' USING ERRCODE = '22023';
 END IF;
 pid := (p_check->>'pcId')::uuid;
 lvl := p_check->>'level';
 IF lvl IS NULL OR lvl NOT IN ('ok','warn','bad') THEN RAISE EXCEPTION '이 PC 점검 결과의 모양이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 res := COALESCE(p_check->'result', '{}'::jsonb);
 IF jsonb_typeof(res) <> 'object' THEN RAISE EXCEPTION '이 PC 점검 결과의 모양이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 IF octet_length(res::text) > 16384 THEN RAISE EXCEPTION '이 PC 점검 결과가 너무 큽니다.' USING ERRCODE = '22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bae_gyeong_pc_checks WHERE user_id = actor AND pc_id = pid)
    AND (SELECT count(*) FROM public.bae_gyeong_pc_checks WHERE user_id = actor) >= 20 THEN
  DELETE FROM public.bae_gyeong_pc_checks WHERE (user_id, pc_id) IN (
   SELECT x.user_id, x.pc_id FROM public.bae_gyeong_pc_checks x WHERE x.user_id = actor ORDER BY x.checked_at, x.pc_id
   LIMIT (SELECT count(*) - 19 FROM public.bae_gyeong_pc_checks WHERE user_id = actor));
 END IF;
 INSERT INTO public.bae_gyeong_pc_checks(user_id, pc_id, pc_name, app_version, level, summary, result, checked_at)
 VALUES (actor, pid, left(COALESCE(p_check->>'pcName', ''), 120), left(COALESCE(p_check->>'appVersion', ''), 40), lvl,
   left(COALESCE(p_check->>'summary', ''), 300), res, now())
 ON CONFLICT (user_id, pc_id) DO UPDATE SET pc_name = EXCLUDED.pc_name, app_version = EXCLUDED.app_version, level = EXCLUDED.level,
   summary = EXCLUDED.summary, result = EXCLUDED.result, checked_at = now()
 RETURNING * INTO r;
 PERFORM public.bae_gyeong_signal('pc-check-changed');
 RETURN public.bae_gyeong_pc_check_json(r);
END $$;

-- Everyone's rows for an admin or a reviewer, newest first (at most 1000).
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_pc_check_list(p_session_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token);
BEGIN
 IF NOT public.bae_gyeong_can_review(actor) THEN RAISE EXCEPTION 'PC 점검 표는 관리자와 BAE경 검수자만 볼 수 있습니다.' USING ERRCODE = '42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(public.bae_gyeong_pc_check_json(c) ORDER BY c.checked_at DESC, c.user_id, c.pc_id)
   FROM public.bae_gyeong_pc_checks c
   WHERE (c.user_id, c.pc_id) IN (SELECT x.user_id, x.pc_id FROM public.bae_gyeong_pc_checks x
     WHERE EXISTS(SELECT 1 FROM public.users u WHERE u.id = x.user_id) ORDER BY x.checked_at DESC, x.user_id, x.pc_id LIMIT 1000)), '[]'::jsonb);
END $$;

-- ───────────── lockdown: no direct right on the table or the internal function; only the session wrappers ─────────────
DO $$ DECLARE role_name TEXT; fn REGPROCEDURE; BEGIN
 REVOKE ALL PRIVILEGES ON TABLE public.bae_gyeong_pc_checks FROM PUBLIC;
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'bae_gyeong_%' LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', fn);
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.bae_gyeong_pc_checks FROM %I', role_name);
   FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'bae_gyeong_%' LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I', fn, role_name);
   END LOOP;
   FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'bae_gyeong_session_%' LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn, role_name);
   END LOOP;
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
