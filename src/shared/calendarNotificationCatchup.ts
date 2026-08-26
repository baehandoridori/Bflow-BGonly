/** 캘린더 알림 catch-up은 한 번에 이 수만 renderer로 보낸다. */
export const CALENDAR_NOTIFICATION_CATCHUP_LIMIT = 200;

/**
 * 숨김 캘린더 ID는 authorized RPC의 POST `UUID[]` 본문으로만 전달된다.
 * DB/프리뷰 모두 UUID를 사용하므로, 전송 전 허용 목록으로 입력을 좁힌다.
 */
const CALENDAR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CalendarNotificationCatchupInput {
  excludedCalendarIds?: string[];
}

/** renderer 입력에서 안전한 UUID만 소문자·중복 제거 상태로 남긴다. */
export function normalizeCalendarNotificationCatchupInput(
  input: unknown,
): Required<CalendarNotificationCatchupInput> {
  const rawIds = input
    && typeof input === 'object'
    && Array.isArray((input as { excludedCalendarIds?: unknown }).excludedCalendarIds)
    ? (input as { excludedCalendarIds: unknown[] }).excludedCalendarIds
    : [];
  const seen = new Set<string>();
  const excludedCalendarIds: string[] = [];

  for (const rawId of rawIds) {
    if (typeof rawId !== 'string') continue;
    const id = rawId.trim().toLowerCase();
    if (!CALENDAR_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    excludedCalendarIds.push(id);
  }

  return { excludedCalendarIds };
}
