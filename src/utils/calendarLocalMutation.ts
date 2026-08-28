import type { CalendarEvent } from '@/types/calendar';
import { buildEventSnapshot } from '@/utils/calendarEventDiff';
import { calendarEventIdentityKey } from '@/utils/calendarEventIdentity';

/**
 * 저장/삭제가 진행 중이거나 실패한 뒤, 정본 스냅샷이 "내가 만든 변화"인지 "동료의 변경"인지
 * 구분하기 위한 기록이다. 저장이 오래 걸려 낙관적 갱신이 먼저 렌더되면 정본 스냅샷은
 * rollbackSnapshot이 아니라 optimisticSnapshot과 일치하므로, 두 값을 모두 로컬 변화로 본다.
 */
export type LocalMutationRecovery = {
  identityKey: string;
  rollbackSnapshot: string;
  optimisticSnapshot?: string;
};

export function eventContentSnapshot(event: CalendarEvent): string {
  return buildEventSnapshot([event]).get(calendarEventIdentityKey(event)) ?? '';
}

/**
 * 낙관적 갱신은 store가 아니라 편집기가 보낸 updates를 그대로 얹는다. 날짜가 비었거나
 * 뒤집힌 입력은 store와 같은 규칙으로 정규화해야 실제 렌더 결과와 스냅샷이 어긋나지 않는다.
 */
export function directUpdateSnapshot(event: CalendarEvent, updates: Partial<CalendarEvent>): string {
  const normalized = { ...updates };
  if ('startDate' in normalized && !normalized.startDate) delete normalized.startDate;
  if ('endDate' in normalized && !normalized.endDate) delete normalized.endDate;
  if (normalized.startDate && normalized.endDate && normalized.endDate < normalized.startDate) {
    [normalized.startDate, normalized.endDate] = [normalized.endDate, normalized.startDate];
  }
  return eventContentSnapshot({ ...event, ...normalized });
}

export function isLocalMutationSnapshot(mutation: LocalMutationRecovery, snapshot: string): boolean {
  return snapshot === mutation.rollbackSnapshot || snapshot === mutation.optimisticSnapshot;
}

/**
 * 캘린더를 옮기면 calendarService의 낙관 반영이 목적지 캘린더의 색·권한까지 파생해 얹는다.
 * 스냅샷을 만들 때 그 파생을 빼먹으면 실제 화면과 값이 어긋나 "내가 만든 변화"를
 * 동료 변경으로 오인하고, 저장 실패 안내 대신 조용히 원복해 버린다.
 */
export function withCalendarPresentationForSnapshot(
  event: CalendarEvent,
  updates: Partial<CalendarEvent>,
  calendars: ReadonlyArray<{ id: string; color?: string; canEdit?: boolean; isPersonal?: boolean }>,
): Partial<CalendarEvent> {
  if (updates.calendarId === undefined || event.source !== 'bflow') return updates;
  const destination = calendars.find((calendar) => calendar.id === updates.calendarId);
  const canEdit = destination?.canEdit ?? false;
  return {
    ...updates,
    source: 'bflow',
    sourceCalendarId: `bflow:${updates.calendarId}`,
    calendarId: updates.calendarId,
    color: destination?.color ?? '#6C5CE7',
    canEdit,
    isReadOnly: !canEdit,
    isPrivate: destination?.isPersonal === true,
  };
}
