-- DEVLOG/migrations/2026-08-27-calendar-notification-catchup.sql
-- 캘린더 알림 catch-up: 큰 숨김 목록도 POST RPC 본문으로 안전하게 전달한다.
-- 재실행 안전(idempotent). 라이브 적용은 PR 머지 후 한솔의 별도 수동 SQL 게이트에서만 하며, 이 세션에서는 실행하지 않는다.

-- 읽지 않은 수신자 알림을 최신순으로 고정 200개만 반환한다.
-- NULL calendar_id는 삭제된 캘린더의 알림이므로 anti-join 대상에서 의도적으로 보존한다.
CREATE OR REPLACE FUNCTION public.list_calendar_notifications_authorized(
  p_actor_id TEXT,
  p_since TIMESTAMPTZ,
  p_excluded_calendar_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS SETOF public.calendar_notifications
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
STABLE
AS $$
  WITH excluded_calendar_ids AS (
    SELECT DISTINCT input.excluded_calendar_id
    FROM unnest(COALESCE(p_excluded_calendar_ids, ARRAY[]::UUID[]))
      AS input(excluded_calendar_id)
    WHERE input.excluded_calendar_id IS NOT NULL
  )
  SELECT notification.*
  FROM public.calendar_notifications AS notification
  LEFT JOIN excluded_calendar_ids AS excluded
    ON excluded.excluded_calendar_id = notification.calendar_id
  WHERE EXISTS (
      SELECT 1
      FROM public.users AS actor
      WHERE actor.id = p_actor_id
    )
    AND notification.recipient_id = p_actor_id
    AND notification.read_at IS NULL
    AND notification.created_at >= p_since
    AND excluded.excluded_calendar_id IS NULL
  ORDER BY notification.created_at DESC, notification.id DESC
  LIMIT 200;
$$;

COMMENT ON FUNCTION public.list_calendar_notifications_authorized(TEXT, TIMESTAMPTZ, UUID[]) IS
  'actor 존재·수신자 일치·미읽음·기간과 숨김 캘린더 anti-join을 정렬/200개 제한 전에 적용해, 삭제 알림(NULL calendar_id)은 보존하는 SECURITY INVOKER catch-up 조회 RPC.';

CREATE INDEX IF NOT EXISTS idx_calendar_notifications_unread_recipient_created_id
  ON public.calendar_notifications (recipient_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;
