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
