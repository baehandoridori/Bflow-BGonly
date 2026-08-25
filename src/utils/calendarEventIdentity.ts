import type { CalendarEvent } from '@/types/calendar';

/**
 * 일정 ID는 Google, legacy private, B flow 캘린더 사이에서 겹칠 수 있다.
 * canonical B flow 행의 UUID는 전체 캘린더에서 유일하고 calendar ID는 이동 시 바뀌므로,
 * `bflow:` 자체만 저장소 namespace로 취급한다. 그 밖의 저장소는 원본 calendar ID까지 구분한다.
 */
export function hasSameCalendarEventIdentity(
  left: Pick<CalendarEvent, 'id' | 'source' | 'sourceCalendarId'>,
  right: Pick<CalendarEvent, 'id' | 'source' | 'sourceCalendarId'>,
): boolean {
  if (left.id !== right.id || left.source !== right.source) return false;

  const leftIsCanonicalBflow = left.source === 'bflow' && left.sourceCalendarId?.startsWith('bflow:') === true;
  const rightIsCanonicalBflow = right.source === 'bflow' && right.sourceCalendarId?.startsWith('bflow:') === true;
  if (leftIsCanonicalBflow || rightIsCanonicalBflow) {
    return leftIsCanonicalBflow && rightIsCanonicalBflow;
  }

  if (left.sourceCalendarId !== undefined || right.sourceCalendarId !== undefined) {
    return left.sourceCalendarId === right.sourceCalendarId;
  }
  return true;
}
