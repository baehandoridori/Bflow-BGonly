-- 2026-05-10 — comments 테이블에 parent_comment_id 컬럼 추가
-- 1단계 대댓글 (Slack/Linear 스타일) 구현 위한 self-reference.
-- 부모 삭제 시 ON DELETE SET NULL → 답글이 일반 댓글로 떨어져 메인 흐름에 표시됨 (Slack 동작과 일치).

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid NULL
  REFERENCES comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments(parent_comment_id)
  WHERE parent_comment_id IS NOT NULL;

COMMENT ON COLUMN comments.parent_comment_id IS
  '1단계 대댓글 부모 참조 (v1.24.0+). NULL = 일반 댓글, 값 있음 = 답글. 부모 삭제 시 SET NULL.';
