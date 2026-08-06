-- 피드백 47: 복장별 키 오버라이드. NULL = 캐릭터 대표 키(reference_height_px)를 따른다.
-- nullable 추가 컬럼 — realtime publication 변경 불필요(기존 character_costumes 구독에 포함).
ALTER TABLE character_costumes
  ADD COLUMN IF NOT EXISTS height_px INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_costume_height'
  ) THEN
    ALTER TABLE character_costumes ADD CONSTRAINT chk_costume_height
      CHECK (height_px IS NULL OR (height_px > 0 AND height_px < 5000));
  END IF;
END $$;

COMMENT ON COLUMN character_costumes.height_px IS
  '복장별 키 오버라이드(px, 1280x720 기준). NULL=캐릭터 대표 키 사용.';

NOTIFY pgrst, 'reload schema';
