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

CREATE OR REPLACE FUNCTION upsert_comment_read_state(
  p_user_id TEXT,
  p_scene_thread_key TEXT,
  p_last_read_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO comment_read_states (
    user_id,
    scene_thread_key,
    last_read_at,
    updated_at
  )
  VALUES (
    p_user_id,
    p_scene_thread_key,
    p_last_read_at,
    now()
  )
  ON CONFLICT (user_id, scene_thread_key) DO UPDATE
  SET
    last_read_at = GREATEST(comment_read_states.last_read_at, EXCLUDED.last_read_at),
    updated_at = CASE
      WHEN EXCLUDED.last_read_at > comment_read_states.last_read_at THEN now()
      ELSE comment_read_states.updated_at
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_comment_read_state(TEXT, TEXT, TIMESTAMPTZ) TO anon, authenticated;
