-- ============================================================
-- 캐릭터 현황판 — 에피소드 에셋 보드용 추가 컬럼 (additive)
-- date: 2026-06-25
-- episode_character_mapping 에 에피소드별 캐릭터 주의점(memo) + 이 편 사용 복장(costume_id).
-- ============================================================
ALTER TABLE episode_character_mapping ADD COLUMN IF NOT EXISTS memo TEXT;
ALTER TABLE episode_character_mapping ADD COLUMN IF NOT EXISTS costume_id UUID REFERENCES character_costumes(id) ON DELETE SET NULL;
