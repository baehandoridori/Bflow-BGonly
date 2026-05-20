-- 2026-05-21 (코덱스 4차 P1): comment_reaction_notifications atomic UPSERT/REMOVE RPC
-- spec: docs/superpowers/specs/2026-05-21-comment-reaction-notifications-design.md
--
-- 기존 application-side SELECT → INSERT/UPDATE 시퀀스가 동일 (recipient, comment, actor) 조합의
-- 동시 호출에서 race condition 으로 emoji 손실 가능. 단일 SQL 표현식으로 원자화.

-- ─── UPSERT (이모지 추가) ────────────────────────────
CREATE OR REPLACE FUNCTION upsert_comment_reaction_notification(
  p_recipient   TEXT,
  p_comment     TEXT,
  p_actor       TEXT,
  p_actor_name  TEXT,
  p_scene       TEXT,
  p_episode     INTEGER,
  p_part        TEXT,
  p_dept        TEXT,
  p_emoji       TEXT
) RETURNS comment_reaction_notifications
LANGUAGE plpgsql AS $$
DECLARE
  v_row comment_reaction_notifications;
BEGIN
  INSERT INTO comment_reaction_notifications
    (recipient_id, comment_id, actor_id, actor_name,
     scene_id, episode_number, part_id, dept,
     emojis, reaction_count, last_action_at, read_at, created_at)
  VALUES
    (p_recipient, p_comment, p_actor, p_actor_name,
     p_scene, p_episode, p_part, p_dept,
     jsonb_build_array(p_emoji), 1, now(), NULL, now())
  ON CONFLICT (recipient_id, comment_id, actor_id) DO UPDATE
  SET emojis         = comment_reaction_notifications.emojis || jsonb_build_array(p_emoji),
      reaction_count = comment_reaction_notifications.reaction_count + 1,
      last_action_at = now(),
      read_at        = NULL
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- ─── REMOVE (이모지 제거 + 빈 행이면 DELETE) ──────────
-- 행 잠금 + 새 emojis 계산 + UPDATE/DELETE 한 트랜잭션에서 수행 → race-free.
DROP FUNCTION IF EXISTS remove_emoji_from_reaction_notification(TEXT, TEXT, TEXT, TEXT);
CREATE FUNCTION remove_emoji_from_reaction_notification(
  p_recipient TEXT,
  p_comment   TEXT,
  p_actor     TEXT,
  p_emoji     TEXT
) RETURNS TABLE(
  notification_id        UUID,
  deleted                BOOLEAN,
  reaction_count_after   SMALLINT,
  emojis_after           JSONB
) LANGUAGE plpgsql AS $$
DECLARE
  v_id           UUID;
  v_new_emojis   JSONB;
  v_new_count    SMALLINT;
BEGIN
  -- 잠금 + 행 id 확보
  SELECT id INTO v_id
    FROM comment_reaction_notifications
   WHERE recipient_id = p_recipient
     AND comment_id   = p_comment
     AND actor_id     = p_actor
   FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN;  -- 행 없음 → empty result
  END IF;

  -- 잠금된 행의 emojis 배열에서 p_emoji 제거 (WITH ORDINALITY 로 삽입 순서 보존)
  SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
    INTO v_new_emojis
    FROM comment_reaction_notifications n,
         LATERAL jsonb_array_elements_text(n.emojis) WITH ORDINALITY AS t(e, ord)
   WHERE n.id = v_id
     AND t.e  <> p_emoji;

  v_new_count := jsonb_array_length(v_new_emojis)::SMALLINT;

  IF v_new_count = 0 THEN
    DELETE FROM comment_reaction_notifications WHERE id = v_id;
    notification_id       := v_id;
    deleted               := TRUE;
    reaction_count_after  := 0;
    emojis_after          := '[]'::jsonb;
    RETURN NEXT;
  ELSE
    UPDATE comment_reaction_notifications
       SET emojis         = v_new_emojis,
           reaction_count = v_new_count,
           last_action_at = now()
           -- 코덱스 6차 P1: last_action_at 갱신 — catch-up 이 last_action_at > since 로 변경 행을
           --   가져오게 해야 offline 사용자도 emoji 제거를 다음 실행 때 반영 가능.
           -- read_at, created_at 은 의도적으로 미수정 (read 상태는 그대로 유지).
     WHERE id = v_id;
    notification_id       := v_id;
    deleted               := FALSE;
    reaction_count_after  := v_new_count;
    emojis_after          := v_new_emojis;
    RETURN NEXT;
  END IF;
END;
$$;
