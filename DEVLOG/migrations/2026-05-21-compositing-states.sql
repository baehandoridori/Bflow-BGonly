-- 2026-05-21: 컴포지팅 단계 상태 테이블 + scenes.duration_frames 컬럼
-- spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md
-- plan: docs/superpowers/plans/2026-05-21-compositing-dashboard.md
--
-- 한 row = (에피소드, sceneId) 단위 컴포지팅 현재 단계.
-- BG/ACT 시트와 무관 — 한솔 멘탈 모델 (씬 = 한 단위, BG/ACT = 부서) 반영.
-- 권한 분기는 앱 레벨 (useAuthStore().currentUser.isCompositor) 로 처리.
-- 본 SQL 은 멱등성 유지 — 재실행 시 ALTER 없음.

-- ─── 1) compositing_states 테이블 ───
CREATE TABLE IF NOT EXISTS compositing_states (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_number   INTEGER      NOT NULL,
  scene_id         TEXT         NOT NULL,
  part_id          TEXT         NOT NULL,
  -- 단계: 'batch' | 'combine' | 'aggregated' | 'adjust' | 'error' | 'done'
  status           TEXT         NOT NULL DEFAULT 'batch'
    CHECK (status IN ('batch','combine','aggregated','adjust','error','done')),
  -- 오류 세부 사유 (status='error' 일 때만 의미):
  -- 'missing_file' | 'fix_blemish' | 'retake' | 'canceled_scene' | 'other'
  error_kind       TEXT         NULL
    CHECK (error_kind IS NULL OR error_kind IN ('missing_file','fix_blemish','retake','canceled_scene','other')),
  -- error_kind='other' 일 때 자유 입력 (max ~100자, 앱에서 강제)
  error_note       TEXT         NULL,
  -- 'combine'/'adjust' 진행률 표시용 (MVP 는 단계만, 0~100)
  progress_percent SMALLINT     NOT NULL DEFAULT 0
    CHECK (progress_percent >= 0 AND progress_percent <= 100),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- 마지막으로 단계를 바꾼 사용자 (users.id, B flow 는 TEXT). 삭제되어도 row 보존.
  updated_by       TEXT         NULL REFERENCES users(id) ON DELETE SET NULL,
  -- 씬 단위 1 row — (에피소드, sceneId) 가 유니크
  UNIQUE (episode_number, scene_id)
);

CREATE INDEX IF NOT EXISTS idx_compositing_states_episode
  ON compositing_states (episode_number);

CREATE INDEX IF NOT EXISTS idx_compositing_states_status
  ON compositing_states (status);

CREATE INDEX IF NOT EXISTS idx_compositing_states_episode_part
  ON compositing_states (episode_number, part_id);

-- ─── 2) updated_at 자동 갱신 트리거 ───
CREATE OR REPLACE FUNCTION set_compositing_states_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compositing_states_updated_at ON compositing_states;
CREATE TRIGGER trg_compositing_states_updated_at
  BEFORE UPDATE ON compositing_states
  FOR EACH ROW EXECUTE FUNCTION set_compositing_states_updated_at();

-- ─── 3) Realtime publication 추가 ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='compositing_states'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE compositing_states;
  END IF;
END $$;

-- DELETE 이벤트 때 'old' payload 가 모든 컬럼을 포함하도록 REPLICA IDENTITY FULL 지정.
-- 기본값(REPLICA IDENTITY DEFAULT)은 PK 만 포함하므로 episode_number/scene_id 없이 들어와
-- 렌더러의 rowToCompositingState 가 어느 씬의 row 인지 못 알아내는 문제 방지.
ALTER TABLE compositing_states REPLICA IDENTITY FULL;

-- ─── 4) scenes.duration_frames 컬럼 추가 (24fps 기준 프레임, 정수) ───
-- 입력 UI 는 후속 spec (docs/superpowers/specs/2026-05-21-premiere-clip-length-import-design.md).
-- 컴포지팅 대시보드 MVP 에는 비어있는 상태로 두고 AE 패널은 "씬 인덱스" fallback 사용.
ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS duration_frames INTEGER NULL;

COMMENT ON COLUMN scenes.duration_frames IS
  'v1.30.0~ 씬 길이 (24fps 기준 프레임 단위). NULL = 미입력. 후속 spec(Premiere 추출)에서 자동 채움 예정.';

-- ─── 5) (옵션) 활동 로그 통합 — 단계 변경 시 activities 테이블에 기록 ───
-- 본 PR 1 에서는 추가 작업 안 함. PR 3 의 단계 토글 흐름에서 supabaseService 가
-- 직접 INSERT/UPSERT activities. 필요 시 후속 PR 에서 트리거 도입 검토.
