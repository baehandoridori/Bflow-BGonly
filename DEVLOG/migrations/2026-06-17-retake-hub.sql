-- 2026-06-17: 리테이크 허브 — 담당자 워크플로우 + 세트
-- spec: docs/superpowers/specs/2026-06-17-retake-hub-redesign-design.md
-- plan: docs/superpowers/plans/2026-06-17-retake-hub-step1-workflow-backend.md
--
-- comp_revisions 에 담당자(assignee_ids/assignee_states)·세트(set_id)·최종완료(final_*) 추가.
-- 전체 status 는 final_resolved_at + assignee_states 에서 파생(앱 레벨). status CHECK 에 'assignee_done' 추가.
-- scene_id 는 세트 '전반' 항목을 위해 nullable 로 완화.
-- 멱등성 유지 — 재실행 안전.

-- ─── 1) comp_revisions 컬럼 추가 ───
ALTER TABLE comp_revisions
  ADD COLUMN IF NOT EXISTS assignee_ids      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assignee_states   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS set_id            UUID         NULL,
  ADD COLUMN IF NOT EXISTS final_resolved_by TEXT         NULL,
  ADD COLUMN IF NOT EXISTS final_resolved_at TIMESTAMPTZ  NULL;

-- ─── 2) status CHECK 제약에 'assignee_done' 추가 ───
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'comp_revisions' AND constraint_name = 'comp_revisions_status_check'
  ) THEN
    ALTER TABLE comp_revisions DROP CONSTRAINT comp_revisions_status_check;
  END IF;
  ALTER TABLE comp_revisions
    ADD CONSTRAINT comp_revisions_status_check
    CHECK (status IN ('open','in_progress','assignee_done','resolved'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ─── 3) scene_id NOT NULL 완화 (세트 '전반' 항목) ───
ALTER TABLE comp_revisions ALTER COLUMN scene_id DROP NOT NULL;

-- ─── 4) comp_revision_sets 테이블 ───
CREATE TABLE IF NOT EXISTS comp_revision_sets (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT         NOT NULL,
  episode_number INTEGER      NULL,
  department     TEXT         NULL,
  aggregator_id  TEXT         NULL REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT         NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_by     TEXT         NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─── 5) set_id FK + 인덱스 ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'comp_revisions' AND constraint_name = 'comp_revisions_set_id_fkey'
  ) THEN
    ALTER TABLE comp_revisions
      ADD CONSTRAINT comp_revisions_set_id_fkey
      FOREIGN KEY (set_id) REFERENCES comp_revision_sets(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comp_revisions_set ON comp_revisions(set_id) WHERE set_id IS NOT NULL;

-- ─── 6) RLS allow_all (기존 테이블 컨벤션 동일) ───
ALTER TABLE comp_revision_sets ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'comp_revision_sets' AND policyname = 'allow_all'
  ) THEN
    CREATE POLICY "allow_all" ON comp_revision_sets FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── 7) updated_at 자동 갱신 트리거 ───
CREATE OR REPLACE FUNCTION set_comp_revision_sets_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comp_revision_sets_updated_at ON comp_revision_sets;
CREATE TRIGGER trg_comp_revision_sets_updated_at
  BEFORE UPDATE ON comp_revision_sets
  FOR EACH ROW EXECUTE FUNCTION set_comp_revision_sets_updated_at();

-- ─── 8) Realtime publication ───
-- 주의: comp_revision_sets 핸들러는 5단계(허브)에서 추가한다. publication 등록은
-- 핸들러가 없어도 무해(이벤트 무시)하므로 여기서 함께 등록한다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='comp_revision_sets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE comp_revision_sets;
  END IF;
END $$;
