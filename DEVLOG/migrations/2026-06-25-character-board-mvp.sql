-- ============================================================
-- 캐릭터 현황판 MVP — character board (additive only)
-- date: 2026-06-25
--
-- 기존 episodes/parts/scenes 등은 일절 손대지 않는다 (추가 전용).
-- 모델:
--   characters (전역)  ──<  character_costumes (복장/디자인, 버전·진행 단위)
--   characters  >──< episodes  via episode_character_mapping (다대다)
-- 한 복장 = 디자인 단계(4) + 리깅 단계(5) + 대표 이미지 + 버전 + 구조/에셋 태그.
-- 네이밍/RLS/트리거/Realtime 패턴은 기존 supabase-init.sql 컨벤션을 그대로 따른다.
-- ============================================================

-- updated_at 자동 갱신 함수 (기존에 있으면 그대로, 없으면 생성)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1) characters : 전역 캐릭터 ----------------------------------
CREATE TABLE IF NOT EXISTS characters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  memo        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_characters_status ON characters(status);

DROP TRIGGER IF EXISTS trg_characters_updated_at ON characters;
CREATE TRIGGER trg_characters_updated_at
  BEFORE UPDATE ON characters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2) character_costumes : 복장(디자인) = 버전·진행 단위 --------
--    한 복장 = 디자인 단계 1개 + 리깅 단계 1개 (씬의 boolean 4개와 달리 단일 enum 컬럼).
CREATE TABLE IF NOT EXISTS character_costumes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                       -- 복장 이름 (교복, 사복, 체육복 ...)
  version_no    INTEGER NOT NULL DEFAULT 1,          -- 리깅 버전 (사용자가 직접 수정)
  design_stage  TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (design_stage  IN ('waiting', 'in_progress', 'feedback', 'done')),
  rigging_stage TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (rigging_stage IN ('waiting', 'vectorized', 'rigging', 'feedback', 'done')),
  featured_image_url TEXT,                            -- 대표 이미지 (scene-images 버킷 재사용)
  structure_tags JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 구조 태그 ["얼굴각도 컨트롤러", ...]
  asset_tags     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 에셋 태그 ["담배", "핸드폰", ...]
  assignee      TEXT,                                 -- 대표 담당(공유 진행은 activity_log로 추적)
  memo          TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE (character_id, name)                         -- 한 캐릭터 안에서 복장 이름 유일
);

CREATE INDEX IF NOT EXISTS idx_character_costumes_character ON character_costumes(character_id);
CREATE INDEX IF NOT EXISTS idx_character_costumes_design    ON character_costumes(design_stage);
CREATE INDEX IF NOT EXISTS idx_character_costumes_rigging   ON character_costumes(rigging_stage);

DROP TRIGGER IF EXISTS trg_character_costumes_updated_at ON character_costumes;
CREATE TRIGGER trg_character_costumes_updated_at
  BEFORE UPDATE ON character_costumes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3) episode_character_mapping : 에피소드 ↔ 캐릭터 다대다 -------
--    episodes.id(UUID) 를 참조 (parts.episode_id 와 동일 전략). 보드는 전역이지만
--    연결 테이블을 지금 깔아 두어 후속 '에피소드 에셋 현황'을 갈아엎지 않게 한다.
CREATE TABLE IF NOT EXISTS episode_character_mapping (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id    UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE (episode_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_ep_char_map_episode   ON episode_character_mapping(episode_id);
CREATE INDEX IF NOT EXISTS idx_ep_char_map_character ON episode_character_mapping(character_id);

-- 4) RLS (기존 allow_all 패턴) --------------------------------
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='characters' AND policyname='allow_all') THEN
    CREATE POLICY "allow_all" ON characters FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE character_costumes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='character_costumes' AND policyname='allow_all') THEN
    CREATE POLICY "allow_all" ON character_costumes FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE episode_character_mapping ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='episode_character_mapping' AND policyname='allow_all') THEN
    CREATE POLICY "allow_all" ON episode_character_mapping FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5) Realtime publication (다른 창/피어 실시간 전파) ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='characters') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE characters;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='character_costumes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE character_costumes;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='episode_character_mapping') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE episode_character_mapping;
  END IF;
END $$;

-- 6) 에피소드별 캐릭터 메모 + 이 편 복장 (additive 확장) ---------
--    에피소드 에셋 보드: "이 편에서의 주의점" 과 "이 편에 쓰는 복장" 을 매핑 row 에 보관.
--    costume_id 는 character_costumes 를 참조하되, 복장이 삭제돼도 매핑은 유지되도록 SET NULL.
ALTER TABLE episode_character_mapping
  ADD COLUMN IF NOT EXISTS memo TEXT;
ALTER TABLE episode_character_mapping
  ADD COLUMN IF NOT EXISTS costume_id UUID REFERENCES character_costumes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ep_char_map_costume ON episode_character_mapping(costume_id);

-- ============================================================
-- 끝. 롤백이 필요하면 (개발 중에만):
--   DROP TABLE IF EXISTS episode_character_mapping, character_costumes, characters CASCADE;
-- ============================================================
