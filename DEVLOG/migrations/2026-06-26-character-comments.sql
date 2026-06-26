-- ============================================================
-- 캐릭터 댓글 지원 (additive + 제약 완화)
-- date: 2026-06-26
--
-- 기존 comments 테이블을 재사용해 캐릭터(현황판) 댓글 스레드를 담는다.
-- 씬 댓글은 그대로 (part_id + scene_id). 캐릭터 댓글은 character_id 로 식별.
-- 대댓글(parent_comment_id)·이모지 반응(comment_reactions, comment_id FK)·읽음 상태는 그대로 재사용.
-- ============================================================

ALTER TABLE comments ADD COLUMN IF NOT EXISTS character_id UUID REFERENCES characters(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS costume_id UUID REFERENCES character_costumes(id) ON DELETE SET NULL;

-- 캐릭터 댓글은 part_id/scene_id 가 없으므로 NOT NULL 완화.
-- 기존 씬 댓글 row 는 값이 있으므로 영향 없음. 씬 댓글 INSERT 는 계속 두 값을 채운다.
ALTER TABLE comments ALTER COLUMN part_id DROP NOT NULL;
ALTER TABLE comments ALTER COLUMN scene_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comments_character ON comments(character_id) WHERE character_id IS NOT NULL;
