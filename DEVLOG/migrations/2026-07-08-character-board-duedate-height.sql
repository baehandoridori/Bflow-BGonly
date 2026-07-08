-- 캐릭터 현황판 Tier 2 PR2: 복장 마감일(T2-4) + 캐릭터 기준 키(T2-3)
-- 둘 다 nullable 추가 컬럼 — realtime publication 변경 불필요(기존 characters/character_costumes 구독에 포함).
-- 추가 전용(DROP 없음). 라이브 DB(mpqifkpxalwxgcrddchv)에 코드 PR 머지 전 먼저 적용.

-- T2-4: 복장 작업 마감일
ALTER TABLE character_costumes
  ADD COLUMN IF NOT EXISTS due_date DATE;
COMMENT ON COLUMN character_costumes.due_date IS
  '복장 작업 마감일(주로 리깅 기준, 디자인/리깅 구분 없음 — 필요 시 후속 확장). NULL이면 일정 미설정.';

-- T2-3: 캐릭터 나열 시 상대 크기 비교용 기준값(스튜디오 임의 단위, 실제 업로드 픽셀과 무관)
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS reference_height_px INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_characters_reference_height'
  ) THEN
    ALTER TABLE characters ADD CONSTRAINT chk_characters_reference_height
      CHECK (reference_height_px IS NULL OR (reference_height_px > 0 AND reference_height_px < 5000));
  END IF;
END $$;
COMMENT ON COLUMN characters.reference_height_px IS
  '캐릭터 나열 시 상대 크기 비교 기준값(스튜디오 임의 단위, 실제 업로드 픽셀 크기와 무관). NULL이면 균일 표시.';
