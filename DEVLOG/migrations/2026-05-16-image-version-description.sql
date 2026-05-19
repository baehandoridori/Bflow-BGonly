-- 2026-05-16 v1.26.2 — scene_image_versions 에 description 컬럼 추가
-- 주석 모드에서 그림 위 + 텍스트 메모를 함께 저장하기 위함.
-- 마이그레이션 적용: 2026-05-16 (live DB)
ALTER TABLE scene_image_versions ADD COLUMN IF NOT EXISTS description TEXT;
COMMENT ON COLUMN scene_image_versions.description IS '주석 버전에 첨부된 텍스트 메모 (v1.26.2+).';
