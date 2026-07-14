-- ============================================================
-- 복장 이미지 원본 크기(natural_width/height) + 기준 키 의미 갱신 (피드백 33)
-- date: 2026-07-15
--
-- 원칙:
-- - 추가 전용(additive) — 기존 행은 NULL 유지(과거 업로드는 원본 크기 미기록, UI 가 폴백 처리).
-- - 구버전 앱과 호환: 구버전은 새 컬럼을 모르지만 SELECT * 로 받아 무시한다.
-- ============================================================

BEGIN;

-- 1) 업로드 원본 픽셀 크기 (리사이즈 전 — 저장본은 최대 800px 축소본이라 원본 크기가 따로 필요)
ALTER TABLE character_costume_images
  ADD COLUMN IF NOT EXISTS natural_width INTEGER,
  ADD COLUMN IF NOT EXISTS natural_height INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_costume_images_natural_size'
  ) THEN
    ALTER TABLE character_costume_images ADD CONSTRAINT chk_costume_images_natural_size
      CHECK (
        (natural_width IS NULL OR natural_width > 0)
        AND (natural_height IS NULL OR natural_height > 0)
      );
  END IF;
END $$;

COMMENT ON COLUMN character_costume_images.natural_width IS
  '업로드 원본 이미지 가로 px(리사이즈 전). 과거 업로드/측정 실패는 NULL.';
COMMENT ON COLUMN character_costume_images.natural_height IS
  '업로드 원본 이미지 세로 px(리사이즈 전). 기준 키 자동 설정·드래그 조정의 환산 기준. 과거 업로드/측정 실패는 NULL.';

-- 2) 기준 키 의미 갱신 (피드백 33): 임의 단위 → 실제 프로젝트(1280x720) 픽셀 기준
COMMENT ON COLUMN characters.reference_height_px IS
  '캐릭터 키(px, 1280x720 프로젝트 기준). 이미지 업로드 시 원본 세로 px 로 자동 설정되고 기준선 드래그로 조정. NULL이면 미설정(키 비교에서 균일 표시).';

COMMIT;

-- PostgREST 스키마 캐시 갱신 — 컬럼 추가 직후 API 가 새 컬럼을 모르는 상태 방지.
NOTIFY pgrst, 'reload schema';
