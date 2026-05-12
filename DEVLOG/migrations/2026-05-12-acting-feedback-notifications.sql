-- v1.25.5 액팅 피드백 알림 catch-up 테이블
-- 작성일: 2026-05-12
-- 한솔 결정: broadcast 만 의존하면 오프라인/로그아웃 시 영구 손실 → 댓글 멘션 catch-up 흐름과
--           평행 구조로 DB row 영구 저장. 가장 안정·격리·검증된 패턴.
-- 멱등 — 재실행 안전.

CREATE TABLE IF NOT EXISTS acting_feedback_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL,
  sender_name TEXT NOT NULL,
  recipient_id UUID NOT NULL,
  scene_uuid UUID,
  scene_id TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  work_round INTEGER DEFAULT 0,
  feedback_round INTEGER DEFAULT 0,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

-- 받은 사용자별 최신순 조회 (알림 패널 표시용)
CREATE INDEX IF NOT EXISTS idx_afn_recipient_created
  ON acting_feedback_notifications(recipient_id, created_at DESC);

-- 받은 사용자별 미읽음 catch-up (로그인 시)
CREATE INDEX IF NOT EXISTS idx_afn_recipient_unread
  ON acting_feedback_notifications(recipient_id, created_at DESC)
  WHERE read_at IS NULL;

-- RLS — 기존 테이블들과 일관 (allow_all)
ALTER TABLE acting_feedback_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all ON acting_feedback_notifications;
CREATE POLICY allow_all ON acting_feedback_notifications
  FOR ALL
  USING (true)
  WITH CHECK (true);
