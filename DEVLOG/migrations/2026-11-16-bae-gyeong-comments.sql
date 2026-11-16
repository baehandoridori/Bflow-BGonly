-- BAE경 9단계 '코멘트': 기록 한 건 = 댓글 스레드 하나(스레드 이름 bae:{작업 id}). 계획 14 6-2 · 6-3, 14b 11-3 9단계.
-- Prerequisites: DEVLOG/migrations/2026-11-13-bae-gyeong-base.sql · 2026-11-16-bae-gyeong-pc-check.sql · 2026-11-16-bae-gyeong-review.sql
--   (bae_gyeong_jobs · bae_gyeong_stamps · bae_gyeong_actor · bae_gyeong_can_review · bae_gyeong_is_admin · bae_gyeong_signal) and the
--   comment tables + DEVLOG/migrations/2026-11-05-comment-notifications.sql (comment_notifications, its triggers and wrappers).
--
-- What this changes in SHARED tables (everything else is new and named bae_gyeong_*):
--   comments           + one column bae_job_id UUID NULL (FK bae_gyeong_jobs ON DELETE CASCADE), a CHECK that only rows with it carry
--                        the 'baec_' id prefix rule, a partial index, and ONE RESTRICTIVE policy 'bae_gyeong_comments_private'
--                        (USING / WITH CHECK bae_job_id IS NULL, TO PUBLIC). The existing permissive policy (allow_all) is untouched:
--                        restrictive policies only take rows away, so every scene and character comment row stays exactly as reachable
--                        as before, while a BAE comment row is reachable by no role that is subject to RLS (anon, authenticated) —
--                        not by a direct select, not by a realtime postgres_changes event (realtime applies the subscriber's RLS),
--                        and it cannot be inserted or changed through the table either. BAE comment bodies are reached ONLY through
--                        the bae_gyeong_session_comment_* wrappers below (maker or reviewer, decided from the session token).
--   comment_reactions  + ONE RESTRICTIVE policy 'bae_gyeong_comment_reactions_private' (comment_id does not start with 'baec_'):
--                        reactions on BAE comments are read and written only through the wrappers as well.
--   comment_notifications_on_insert / comment_notifications_on_mentions (trigger functions): one branch at the top — a row with a
--                        bae_job_id goes to bae_gyeong_comment_notify(); every other row takes the very same call as before.
--   comment_notifications_session_list: the comment object also carries 'baeJobId' (null for scene and character comments), and a
--                        BAE row is listed only while its recipient may still read that thread.
--   Nothing else: comment_notifications_recipients · _fanout · _names · _on_delete · _session_mark_read, the reaction notification
--   functions, the thread to-dos, every existing policy, grant, trigger and the realtime publication stay as they are.
--   Before replacing the three functions above this file checks that their bodies are the production ones (md5 of 2026-11-16) or
--   this file's own, and stops otherwise — it never overwrites a version it was not written against.
-- Who gets a notification for a BAE comment (bae_gyeong_comment_notify, TypeScript twin in src/shared/commentNotificationRecipients.ts —
--   change both): mention (named with @ and allowed to read the thread) > reply (the parent's author) > the job's maker
--   (reason 'auto', detail 'assignee': the person the record belongs to; the CHECK on comment_notifications is not changed) >
--   anyone else who wrote in the thread (auto · participant). Never the writer, never someone who may not read the thread.
--   A mention of someone who may not read the thread is dropped when the comment is saved (it is not stored either).
-- Stamps (plan 14 6-2, stage 9): a 좋아요 or 다시 stamp also leaves a one-line comment by the stamper in the job's thread (trigger on
--   bae_gyeong_stamps), so it rides the bell like any comment. 확인함 stays quiet; taking a stamp back writes nothing. A failure to write
--   that line never blocks the stamp.
-- Realtime: no table goes into the publication. A change sends the contentless 'comments-changed' on channel 'bae-gyeong-comments';
--   the notification rows keep the existing contentless 'comment-notifications-changed' on 'bflow-realtime'.
-- Conflicts are raised with PT409, never 40001 / 40P01 (the Data API retries those by itself and the caller never gets an answer).
-- Rerunning this file is safe (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS); it keeps data. If 2026-11-05-comment-notifications.sql
--   is ever rerun, rerun this file after it (that file puts the three functions back without the BAE branch).
-- Undo: DEVLOG/migrations/2026-11-16-bae-gyeong-comments-rollback.sql. Dry run: DEVLOG/verification/2026-11-16-bae-gyeong-comments-smoke.sql.
-- Function bodies here carry no '--' comments (the apply tool strips them, which would change md5(prosrc)).
-- After applying, md5(prosrc): comment_notifications_on_insert c00f1da6204c908f6ccc06cdbc31150f · _on_mentions 7be5c193ecd42521e6cb7bb9ffb95f4d ·
--   _session_list 9ece94abbd77d43a833e46a690258610; 17 new bae_gyeong_* functions (58 in all with base + pc-check + review). Every other comment
--   function keeps its production md5 (C:\BAE_stage0\comments_port\prod_shape.md). After the rollback the three are c1653f8c… · 987f05de… · a0bd8a79….
-- Not yet applied anywhere (2026-11-16): dev branch first (on DEVLOG/verification/2026-11-16-bae-gyeong-dev-comments-base.sql), production
--   only with Hansol's OK, after a rolled-back dry run (body + DEVLOG/verification/2026-11-16-bae-gyeong-comments-smoke.sql → 'BAE COMMENTS SMOKE OK').
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ───────────── guards ─────────────
DO $$
DECLARE f TEXT; want TEXT; src TEXT; owner_ok BOOLEAN;
BEGIN
 IF to_regclass('public.bae_gyeong_jobs') IS NULL OR to_regclass('public.bae_gyeong_stamps') IS NULL OR to_regclass('public.comments') IS NULL
    OR to_regclass('public.comment_reactions') IS NULL OR to_regclass('public.comment_notifications') IS NULL THEN
  RAISE EXCEPTION 'BAE경 코멘트: 먼저 BAE경 기본 · 8단계 SQL 과 댓글 알림 SQL(2026-11-05)이 있어야 합니다.';
 END IF;
 FOREACH f IN ARRAY ARRAY['comment_notifications_on_insert()', 'comment_notifications_on_mentions()',
   'comment_notifications_session_list(text,timestamp with time zone,uuid,integer)'] LOOP
  want := CASE f WHEN 'comment_notifications_on_insert()' THEN 'c1653f8c22b65b84efb865b299ea828a'
    WHEN 'comment_notifications_on_mentions()' THEN '987f05de601b36e989a4af849a9b9a53' ELSE 'a0bd8a79a9fd91e9405d63b2b24b962e' END;
  SELECT p.prosrc INTO src FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || f);
  IF src IS NULL THEN RAISE EXCEPTION 'BAE경 코멘트: %이(가) 없습니다.', f; END IF;
  IF md5(src) <> want AND position('bae_gyeong_comment' IN src) = 0 THEN
   RAISE EXCEPTION 'BAE경 코멘트: %의 본문이 이 파일이 기대한 운영 본문과 다릅니다. 덮어쓰지 않고 멈춥니다.', f;
  END IF;
 END LOOP;
 IF (SELECT c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'public.comments'::regclass) THEN
  RAISE EXCEPTION 'BAE경 코멘트: comments 가 FORCE ROW LEVEL SECURITY 입니다. 래퍼가 BAE 댓글을 읽지 못하니 멈춥니다.';
 END IF;
 SELECT pg_has_role(current_user, c.relowner, 'MEMBER') OR r.rolsuper OR r.rolbypassrls INTO owner_ok
  FROM pg_class c, pg_roles r WHERE c.oid = 'public.comments'::regclass AND r.rolname = current_user;
 IF NOT owner_ok THEN RAISE EXCEPTION 'BAE경 코멘트: comments 의 주인(또는 RLS 우회 역할)으로 실행해야 합니다.'; END IF;
END $$;

-- ───────────── the one column (+ its rule and index) ─────────────
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS bae_job_id UUID NULL REFERENCES public.bae_gyeong_jobs(id) ON DELETE CASCADE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid = 'public.comments'::regclass AND conname = 'comments_bae_job_id_prefix') THEN
  ALTER TABLE public.comments ADD CONSTRAINT comments_bae_job_id_prefix CHECK (bae_job_id IS NULL OR left(id, 5) = 'baec_') NOT VALID;
  ALTER TABLE public.comments VALIDATE CONSTRAINT comments_bae_job_id_prefix;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_comments_bae_job ON public.comments (bae_job_id, created_at) WHERE bae_job_id IS NOT NULL;
COMMENT ON COLUMN public.comments.bae_job_id IS
  'BAE경 9단계: 이 댓글이 달린 BAE경 기록(작업 id). 값이 있는 줄은 bae_gyeong_comments_private 정책으로 표에서 보이지 않고 bae_gyeong_session_comment_* 래퍼로만 읽고 쓴다.';

-- ───────────── the two restrictive policies (take BAE rows away; never add anything) ─────────────
DROP POLICY IF EXISTS bae_gyeong_comments_private ON public.comments;
CREATE POLICY bae_gyeong_comments_private ON public.comments AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (bae_job_id IS NULL) WITH CHECK (bae_job_id IS NULL);
DROP POLICY IF EXISTS bae_gyeong_comment_reactions_private ON public.comment_reactions;
CREATE POLICY bae_gyeong_comment_reactions_private ON public.comment_reactions AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (left(comment_id, 5) <> 'baec_') WITH CHECK (left(comment_id, 5) <> 'baec_');

-- ───────────── internal (no role is granted them) ─────────────
-- Who may read and write a job's thread: its maker and reviewers (admins + 'BAE경 검수자'), as for the job itself.
CREATE OR REPLACE FUNCTION public.bae_gyeong_comment_can_read(actor TEXT, job UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id = actor)
   AND (EXISTS(SELECT 1 FROM public.bae_gyeong_jobs j WHERE j.id = job AND j.user_id = actor) OR public.bae_gyeong_can_review(actor))
$$;
-- The people who may read a job's thread (the @ list of the panel, and what a mention may name). Only id and name of users.
CREATE OR REPLACE FUNCTION public.bae_gyeong_comment_audience(job UUID)
RETURNS TABLE(id TEXT, name TEXT) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT u.id, u.name FROM public.users u
  WHERE EXISTS(SELECT 1 FROM public.bae_gyeong_jobs j WHERE j.id = job AND j.user_id = u.id) OR public.bae_gyeong_can_review(u.id)
$$;
CREATE OR REPLACE FUNCTION public.bae_gyeong_comment_id_ok(p TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT COALESCE(p ~ '^baec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
$$;
-- One comment as the panel reads it (the same shape as the character thread's rows).
CREATE OR REPLACE FUNCTION public.bae_gyeong_comment_json(c public.comments)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT jsonb_build_object('id', c.id, 'baeJobId', c.bae_job_id, 'userId', c.user_id, 'userName', c.user_name, 'text', c.text,
   'mentions', CASE WHEN jsonb_typeof(c.mentions) = 'array' THEN c.mentions ELSE '[]'::jsonb END,
   'images', CASE WHEN jsonb_typeof(c.images) = 'array' THEN c.images ELSE '[]'::jsonb END,
   'parentCommentId', c.parent_comment_id, 'createdAt', c.created_at, 'editedAt', c.edited_at)
$$;
CREATE OR REPLACE FUNCTION public.bae_gyeong_comment_reactions_json(p_comment_id TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'commentId', r.comment_id, 'userId', r.user_id, 'userName', r.user_name,
   'emoji', r.emoji, 'createdAt', r.created_at) ORDER BY r.created_at, r.id), '[]'::jsonb)
  FROM public.comment_reactions r WHERE r.comment_id = p_comment_id
$$;
-- The words, the names and the pictures of a comment, checked. Mentions keep only names of people who may read the thread;
-- pictures must be comment pictures of this job in the app's bucket (bae/{job}/comments/…), at most 10.
CREATE OR REPLACE FUNCTION public.bae_gyeong_comment_clean(job UUID, p_text TEXT, p_mentions JSONB, p_images JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE t TEXT := COALESCE(p_text, ''); m JSONB := COALESCE(p_mentions, '[]'::jsonb); i JSONB := COALESCE(p_images, '[]'::jsonb); pat TEXT; kept JSONB;
BEGIN
 IF length(t) > 5000 THEN RAISE EXCEPTION '댓글은 5000자까지 쓸 수 있습니다.' USING ERRCODE = '22023'; END IF;
 IF jsonb_typeof(m) <> 'array' OR jsonb_array_length(m) > 30
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(m) e WHERE jsonb_typeof(e) <> 'string' OR length(e #>> '{}') NOT BETWEEN 1 AND 100) THEN
  RAISE EXCEPTION '댓글의 멘션이 올바르지 않습니다.' USING ERRCODE = '22023';
 END IF;
 pat := '^https?://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/scene-images/bae/' || job::text || '/comments/[A-Za-z0-9_.-]{1,160}$';
 IF jsonb_typeof(i) <> 'array' OR jsonb_array_length(i) > 10
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(i) e WHERE jsonb_typeof(e) <> 'string' OR NOT ((e #>> '{}') ~ pat)) THEN
  RAISE EXCEPTION '댓글 그림이 올바르지 않습니다.' USING ERRCODE = '22023';
 END IF;
 IF btrim(t) = '' AND jsonb_array_length(i) = 0 THEN RAISE EXCEPTION '댓글 내용을 적어 주세요.' USING ERRCODE = '22023'; END IF;
 SELECT COALESCE(jsonb_agg(x.n ORDER BY x.o), '[]'::jsonb) INTO kept FROM (
  SELECT DISTINCT ON (e.n) e.n, e.o FROM jsonb_array_elements_text(m) WITH ORDINALITY AS e(n, o)
   WHERE EXISTS(SELECT 1 FROM public.bae_gyeong_comment_audience(job) a WHERE a.name = e.n) ORDER BY e.n, e.o) x;
 RETURN jsonb_build_object('text', t, 'mentions', kept, 'images', i);
END $$;
-- The people a set of names reaches in this thread (for the Slack note of the writer's app), never the writer.
CREATE OR REPLACE FUNCTION public.bae_gyeong_comment_reached(job UUID, p_names JSONB, actor TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT COALESCE(jsonb_agg(DISTINCT a.id), '[]'::jsonb) FROM public.bae_gyeong_comment_audience(job) a
  WHERE a.id <> actor AND a.name IN (SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_names) = 'array' THEN p_names ELSE '[]'::jsonb END))
$$;
-- A contentless signal on the BAE comment channel. A failed signal never undoes a save: the panels catch up on their next read.
CREATE OR REPLACE FUNCTION public.bae_gyeong_comment_signal()
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
 IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
  EXECUTE 'SELECT realtime.send($1,$2,$3,$4)' USING '{}'::jsonb, 'comments-changed', 'bae-gyeong-comments', false;
 END IF;
EXCEPTION WHEN OTHERS THEN
 RAISE WARNING '[bae-gyeong] 코멘트 신호 전송 실패: %', SQLERRM;
END $$;
-- The notification rows of one BAE comment (called by the comments triggers below). 'add': the rule in the header, one row per person
-- (the strongest reason). 'edit': the names newly added by an edit, as mention rows (the same row again is refreshed unread).
-- New rows send the existing contentless 'comment-notifications-changed' so the bell reads again.
CREATE OR REPLACE FUNCTION public.bae_gyeong_comment_notify(p_comment_id TEXT, p_kind TEXT, p_added_names TEXT[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE c public.comments; n INTEGER := 0;
BEGIN
 SELECT * INTO c FROM public.comments WHERE id = p_comment_id;
 IF NOT FOUND OR c.bae_job_id IS NULL OR c.user_id IS NULL THEN RETURN 0; END IF;
 IF p_kind = 'add' THEN
  INSERT INTO public.comment_notifications (recipient_id, comment_id, kind, reason, detail, actor_id)
  SELECT DISTINCT ON (k.rid) k.rid, c.id, 'add', k.reason, k.detail, c.user_id
   FROM (
    SELECT u.id AS rid, 'mention'::TEXT AS reason, NULL::TEXT AS detail, 1 AS rank
     FROM public.users u WHERE u.name = ANY (public.comment_notifications_names(c.mentions))
    UNION ALL
    SELECT p.user_id, 'reply', NULL, 2 FROM public.comments p WHERE p.id = c.parent_comment_id AND p.bae_job_id = c.bae_job_id
    UNION ALL
    SELECT j.user_id, 'auto', 'assignee', 3 FROM public.bae_gyeong_jobs j WHERE j.id = c.bae_job_id
    UNION ALL
    SELECT o.user_id, 'auto', 'participant', 5 FROM public.comments o WHERE o.bae_job_id = c.bae_job_id AND o.id <> c.id
   ) k
   WHERE k.rid IS NOT NULL AND k.rid <> c.user_id AND public.bae_gyeong_comment_can_read(k.rid, c.bae_job_id)
   ORDER BY k.rid, k.rank
  ON CONFLICT ON CONSTRAINT comment_notifications_once DO NOTHING;
 ELSIF p_kind = 'edit' THEN
  INSERT INTO public.comment_notifications (recipient_id, comment_id, kind, reason, detail, actor_id, event_at, edit_at)
  SELECT DISTINCT u.id, c.id, 'edit', 'mention', NULL, c.user_id, now(), c.edited_at
   FROM public.users u
   WHERE u.name = ANY (COALESCE(p_added_names, ARRAY[]::TEXT[])) AND u.id <> c.user_id AND public.bae_gyeong_comment_can_read(u.id, c.bae_job_id)
  ON CONFLICT ON CONSTRAINT comment_notifications_once
   DO UPDATE SET reason = 'mention', detail = NULL, actor_id = EXCLUDED.actor_id, event_at = EXCLUDED.event_at,
                 edit_at = EXCLUDED.edit_at, read_at = NULL;
 ELSE
  RETURN 0;
 END IF;
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n > 0 THEN
  BEGIN
   IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    EXECUTE 'SELECT realtime.send($1,$2,$3,$4)' USING '{}'::JSONB, 'comment-notifications-changed', 'bflow-realtime', false;
   END IF;
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING '[bae-gyeong] 코멘트 알림 신호 전송 실패: %', SQLERRM;
  END;
 END IF;
 RETURN n;
END $$;
CREATE OR REPLACE FUNCTION public.bae_gyeong_stamp_comment_text(p_stamp TEXT, p_note TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT CASE p_stamp WHEN 'good' THEN '좋아요 도장을 찍었어요.' ELSE '다시 도장을 찍었어요.' END
   || CASE WHEN NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN '' ELSE E'\n' || btrim(p_note) END
$$;
-- 좋아요 · 다시 stamp → one comment line by the stamper in the job's thread. Every error is swallowed (the stamp is saved anyway).
CREATE OR REPLACE FUNCTION public.bae_gyeong_stamp_comment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uname TEXT;
BEGIN
 IF NEW.stamp IN ('good', 'again') THEN
  BEGIN
   SELECT u.name INTO uname FROM public.users u WHERE u.id = NEW.stamped_by;
   IF FOUND THEN
    INSERT INTO public.comments (id, part_id, scene_id, user_id, user_name, text, mentions, images, bae_job_id, created_at)
    VALUES ('baec_' || gen_random_uuid()::text, NULL, NULL, NEW.stamped_by, COALESCE(uname, ''),
      public.bae_gyeong_stamp_comment_text(NEW.stamp, NEW.note), '[]'::jsonb, '[]'::jsonb, NEW.job_id, NEW.stamped_at);
    PERFORM public.bae_gyeong_comment_signal();
   END IF;
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING '[bae-gyeong] 도장 코멘트를 남기지 못했습니다(도장은 저장됨): %', SQLERRM;
  END;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS bae_gyeong_stamp_comment ON public.bae_gyeong_stamps;
CREATE TRIGGER bae_gyeong_stamp_comment AFTER INSERT ON public.bae_gyeong_stamps
  FOR EACH ROW EXECUTE FUNCTION public.bae_gyeong_stamp_comment();

-- ───────────── the shared comment triggers: one BAE branch each ─────────────
CREATE OR REPLACE FUNCTION public.comment_notifications_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    IF NEW.bae_job_id IS NOT NULL THEN
      PERFORM public.bae_gyeong_comment_notify(NEW.id, 'add', NULL);
    ELSE
      PERFORM public.comment_notifications_fanout(NEW.id, 'add', NULL, NULL, true);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[comment-notifications] 새 댓글 알림 만들기 실패(댓글은 저장됨): %', SQLERRM;
  END;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.comment_notifications_on_mentions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_added TEXT[];
BEGIN
  BEGIN
    v_added := ARRAY(
      SELECT DISTINCT n FROM unnest(public.comment_notifications_names(NEW.mentions)) n
       WHERE NOT (n = ANY (public.comment_notifications_names(OLD.mentions)))
    );
    IF cardinality(v_added) > 0 THEN
      IF NEW.bae_job_id IS NOT NULL THEN
        PERFORM public.bae_gyeong_comment_notify(NEW.id, 'edit', v_added);
      ELSE
        PERFORM public.comment_notifications_fanout(NEW.id, 'edit', v_added, NULL, true);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[comment-notifications] 수정 멘션 알림 만들기 실패(수정은 저장됨): %', SQLERRM;
  END;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.comment_notifications_session_list(
  p_session_token TEXT, p_after_at TIMESTAMPTZ, p_after_id UUID, p_limit INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_limit INTEGER;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  PERFORM 1 FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  RETURN COALESCE((
    SELECT jsonb_agg(s.item ORDER BY s.event_at, s.id)
      FROM (
        SELECT n.event_at, n.id, jsonb_build_object(
                 'id', n.id, 'commentId', n.comment_id, 'kind', n.kind, 'reason', n.reason, 'detail', n.detail,
                 'eventAt', n.event_at, 'editAt', n.edit_at, 'readAt', n.read_at, 'revisionNo', r.revision_no,
                 'comment', jsonb_build_object(
                   'partId', c.part_id, 'sceneId', c.scene_id, 'sceneUuid', c.scene_uuid,
                   'userId', c.user_id, 'userName', c.user_name, 'text', c.text,
                   'mentions', CASE WHEN jsonb_typeof(c.mentions) = 'array' THEN c.mentions ELSE '[]'::JSONB END,
                   'imageCount', CASE WHEN jsonb_typeof(c.images) = 'array' THEN jsonb_array_length(c.images) ELSE 0 END,
                   'parentCommentId', c.parent_comment_id, 'revisionId', c.revision_id, 'characterId', c.character_id,
                   'baeJobId', c.bae_job_id,
                   'createdAt', c.created_at, 'editedAt', c.edited_at)
               ) AS item
          FROM public.comment_notifications n
          JOIN public.comments c ON c.id = n.comment_id
          LEFT JOIN public.comp_revisions r ON r.id = c.revision_id
         WHERE n.recipient_id = v_user
           AND (c.bae_job_id IS NULL OR public.bae_gyeong_comment_can_read(v_user, c.bae_job_id))
           AND (p_after_at IS NULL
                OR n.event_at > p_after_at
                OR (p_after_id IS NOT NULL AND n.event_at = p_after_at AND n.id > p_after_id))
         ORDER BY n.event_at, n.id
         LIMIT v_limit
      ) s
  ), '[]'::JSONB);
END $$;

-- ───────────── session wrappers ─────────────
-- One job's thread for its maker or a reviewer: the comments (oldest first, at most 2000), who may be named with @ in it, and whether
-- the reader may remove other people's comments (Bflow admins).
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_comment_list(p_session_token TEXT, p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.bae_gyeong_jobs j WHERE j.id = p_job_id) THEN RAISE EXCEPTION 'BAE경 작업 기록을 찾을 수 없습니다.' USING ERRCODE = 'P0002'; END IF;
 IF NOT public.bae_gyeong_comment_can_read(actor, p_job_id) THEN RAISE EXCEPTION '이 BAE경 기록의 코멘트는 만든 사람과 검수자만 볼 수 있습니다.' USING ERRCODE = '42501'; END IF;
 RETURN jsonb_build_object(
  'comments', COALESCE((SELECT jsonb_agg(public.bae_gyeong_comment_json(c) ORDER BY c.created_at, c.id) FROM public.comments c
    WHERE c.id IN (SELECT x.id FROM public.comments x WHERE x.bae_job_id = p_job_id ORDER BY x.created_at DESC, x.id DESC LIMIT 2000)), '[]'::jsonb),
  'audience', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) ORDER BY a.name, a.id) FROM public.bae_gyeong_comment_audience(p_job_id) a), '[]'::jsonb),
  'canModerate', public.bae_gyeong_is_admin(actor),
  'serverTime', now());
END $$;

-- A new comment (or a reply) in a job's thread. The server decides who wrote it and when; the PC sends the id it already shows
-- ('baec_' + a UUID), the words, the @ names and the picture addresses. The same id again from the same writer in the same thread is the
-- same comment (a retry after a lost answer). The answer carries the saved comment and who the @ names reached (for the Slack note).
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_comment_add(p_session_token TEXT, p_job_id UUID, p_comment JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); cid TEXT; parent TEXT; body JSONB; cur public.comments; saved public.comments; uname TEXT;
BEGIN
 IF p_comment IS NULL OR jsonb_typeof(p_comment) <> 'object' OR length(p_comment::text) > 60000 THEN RAISE EXCEPTION '댓글 모양이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bae_gyeong_jobs j WHERE j.id = p_job_id) THEN RAISE EXCEPTION 'BAE경 작업 기록을 찾을 수 없습니다.' USING ERRCODE = 'P0002'; END IF;
 IF NOT public.bae_gyeong_comment_can_read(actor, p_job_id) THEN RAISE EXCEPTION '이 BAE경 기록에는 만든 사람과 검수자만 코멘트를 남길 수 있습니다.' USING ERRCODE = '42501'; END IF;
 cid := p_comment->>'id';
 IF NOT public.bae_gyeong_comment_id_ok(cid) THEN RAISE EXCEPTION '댓글 번호가 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 IF p_comment ? 'parentCommentId' AND jsonb_typeof(p_comment->'parentCommentId') NOT IN ('string', 'null') THEN RAISE EXCEPTION '댓글 모양이 올바르지 않습니다.' USING ERRCODE = '22023'; END IF;
 parent := NULLIF(p_comment->>'parentCommentId', '');
 body := public.bae_gyeong_comment_clean(p_job_id, p_comment->>'text', p_comment->'mentions', p_comment->'images');
 SELECT * INTO cur FROM public.comments WHERE id = cid;
 IF FOUND THEN
  IF cur.bae_job_id IS DISTINCT FROM p_job_id OR cur.user_id <> actor THEN RAISE EXCEPTION '같은 번호의 댓글이 이미 있습니다.' USING ERRCODE = 'PT409'; END IF;
  RETURN jsonb_build_object('comment', public.bae_gyeong_comment_json(cur), 'mentioned', public.bae_gyeong_comment_reached(p_job_id, cur.mentions, actor), 'duplicate', true);
 END IF;
 IF parent IS NOT NULL AND (parent = cid OR NOT EXISTS(SELECT 1 FROM public.comments p WHERE p.id = parent AND p.bae_job_id = p_job_id)) THEN
  RAISE EXCEPTION '답글을 달 댓글을 찾을 수 없습니다.' USING ERRCODE = 'P0002';
 END IF;
 SELECT u.name INTO uname FROM public.users u WHERE u.id = actor;
 INSERT INTO public.comments (id, part_id, scene_id, user_id, user_name, text, mentions, images, parent_comment_id, bae_job_id, created_at)
 VALUES (cid, NULL, NULL, actor, COALESCE(uname, ''), body->>'text', body->'mentions', body->'images', parent, p_job_id, now())
 RETURNING * INTO saved;
 PERFORM public.bae_gyeong_comment_signal();
 RETURN jsonb_build_object('comment', public.bae_gyeong_comment_json(saved), 'mentioned', public.bae_gyeong_comment_reached(p_job_id, body->'mentions', actor), 'duplicate', false);
END $$;

-- The writer changes their comment: words and @ names, and the pictures when p_images is not NULL. The answer carries who the newly
-- added @ names reached.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_comment_edit(p_session_token TEXT, p_comment_id TEXT, p_text TEXT, p_mentions JSONB, p_images JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); cur public.comments; saved public.comments; body JSONB; added JSONB;
BEGIN
 SELECT * INTO cur FROM public.comments WHERE id = p_comment_id FOR UPDATE;
 IF NOT FOUND OR cur.bae_job_id IS NULL THEN RAISE EXCEPTION '댓글을 찾을 수 없습니다.' USING ERRCODE = 'P0002'; END IF;
 IF NOT public.bae_gyeong_comment_can_read(actor, cur.bae_job_id) THEN RAISE EXCEPTION '이 BAE경 기록의 코멘트는 만든 사람과 검수자만 볼 수 있습니다.' USING ERRCODE = '42501'; END IF;
 IF cur.user_id <> actor THEN RAISE EXCEPTION '내가 쓴 댓글만 고칠 수 있습니다.' USING ERRCODE = '42501'; END IF;
 body := public.bae_gyeong_comment_clean(cur.bae_job_id, p_text, p_mentions, COALESCE(p_images, cur.images));
 SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO added FROM jsonb_array_elements_text(body->'mentions') x
  WHERE NOT (x = ANY (public.comment_notifications_names(cur.mentions)));
 UPDATE public.comments SET text = body->>'text', mentions = body->'mentions', images = body->'images', edited_at = now()
  WHERE id = p_comment_id RETURNING * INTO saved;
 PERFORM public.bae_gyeong_comment_signal();
 RETURN jsonb_build_object('comment', public.bae_gyeong_comment_json(saved), 'addedMentioned', public.bae_gyeong_comment_reached(cur.bae_job_id, added, actor));
END $$;

-- The writer (or a Bflow admin) removes a comment. Its replies stay as comments of the thread (the parent link is cleared, as for
-- scene comments), its reactions and notification rows go with it. A comment already gone answers deleted:false.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_comment_delete(p_session_token TEXT, p_comment_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); cur public.comments;
BEGIN
 SELECT * INTO cur FROM public.comments WHERE id = p_comment_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('deleted', false); END IF;
 IF cur.bae_job_id IS NULL THEN RAISE EXCEPTION '댓글을 찾을 수 없습니다.' USING ERRCODE = 'P0002'; END IF;
 IF NOT public.bae_gyeong_comment_can_read(actor, cur.bae_job_id) THEN RAISE EXCEPTION '이 BAE경 기록의 코멘트는 만든 사람과 검수자만 볼 수 있습니다.' USING ERRCODE = '42501'; END IF;
 IF cur.user_id <> actor AND NOT public.bae_gyeong_is_admin(actor) THEN RAISE EXCEPTION '내가 쓴 댓글만 지울 수 있습니다.' USING ERRCODE = '42501'; END IF;
 DELETE FROM public.comments WHERE id = p_comment_id;
 PERFORM public.bae_gyeong_comment_signal();
 RETURN jsonb_build_object('deleted', true, 'images', CASE WHEN jsonb_typeof(cur.images) = 'array' THEN cur.images ELSE '[]'::jsonb END);
END $$;

-- An emoji reaction on a BAE comment, on or off, by the reader. The answer is that comment's reactions.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_comment_react(p_session_token TEXT, p_comment_id TEXT, p_emoji TEXT, p_on BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token); job UUID; uname TEXT;
BEGIN
 SELECT c.bae_job_id INTO job FROM public.comments c WHERE c.id = p_comment_id;
 IF job IS NULL THEN RAISE EXCEPTION '댓글을 찾을 수 없습니다.' USING ERRCODE = 'P0002'; END IF;
 IF NOT public.bae_gyeong_comment_can_read(actor, job) THEN RAISE EXCEPTION '이 BAE경 기록의 코멘트는 만든 사람과 검수자만 볼 수 있습니다.' USING ERRCODE = '42501'; END IF;
 IF p_emoji IS NULL OR length(p_emoji) NOT BETWEEN 1 AND 32 OR p_emoji ~ '[[:space:][:cntrl:]]' OR p_on IS NULL THEN
  RAISE EXCEPTION '반응이 올바르지 않습니다.' USING ERRCODE = '22023';
 END IF;
 IF p_on THEN
  SELECT u.name INTO uname FROM public.users u WHERE u.id = actor;
  INSERT INTO public.comment_reactions (comment_id, user_id, user_name, emoji) VALUES (p_comment_id, actor, COALESCE(uname, ''), p_emoji)
  ON CONFLICT (comment_id, user_id, emoji) DO NOTHING;
 ELSE
  DELETE FROM public.comment_reactions WHERE comment_id = p_comment_id AND user_id = actor AND emoji = p_emoji;
 END IF;
 PERFORM public.bae_gyeong_comment_signal();
 RETURN public.bae_gyeong_comment_reactions_json(p_comment_id);
END $$;

-- The reactions of many BAE comments at once (at most 500 ids), only of threads the reader may read: { commentId: [reaction…] }.
CREATE OR REPLACE FUNCTION public.bae_gyeong_session_comment_reactions(p_session_token TEXT, p_comment_ids TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token);
BEGIN
 IF COALESCE(cardinality(p_comment_ids), 0) > 500 THEN RAISE EXCEPTION '한 번에 읽을 수 있는 반응은 댓글 500개까지예요.' USING ERRCODE = '22023'; END IF;
 RETURN COALESCE((SELECT jsonb_object_agg(c.id, public.bae_gyeong_comment_reactions_json(c.id))
  FROM public.comments c
  WHERE c.id = ANY (COALESCE(p_comment_ids, ARRAY[]::TEXT[])) AND c.bae_job_id IS NOT NULL
    AND public.bae_gyeong_comment_can_read(actor, c.bae_job_id)), '{}'::jsonb);
END $$;

COMMENT ON FUNCTION public.bae_gyeong_comment_notify(TEXT, TEXT, TEXT[]) IS '내부 전용: BAE경 기록 댓글의 알림 줄(멘션 > 답글 > 만든 사람 > 참여자, 스레드를 볼 수 있는 사람만).';
COMMENT ON FUNCTION public.bae_gyeong_session_comment_list(TEXT, UUID) IS '세션 토큰으로 호출자를 확정한 뒤 BAE경 기록 한 건의 댓글(만든 사람 · 검수자만)을 돌려주는 래퍼.';

-- ───────────── rights: the shared trigger functions as before; BAE internals to nobody, BAE session wrappers to anon/authenticated ─────────────
DO $$ DECLARE role_name TEXT; fn REGPROCEDURE; BEGIN
 REVOKE ALL PRIVILEGES ON FUNCTION public.comment_notifications_on_insert(), public.comment_notifications_on_mentions(),
   public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER) FROM PUBLIC;
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'bae_gyeong_%' LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', fn);
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.comment_notifications_on_insert(), public.comment_notifications_on_mentions() FROM %I', role_name);
   FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'bae_gyeong_%' LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I', fn, role_name);
   END LOOP;
   FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'bae_gyeong_session_%' LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn, role_name);
   END LOOP;
  END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER) TO %I', role_name);
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
