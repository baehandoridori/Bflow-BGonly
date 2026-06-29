-- ============================================================
-- 캐릭터 현황판 베타 — 이미지/파일/릴 워크플로우 확장 (additive only)
-- date: 2026-06-29
--
-- 원칙:
-- - 대표 이미지는 character_costumes.featured_image_url 1장을 계속 사용한다.
-- - 실제 파일/폴더는 복사하지 않고 경로만 저장한다.
-- - 기존 row 는 null/default fallback 으로 계속 동작한다.
-- ============================================================

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS work_folder_path TEXT;

ALTER TABLE character_costumes
  ADD COLUMN IF NOT EXISTS work_file_path TEXT,
  ADD COLUMN IF NOT EXISTS image_background TEXT NOT NULL DEFAULT 'black'
    CHECK (image_background IN ('transparent', 'black', 'white', 'checker')),
  ADD COLUMN IF NOT EXISTS image_fit JSONB NOT NULL DEFAULT '{"scale":1,"scaleX":1,"scaleY":1,"x":0,"y":0,"lockAspect":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS design_assignee TEXT,
  ADD COLUMN IF NOT EXISTS rigging_assignee TEXT;

ALTER TABLE episodes
  ADD COLUMN IF NOT EXISTS reel_file_path TEXT;

UPDATE character_costumes
SET
  design_assignee = COALESCE(design_assignee, assignee),
  rigging_assignee = COALESCE(rigging_assignee, assignee)
WHERE assignee IS NOT NULL
  AND btrim(assignee) <> ''
  AND (design_assignee IS NULL OR rigging_assignee IS NULL);

COMMENT ON COLUMN characters.work_folder_path IS '캐릭터 기본 작업 폴더 경로. 실제 폴더 복사/생성 없음.';
COMMENT ON COLUMN character_costumes.work_file_path IS '복장별 작업 파일 경로(.moho 등). 실제 파일 복사/생성 없음.';
COMMENT ON COLUMN character_costumes.image_background IS '투명 PNG 표시 배경: transparent/black/white/checker.';
COMMENT ON COLUMN character_costumes.image_fit IS '대표 이미지 표시값: scale/scaleX/scaleY/x/y/lockAspect. 원본 이미지는 수정하지 않음.';
COMMENT ON COLUMN episodes.reel_file_path IS '에피소드 릴 파일 경로. 실제 파일 복사/생성 없음.';
