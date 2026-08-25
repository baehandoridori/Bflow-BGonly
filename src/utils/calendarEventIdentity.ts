import type { CalendarEvent } from '@/types/calendar';

export type CalendarEventIdentity = Pick<CalendarEvent, 'id' | 'source' | 'sourceCalendarId'>;
export type CalendarEventTodoLink = Pick<CalendarEvent, 'id' | 'source' | 'linkedTodoId'>;

export function snapshotCalendarEventIdentity(event: CalendarEventIdentity): CalendarEventIdentity {
  return {
    id: event.id,
    source: event.source,
    sourceCalendarId: event.sourceCalendarId,
  };
}

export function calendarEventIdentityKey(event: CalendarEventIdentity): string {
  const isCanonicalBflow = event.source === 'bflow'
    && event.sourceCalendarId?.startsWith('bflow:') === true;
  if (isCanonicalBflow) return `bflow\u0000${event.id}`;
  return `${event.source ?? ''}\u0000${event.sourceCalendarId ?? ''}\u0000${event.id}`;
}

/**
 * 일정 ID는 Google, legacy private, B flow 캘린더 사이에서 겹칠 수 있다.
 * canonical B flow 행의 UUID는 전체 캘린더에서 유일하고 calendar ID는 이동 시 바뀌므로,
 * `bflow:` 자체만 저장소 namespace로 취급한다. 그 밖의 저장소는 원본 calendar ID까지 구분한다.
 */
export function hasSameCalendarEventIdentity(
  left: CalendarEventIdentity,
  right: CalendarEventIdentity,
): boolean {
  return calendarEventIdentityKey(left) === calendarEventIdentityKey(right);
}

/**
 * linkedTodoId는 provider와 무관한 명시적 연결이다. 구형 cal_* ID 규칙은 B flow의
 * 로컬 일정에만 존재했으므로 Google provider ID에는 적용하지 않는다.
 */
export function calendarEventLinkedTodoId(event: CalendarEventTodoLink): string | undefined {
  if (event.linkedTodoId) return event.linkedTodoId;
  const isLegacyLocal = event.source === 'bflow' || event.source === undefined;
  return isLegacyLocal && event.id.startsWith('cal_')
    ? event.id.slice('cal_'.length)
    : undefined;
}
