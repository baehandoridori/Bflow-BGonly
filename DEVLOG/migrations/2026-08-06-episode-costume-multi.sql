-- 피드백 42: 한 에피소드에 한 캐릭터의 복장 여러 벌 지정 허용 (1:N).
-- 추가 전용: costume_ids JSONB 배열 신설 + 기존 costume_id 백필.
-- costume_id 스칼라는 구버전 앱 호환용 미러로 유지한다(새 코드가 배열 첫 값을 dual-write).
-- nullable/기본값 있는 추가 컬럼 — realtime publication 변경 불필요(기존 episode_character_mapping 구독에 포함).
ALTER TABLE episode_character_mapping
  ADD COLUMN IF NOT EXISTS costume_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE episode_character_mapping
  SET costume_ids = to_jsonb(ARRAY[costume_id])
  WHERE costume_id IS NOT NULL AND costume_ids = '[]'::jsonb;

COMMENT ON COLUMN episode_character_mapping.costume_ids IS
  '이 편에서 쓰는 복장 id 배열(지정 순서 유지). costume_id 는 구버전 앱 호환 미러(배열 첫 값).';

NOTIFY pgrst, 'reload schema';
