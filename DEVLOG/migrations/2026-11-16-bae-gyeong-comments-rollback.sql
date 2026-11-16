-- 되돌리기: DEVLOG/migrations/2026-11-16-bae-gyeong-comments.sql (BAE경 9단계 코멘트)이 바꾼 것을 정확히 그만큼 되돌린다.
-- 두 번 돌려도 안전하다(이미 되돌린 것은 건너뛴다). 씬 · 캐릭터 댓글과 그 반응 · 알림 줄 · 정책 · 권한은 건드리지 않는다.
--
-- 순서(이 순서가 중요하다 — 트리거 함수가 bae_job_id 칸을 읽는 채로 칸을 지우면 모든 댓글의 알림이 조용히 멈춘다):
--   1) 공용 함수 셋(comment_notifications_on_insert · _on_mentions · _session_list)을 2026-11-05 파일 본문(= 운영 본문, md5 c1653f8c… ·
--      987f05de… · a0bd8a79…) 그대로 되돌린다. 지금 본문이 9단계 본문도 원래 본문도 아니면(누가 그 뒤 고쳤으면) 손대지 않고 멈춘다.
--   2) 도장 → 코멘트 트리거와 그 함수를 지운다.
--   3) BAE 댓글을 보관한다: 각 댓글 줄과 그 반응을 public.bae_gyeong_comment_archive(RLS on, 정책 없음, anon · authenticated 권한 없음)에
--      JSON 으로 옮겨 둔다. 그다음 comments 에서 BAE 댓글을 지운다 — 반응은 FK 로 함께, 알림 줄은 삭제 트리거로 함께 지워진다.
--      ※ BAE 댓글은 화면에서 사라진다. 다시 9단계를 적용해도 자동으로 돌아오지 않는다(되살리려면 보관 표에서 손으로 — 그때 알림이
--        다시 가지 않도록 주의). 보관 표는 지우지 않는다(데이터를 지우지 않는 되돌리기).
--   4) 두 RESTRICTIVE 정책(bae_gyeong_comments_private · bae_gyeong_comment_reactions_private)을 지운다. 기존 allow_all 정책은 그대로다.
--   5) CHECK · 색인 · bae_job_id 칸을 지운다.
--   6) 9단계가 만든 bae_gyeong_comment* · bae_gyeong_session_comment_* · bae_gyeong_stamp_comment* 함수를 지운다.
-- 되돌린 뒤 앱: 새 앱의 BAE 댓글 칸은 '서버 준비가 필요해요'로 보이고, 씬 · 캐릭터 댓글과 알림은 예전 그대로 돈다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1) 공용 함수 셋 — 지금 본문이 9단계 것이거나 이미 원래 것일 때만.
DO $$
DECLARE f TEXT; src TEXT; want TEXT;
BEGIN
 FOREACH f IN ARRAY ARRAY['comment_notifications_on_insert()', 'comment_notifications_on_mentions()',
   'comment_notifications_session_list(text,timestamp with time zone,uuid,integer)'] LOOP
  want := CASE f WHEN 'comment_notifications_on_insert()' THEN 'c1653f8c22b65b84efb865b299ea828a'
    WHEN 'comment_notifications_on_mentions()' THEN '987f05de601b36e989a4af849a9b9a53' ELSE 'a0bd8a79a9fd91e9405d63b2b24b962e' END;
  SELECT p.prosrc INTO src FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || f);
  IF src IS NOT NULL AND md5(src) <> want AND position('bae_gyeong_comment' IN src) = 0 THEN
   RAISE EXCEPTION 'BAE경 코멘트 되돌리기: %의 본문이 9단계 본문도 원래 본문도 아닙니다. 누가 고쳤는지 먼저 확인해 주세요.', f;
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.comment_notifications_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.comment_notifications_fanout(NEW.id, 'add', NULL, NULL, true);
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
      PERFORM public.comment_notifications_fanout(NEW.id, 'edit', v_added, NULL, true);
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
                   'createdAt', c.created_at, 'editedAt', c.edited_at)
               ) AS item
          FROM public.comment_notifications n
          JOIN public.comments c ON c.id = n.comment_id
          LEFT JOIN public.comp_revisions r ON r.id = c.revision_id
         WHERE n.recipient_id = v_user
           AND (p_after_at IS NULL
                OR n.event_at > p_after_at
                OR (p_after_id IS NOT NULL AND n.event_at = p_after_at AND n.id > p_after_id))
         ORDER BY n.event_at, n.id
         LIMIT v_limit
      ) s
  ), '[]'::JSONB);
END $$;

DO $$ DECLARE role_name TEXT; BEGIN
 REVOKE ALL PRIVILEGES ON FUNCTION public.comment_notifications_on_insert(), public.comment_notifications_on_mentions(),
   public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER) FROM PUBLIC;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.comment_notifications_on_insert(), public.comment_notifications_on_mentions() FROM %I', role_name);
  END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER) TO %I', role_name);
  END IF;
 END LOOP;
END $$;

-- 2) 도장 → 코멘트
DO $$ BEGIN
 IF to_regclass('public.bae_gyeong_stamps') IS NOT NULL THEN
  EXECUTE 'DROP TRIGGER IF EXISTS bae_gyeong_stamp_comment ON public.bae_gyeong_stamps';
 END IF;
END $$;

-- 3) BAE 댓글 보관 → 지우기
CREATE TABLE IF NOT EXISTS public.bae_gyeong_comment_archive (
  id TEXT PRIMARY KEY,
  job_id UUID,
  comment_row JSONB NOT NULL,
  reactions JSONB NOT NULL DEFAULT '[]'::jsonb,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bae_gyeong_comment_archive ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE role_name TEXT; BEGIN
 REVOKE ALL PRIVILEGES ON TABLE public.bae_gyeong_comment_archive FROM PUBLIC;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.bae_gyeong_comment_archive FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid = 'public.comments'::regclass AND attname = 'bae_job_id' AND NOT attisdropped) THEN
  EXECUTE $q$
   INSERT INTO public.bae_gyeong_comment_archive (id, job_id, comment_row, reactions)
   SELECT c.id, c.bae_job_id, to_jsonb(c),
     COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id) FROM public.comment_reactions r WHERE r.comment_id = c.id), '[]'::jsonb)
     FROM public.comments c WHERE c.bae_job_id IS NOT NULL
   ON CONFLICT (id) DO UPDATE SET comment_row = EXCLUDED.comment_row, reactions = EXCLUDED.reactions, archived_at = now()$q$;
  EXECUTE 'DELETE FROM public.comments WHERE bae_job_id IS NOT NULL';
 END IF;
END $$;

-- 4) 두 RESTRICTIVE 정책
DROP POLICY IF EXISTS bae_gyeong_comments_private ON public.comments;
DROP POLICY IF EXISTS bae_gyeong_comment_reactions_private ON public.comment_reactions;

-- 5) CHECK · 색인 · 칸
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_bae_job_id_prefix;
DROP INDEX IF EXISTS public.idx_comments_bae_job;
ALTER TABLE public.comments DROP COLUMN IF EXISTS bae_job_id;

-- 6) 9단계 함수
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_list(TEXT, UUID);
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_add(TEXT, UUID, JSONB);
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_edit(TEXT, TEXT, TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_delete(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_react(TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.bae_gyeong_session_comment_reactions(TEXT, TEXT[]);
DROP FUNCTION IF EXISTS public.bae_gyeong_stamp_comment();
DROP FUNCTION IF EXISTS public.bae_gyeong_stamp_comment_text(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_notify(TEXT, TEXT, TEXT[]);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_signal();
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_reached(UUID, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_clean(UUID, TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_reactions_json(TEXT);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_json(public.comments);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_id_ok(TEXT);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_audience(UUID);
DROP FUNCTION IF EXISTS public.bae_gyeong_comment_can_read(TEXT, UUID);
NOTIFY pgrst, 'reload schema';
COMMIT;
