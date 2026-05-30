-- 2026-05-30: 사용자별 씬 댓글 읽음 상태
-- spec: docs/superpowers/specs/2026-05-29-comment-read-state-design.md

CREATE TABLE IF NOT EXISTS comment_read_states (
  user_id TEXT NOT NULL,
  scene_thread_key TEXT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scene_thread_key)
);

CREATE INDEX IF NOT EXISTS idx_comment_read_states_user_updated
  ON comment_read_states (user_id, updated_at DESC);

ALTER TABLE comment_read_states ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'comment_read_states'
      AND policyname = 'allow_all'
  ) THEN
    CREATE POLICY "allow_all" ON comment_read_states FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
