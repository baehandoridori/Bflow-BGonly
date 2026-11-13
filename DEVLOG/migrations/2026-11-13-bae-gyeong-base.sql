-- BAE경 (Bflow 안의 AI 배경 작업실) 기본 표와 세션 함수. 계획: 프로젝트 문서 14 · 14b · 14c(15-5) · 14e.
-- Prerequisites: public.users(id text, role text), public.app_session_user_id(text) (gantt session auth), the vault
-- extension (supabase_vault; the calendar feed already uses vault.create_secret), realtime.send (optional).
-- Nothing here touches an existing table. The tables have RLS on and no policy, and anon/authenticated get no direct
-- right on them: they are reached only through the bae_gyeong_session_* wrappers below, which take the server-issued
-- session token and decide the actor themselves (the caller's own word about who it is is never trusted).
-- Every new function is named bae_gyeong_* (the background library files revoke their own prefixes only).
-- Realtime: no table goes into the publication. A save sends a contentless broadcast on channel 'bae-gyeong'
-- ('settings-changed' / 'members-changed' / 'jobs-changed'); every app reads again through its session.
-- Rerunning this file is safe (IF NOT EXISTS / OR REPLACE); it does not drop data.
-- Not yet applied anywhere. Apply on the dev branch first, then production at stop 1 with Hansol watching
-- (BEGIN ... ROLLBACK dry run first, then compare function bodies, per tasks/lessons.md 2026-10-08).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

-- ───────────── tables ─────────────
-- Who may use BAE경 besides admins, and who may review the team's records. No foreign key to users (deleting a user is
-- never blocked); a row whose user is gone gives no right, as every check also asks for the user row.
CREATE TABLE IF NOT EXISTS public.bae_gyeong_members (
  user_id TEXT PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 200),
  role TEXT NOT NULL CHECK (role IN ('user', 'reviewer')),
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The settings bookshelf: one row per key, with a revision. The list of keys is closed (src/shared/bae/settings.ts).
CREATE TABLE IF NOT EXISTS public.bae_gyeong_settings (
  key TEXT PRIMARY KEY CHECK (key IN ('manual','fixed','guidance','times','horizon','models','prices','api_base','library','access')),
  value JSONB NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.bae_gyeong_settings_history (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  value JSONB NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key, revision)
);
-- The OpenAI keys: only a pointer into the vault. 'team' is the one key of this move; per-person keys come later
-- (plan 14c 15-10) as more rows, picked by bae_gyeong_key_label_for().
CREATE TABLE IF NOT EXISTS public.bae_gyeong_keys (
  label TEXT PRIMARY KEY CHECK (label ~ '^[a-z0-9_-]{1,40}$'),
  secret_id UUID NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One job = one 'make a picture' (an order and a picture), or one tool run on a picture. The originals stay on the
-- maker's PC; here are the words, the numbers and the preview addresses (plan 14 5-2).
CREATE TABLE IF NOT EXISTS public.bae_gyeong_jobs (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('new','same','edit','angle','layers','import','upscale','denoise')),
  status TEXT NOT NULL CHECK (status IN ('ordering','ordered','drawing','done','failed','stopped')),
  name TEXT CHECK (name IS NULL OR length(name) <= 80),
  parent_job_id UUID,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  pd JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  images JSONB NOT NULL DEFAULT '{}'::jsonb,
  self_review JSONB,
  stamp TEXT CHECK (stamp IS NULL OR stamp IN ('seen','good','again')),
  stamp_by TEXT,
  stamp_at TIMESTAMPTZ,
  stamp_note TEXT CHECK (stamp_note IS NULL OR length(stamp_note) <= 400),
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT '' CHECK (length(origin) <= 120),
  app_version TEXT NOT NULL DEFAULT '' CHECK (length(app_version) <= 40),
  episode_number INTEGER,
  scene_ref TEXT,
  library_view_id TEXT,
  hidden_by_owner BOOLEAN NOT NULL DEFAULT false,
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS bae_gyeong_jobs_user_updated ON public.bae_gyeong_jobs (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS bae_gyeong_jobs_updated ON public.bae_gyeong_jobs (updated_at DESC);
-- One line per OpenAI call: who (decided by the server from the session), which job, what, how much. key_label says
-- which key paid (all 'team' for now).
CREATE TABLE IF NOT EXISTS public.bae_gyeong_usage (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('order','image','layers','angle','note','other')),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
  tokens JSONB NOT NULL DEFAULT '{}'::jsonb,
  usd NUMERIC(12,6) NOT NULL CHECK (usd >= 0 AND usd < 100),
  key_label TEXT NOT NULL DEFAULT 'team',
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS bae_gyeong_usage_user_created ON public.bae_gyeong_usage (user_id, created_at DESC);

ALTER TABLE public.bae_gyeong_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bae_gyeong_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bae_gyeong_settings_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bae_gyeong_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bae_gyeong_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bae_gyeong_usage ENABLE ROW LEVEL SECURITY;

-- ───────────── rights, in one place each (internal: no role is granted them) ─────────────
CREATE OR REPLACE FUNCTION public.bae_gyeong_is_admin(actor TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id = actor AND u.role = 'admin')
$$;
CREATE OR REPLACE FUNCTION public.bae_gyeong_is_open()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT COALESCE((SELECT (s.value->>'open')::boolean FROM public.bae_gyeong_settings s WHERE s.key = 'access'), false)
$$;
CREATE OR REPLACE FUNCTION public.bae_gyeong_can_use(actor TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id = actor AND (
   u.role = 'admin'
   OR EXISTS(SELECT 1 FROM public.bae_gyeong_members m WHERE m.user_id = u.id)
   OR public.bae_gyeong_is_open()))
$$;
CREATE OR REPLACE FUNCTION public.bae_gyeong_can_review(actor TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id = actor AND (
   u.role = 'admin' OR EXISTS(SELECT 1 FROM public.bae_gyeong_members m WHERE m.user_id = u.id AND m.role = 'reviewer')))
$$;
-- The actor of a session, or a refusal. Every wrapper starts here.
-- Not STABLE: app_session_user_id refreshes the session's last-seen time (an UPDATE).
CREATE OR REPLACE FUNCTION public.bae_gyeong_actor(p_session_token TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.app_session_user_id(p_session_token);
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id = actor) THEN
  RAISE EXCEPTION '로그인 세션이 필요합니다. 다시 로그인해 주세요.' USING ERRCODE = '42501';
 END IF;
 RETURN actor;
END $$;
CREATE OR REPLACE FUNCTION public.bae_gyeong_require_use(actor TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
 IF NOT public.bae_gyeong_can_use(actor) THEN RAISE EXCEPTION 'BAE경을 쓸 권한이 없습니다. 관리자에게 BAE경 사용자로 지정해 달라고 요청해 주세요.' USING ERRCODE = '42501'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.bae_gyeong_require_admin(actor TEXT, what TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
 IF NOT public.bae_gyeong_is_admin(actor) THEN RAISE EXCEPTION '%은(는) 관리자만 할 수 있습니다.', what USING ERRCODE = '42501'; END IF;
END $$;
-- Which key this person's calls use. One team key now; per-person keys later change only this function (14c 15-10).
CREATE OR REPLACE FUNCTION public.bae_gyeong_key_label_for(actor TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT 'team'::text
$$;
-- A contentless signal. A failed signal never undoes a save: the others catch up on their next read.
CREATE OR REPLACE FUNCTION public.bae_gyeong_signal(event TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
 IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
  EXECUTE 'SELECT realtime.send($1,$2,$3,$4)' USING '{}'::jsonb, event, 'bae-gyeong', false;
 END IF;
EXCEPTION WHEN OTHERS THEN
 RAISE WARNING '[bae-gyeong] realtime 신호 전송 실패: %', SQLERRM;
END $$;

-- ───────────── session wrappers ─────────────
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_access(p_session_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token);
BEGIN
 RETURN jsonb_build_object('canUse', public.bae_gyeong_can_use(actor), 'canReview', public.bae_gyeong_can_review(actor),
   'isAdmin', public.bae_gyeong_is_admin(actor), 'open', public.bae_gyeong_is_open());
END $$;

-- Every row of the bookshelf for a user who may use BAE경. The bodies of the manual, the fixed sentences and the
-- extra guidance reach only the main process: the app hands them to an admin's screen and to nobody else's.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_settings_get(p_session_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token);
BEGIN
 PERFORM public.bae_gyeong_require_use(actor);
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('key', s.key, 'value', s.value, 'revision', s.revision,
   'updatedAt', s.updated_at, 'updatedBy', s.updated_by) ORDER BY s.key) FROM public.bae_gyeong_settings s), '[]'::jsonb);
END $$;

-- One key saved by an admin, against the revision the admin's screen saw (0 = there was none). The answer is the row.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_settings_save(p_session_token TEXT, p_key TEXT, p_value JSONB, p_expected_revision INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); cur public.bae_gyeong_settings%ROWTYPE; next_rev INTEGER;
BEGIN
 PERFORM public.bae_gyeong_require_admin(actor, 'BAE경 설정 바꾸기');
 IF p_key IS NULL OR p_key NOT IN ('manual','fixed','guidance','times','horizon','models','prices','api_base','library','access') THEN
  RAISE EXCEPTION '알 수 없는 BAE경 설정입니다.' USING ERRCODE = '22023'; END IF;
 IF p_value IS NULL OR octet_length(p_value::text) > 600000 THEN RAISE EXCEPTION 'BAE경 설정 값이 없거나 너무 큽니다.' USING ERRCODE = '22023'; END IF;
 IF (p_key IN ('manual','fixed','guidance') AND (jsonb_typeof(p_value) <> 'object' OR jsonb_typeof(p_value->'text') <> 'string'))
  OR (p_key IN ('manual','fixed') AND btrim(p_value->>'text') = '')
  OR (p_key = 'access' AND (jsonb_typeof(p_value) <> 'object' OR jsonb_typeof(p_value->'open') <> 'boolean'))
  OR (p_key = 'api_base' AND (jsonb_typeof(p_value) <> 'string' OR (p_value #>> '{}') !~ '^https://[^[:space:]/?#]+'))
  OR (p_key = 'horizon' AND (jsonb_typeof(p_value->'calib') <> 'number' OR abs((p_value->>'calib')::numeric) > 50))
  OR (p_key IN ('times','models','prices','library') AND jsonb_typeof(p_value) <> 'object') THEN
  RAISE EXCEPTION 'BAE경 설정 값의 모양이 올바르지 않습니다.' USING ERRCODE = '22023';
 END IF;
 IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN RAISE EXCEPTION '설정 판 번호가 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 SELECT * INTO cur FROM public.bae_gyeong_settings WHERE key = p_key FOR UPDATE;
 IF COALESCE(cur.revision, 0) <> p_expected_revision THEN RAISE EXCEPTION '다른 관리자가 먼저 바꿨습니다. 다시 불러와 주세요.' USING ERRCODE = '40001'; END IF;
 next_rev := COALESCE(cur.revision, 0) + 1;
 INSERT INTO public.bae_gyeong_settings(key, value, revision, updated_by, updated_at) VALUES (p_key, p_value, next_rev, actor, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, revision = EXCLUDED.revision, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
 INSERT INTO public.bae_gyeong_settings_history(key, revision, value, updated_by) VALUES (p_key, next_rev, p_value, actor);
 PERFORM public.bae_gyeong_signal('settings-changed');
 RETURN jsonb_build_object('key', p_key, 'value', p_value, 'revision', next_rev, 'updatedAt', now(), 'updatedBy', actor);
END $$;

-- The last revisions of one key, for an admin to look back and roll back (a rollback is a new save of an old value).
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_settings_history(p_session_token TEXT, p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token);
BEGIN
 PERFORM public.bae_gyeong_require_admin(actor, 'BAE경 설정 기록 보기');
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('key', h.key, 'value', h.value, 'revision', h.revision, 'updatedAt', h.updated_at, 'updatedBy', h.updated_by) ORDER BY h.revision DESC)
   FROM (SELECT * FROM public.bae_gyeong_settings_history WHERE key = p_key ORDER BY revision DESC LIMIT 50) h), '[]'::jsonb);
END $$;

-- Whether a key is in the vault and when it was changed. Never a letter of the key.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_key_status(p_session_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); lbl TEXT; k public.bae_gyeong_keys%ROWTYPE;
BEGIN
 PERFORM public.bae_gyeong_require_use(actor);
 lbl := public.bae_gyeong_key_label_for(actor);
 SELECT * INTO k FROM public.bae_gyeong_keys WHERE label = lbl;
 RETURN jsonb_build_object('hasKey', FOUND, 'updatedAt', CASE WHEN FOUND THEN k.updated_at END, 'label', lbl);
END $$;

-- An admin puts the team key in the vault (or replaces it). The answer is the status, never the key.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_set_key(p_session_token TEXT, p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); v TEXT := btrim(COALESCE(p_key, '')); sid UUID;
BEGIN
 PERFORM public.bae_gyeong_require_admin(actor, 'OpenAI 키 넣기');
 IF v !~ '^sk-[A-Za-z0-9_-]{16,}$' OR length(v) > 400 THEN RAISE EXCEPTION 'OpenAI 키 모양이 아닙니다.' USING ERRCODE = '22023'; END IF;
 PERFORM pg_advisory_xact_lock(2119212026, 31);
 SELECT secret_id INTO sid FROM public.bae_gyeong_keys WHERE label = 'team';
 IF sid IS NULL THEN
  sid := vault.create_secret(v, NULL, 'BAE gyeong team OpenAI key');
  INSERT INTO public.bae_gyeong_keys(label, secret_id, updated_by) VALUES ('team', sid, actor);
 ELSE
  PERFORM vault.update_secret(sid, v);
  UPDATE public.bae_gyeong_keys SET updated_by = actor, updated_at = now() WHERE label = 'team';
 END IF;
 PERFORM public.bae_gyeong_signal('settings-changed');
 RETURN jsonb_build_object('hasKey', true, 'updatedAt', now(), 'label', 'team');
END $$;

-- The key for this person's calls, to the main process of a signed-in Bflow whose user may use BAE경. The app keeps it
-- in memory only. Who gets which key is decided here from the session (one team key now).
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_get_key(p_session_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); lbl TEXT; secret TEXT;
BEGIN
 PERFORM public.bae_gyeong_require_use(actor);
 lbl := public.bae_gyeong_key_label_for(actor);
 SELECT d.decrypted_secret INTO secret FROM public.bae_gyeong_keys k JOIN vault.decrypted_secrets d ON d.id = k.secret_id WHERE k.label = lbl;
 IF secret IS NULL THEN RAISE EXCEPTION 'BAE경 OpenAI 키가 아직 없습니다. 관리자에게 키를 넣어 달라고 요청해 주세요.' USING ERRCODE = 'P0002'; END IF;
 RETURN jsonb_build_object('key', secret, 'label', lbl);
END $$;

-- The list of BAE경 users and reviewers, for an admin. Ids of users that still exist.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_members_list(p_session_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token);
BEGIN
 PERFORM public.bae_gyeong_require_admin(actor, 'BAE경 명단 보기');
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('userId', m.user_id, 'role', m.role) ORDER BY m.user_id)
   FROM public.bae_gyeong_members m JOIN public.users u ON u.id = m.user_id), '[]'::jsonb);
END $$;

-- One person put on the list (as user or reviewer) or taken off it (p_role NULL). The answer is the list afterwards.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_members_set(p_session_token TEXT, p_user_id TEXT, p_role TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token);
BEGIN
 PERFORM public.bae_gyeong_require_admin(actor, 'BAE경 명단 바꾸기');
 IF p_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id = p_user_id) THEN RAISE EXCEPTION 'BAE경 명단에 넣을 사용자를 찾을 수 없습니다.' USING ERRCODE = '22023'; END IF;
 IF p_role IS NOT NULL AND p_role NOT IN ('user', 'reviewer') THEN RAISE EXCEPTION 'BAE경 명단의 역할이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 IF p_role IS NULL THEN
  DELETE FROM public.bae_gyeong_members WHERE user_id = p_user_id;
 ELSE
  INSERT INTO public.bae_gyeong_members(user_id, role, granted_by) VALUES (p_user_id, p_role, actor)
   ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = now();
 END IF;
 PERFORM public.bae_gyeong_signal('members-changed');
 RETURN public.bae_gyeong_session_members_list(p_session_token);
END $$;

-- ───────────── jobs and the ledger (stage 2) ─────────────
-- A time the PC sends (an offline job arrives later than it was made), or NULL when it is missing, unreadable or
-- outside sane bounds (more than 5 minutes ahead, more than 60 days back). Internal.
CREATE OR REPLACE FUNCTION public.bae_gyeong_pc_time(v TEXT)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE t TIMESTAMPTZ;
BEGIN
 IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
 BEGIN t := v::timestamptz; EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
 IF t > now() + interval '5 minutes' OR t < now() - interval '60 days' THEN RETURN NULL; END IF;
 RETURN t;
END $$;
-- 0 ordering · 1 ordered · 2 drawing · 3 finished. A late, out-of-order write never takes a finished job back.
CREATE OR REPLACE FUNCTION public.bae_gyeong_status_rank(s TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT CASE s WHEN 'ordering' THEN 0 WHEN 'ordered' THEN 1 WHEN 'drawing' THEN 2 ELSE 3 END
$$;
-- One job as the app reads it. The list leaves out the PD words (pd), which only the one-job view needs.
CREATE OR REPLACE FUNCTION public.bae_gyeong_job_json(j public.bae_gyeong_jobs, full_row BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT jsonb_build_object('id', j.id, 'userId', j.user_id, 'userName', j.user_name, 'kind', j.kind, 'status', j.status,
   'name', j.name, 'parentJobId', j.parent_job_id, 'summary', j.summary, 'result', j.result, 'images', j.images,
   'selfReview', j.self_review, 'stamp', j.stamp, 'stampAt', j.stamp_at, 'costUsd', j.cost_usd, 'origin', j.origin,
   'appVersion', j.app_version, 'hidden', j.hidden_by_owner, 'createdAt', j.created_at, 'finishedAt', j.finished_at,
   'updatedAt', j.updated_at)
  || CASE WHEN full_row THEN jsonb_build_object('pd', j.pd, 'stampBy', j.stamp_by, 'stampNote', j.stamp_note) ELSE '{}'::jsonb END
$$;

-- The maker writes their own job: made when '그림 만들기' is pressed, then finished (done · failed · stopped).
-- The server decides who (the session) and the name shown; the PC sends the words, numbers and preview addresses.
-- A new job needs the right to use BAE경; a job already started may still be finished after the right is taken away.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_job_upsert(p_session_token TEXT, p_job JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); jid UUID; parent UUID; cur public.bae_gyeong_jobs;
  saved public.bae_gyeong_jobs; st TEXT; nm TEXT; cost NUMERIC; uname TEXT; part TEXT;
BEGIN
 IF p_job IS NULL OR jsonb_typeof(p_job) <> 'object' OR length(p_job::text) > 300000 THEN
  RAISE EXCEPTION 'BAE경 작업 기록의 모양이 올바르지 않습니다.' USING ERRCODE = '22023';
 END IF;
 BEGIN jid := (p_job->>'id')::uuid; EXCEPTION WHEN OTHERS THEN jid := NULL; END;
 IF jid IS NULL THEN RAISE EXCEPTION 'BAE경 작업 번호가 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 parent := NULL;
 IF p_job ? 'parentJobId' AND jsonb_typeof(p_job->'parentJobId') = 'string' THEN
  BEGIN parent := (p_job->>'parentJobId')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'BAE경 작업 번호가 올바르지 않습니다.' USING ERRCODE = '22023'; END;
 END IF;
 st := p_job->>'status';
 IF st IS NULL OR st NOT IN ('ordering','ordered','drawing','done','failed','stopped') THEN RAISE EXCEPTION 'BAE경 작업 상태가 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 FOREACH part IN ARRAY ARRAY['summary','pd','result','images'] LOOP
  IF p_job ? part AND jsonb_typeof(p_job->part) <> 'object' THEN RAISE EXCEPTION 'BAE경 작업 기록의 모양이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 END LOOP;
 IF p_job ? 'selfReview' AND jsonb_typeof(p_job->'selfReview') NOT IN ('object','null') THEN RAISE EXCEPTION 'BAE경 작업 기록의 모양이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 nm := NULLIF(btrim(COALESCE(p_job->>'name', '')), '');
 IF nm IS NOT NULL AND length(nm) > 80 THEN RAISE EXCEPTION '그림 이름은 80자까지 쓸 수 있습니다.' USING ERRCODE = '22023'; END IF;
 BEGIN cost := COALESCE((p_job->>'costUsd')::numeric, 0); EXCEPTION WHEN OTHERS THEN cost := NULL; END;
 IF cost IS NULL OR cost < 0 OR cost >= 1000 THEN RAISE EXCEPTION 'BAE경 작업 비용이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;

 SELECT * INTO cur FROM public.bae_gyeong_jobs WHERE id = jid FOR UPDATE;
 IF NOT FOUND THEN
  PERFORM public.bae_gyeong_require_use(actor);
  IF p_job->>'kind' IS NULL OR p_job->>'kind' NOT IN ('new','same','edit','angle','layers','import','upscale','denoise') THEN
   RAISE EXCEPTION 'BAE경 작업 종류가 올바르지 않습니다.' USING ERRCODE = '22023';
  END IF;
  SELECT u.name INTO uname FROM public.users u WHERE u.id = actor;
  INSERT INTO public.bae_gyeong_jobs(id, user_id, user_name, kind, status, name, parent_job_id, summary, pd, result, images,
    self_review, cost_usd, origin, app_version, request_id, created_at, finished_at, updated_at)
  VALUES (jid, actor, COALESCE(uname, ''), p_job->>'kind', st, nm, parent,
    COALESCE(p_job->'summary', '{}'::jsonb), COALESCE(p_job->'pd', '{}'::jsonb), COALESCE(p_job->'result', '{}'::jsonb), COALESCE(p_job->'images', '{}'::jsonb),
    CASE WHEN jsonb_typeof(p_job->'selfReview') = 'object' THEN p_job->'selfReview' END, cost,
    left(COALESCE(p_job->>'origin', ''), 120), left(COALESCE(p_job->>'appVersion', ''), 40), jid::text,
    COALESCE(public.bae_gyeong_pc_time(p_job->>'createdAt'), now()),
    CASE WHEN public.bae_gyeong_status_rank(st) = 3 THEN COALESCE(public.bae_gyeong_pc_time(p_job->>'finishedAt'), now()) END, now())
  RETURNING * INTO saved;
 ELSE
  IF cur.user_id <> actor THEN RAISE EXCEPTION '다른 사람의 BAE경 작업 기록은 고칠 수 없습니다.' USING ERRCODE = '42501'; END IF;
  IF public.bae_gyeong_status_rank(cur.status) = 3 AND public.bae_gyeong_status_rank(st) < 3 THEN st := cur.status; END IF;
  UPDATE public.bae_gyeong_jobs SET
    status = st,
    name = CASE WHEN p_job ? 'name' THEN nm ELSE cur.name END,
    summary = COALESCE(p_job->'summary', cur.summary), pd = COALESCE(p_job->'pd', cur.pd),
    result = COALESCE(p_job->'result', cur.result), images = COALESCE(p_job->'images', cur.images),
    self_review = CASE WHEN p_job ? 'selfReview' THEN CASE WHEN jsonb_typeof(p_job->'selfReview') = 'object' THEN p_job->'selfReview' END ELSE cur.self_review END,
    cost_usd = CASE WHEN p_job ? 'costUsd' THEN cost ELSE cur.cost_usd END,
    finished_at = CASE WHEN public.bae_gyeong_status_rank(st) = 3 THEN COALESCE(cur.finished_at, public.bae_gyeong_pc_time(p_job->>'finishedAt'), now()) END,
    updated_at = now()
  WHERE id = jid RETURNING * INTO saved;
 END IF;
 PERFORM public.bae_gyeong_signal('jobs-changed');
 RETURN public.bae_gyeong_job_json(saved, false);
END $$;

-- My jobs. With no cursor: the newest p_limit. With a cursor (the newest updated_at the PC has, minus a small overlap):
-- what changed after it, oldest first, so the PC can ask again until 'more' is false. 'total' lets the PC notice rows
-- an admin removed.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_job_list_mine(p_session_token TEXT, p_since TIMESTAMPTZ, p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); lim INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 300); rows_out JSONB; n INTEGER;
BEGIN
 IF p_since IS NULL THEN
  SELECT COALESCE(jsonb_agg(public.bae_gyeong_job_json(j, false) ORDER BY j.updated_at DESC, j.id), '[]'::jsonb), count(*) INTO rows_out, n
   FROM public.bae_gyeong_jobs j WHERE j.id IN (SELECT x.id FROM public.bae_gyeong_jobs x WHERE x.user_id = actor ORDER BY x.updated_at DESC, x.id LIMIT lim);
 ELSE
  SELECT COALESCE(jsonb_agg(public.bae_gyeong_job_json(j, false) ORDER BY j.updated_at, j.id), '[]'::jsonb), count(*) INTO rows_out, n
   FROM public.bae_gyeong_jobs j WHERE j.id IN (SELECT x.id FROM public.bae_gyeong_jobs x WHERE x.user_id = actor AND x.updated_at > p_since ORDER BY x.updated_at, x.id LIMIT lim);
 END IF;
 RETURN jsonb_build_object('rows', rows_out, 'more', n >= lim, 'serverTime', now(),
   'total', (SELECT count(*) FROM public.bae_gyeong_jobs WHERE user_id = actor));
END $$;

-- Every member's jobs, for a reviewer (the admin screen, stage 8). Hidden ones too: hiding only tidies the maker's list.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_job_list_team(p_session_token TEXT, p_since TIMESTAMPTZ, p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); lim INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 300); rows_out JSONB; n INTEGER;
BEGIN
 IF NOT public.bae_gyeong_can_review(actor) THEN RAISE EXCEPTION '팀 기록은 BAE경 검수자만 볼 수 있습니다.' USING ERRCODE = '42501'; END IF;
 IF p_since IS NULL THEN
  SELECT COALESCE(jsonb_agg(public.bae_gyeong_job_json(j, false) ORDER BY j.updated_at DESC, j.id), '[]'::jsonb), count(*) INTO rows_out, n
   FROM public.bae_gyeong_jobs j WHERE j.id IN (SELECT x.id FROM public.bae_gyeong_jobs x ORDER BY x.updated_at DESC, x.id LIMIT lim);
 ELSE
  SELECT COALESCE(jsonb_agg(public.bae_gyeong_job_json(j, false) ORDER BY j.updated_at, j.id), '[]'::jsonb), count(*) INTO rows_out, n
   FROM public.bae_gyeong_jobs j WHERE j.id IN (SELECT x.id FROM public.bae_gyeong_jobs x WHERE x.updated_at > p_since ORDER BY x.updated_at, x.id LIMIT lim);
 END IF;
 RETURN jsonb_build_object('rows', rows_out, 'more', n >= lim, 'serverTime', now(), 'total', (SELECT count(*) FROM public.bae_gyeong_jobs));
END $$;

-- One job with the PD words, for its maker or a reviewer.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_job_get(p_session_token TEXT, p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); j public.bae_gyeong_jobs;
BEGIN
 SELECT * INTO j FROM public.bae_gyeong_jobs WHERE id = p_job_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BAE경 작업 기록을 찾을 수 없습니다.' USING ERRCODE = 'P0002'; END IF;
 IF j.user_id <> actor AND NOT public.bae_gyeong_can_review(actor) THEN RAISE EXCEPTION '다른 사람의 BAE경 작업 기록은 볼 수 없습니다.' USING ERRCODE = '42501'; END IF;
 RETURN public.bae_gyeong_job_json(j, true);
END $$;

-- The maker hides a job from their own list (or shows it again). The row and its ledger lines stay (plan 14 5-4).
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_job_hide(p_session_token TEXT, p_job_id UUID, p_hidden BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); j public.bae_gyeong_jobs;
BEGIN
 SELECT * INTO j FROM public.bae_gyeong_jobs WHERE id = p_job_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BAE경 작업 기록을 찾을 수 없습니다.' USING ERRCODE = 'P0002'; END IF;
 IF j.user_id <> actor THEN RAISE EXCEPTION '내 BAE경 작업 기록만 숨길 수 있습니다.' USING ERRCODE = '42501'; END IF;
 UPDATE public.bae_gyeong_jobs SET hidden_by_owner = COALESCE(p_hidden, true), updated_at = now() WHERE id = p_job_id RETURNING * INTO j;
 PERFORM public.bae_gyeong_signal('jobs-changed');
 RETURN public.bae_gyeong_job_json(j, false);
END $$;

-- One ledger line per OpenAI call. Who and which key are decided here; the same request id twice is one line.
-- A signed-in session is enough: money already spent is recorded even if the right to use was taken away meanwhile.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_usage_log(p_session_token TEXT, p_row JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); jid UUID; usd NUMERIC; n INTEGER; rid TEXT; mdl TEXT;
BEGIN
 IF p_row IS NULL OR jsonb_typeof(p_row) <> 'object' OR length(p_row::text) > 8000 THEN RAISE EXCEPTION 'BAE경 장부 줄의 모양이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 jid := NULL;
 IF jsonb_typeof(p_row->'jobId') = 'string' THEN
  BEGIN jid := (p_row->>'jobId')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'BAE경 작업 번호가 올바르지 않습니다.' USING ERRCODE = '22023'; END;
 END IF;
 IF p_row->>'kind' IS NULL OR p_row->>'kind' NOT IN ('order','image','layers','angle','note','other') THEN RAISE EXCEPTION 'BAE경 장부 줄의 종류가 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 mdl := p_row->>'model'; rid := p_row->>'requestId';
 IF mdl IS NULL OR length(mdl) NOT BETWEEN 1 AND 120 OR rid IS NULL OR length(rid) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'BAE경 장부 줄의 모양이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 IF p_row ? 'tokens' AND jsonb_typeof(p_row->'tokens') NOT IN ('object','null') THEN RAISE EXCEPTION 'BAE경 장부 줄의 모양이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 BEGIN usd := (p_row->>'usd')::numeric; EXCEPTION WHEN OTHERS THEN usd := NULL; END;
 IF usd IS NULL OR usd < 0 OR usd >= 100 THEN RAISE EXCEPTION 'BAE경 장부 금액이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 INSERT INTO public.bae_gyeong_usage(job_id, user_id, kind, model, tokens, usd, key_label, request_id, created_at)
 VALUES (jid, actor, p_row->>'kind', mdl, CASE WHEN jsonb_typeof(p_row->'tokens') = 'object' THEN p_row->'tokens' ELSE '{}'::jsonb END, usd,
   public.bae_gyeong_key_label_for(actor), rid, COALESCE(public.bae_gyeong_pc_time(p_row->>'at'), now()))
 ON CONFLICT (user_id, request_id) DO NOTHING;
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN jsonb_build_object('ok', true, 'duplicate', n = 0);
END $$;

-- My spending between two times: totals, pictures and orders, and lines per kind and model.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_usage_summary(p_session_token TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token);
BEGIN
 RETURN (SELECT jsonb_build_object('usd', COALESCE(sum(u.usd), 0), 'images', count(*) FILTER (WHERE u.kind = 'image'),
   'orders', count(*) FILTER (WHERE u.kind = 'order'),
   'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', g.kind, 'model', g.model, 'n', g.n, 'usd', g.usd) ORDER BY g.kind, g.model)
     FROM (SELECT x.kind, x.model, count(*) n, sum(x.usd) usd FROM public.bae_gyeong_usage x
       WHERE x.user_id = actor AND x.created_at >= COALESCE(p_from, '-infinity') AND x.created_at < COALESCE(p_to, 'infinity') GROUP BY x.kind, x.model) g), '[]'::jsonb))
  FROM public.bae_gyeong_usage u
  WHERE u.user_id = actor AND u.created_at >= COALESCE(p_from, '-infinity') AND u.created_at < COALESCE(p_to, 'infinity'));
END $$;

-- ───────────── lockdown: no direct right on any table or internal function; only the session wrappers ─────────────
DO $$ DECLARE role_name TEXT; fn REGPROCEDURE; tbl TEXT; BEGIN
 FOREACH tbl IN ARRAY ARRAY['bae_gyeong_members','bae_gyeong_settings','bae_gyeong_settings_history','bae_gyeong_keys','bae_gyeong_jobs','bae_gyeong_usage'] LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', tbl);
 END LOOP;
 EXECUTE 'REVOKE ALL PRIVILEGES ON SEQUENCE public.bae_gyeong_settings_history_id_seq, public.bae_gyeong_usage_id_seq FROM PUBLIC';
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'bae_gyeong_%' LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', fn);
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   FOREACH tbl IN ARRAY ARRAY['bae_gyeong_members','bae_gyeong_settings','bae_gyeong_settings_history','bae_gyeong_keys','bae_gyeong_jobs','bae_gyeong_usage'] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', tbl, role_name);
   END LOOP;
   EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.bae_gyeong_settings_history_id_seq, public.bae_gyeong_usage_id_seq FROM %I', role_name);
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
