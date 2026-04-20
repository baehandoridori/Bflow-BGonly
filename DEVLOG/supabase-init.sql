-- ============================================================
-- B flow — Supabase 초기 테이블 생성 SQL
-- Supabase 대시보드 → SQL Editor → New query 에서 실행
-- 작성일: 2026-03-14
-- 참고: IF NOT EXISTS 사용으로 재실행 시에도 안전
-- ============================================================

-- 1. episodes
CREATE TABLE IF NOT EXISTS episodes (
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
CREATE TABLE IF NOT EXISTS parts (
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
CREATE TABLE IF NOT EXISTS scenes (
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

CREATE INDEX IF NOT EXISTS idx_scenes_part_id ON scenes(part_id);
CREATE INDEX IF NOT EXISTS idx_scenes_assignee ON scenes(assignee);

-- 4. comments (→ parts, scenes)
CREATE TABLE IF NOT EXISTS comments (
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

CREATE INDEX IF NOT EXISTS idx_comments_part_scene ON comments(part_id, scene_id);

-- 5. comp_revisions (→ parts)
CREATE TABLE IF NOT EXISTS comp_revisions (
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

CREATE INDEX IF NOT EXISTS idx_comp_revisions_part_scene ON comp_revisions(part_id, scene_id);

-- 6. users
CREATE TABLE IF NOT EXISTS users (
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
CREATE TABLE IF NOT EXISTS metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(type, key)
);

-- 8. private_calendar_events — 사용자 개인 비공개 일정 (Google Calendar 비연동)
-- 정책: 같은 도메인(@studiojbbj.com) 구성원에게도 노출되면 안 되는 일정은 여기에만 저장된다.
-- Google Calendar 에는 올라가지 않으므로 '바쁨 시간' 조차 노출되지 않는다.
CREATE TABLE IF NOT EXISTS private_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,           -- 소유자 (본인만 조회/수정)
  title TEXT NOT NULL,
  memo TEXT,
  color TEXT,
  type TEXT DEFAULT 'custom',      -- 'custom' | 'episode' | 'part' | 'scene'
  start_date TEXT NOT NULL,        -- YYYY-MM-DD 또는 ISO datetime
  end_date TEXT NOT NULL,
  linked_episode INTEGER,
  linked_part TEXT,
  linked_sheet_name TEXT,
  linked_scene_id TEXT,
  linked_department TEXT,          -- 'bg' | 'acting'
  linked_todo_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_private_cal_events_user ON private_calendar_events(user_id, start_date DESC);

-- ============================================================
-- RLS 정책: 초기 개발 단계에서는 anon key로 전체 접근 허용
-- (Supabase Auth 연동 완료 후 authenticated 전용으로 강화)
-- DO NOTHING 패턴: 이미 존재하면 무시
-- ============================================================

ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'episodes' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON episodes FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'parts' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON parts FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scenes' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON scenes FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comments' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON comments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE comp_revisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comp_revisions' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON comp_revisions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON users FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE metadata ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'metadata' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON metadata FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE private_calendar_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'private_calendar_events' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON private_calendar_events FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Realtime 활성화 (이미 추가되어 있으면 에러 무시)
-- ============================================================

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE scenes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE comments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE comp_revisions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE episodes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE parts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
