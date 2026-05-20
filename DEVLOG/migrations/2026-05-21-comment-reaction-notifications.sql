-- 2026-05-21: 댓글 이모지 반응 알림 테이블
-- spec: docs/superpowers/specs/2026-05-21-comment-reaction-notifications-design.md
-- plan: docs/superpowers/plans/2026-05-21-comment-reaction-notifications.md
--
-- 한 줄 = "받는 사람(comment 작성자) × 댓글 × 반응한 사람" 의 묶음 알림.
-- 같은 (recipient, comment, actor) 면 emojis 배열에 누적되고 read_at 이 NULL 로 리셋됨.

CREATE TABLE IF NOT EXISTS comment_reaction_notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    TEXT        NOT NULL,
  comment_id      TEXT        NOT NULL,
  actor_id        TEXT        NOT NULL,
  actor_name      TEXT        NOT NULL,
  -- 점프용 컨텍스트 (스냅샷 — 댓글이 다른 씬으로 이동하는 일은 없음)
  scene_id        TEXT,
  episode_number  INTEGER,
  part_id         TEXT,
  dept            TEXT,
  -- 누적 데이터 (last_emoji 는 별도 컬럼 두지 않고 client 에서 emojis.at(-1) 로 derive)
  emojis          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  reaction_count  SMALLINT    NOT NULL DEFAULT 0,
  last_action_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at         TIMESTAMPTZ,
  UNIQUE (recipient_id, comment_id, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_crn_recipient_unread
  ON comment_reaction_notifications (recipient_id, read_at NULLS FIRST, last_action_at DESC);

CREATE INDEX IF NOT EXISTS idx_crn_comment
  ON comment_reaction_notifications (comment_id);

-- Realtime publication 등록 (멱등성 보장)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='comment_reaction_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE comment_reaction_notifications;
  END IF;
END $$;
