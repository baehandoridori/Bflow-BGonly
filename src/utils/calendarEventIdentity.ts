import type { CalendarEvent } from '@/types/calendar';

/**
 * 일정 ID는 Google, legacy private, B flow 캘린더 사이에서 겹칠 수 있다.
 * 열린 UI state를 정본 행으로 교체할 때는 저장소 출처까지 같은 행만 허용한다.
 */
export function hasSameCalendarEventIdentity(
  left: Pick<CalendarEvent, 'id' | 'source' | 'sourceCalendarId'>,
  right: Pick<CalendarEvent, 'id' | 'source' | 'sourceCalendarId'>,
): boolean {
  if (left.id !== right.id || left.source !== right.source) return false;
  if (left.sourceCalendarId !== undefined || right.sourceCalendarId !== undefined) {
    return left.sourceCalendarId === right.sourceCalendarId;
  }
  return true;
}
