-- 2026-11-05: 씬 댓글 알림을 서버가 저장 순간에 만든다 (씬 댓글 B안 PR 6 · 인수인계서 §10)
--
-- 배경:
--   지금까지는 댓글을 받는 PC 마다 렌더러가 '누가 받나'를 각자 판정했다(src/utils/sceneCommentNotification.ts).
--   그 PC 의 캐시에 씬·댓글이 없으면 알림이 빠지고, 로그인 때마다 최근 댓글을 최대 2,000줄 훑어 놓친 멘션을 찾았다.
--   이 파일은 댓글이 저장되는 그 트랜잭션 안에서 받을 사람을 계산해 comment_notifications 에 한 줄씩 넣는다.
--   앱은 '내 줄'만 세션 래퍼로 읽는다(놓친 알림 복원 = 내 줄 목록, 2,000줄 훑기 없음).
-- 한솔 결정(2026-11-05): 서버가 저장 순간에 만든다(앱이 저장 뒤 요청하는 원안 대신 — 업데이트 안 한 PC 가 쓴 댓글도 빠짐없이),
--   '내 씬' 조용한 알림은 그 PC 가 씬을 열어 봤는지와 무관하게 늘 만든다(보관한 에피소드·파트는 지금처럼 만들지 않는다),
--   슬랙은 이번에 옮기지 않는다.
--
-- 받는 사람 규칙 (화면 판정 함수와 같은 순서, 한 사람은 한 댓글에 가장 강한 이유 한 줄만):
--   캐릭터 댓글   : 본문에 @이름 으로 부른 사람(mention)만.
--   리테이크 댓글 : mention → 리테이크 요청자·알림 대상(retake). 담당자는 알림 대상 안에 있을 때만(앱의 '담당 ⊆ 알림 대상' 규칙).
--   일반 댓글     : mention → 원댓글 작성자(reply) → 자동(auto): 씬 담당(assignee) > 같은 장면 상대 부서 담당(counterpart)
--                   > 그 씬·상대 부서 같은 씬에 댓글을 단 적 있는 사람(participant). 자동은 활성 에피소드·활성 파트의 씬만.
--   수정          : 수정으로 새로 들어간 @이름만(kind='edit', mention). 같은 사람이 다시 들어가면 그 줄을 새로 고친다.
--   작성자 본인과 users 에 없는 이름·id 는 받지 않는다. 이름이 같은 사람이 여럿이면 모두 받는다(앱도 이름으로 비교한다).
--   설정(내 씬 자동 알림·리테이크 알림)과 스레드 팔로우·끄기는 PC 로컬이라 서버는 모른다 — 앱이 보여 줄 때 거른다.
--
-- 경계(CLAUDE.md 규칙 7·10, AGENTS.md '씬 댓글 알림 경계'):
--   comment_notifications 는 RLS 를 켜고 정책 0개 + anon/authenticated 권한 회수. publication 에 넣지 않는다.
--   앱이 닿는 길은 세션 래퍼 두 개뿐(목록·읽음). 줄은 댓글 트리거만 만든다 — 클라이언트는 줄을 만들 수 없다.
--   실시간은 줄이 생겼을 때 공개 채널 bflow-realtime 에 내용 없는 신호 'comment-notifications-changed' 한 번 → 앱이 래퍼로 다시 읽는다.
--   트리거는 모든 예외를 삼킨다 — 알림을 못 만들어도 댓글 저장·삭제는 절대 막지 않는다(PR #265: 트리거 하나가 사용자 삭제를 막은 회귀).
--   users·comments FK 는 두지 않는다(사용자 삭제·댓글 삭제 경로를 새 테이블이 막지 않게). 댓글이 지워지면 삭제 트리거가 줄을 지우고,
--   목록 래퍼는 comments 와 INNER JOIN 해 남은 줄을 감춘다.
-- 호환성: 추가 전용. comments 에는 트리거 셋만 붙고 칸·권한은 그대로다. v1.148.0 앱은 이 객체를 모르고 그대로 동작한다.
-- 멱등: 반복 실행해도 안전하다(마지막 채우기는 이미 있는 줄을 건너뛴다). 이 프로젝트의 default privileges 가 새 테이블·함수에
--   anon 권한을 자동으로 주므로 명시 회수한다.
-- 채우기(6절): 최근 30일 댓글 중 '나를 직접 부른' 줄(멘션·답글·리테이크)만 신호 없이 채운다. 자동 알림(담당·상대 부서·참여자)은
--   채우지 않는다 — 지금 담당자·지금까지의 댓글로 계산하면 그때는 받지 않았을 사람에게도 줄이 생기고, v1.148.0 이 이미 보여 준
--   자동 알림이 업데이트 뒤 다시 들어온다(리뷰 지적). 줄 시각은 댓글 시각이되 서버 시각보다 늦지 않게 자른다(시계가 앞선 PC·위조 댓글).
-- 되돌리기(그대로 실행): 트리거 셋과 래퍼 두 개를 지우면 새 앱은 '서버 알림 없음'으로 보고 예전 길(렌더러 판정 + 놓친 멘션 훑기)로 돌아간다.
--   BEGIN;
--   DROP TRIGGER IF EXISTS comment_notifications_after_insert ON public.comments;
--   DROP TRIGGER IF EXISTS comment_notifications_after_mentions ON public.comments;
--   DROP TRIGGER IF EXISTS comment_notifications_after_delete ON public.comments;
--   DROP FUNCTION IF EXISTS public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER);
--   DROP FUNCTION IF EXISTS public.comment_notifications_session_mark_read(TEXT, TEXT[], JSONB);
--   NOTIFY pgrst, 'reload schema';
--   COMMIT;
-- 운영 적용: 2026-11-05 13:51 KST, 20261105045120(apply_migration 'comment_notifications'). 적용 전 같은 본문 + 확인 SQL 을
--   한 묶음으로 돌려 끝에서 일부러 되돌리는 예행연습 통과(채울 줄 36개), 적용 뒤 확인 SQL 도 같은 방식으로 통과 — 채운 줄 40개
--   (멘션 39·답글 1), anon 은 래퍼 두 개만 실행, 표 권한 없음, publication 밖, 트리거 셋.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1) 테이블 ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comment_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id TEXT NOT NULL,
  comment_id   TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('add', 'edit')),
  reason       TEXT NOT NULL CHECK (reason IN ('mention', 'reply', 'retake', 'auto')),
  detail       TEXT CHECK (detail IS NULL OR detail IN ('assignee', 'counterpart', 'participant')),
  actor_id     TEXT NOT NULL,
  -- 서버 시각(목록 커서). comments.created_at 은 보낸 PC 의 시계라 커서로 쓰지 않는다.
  event_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 수정 줄: 그 수정의 comments.edited_at(앱의 수정 방송 editedAt 과 같은 값 — 같은 수정이 두 길로 와도 한 번만).
  edit_at      TIMESTAMPTZ,
  read_at      TIMESTAMPTZ,
  CONSTRAINT comment_notifications_once UNIQUE (recipient_id, comment_id, kind),
  CONSTRAINT comment_notifications_auto_detail CHECK ((reason = 'auto') = (detail IS NOT NULL)),
  CONSTRAINT comment_notifications_edit_mention CHECK (kind = 'add' OR reason = 'mention')
);

CREATE INDEX IF NOT EXISTS idx_comment_notifications_recipient
  ON public.comment_notifications (recipient_id, event_at, id);
CREATE INDEX IF NOT EXISTS idx_comment_notifications_comment
  ON public.comment_notifications (comment_id);

ALTER TABLE public.comment_notifications ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE role_name TEXT; BEGIN
  REVOKE ALL PRIVILEGES ON TABLE public.comment_notifications FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.comment_notifications FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

-- ── 2) 내부 함수: 이름 목록 · 받는 사람 · 줄 넣기 ────────────────────────────

-- JSONB 배열 안의 글자만(앱의 asNames 와 같다). 배열이 아니면 빈 목록.
CREATE OR REPLACE FUNCTION public.comment_notifications_names(p_value JSONB)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(ARRAY(
    SELECT e #>> '{}' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::JSONB END) e
    WHERE jsonb_typeof(e) = 'string' AND e #>> '{}' <> ''
  ), ARRAY[]::TEXT[])
$$;

-- 새 댓글 하나의 받는 사람. 화면 판정 함수(decideSceneCommentNotification)와 같은 순서이고,
-- 미리보기 짝은 src/shared/commentNotificationRecipients.ts(같은 예제로 tests/commentNotificationsDatabase.test.ts 가 대조).
CREATE OR REPLACE FUNCTION public.comment_notifications_recipients(p_comment_id TEXT)
RETURNS TABLE(recipient_id TEXT, reason TEXT, detail TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
WITH c AS (
  SELECT cm.id, cm.user_id, cm.part_id, cm.scene_uuid, cm.parent_comment_id, cm.revision_id, cm.character_id,
         public.comment_notifications_names(cm.mentions) AS mention_names,
         CASE WHEN btrim(COALESCE(cm.scene_id, '')) ~ '^-?[0-9]{1,9}$' THEN btrim(cm.scene_id)::INTEGER END AS scene_no
    FROM public.comments cm WHERE cm.id = p_comment_id
),
mention AS (
  SELECT u.id AS recipient_id, 'mention'::TEXT AS reason, NULL::TEXT AS detail, 1 AS rank
    FROM c JOIN public.users u ON u.name = ANY (c.mention_names)
),
reply AS (
  SELECT p.user_id, 'reply'::TEXT, NULL::TEXT, 2
    FROM c JOIN public.comments p ON p.id = c.parent_comment_id
   WHERE c.character_id IS NULL AND c.revision_id IS NULL
),
retake AS (
  SELECT t.id, 'retake'::TEXT, NULL::TEXT, 2
    FROM c JOIN public.comp_revisions r ON r.id = c.revision_id
   CROSS JOIN LATERAL (
     SELECT r.requester_id AS id
     UNION SELECT unnest(public.comment_notifications_names(r.notify_user_ids))
     -- 담당자는 알림 대상 안에 있을 때만(앱 mapRevision 의 '담당 ⊆ 알림 대상').
     UNION SELECT a FROM unnest(public.comment_notifications_names(r.assignee_ids)) a
            WHERE a = ANY (public.comment_notifications_names(r.notify_user_ids))
   ) t
   WHERE c.character_id IS NULL
),
-- 자동 알림의 씬: 앱이 들고 있는 것과 같게 활성 에피소드·활성 파트만. scene_uuid 가 먼저, 없으면 (파트, 씬 순서).
scene AS (
  SELECT s.id, s.part_id, s.scene_number, s.sort_order, s.assignee, pt.episode_id, pt.part_id AS part_letter, pt.department
    FROM c
    JOIN public.scenes s ON (s.id = c.scene_uuid OR (s.part_id = c.part_id AND s.sort_order = c.scene_no))
    JOIN public.parts pt ON pt.id = s.part_id AND pt.status = 'active'
    JOIN public.episodes ep ON ep.id = pt.episode_id AND ep.status = 'active'
   WHERE c.character_id IS NULL AND c.revision_id IS NULL
   ORDER BY (s.id = c.scene_uuid) DESC NULLS LAST, s.id
   LIMIT 1
),
-- 같은 에피소드·같은 파트 글자·반대 부서(BG↔ACT) 파트에서, 씬 번호가 대소문자·앞뒤 공백만 다른 씬(d001 = D001).
counterpart_scene AS (
  SELECT cs.id, cs.part_id, cs.sort_order, cs.assignee
    FROM scene sc
    JOIN public.parts cp ON cp.episode_id = sc.episode_id AND cp.part_id = sc.part_letter AND cp.status = 'active'
                        AND CASE WHEN sc.department = 'acting' THEN cp.department <> 'acting' ELSE cp.department = 'acting' END
    JOIN public.scenes cs ON cs.part_id = cp.id AND lower(btrim(cs.scene_number)) = lower(btrim(sc.scene_number))
   WHERE btrim(sc.scene_number) <> ''
),
assignee_names AS (
  SELECT btrim(n) AS name, 'assignee'::TEXT AS detail, 3 AS rank
    FROM scene, regexp_split_to_table(COALESCE(scene.assignee, ''), '[,、，]') n
  UNION ALL
  SELECT btrim(n), 'counterpart'::TEXT, 4
    FROM counterpart_scene, regexp_split_to_table(COALESCE(counterpart_scene.assignee, ''), '[,、，]') n
),
auto_assignee AS (
  SELECT u.id, 'auto'::TEXT, a.detail, a.rank
    FROM assignee_names a JOIN public.users u ON u.name = a.name
   WHERE a.name <> ''
),
-- 그 씬·상대 부서 같은 씬에 댓글(리테이크 댓글·답글 포함)을 단 적 있는 사람.
participant AS (
  SELECT DISTINCT o.user_id, 'auto'::TEXT, 'participant'::TEXT, 5
    FROM c, public.comments o
   WHERE o.id <> c.id
     AND EXISTS (
       SELECT 1 FROM scene sc WHERE o.scene_uuid = sc.id OR (o.part_id = sc.part_id AND btrim(o.scene_id) = sc.sort_order::TEXT)
       UNION ALL
       SELECT 1 FROM counterpart_scene cs WHERE o.scene_uuid = cs.id OR (o.part_id = cs.part_id AND btrim(o.scene_id) = cs.sort_order::TEXT)
     )
),
candidate AS (
  SELECT * FROM mention
  UNION ALL SELECT * FROM reply
  UNION ALL SELECT * FROM retake
  UNION ALL SELECT * FROM auto_assignee
  UNION ALL SELECT * FROM participant
)
SELECT DISTINCT ON (k.recipient_id) k.recipient_id, k.reason, k.detail
  FROM candidate k, c
 WHERE k.recipient_id IS NOT NULL
   AND k.recipient_id <> c.user_id
   AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = k.recipient_id)
 ORDER BY k.recipient_id, k.rank
$$;

-- 줄 넣기. 'add' 는 받는 사람 계산 결과를 그대로(이미 있으면 건너뜀), 'edit' 는 새로 들어간 @이름의 사람에게 멘션 한 줄
-- (같은 사람이 다시 들어가면 그 줄을 새로 고쳐 안 읽음으로). 새 줄이 생겼고 p_signal 이면 내용 없는 신호를 한 번 보낸다.
CREATE OR REPLACE FUNCTION public.comment_notifications_fanout(
  p_comment_id TEXT, p_kind TEXT, p_added_names TEXT[], p_event_at TIMESTAMPTZ, p_signal BOOLEAN
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor TEXT; v_edit_at TIMESTAMPTZ; v_count INTEGER := 0;
BEGIN
  SELECT cm.user_id, cm.edited_at INTO v_actor, v_edit_at FROM public.comments cm WHERE cm.id = p_comment_id;
  IF NOT FOUND OR v_actor IS NULL THEN RETURN 0; END IF;
  IF p_kind = 'add' THEN
    INSERT INTO public.comment_notifications (recipient_id, comment_id, kind, reason, detail, actor_id, event_at)
    SELECT r.recipient_id, p_comment_id, 'add', r.reason, r.detail, v_actor, COALESCE(p_event_at, now())
      FROM public.comment_notifications_recipients(p_comment_id) r
    ON CONFLICT ON CONSTRAINT comment_notifications_once DO NOTHING;
  ELSIF p_kind = 'edit' THEN
    INSERT INTO public.comment_notifications (recipient_id, comment_id, kind, reason, detail, actor_id, event_at, edit_at)
    SELECT DISTINCT u.id, p_comment_id, 'edit', 'mention', NULL, v_actor, COALESCE(p_event_at, now()), v_edit_at
      FROM public.users u
     WHERE u.name = ANY (COALESCE(p_added_names, ARRAY[]::TEXT[])) AND u.id <> v_actor
    ON CONFLICT ON CONSTRAINT comment_notifications_once
      DO UPDATE SET reason = 'mention', detail = NULL, actor_id = EXCLUDED.actor_id, event_at = EXCLUDED.event_at,
                    edit_at = EXCLUDED.edit_at, read_at = NULL;
  ELSE
    RETURN 0;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 AND COALESCE(p_signal, false) THEN
    -- 공개 채널에는 사람·식별자·내용을 싣지 않는다. 신호가 실패해도 줄은 남는다(앱이 다음 읽기·재연결에서 따라잡는다).
    BEGIN
      IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
        EXECUTE 'SELECT realtime.send($1,$2,$3,$4)' USING '{}'::JSONB, 'comment-notifications-changed', 'bflow-realtime', false;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[comment-notifications] realtime 변경 신호 전송 실패: %', SQLERRM;
    END;
  END IF;
  RETURN v_count;
END $$;

-- ── 3) comments 트리거 셋 (모든 예외를 삼킨다) ──────────────────────────────

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

CREATE OR REPLACE FUNCTION public.comment_notifications_on_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    DELETE FROM public.comment_notifications WHERE comment_id = OLD.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[comment-notifications] 지운 댓글의 알림 정리 실패(댓글은 지워짐): %', SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS comment_notifications_after_insert ON public.comments;
CREATE TRIGGER comment_notifications_after_insert
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.comment_notifications_on_insert();

DROP TRIGGER IF EXISTS comment_notifications_after_mentions ON public.comments;
CREATE TRIGGER comment_notifications_after_mentions
  AFTER UPDATE OF mentions ON public.comments
  FOR EACH ROW WHEN (OLD.mentions IS DISTINCT FROM NEW.mentions)
  EXECUTE FUNCTION public.comment_notifications_on_mentions();

DROP TRIGGER IF EXISTS comment_notifications_after_delete ON public.comments;
CREATE TRIGGER comment_notifications_after_delete
  AFTER DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.comment_notifications_on_delete();

-- ── 4) 공개 래퍼 두 개 (세션 토큰 → 호출자 확정 → 내 줄만) ────────────────

-- 내 줄을 (event_at, id) 커서 뒤로 오래된 것부터 최대 200개. 댓글 내용·리테이크 번호를 함께 돌려줘 앱이 스토어 없이도 그린다.
-- 커서의 id 가 없으면 그 시각보다 뒤(앱은 커밋 순서 차이 몫만큼 시각을 앞당겨 다시 읽고, 받은 줄은 스스로 거른다).
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

-- 내 줄 읽음. 화면에 있던 알림만 보낸다 — 새 댓글 줄은 댓글 id, 수정으로 넣은 @ 줄은 (댓글 id, 그 수정 시각) 짝.
-- 같은 댓글에서 빠졌다가 다시 불려 새로 고쳐진 수정 줄은 시각이 달라 읽음이 되지 않는다(아직 이 PC 가 못 받은 알림 — 코덱스 1차).
-- '전부' 는 받지 않는다 — 아직 이 PC 가 받지 못한 줄까지 읽음이 되지 않게. 이미 읽은 줄은 그대로.
CREATE OR REPLACE FUNCTION public.comment_notifications_session_mark_read(
  p_session_token TEXT, p_add_comment_ids TEXT[], p_edit_targets JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_count INTEGER := 0; v_more INTEGER := 0; v_edits INTEGER;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  PERFORM 1 FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  IF p_edit_targets IS NOT NULL AND jsonb_typeof(p_edit_targets) <> 'array' THEN
    RAISE EXCEPTION '읽음 대상이 올바르지 않습니다.' USING ERRCODE = '22023';
  END IF;
  v_edits := COALESCE(jsonb_array_length(p_edit_targets), 0);
  IF COALESCE(cardinality(p_add_comment_ids), 0) + v_edits > 500 THEN
    RAISE EXCEPTION '한 번에 읽음으로 바꿀 수 있는 알림은 500개까지예요.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(cardinality(p_add_comment_ids), 0) > 0 THEN
    UPDATE public.comment_notifications SET read_at = now()
     WHERE recipient_id = v_user AND kind = 'add' AND read_at IS NULL AND comment_id = ANY (p_add_comment_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  IF v_edits > 0 THEN
    UPDATE public.comment_notifications n SET read_at = now()
      FROM jsonb_to_recordset(p_edit_targets) AS t("commentId" TEXT, "editAt" TIMESTAMPTZ)
     WHERE n.recipient_id = v_user AND n.kind = 'edit' AND n.read_at IS NULL
       AND n.comment_id = t."commentId" AND n.edit_at = t."editAt";
    GET DIAGNOSTICS v_more = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('updated', v_count + v_more);
END $$;

COMMENT ON TABLE public.comment_notifications IS
  '씬·캐릭터 댓글 알림(받는 사람별 한 줄). 댓글 트리거만 만들고, 앱은 comment_notifications_session_* 래퍼로 내 줄만 읽는다.';
COMMENT ON FUNCTION public.comment_notifications_recipients(TEXT) IS '내부 전용: 새 댓글의 받는 사람(이유·자동 종류). 화면 판정 함수와 같은 순서.';
COMMENT ON FUNCTION public.comment_notifications_fanout(TEXT, TEXT, TEXT[], TIMESTAMPTZ, BOOLEAN) IS '내부 전용: 알림 줄을 넣고 새 줄이 있으면 내용 없는 신호를 보낸다.';
COMMENT ON FUNCTION public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER) IS '세션 토큰으로 호출자를 확정한 뒤 내 댓글 알림 줄을 커서 뒤로 돌려주는 공개 래퍼.';
COMMENT ON FUNCTION public.comment_notifications_session_mark_read(TEXT, TEXT[], JSONB) IS '세션 토큰으로 호출자를 확정한 뒤 내 댓글 알림 줄을 읽음으로 바꾸는 공개 래퍼.';

-- ── 5) 권한: 내부 함수는 아무도, 래퍼 두 개만 anon/authenticated/service_role ──

DO $$ DECLARE role_name TEXT; BEGIN
  REVOKE ALL PRIVILEGES ON FUNCTION
    public.comment_notifications_names(JSONB),
    public.comment_notifications_recipients(TEXT),
    public.comment_notifications_fanout(TEXT, TEXT, TEXT[], TIMESTAMPTZ, BOOLEAN),
    public.comment_notifications_on_insert(),
    public.comment_notifications_on_mentions(),
    public.comment_notifications_on_delete(),
    public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER),
    public.comment_notifications_session_mark_read(TEXT, TEXT[], JSONB)
  FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format($r$REVOKE ALL PRIVILEGES ON FUNCTION
        public.comment_notifications_names(JSONB),
        public.comment_notifications_recipients(TEXT),
        public.comment_notifications_fanout(TEXT, TEXT, TEXT[], TIMESTAMPTZ, BOOLEAN),
        public.comment_notifications_on_insert(),
        public.comment_notifications_on_mentions(),
        public.comment_notifications_on_delete() FROM %I$r$, role_name);
    END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format($g$GRANT EXECUTE ON FUNCTION
        public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER),
        public.comment_notifications_session_mark_read(TEXT, TEXT[], JSONB) TO %I$g$, role_name);
    END IF;
  END LOOP;
END $$;

-- 방어: 누군가 publication 에 넣었다면 뺀다(줄 내용이 anon 구독자에게 흘러가지 않게).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comment_notifications') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.comment_notifications;
  END IF;
END $$;

-- ── 6) 최근 30일 댓글로 한 번 채우기 (신호 없음) ─────────────────────────────
-- 새 앱의 첫 '놓친 알림 모으기'는 예전 기준 시각부터 내 줄을 읽는다 — 이 파일을 적용하기 전에 온 '나를 부른' 댓글도 빠지지 않게.
-- 자동 알림은 채우지 않는다(머리말). 줄 시각은 댓글을 쓴 시각(예전 기준 시각과 같은 시계)이되 서버 시각보다 늦지 않게.
INSERT INTO public.comment_notifications (recipient_id, comment_id, kind, reason, detail, actor_id, event_at)
SELECT r.recipient_id, cm.id, 'add', r.reason, r.detail, cm.user_id, LEAST(COALESCE(cm.created_at, now()), now())
  FROM public.comments cm
 CROSS JOIN LATERAL public.comment_notifications_recipients(cm.id) r
 WHERE cm.created_at > now() - interval '30 days'
   AND r.reason <> 'auto'
ON CONFLICT ON CONSTRAINT comment_notifications_once DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
