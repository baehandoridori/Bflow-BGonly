-- 2026-05-21: compositing_states RLS 활성화 (PR 1 누락분 hotfix)
--
-- 배경:
--   PR 1 의 2026-05-21-compositing-states.sql 적용 직후 Supabase advisory 에
--   "Row Level Security is disabled (critical)" 경고가 떴음.
--   B flow 의 다른 모든 public 테이블은 RLS enabled + "allow_all" 단일 정책 패턴
--   (권한 분기는 앱 레벨 useAuthStore().currentUser.isCompositor 로 처리).
--   compositing_states 만 그 한 줄이 누락되어 anon key 로 read/write 가능한 상태.
--
-- 본 SQL 은 멱등 — 이미 enable 된 상태에서 재실행해도 NOP. 정책 중복 시 IF NOT EXISTS 사용.

ALTER TABLE compositing_states ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='compositing_states'
      AND policyname='allow_all'
  ) THEN
    CREATE POLICY allow_all ON compositing_states
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
