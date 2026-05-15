-- 2026-05-15 v1.26.0 — 댓글 이모지 리액션
--
-- 한 사용자는 한 댓글에 한 이모지를 1번만 누를 수 있다 (UNIQUE).
-- 댓글 삭제 시 cascade. 사용자 삭제 시도 cascade.
--
-- 참고:
--   - comments.id 는 TEXT 타입 → comment_id 도 TEXT
--   - users.id 는 TEXT 타입 → user_id 도 TEXT
--   - RLS 는 기존 패턴(allow_all) 따라 동일 허용. 권한 가드는 IPC 레이어에서.

CREATE TABLE IF NOT EXISTS comment_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_user ON comment_reactions(user_id);

-- RLS — 기존 패턴 그대로 (anon key 전체 허용, 권한 가드는 앱 레이어)
ALTER TABLE comment_reactions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comment_reactions') THEN
    CREATE POLICY "allow_all" ON comment_reactions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE comment_reactions;

COMMENT ON TABLE comment_reactions IS
  '댓글 이모지 리액션 (v1.26.0+). 한 댓글에 한 사용자가 같은 이모지를 1번만 누를 수 있다.';
