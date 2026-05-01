-- v1.16.0 — scenes 테이블에 length_change 컬럼 추가
--
-- 씬 길이 변경 시각 라벨 (수동 토글, 영구).
--   'LD' = Long Duration (길이 늘어남)
--   'SD' = Short Duration (길이 줄어듦)
--   NULL = 표시 없음 (기본)
--
-- 카드/시트 우클릭 메뉴로 토글. 영구 라벨 — 사용자가 직접 해제할 때까지 유지.
-- 적용: Supabase SQL Editor에서 실행 후, scenes Realtime 채널에 자동 포함됨.

ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS length_change text NULL
    CHECK (length_change IS NULL OR length_change IN ('LD', 'SD'));

COMMENT ON COLUMN scenes.length_change IS
  '씬 길이 변경 시각 라벨: LD(늘어남) / SD(줄어듦) / NULL(표시 없음). 카드/시트 우클릭으로 토글, 영구 라벨.';
