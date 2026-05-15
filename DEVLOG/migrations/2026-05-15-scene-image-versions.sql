-- 2026-05-15 v1.26.0 — 이미지 버전 관리
--
-- 기존 scenes.storyboard_url / scenes.guide_url 은 "항상 최신 버전 URL" 로 유지 (외부 호환).
-- 모든 과거/현재 버전은 이 테이블에 row 로 보존.
--
-- 참고:
--   - scenes.id 는 UUID
--   - users.id 는 TEXT
--   - 백필: 기존에 채워져 있는 storyboard_url / guide_url 을 각각 v1 (replace) 으로 한 줄씩.

CREATE TABLE IF NOT EXISTS scene_image_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  image_type TEXT NOT NULL CHECK (image_type IN ('storyboard', 'guide')),
  version_no INTEGER NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('replace', 'annotate')),
  base_version_no INTEGER,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scene_id, image_type, version_no)
);

CREATE INDEX IF NOT EXISTS idx_siv_scene_type
  ON scene_image_versions(scene_id, image_type, version_no DESC);

-- 백필 — 기존 storyboard_url 이 비어있지 않은 씬 각각에 v1 (replace) 한 줄 INSERT.
-- created_by 는 첫 번째 admin 사용자 (없으면 첫 번째 사용자) 로 자동 설정.
INSERT INTO scene_image_versions (scene_id, image_type, version_no, url, kind, created_by, created_at)
SELECT
  s.id,
  'storyboard',
  1,
  s.storyboard_url,
  'replace',
  COALESCE(
    (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1),
    (SELECT id FROM users ORDER BY created_at LIMIT 1)
  ),
  COALESCE(s.created_at, now())
FROM scenes s
WHERE COALESCE(s.storyboard_url, '') <> ''
ON CONFLICT (scene_id, image_type, version_no) DO NOTHING;

INSERT INTO scene_image_versions (scene_id, image_type, version_no, url, kind, created_by, created_at)
SELECT
  s.id,
  'guide',
  1,
  s.guide_url,
  'replace',
  COALESCE(
    (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1),
    (SELECT id FROM users ORDER BY created_at LIMIT 1)
  ),
  COALESCE(s.created_at, now())
FROM scenes s
WHERE COALESCE(s.guide_url, '') <> ''
ON CONFLICT (scene_id, image_type, version_no) DO NOTHING;

-- RLS — 기존 패턴 (allow_all). 권한 가드는 IPC 레이어.
ALTER TABLE scene_image_versions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scene_image_versions') THEN
    CREATE POLICY "allow_all" ON scene_image_versions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE scene_image_versions;

COMMENT ON TABLE scene_image_versions IS
  '씬 이미지 버전 히스토리 (v1.26.0+). scenes.{storyboard,guide}_url 은 항상 최신 버전 URL 을 유지하고, 모든 과거 버전은 이 테이블에 row 로 보존.';
