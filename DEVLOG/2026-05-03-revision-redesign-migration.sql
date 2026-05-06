-- 리비전 기능 전면 재설계 마이그레이션
-- 작성일: 2026-05-03
-- 멱등(IF NOT EXISTS) — 재실행 안전

-- 1. comments.revision_id (리비전 ↔ 댓글 단일 흐름 통합)
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS revision_id TEXT NULL
  REFERENCES comp_revisions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_comments_revision_id
  ON comments(revision_id) WHERE revision_id IS NOT NULL;

-- 2. users.is_compositor (컴포지터 역할 — 부서 구분 없음, 여러 명 가능)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_compositor BOOLEAN DEFAULT false NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_is_compositor
  ON users(is_compositor) WHERE is_compositor = true;

-- 3. comp_revisions.notify_user_ids (알림 받을 사람 목록)
ALTER TABLE comp_revisions
  ADD COLUMN IF NOT EXISTS notify_user_ids JSONB DEFAULT '[]'::jsonb;

-- 4. comments.scene_uuid (init.sql 누락 보강)
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS scene_uuid UUID NULL;

-- 5. comp_revisions.scene_uuid (init.sql 누락 보강)
ALTER TABLE comp_revisions
  ADD COLUMN IF NOT EXISTS scene_uuid UUID NULL;

-- 6. 레거시 백필: 기존 리비전의 notify_user_ids에 등록자 포함 (빈 배열인 경우만)
UPDATE comp_revisions
  SET notify_user_ids = jsonb_build_array(requester_id)
  WHERE notify_user_ids = '[]'::jsonb
    AND requester_id IS NOT NULL
    AND requester_id <> '';
