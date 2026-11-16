-- BAE경 8단계 '관리자 화면': 확인 도장(차례 기록) · 팀 기록 거르기 · 새 도장 숫자 · 팀 비용 표 (계획 14 6-1 · 6-2 · 7장, 14b 11-3 8단계).
-- Prerequisites: DEVLOG/migrations/2026-11-13-bae-gyeong-base.sql (bae_gyeong_jobs · bae_gyeong_usage · bae_gyeong_actor ·
-- bae_gyeong_can_review · bae_gyeong_status_rank · bae_gyeong_job_json · bae_gyeong_signal), public.users(id text, name text, role text).
-- Same conventions as the base file: the new tables have RLS on and no policy, and anon/authenticated get no direct right on them;
-- they are reached only through the bae_gyeong_session_* wrappers below, which take the server-issued session token and decide
-- the actor themselves (an id the caller sends is never trusted). No table goes into the realtime publication: a stamp sends the
-- base file's contentless 'jobs-changed' on channel 'bae-gyeong', and every app reads again through its session.
-- A conflict is never raised with 40001 / 40P01 (the Data API retries those by itself and the caller never gets an answer).
-- Who may: reviewers (admins + 'BAE경 검수자') read the team's records and costs and stamp; the maker reads their own stamps.
-- Rerunning this file is safe (IF NOT EXISTS / OR REPLACE); it keeps data. Rerunning the base file keeps this file's grants right
-- (its lockdown revokes every bae_gyeong_* function and grants only bae_gyeong_session_*), and this file redefines nothing of the
-- base file, so it need not follow it. Applied 2026-11-16 (stage 8): dev branch bae-gyeong-dev, then production as migration
-- 20261116093630 bae_gyeong_review after a rolled-back dry run ('BAE REVIEW SMOKE OK'); all 41 bae_gyeong_* function bodies match
-- the files (fingerprint 350ef63bd4f481fb563f35d2666454bb with base + pc-check + this file).
-- Dry run: DEVLOG/verification/2026-11-16-bae-gyeong-review-smoke.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

-- ───────────── tables ─────────────
-- Every stamp ever put on a job, and every taking back (stamp NULL): who, when, which, with what memo. The job row keeps only the
-- current stamp (bae_gyeong_jobs.stamp · stamp_by · stamp_at · stamp_note); this is its history. job_owner is the maker, copied
-- here so the maker's new stamps are counted without reading the jobs table. No foreign key (base file convention).
CREATE TABLE IF NOT EXISTS public.bae_gyeong_stamps (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL,
  job_owner TEXT NOT NULL CHECK (length(job_owner) BETWEEN 1 AND 200),
  stamp TEXT CHECK (stamp IS NULL OR stamp IN ('seen','good','again')),
  note TEXT CHECK (note IS NULL OR length(note) <= 400),
  stamped_by TEXT NOT NULL CHECK (length(stamped_by) BETWEEN 1 AND 200),
  stamped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bae_gyeong_stamps_job ON public.bae_gyeong_stamps (job_id, id DESC);
CREATE INDEX IF NOT EXISTS bae_gyeong_stamps_owner ON public.bae_gyeong_stamps (job_owner, id);
-- How far each maker has looked at the stamps on their jobs (the highest stamp id seen). New = after it.
CREATE TABLE IF NOT EXISTS public.bae_gyeong_stamp_seen (
  user_id TEXT PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 200),
  seen_id BIGINT NOT NULL DEFAULT 0 CHECK (seen_id >= 0),
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The team list is read newest made first; the cost table by time over everyone.
CREATE INDEX IF NOT EXISTS bae_gyeong_jobs_created ON public.bae_gyeong_jobs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS bae_gyeong_usage_created ON public.bae_gyeong_usage (created_at);

ALTER TABLE public.bae_gyeong_stamps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bae_gyeong_stamp_seen ENABLE ROW LEVEL SECURITY;

-- ───────────── internal (no role is granted them) ─────────────
-- A stamp memo is one line: runs of spaces and line breaks become one space, the ends are trimmed, empty is NULL.
CREATE OR REPLACE FUNCTION public.bae_gyeong_stamp_note(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT NULLIF(btrim(regexp_replace(COALESCE(p, ''), '[[:space:]]+', ' ', 'g')), '')
$$;
-- One line of the history as the screens see it. Only the name column of users is read.
CREATE OR REPLACE FUNCTION public.bae_gyeong_stamp_event_json(s public.bae_gyeong_stamps)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT jsonb_build_object('id', s.id, 'jobId', s.job_id, 'stamp', s.stamp, 'note', s.note, 'by', s.stamped_by,
   'byName', COALESCE((SELECT u.name FROM public.users u WHERE u.id = s.stamped_by), ''), 'at', s.stamped_at)
$$;
-- The maker's new stamps: jobs of theirs whose latest stamp event after their cursor is 좋아요 or 다시 by someone else and is still
-- the job's stamp. 확인함 is quiet (plan 14 6-2: shown in the records only). 'upto' is the highest stamp id on their jobs, which
-- the app sends back when it marks them seen (so a stamp that lands in between is not marked seen unread).
CREATE OR REPLACE FUNCTION public.bae_gyeong_stamp_unseen_of(actor TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 WITH cur AS (SELECT COALESCE((SELECT v.seen_id FROM public.bae_gyeong_stamp_seen v WHERE v.user_id = actor), 0) AS seen_id),
  latest AS (SELECT DISTINCT ON (s.job_id) s.job_id, s.id, s.stamp, s.stamped_by
    FROM public.bae_gyeong_stamps s, cur WHERE s.job_owner = actor AND s.id > cur.seen_id ORDER BY s.job_id, s.id DESC),
  fresh AS (SELECT l.job_id, l.id FROM latest l JOIN public.bae_gyeong_jobs j ON j.id = l.job_id AND j.user_id = actor
    WHERE l.stamp IN ('good','again') AND l.stamped_by <> actor AND j.stamp IS NOT DISTINCT FROM l.stamp)
 SELECT jsonb_build_object(
   'count', (SELECT count(*) FROM fresh),
   'jobIds', COALESCE((SELECT jsonb_agg(f.job_id ORDER BY f.id DESC) FROM (SELECT x.job_id, x.id FROM fresh x ORDER BY x.id DESC LIMIT 100) f), '[]'::jsonb),
   'upto', GREATEST((SELECT cur.seen_id FROM cur), COALESCE((SELECT max(s.id) FROM public.bae_gyeong_stamps s WHERE s.job_owner = actor), 0)))
$$;

-- ───────────── session wrappers ─────────────
-- A reviewer stamps one finished job: 확인함(seen) · 좋아요(good) · 다시(again, with a one-line memo), or takes the stamp back
-- (p_stamp NULL). One stamp per job: a new stamp replaces the old one on the job, and the history keeps both. The same stamp
-- and memo again by the same reviewer changes nothing (a double click adds no line). The answer is the whole job.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_job_stamp(p_session_token TEXT, p_job_id UUID, p_stamp TEXT, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); j public.bae_gyeong_jobs; nt TEXT;
BEGIN
 IF NOT public.bae_gyeong_can_review(actor) THEN RAISE EXCEPTION '확인 도장은 관리자와 BAE경 검수자만 찍을 수 있습니다.' USING ERRCODE = '42501'; END IF;
 IF p_stamp IS NOT NULL AND p_stamp NOT IN ('seen','good','again') THEN RAISE EXCEPTION '도장 종류가 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 nt := CASE WHEN p_stamp IS NULL THEN NULL ELSE public.bae_gyeong_stamp_note(p_note) END;
 IF length(nt) > 400 THEN RAISE EXCEPTION '도장 메모는 400자까지 쓸 수 있습니다.' USING ERRCODE = '22023'; END IF;
 IF p_stamp = 'again' AND nt IS NULL THEN RAISE EXCEPTION '다시 도장에는 한 줄 메모를 남겨 주세요.' USING ERRCODE = '22023'; END IF;
 SELECT * INTO j FROM public.bae_gyeong_jobs WHERE id = p_job_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BAE경 작업 기록을 찾을 수 없습니다.' USING ERRCODE = 'P0002'; END IF;
 IF public.bae_gyeong_status_rank(j.status) < 3 THEN RAISE EXCEPTION '아직 만드는 중인 작업에는 도장을 찍을 수 없습니다.' USING ERRCODE = '22023'; END IF;
 IF j.stamp IS NOT DISTINCT FROM p_stamp AND j.stamp_note IS NOT DISTINCT FROM nt AND (p_stamp IS NULL OR j.stamp_by = actor) THEN
  RETURN public.bae_gyeong_job_json(j, true);
 END IF;
 UPDATE public.bae_gyeong_jobs SET stamp = p_stamp,
   stamp_by = CASE WHEN p_stamp IS NULL THEN NULL ELSE actor END,
   stamp_at = CASE WHEN p_stamp IS NULL THEN NULL ELSE now() END,
   stamp_note = nt, updated_at = now()
  WHERE id = p_job_id RETURNING * INTO j;
 INSERT INTO public.bae_gyeong_stamps(job_id, job_owner, stamp, note, stamped_by) VALUES (j.id, j.user_id, p_stamp, nt, actor);
 PERFORM public.bae_gyeong_signal('jobs-changed');
 RETURN public.bae_gyeong_job_json(j, true);
END $$;

-- A reviewer's '확인함' on many jobs at once (at most 200). A job that already has a stamp keeps it (a bulk 확인함 never covers a
-- 좋아요, or a 다시 and its memo), and a job still being made is left alone. Rows are locked in id order (no deadlock between two
-- bulk stamps). The answer lists the jobs stamped and how many were left as they were.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_job_stamp_bulk(p_session_token TEXT, p_job_ids UUID[], p_stamp TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); j public.bae_gyeong_jobs; done UUID[] := '{}'; asked INTEGER;
BEGIN
 IF NOT public.bae_gyeong_can_review(actor) THEN RAISE EXCEPTION '확인 도장은 관리자와 BAE경 검수자만 찍을 수 있습니다.' USING ERRCODE = '42501'; END IF;
 IF p_stamp IS DISTINCT FROM 'seen' THEN RAISE EXCEPTION '여러 건에 한꺼번에 찍는 도장은 확인함뿐입니다.' USING ERRCODE = '22023'; END IF;
 asked := (SELECT count(DISTINCT x) FROM unnest(COALESCE(p_job_ids, '{}'::uuid[])) x WHERE x IS NOT NULL);
 IF asked = 0 OR COALESCE(cardinality(p_job_ids), 0) > 200 THEN RAISE EXCEPTION '한꺼번에 도장을 찍을 기록은 1~200건이에요.' USING ERRCODE = '22023'; END IF;
 FOR j IN SELECT * FROM public.bae_gyeong_jobs WHERE id = ANY(p_job_ids) ORDER BY id FOR UPDATE LOOP
  CONTINUE WHEN j.stamp IS NOT NULL OR public.bae_gyeong_status_rank(j.status) < 3;
  UPDATE public.bae_gyeong_jobs SET stamp = 'seen', stamp_by = actor, stamp_at = now(), stamp_note = NULL, updated_at = now() WHERE id = j.id;
  INSERT INTO public.bae_gyeong_stamps(job_id, job_owner, stamp, note, stamped_by) VALUES (j.id, j.user_id, 'seen', NULL, actor);
  done := done || j.id;
 END LOOP;
 IF cardinality(done) > 0 THEN PERFORM public.bae_gyeong_signal('jobs-changed'); END IF;
 RETURN jsonb_build_object('stamped', to_jsonb(done), 'skipped', asked - cardinality(done));
END $$;

-- The history of one job's stamps, newest first (at most 100), for its maker or a reviewer.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_job_stamps(p_session_token TEXT, p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); maker TEXT;
BEGIN
 SELECT j.user_id INTO maker FROM public.bae_gyeong_jobs j WHERE j.id = p_job_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BAE경 작업 기록을 찾을 수 없습니다.' USING ERRCODE = 'P0002'; END IF;
 IF maker <> actor AND NOT public.bae_gyeong_can_review(actor) THEN RAISE EXCEPTION '다른 사람의 BAE경 작업 기록은 볼 수 없습니다.' USING ERRCODE = '42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(public.bae_gyeong_stamp_event_json(s) ORDER BY s.id DESC) FROM public.bae_gyeong_stamps s
   WHERE s.id IN (SELECT x.id FROM public.bae_gyeong_stamps x WHERE x.job_id = p_job_id ORDER BY x.id DESC LIMIT 100)), '[]'::jsonb);
END $$;

-- How many new stamps (좋아요 · 다시) wait on my jobs, for the number on the 景 icon and the marks in 내 기록.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_stamp_unseen(p_session_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token);
BEGIN
 RETURN public.bae_gyeong_stamp_unseen_of(actor);
END $$;

-- I looked at my stamps up to p_upto (the 'upto' the unseen answer gave; NULL = all there are now). The cursor only moves forward.
-- The answer is the unseen state afterwards.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_stamp_seen(p_session_token TEXT, p_upto BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); top_id BIGINT; target_id BIGINT;
BEGIN
 IF p_upto IS NOT NULL AND p_upto < 0 THEN RAISE EXCEPTION '도장 확인 위치가 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 top_id := COALESCE((SELECT max(s.id) FROM public.bae_gyeong_stamps s WHERE s.job_owner = actor), 0);
 target_id := LEAST(COALESCE(p_upto, top_id), top_id);
 INSERT INTO public.bae_gyeong_stamp_seen AS v (user_id, seen_id, seen_at) VALUES (actor, target_id, now())
 ON CONFLICT (user_id) DO UPDATE SET seen_id = GREATEST(v.seen_id, EXCLUDED.seen_id), seen_at = now();
 RETURN public.bae_gyeong_stamp_unseen_of(actor);
END $$;

-- The team's records for a reviewer, newest made first, filtered on the server: person, period (made between from and to), kind,
-- '도장 없음' (finished and not stamped), and words in the name, the description, the PD summary or the English order. Paged with a
-- cursor (the last row's createdAt and id, as this function gave them), at most 200 a page. Hidden jobs too (hiding tidies only
-- the maker's own list). The list shape leaves the PD words out.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_job_find_team(p_session_token TEXT, p_filter JSONB, p_before JSONB, p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); lim INTEGER := LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
  f JSONB := COALESCE(p_filter, '{}'::jsonb); f_user TEXT; f_from TIMESTAMPTZ; f_to TIMESTAMPTZ; f_kind TEXT; f_unstamped BOOLEAN := false;
  f_q TEXT; pat TEXT; b_at TIMESTAMPTZ; b_id UUID; ids UUID[]; more BOOLEAN; rows_out JSONB; nxt JSONB;
BEGIN
 IF NOT public.bae_gyeong_can_review(actor) THEN RAISE EXCEPTION '팀 기록은 BAE경 검수자만 볼 수 있습니다.' USING ERRCODE = '42501'; END IF;
 IF jsonb_typeof(f) <> 'object' OR length(f::text) > 2000 THEN RAISE EXCEPTION '팀 기록 거르기 값이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 f_user := NULLIF(f->>'userId', '');
 IF length(f_user) > 200 THEN RAISE EXCEPTION '팀 기록 거르기 값이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 BEGIN
  f_from := NULLIF(f->>'from', '')::timestamptz;
  f_to := NULLIF(f->>'to', '')::timestamptz;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '팀 기록 기간이 올바르지 않습니다.' USING ERRCODE = '22023';
 END;
 f_kind := NULLIF(f->>'kind', '');
 IF f_kind IS NOT NULL AND f_kind NOT IN ('new','same','edit','angle','layers','import','upscale','denoise') THEN
  RAISE EXCEPTION '팀 기록 거르기 값이 올바르지 않습니다.' USING ERRCODE = '22023';
 END IF;
 IF f ? 'unstamped' THEN
  IF jsonb_typeof(f->'unstamped') <> 'boolean' THEN RAISE EXCEPTION '팀 기록 거르기 값이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
  f_unstamped := (f->>'unstamped')::boolean;
 END IF;
 f_q := NULLIF(btrim(COALESCE(f->>'q', '')), '');
 IF length(f_q) > 100 THEN RAISE EXCEPTION '찾는 말은 100자까지 쓸 수 있습니다.' USING ERRCODE = '22023'; END IF;
 IF f_q IS NOT NULL THEN pat := '%' || replace(replace(replace(f_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; END IF;
 IF p_before IS NOT NULL THEN
  BEGIN
   b_at := (p_before->>'createdAt')::timestamptz;
   b_id := (p_before->>'id')::uuid;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '팀 기록 위치가 올바르지 않습니다.' USING ERRCODE = '22023';
  END;
  IF b_at IS NULL OR b_id IS NULL THEN RAISE EXCEPTION '팀 기록 위치가 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 END IF;
 SELECT array_agg(x.id ORDER BY x.created_at DESC, x.id DESC) INTO ids FROM (
  SELECT y.id, y.created_at FROM public.bae_gyeong_jobs y
  WHERE (f_user IS NULL OR y.user_id = f_user)
    AND (f_from IS NULL OR y.created_at >= f_from) AND (f_to IS NULL OR y.created_at < f_to)
    AND (f_kind IS NULL OR y.kind = f_kind)
    AND (NOT f_unstamped OR (y.stamp IS NULL AND public.bae_gyeong_status_rank(y.status) = 3))
    AND (pat IS NULL OR COALESCE(y.name, '') ILIKE pat OR COALESCE(y.summary->>'request', '') ILIKE pat
      OR COALESCE(y.pd->>'summaryKo', '') ILIKE pat OR COALESCE(y.pd->>'prompt', '') ILIKE pat)
    AND (b_at IS NULL OR (y.created_at, y.id) < (b_at, b_id))
  ORDER BY y.created_at DESC, y.id DESC LIMIT lim + 1) x;
 more := COALESCE(cardinality(ids), 0) > lim;
 IF more THEN ids := ids[1:lim]; END IF;
 SELECT COALESCE(jsonb_agg(public.bae_gyeong_job_json(j, false) ORDER BY j.created_at DESC, j.id DESC), '[]'::jsonb) INTO rows_out
  FROM public.bae_gyeong_jobs j WHERE j.id = ANY(COALESCE(ids, '{}'::uuid[]));
 IF more THEN
  SELECT jsonb_build_object('createdAt', j.created_at, 'id', j.id) INTO nxt FROM public.bae_gyeong_jobs j WHERE j.id = ids[lim];
 END IF;
 RETURN jsonb_build_object('rows', rows_out, 'more', more, 'next', nxt, 'serverTime', now());
END $$;

-- The team's spending for a reviewer: ledger lines between p_from and p_to (default: this month so far), summed per person ×
-- period (day · week · month, Korean time) × kind × model. 'total' is the sum of the very same lines, so the table always adds
-- up to the ledger; 'month' is this calendar month for the whole team. Lines of a removed user stay (money spent), name ''.
-- The span is bounded per period size so the answer stays small (day ≤ 93 days, week ≤ 371, month ≤ 1100).
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_usage_team(p_session_token TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_bucket TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); tz CONSTANT TEXT := 'Asia/Seoul';
  bk TEXT := COALESCE(p_bucket, 'day'); m_from TIMESTAMPTZ; f TIMESTAMPTZ; t TIMESTAMPTZ; longest INTERVAL;
BEGIN
 IF NOT public.bae_gyeong_can_review(actor) THEN RAISE EXCEPTION '팀 비용은 관리자와 BAE경 검수자만 볼 수 있습니다.' USING ERRCODE = '42501'; END IF;
 IF bk NOT IN ('day','week','month') THEN RAISE EXCEPTION '비용 표의 기간 단위가 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 m_from := date_trunc('month', now() AT TIME ZONE tz) AT TIME ZONE tz;
 f := COALESCE(p_from, m_from);
 t := COALESCE(p_to, now());
 IF t <= f THEN RAISE EXCEPTION '비용 표의 기간이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 longest := CASE bk WHEN 'day' THEN interval '93 days' WHEN 'week' THEN interval '371 days' ELSE interval '1100 days' END;
 IF t - f > longest THEN RAISE EXCEPTION '비용 표의 기간이 너무 깁니다. 단위를 주나 달로 바꿔 주세요.' USING ERRCODE = '22023'; END IF;
 RETURN jsonb_build_object('from', f, 'to', t, 'bucket', bk, 'tz', tz,
  'periods', (SELECT COALESCE(jsonb_agg(to_char(g, 'YYYY-MM-DD') ORDER BY g), '[]'::jsonb)
    FROM generate_series(date_trunc(bk, f AT TIME ZONE tz), date_trunc(bk, (t - interval '1 microsecond') AT TIME ZONE tz), ('1 ' || bk)::interval) g),
  'rows', (SELECT COALESCE(jsonb_agg(jsonb_build_object('userId', r.user_id, 'userName', COALESCE(u.name, ''), 'period', to_char(r.p, 'YYYY-MM-DD'),
      'kind', r.kind, 'model', r.model, 'n', r.n, 'usd', r.usd) ORDER BY r.user_id, r.p, r.kind, r.model), '[]'::jsonb)
    FROM (SELECT x.user_id, date_trunc(bk, x.created_at AT TIME ZONE tz) AS p, x.kind, x.model, count(*) AS n, sum(x.usd) AS usd
      FROM public.bae_gyeong_usage x WHERE x.created_at >= f AND x.created_at < t GROUP BY 1, 2, 3, 4) r
    LEFT JOIN public.users u ON u.id = r.user_id),
  'total', (SELECT jsonb_build_object('n', count(*), 'usd', COALESCE(sum(x.usd), 0)) FROM public.bae_gyeong_usage x WHERE x.created_at >= f AND x.created_at < t),
  'month', (SELECT jsonb_build_object('from', m_from, 'n', count(*), 'usd', COALESCE(sum(x.usd), 0)) FROM public.bae_gyeong_usage x WHERE x.created_at >= m_from));
END $$;

-- ───────────── lockdown: no direct right on the new tables or the internal functions; only the session wrappers ─────────────
DO $$ DECLARE role_name TEXT; fn REGPROCEDURE; tbl TEXT; BEGIN
 FOREACH tbl IN ARRAY ARRAY['bae_gyeong_stamps','bae_gyeong_stamp_seen'] LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', tbl);
 END LOOP;
 EXECUTE 'REVOKE ALL PRIVILEGES ON SEQUENCE public.bae_gyeong_stamps_id_seq FROM PUBLIC';
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'bae_gyeong_%' LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', fn);
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   FOREACH tbl IN ARRAY ARRAY['bae_gyeong_stamps','bae_gyeong_stamp_seen'] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', tbl, role_name);
   END LOOP;
   EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.bae_gyeong_stamps_id_seq FROM %I', role_name);
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
