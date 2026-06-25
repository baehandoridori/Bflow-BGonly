-- 2026-06-25: 씬 작업 폴더/파일 경로 링크
-- spec: docs/superpowers/specs/2026-06-25-scene-work-links-design.md

CREATE TABLE IF NOT EXISTS public.scene_work_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_uuid UUID NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  department TEXT NOT NULL CHECK (department IN ('bg', 'acting')),
  link_kind TEXT NOT NULL CHECK (link_kind IN ('folder', 'primary_file', 'extra_file')),
  path TEXT NOT NULL,
  label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_scene_work_links_primary_slots
  ON public.scene_work_links(scene_uuid, department, link_kind)
  WHERE link_kind IN ('folder', 'primary_file');

CREATE INDEX IF NOT EXISTS idx_scene_work_links_scene
  ON public.scene_work_links(scene_uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scene_work_links TO anon, authenticated, service_role;

ALTER TABLE public.scene_work_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scene_work_links'
      AND policyname = 'allow_all'
  ) THEN
    CREATE POLICY "allow_all"
      ON public.scene_work_links
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_scene_work_links_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scene_work_links_updated_at ON public.scene_work_links;
CREATE TRIGGER trg_scene_work_links_updated_at
  BEFORE UPDATE ON public.scene_work_links
  FOR EACH ROW
  EXECUTE FUNCTION public.set_scene_work_links_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'scene_work_links'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scene_work_links;
  END IF;
END $$;
