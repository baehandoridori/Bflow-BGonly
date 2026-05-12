-- v1.25.8 씬 담당자 배정 알림 catch-up 테이블
-- 작성일: 2026-05-12
-- 한솔 보고: 미접속 시 담당자 배정 알림이 사라짐 (broadcast 만 의존).
-- acting_feedback_notifications 와 동일한 catch-up 패턴 복제.
-- 멱등 — 재실행 안전.

CREATE TABLE IF NOT EXISTS scene_assignment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL,
  sender_name TEXT NOT NULL,
  recipient_id UUID NOT NULL,
  scene_uuid UUID NOT NULL,
  scene_id TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  prev_assignee TEXT,
  new_assignee TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_san_recipient_created
  ON scene_assignment_notifications(recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_san_recipient_unread
  ON scene_assignment_notifications(recipient_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE scene_assignment_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all ON scene_assignment_notifications;
CREATE POLICY allow_all ON scene_assignment_notifications
  FOR ALL
  USING (true)
  WITH CHECK (true);
