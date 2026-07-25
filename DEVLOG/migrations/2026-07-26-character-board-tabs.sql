-- 캐릭터 현황판 사용자 정의 탭·그룹 (피드백 41).
-- 탭 1 row = 사용자 정의 탭 1개. 그룹은 groups JSONB 배열([{id,name,characterIds}])로 탭 단위 LWW 편집.
-- 추가 전용(DROP 없음). 라이브 DB(mpqifkpxalwxgcrddchv)에 코드 PR 머지 전 먼저 적용.

CREATE TABLE IF NOT EXISTS character_board_tabs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- 그룹 배열: [{ "id": "uuid", "name": "그룹명", "characterIds": ["캐릭터 uuid", ...] }]
  groups     JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_character_board_tabs_order ON character_board_tabs(sort_order);

DROP TRIGGER IF EXISTS trg_character_board_tabs_updated_at ON character_board_tabs;
CREATE TRIGGER trg_character_board_tabs_updated_at
  BEFORE UPDATE ON character_board_tabs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE character_board_tabs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='character_board_tabs' AND policyname='allow_all') THEN
    CREATE POLICY "allow_all" ON character_board_tabs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='character_board_tabs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE character_board_tabs;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
