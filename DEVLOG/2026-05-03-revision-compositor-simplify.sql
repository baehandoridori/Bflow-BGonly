-- 컴포지터 정의 단순화 마이그레이션
-- 작성일: 2026-05-03 (구현 직후 정정)
-- 멱등 — 재실행 안전
--
-- 변경: 부서별(BG/ACT) 컴포지터 → 단일 BOOLEAN 플래그
-- 이유: 한솔 확정 — 컴포지터는 부서 구분 없이 여러 명 가능 (모든 씬 리비전이 모든 컴포지터에게 자동 알림)
--
-- 본 파일은 이전 마이그레이션(2026-05-03-revision-redesign-migration.sql)을
-- 이미 적용한 환경에서 추가로 실행해야 함. 신규 환경은 이미 갱신된 위 파일에
-- is_compositor 정의가 있으므로 본 파일은 건너뛰어도 됨.

DROP INDEX IF EXISTS idx_users_compositor_dept;

ALTER TABLE users DROP COLUMN IF EXISTS compositor_dept;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_compositor BOOLEAN DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_compositor
  ON users(is_compositor) WHERE is_compositor = true;
