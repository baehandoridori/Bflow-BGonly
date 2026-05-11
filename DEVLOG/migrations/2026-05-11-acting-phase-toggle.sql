-- 액팅 씬 단계 토글 + 검수자 멘션 알림 마이그레이션
-- 작성일: 2026-05-11
-- 멱등 — 재실행 안전
--
-- 변경:
-- 1) scenes 테이블에 scene_state / work_round / feedback_round 컬럼 추가
--    (부서 무관 일반화 — BG 향후 합류 시 그대로 사용)
-- 2) users 테이블에 is_acting_supervisor 컬럼 추가 (컴포지터와 독립)
-- 3) 기존 액팅 씬의 lo/done/review/png 데이터를 새 컬럼으로 1:1 매핑
--    한솔 결정: 1원화→대기, 2원화→작업중 1차, 동화→피드백 대기 1차, 최종→완료
-- 4) 기존 boolean 컬럼은 DROP 하지 않음 (롤백 가능, BG 는 계속 사용)
--
-- spec: docs/superpowers/specs/2026-05-11-acting-phase-toggle-design.md

-- ─── 1. scenes 새 컬럼 ───
ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS scene_state TEXT
    CHECK (scene_state IS NULL OR scene_state IN ('wait', 'work', 'feedback', 'done')),
  ADD COLUMN IF NOT EXISTS work_round INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feedback_round INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_scenes_state ON scenes(scene_state) WHERE scene_state IS NOT NULL;

-- ─── 2. users 새 컬럼 ───
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_acting_supervisor BOOLEAN DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_acting_supervisor
  ON users(is_acting_supervisor) WHERE is_acting_supervisor = true;

-- ─── 3. 기존 액팅 데이터 1:1 매핑 ───
-- 부서 판별: parts.department = 'acting' 인 part 에 속하는 scenes
-- (scenes 테이블 자체에는 department 컬럼이 없고, part_id → parts.department 로 조인)
UPDATE scenes s
SET
  scene_state =
    CASE
      WHEN s.png    = true THEN 'done'
      WHEN s.review = true THEN 'feedback'
      WHEN s.done   = true THEN 'work'
      WHEN s.lo     = true THEN 'wait'
      ELSE 'wait'
    END,
  work_round =
    CASE
      WHEN s.png    = true THEN 0
      WHEN s.review = true THEN 1
      WHEN s.done   = true THEN 1
      ELSE 0
    END,
  feedback_round =
    CASE
      WHEN s.png    = true THEN 0
      WHEN s.review = true THEN 1
      ELSE 0
    END
WHERE EXISTS (
  SELECT 1 FROM parts p
  WHERE p.id = s.part_id
    AND p.department = 'acting'
)
AND s.scene_state IS NULL;

-- ─── 적용 결과 확인용 쿼리 (참고) ───
-- SELECT scene_state, work_round, feedback_round, COUNT(*)
-- FROM scenes s
-- JOIN parts p ON p.id = s.part_id
-- WHERE p.department = 'acting'
-- GROUP BY scene_state, work_round, feedback_round
-- ORDER BY scene_state;
