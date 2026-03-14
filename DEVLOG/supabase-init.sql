-- ============================================================
-- B flow — Supabase 초기 테이블 생성 SQL
-- Supabase 대시보드 → SQL Editor → New query 에서 실행
-- 작성일: 2026-03-14
-- ============================================================

-- 1. episodes
CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_number INTEGER NOT NULL,
  title TEXT,
  memo TEXT,
  status TEXT DEFAULT 'active',
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  archive_memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(episode_number)
);

-- 2. parts (→ episodes)
CREATE TABLE parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL,
  department TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(episode_id, part_id, department)
);

-- 3. scenes (→ parts) + updated_by 컬럼 (자기 변경 필터링용)
CREATE TABLE scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_number TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  memo TEXT,
  storyboard_url TEXT,
  guide_url TEXT,
  assignee TEXT,
  lo BOOLEAN DEFAULT false,
  done BOOLEAN DEFAULT false,
  review BOOLEAN DEFAULT false,
  png BOOLEAN DEFAULT false,
  layout TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(part_id, scene_number)
);

CREATE INDEX idx_scenes_part_id ON scenes(part_id);
CREATE INDEX idx_scenes_assignee ON scenes(assignee);

-- 4. comments (→ parts, scenes)
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  text TEXT NOT NULL,
  mentions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  edited_at TIMESTAMPTZ
);

CREATE INDEX idx_comments_part_scene ON comments(part_id, scene_id);

-- 5. comp_revisions (→ parts)
CREATE TABLE comp_revisions (
  id TEXT PRIMARY KEY,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  status TEXT DEFAULT 'open',
  priority TEXT DEFAULT 'normal',
  description TEXT,
  frame_no TEXT,
  image_url TEXT,
  department TEXT,
  requester_id TEXT,
  requester_name TEXT,
  assignee TEXT,
  resolved_by TEXT,
  resolved_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_comp_revisions_part_scene ON comp_revisions(part_id, scene_id);

-- 6. users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  password TEXT,
  slack_id TEXT,
  hire_date TEXT,
  birthday TEXT,
  is_initial_password BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. metadata
CREATE TABLE metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(type, key)
);

-- ============================================================
-- RLS 정책: 초기 개발 단계에서는 anon key로 전체 접근 허용
-- (Supabase Auth 연동 완료 후 authenticated 전용으로 강화)
-- ============================================================

ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON episodes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON parts FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON scenes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON comments FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE comp_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON comp_revisions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON users FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON metadata FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Realtime 활성화 (Supabase 대시보드에서도 수동으로 켤 수 있음)
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE scenes;
ALTER PUBLICATION supabase_realtime ADD TABLE comments;
ALTER PUBLICATION supabase_realtime ADD TABLE comp_revisions;
ALTER PUBLICATION supabase_realtime ADD TABLE episodes;
ALTER PUBLICATION supabase_realtime ADD TABLE parts;
