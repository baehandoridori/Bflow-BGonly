import type { MarketAdminEvent } from '@/features/playground/market/types';

export type ManageableMarketAdminEventStatus = 'active' | 'scheduled' | 'invalid';

export interface ManageableMarketAdminEvent {
  event: MarketAdminEvent;
  status: ManageableMarketAdminEventStatus;
  startsAtMs: number | null;
}

const STATUS_PRIORITY: Readonly<Record<ManageableMarketAdminEventStatus, number>> = {
  active: 0,
  scheduled: 1,
  invalid: 2,
};

const MARKET_EVENT_START_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function classifyEvent(
  event: MarketAdminEvent,
  nowMs: number,
): ManageableMarketAdminEvent | null {
  const startsAtMs = Date.parse(event.startsAt);
  const endsAtMs = event.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(event.endsAt);
  const validStart = Number.isFinite(startsAtMs);
  const validEnd = event.endsAt === null || Number.isFinite(endsAtMs);
  const validWindow = validStart && validEnd && endsAtMs > startsAtMs;

  if (!Number.isFinite(nowMs) || !validWindow) {
    return {
      event,
      status: 'invalid',
      startsAtMs: validStart ? startsAtMs : null,
    };
  }
  if (endsAtMs <= nowMs) return null;
  return {
    event,
    status: startsAtMs > nowMs ? 'scheduled' : 'active',
    startsAtMs,
  };
}

export function selectManageableMarketAdminEvents(
  events: readonly MarketAdminEvent[],
  nowMs: number,
): ManageableMarketAdminEvent[] {
  return events
    .map((event) => classifyEvent(event, nowMs))
    .filter((row): row is ManageableMarketAdminEvent => row !== null)
    .sort((left, right) => {
      const priorityDifference = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
      if (priorityDifference !== 0) return priorityDifference;
      if (left.startsAtMs !== null && right.startsAtMs !== null) {
        const startDifference = left.startsAtMs - right.startsAtMs;
        if (startDifference !== 0) return startDifference;
      } else if (left.startsAtMs !== right.startsAtMs) {
        return left.startsAtMs === null ? 1 : -1;
      }
      return compareIds(left.event.id, right.event.id);
    });
}

export function formatMarketAdminEventStart(startsAtMs: number): string {
  if (!Number.isFinite(startsAtMs)) return '시간 확인 필요';
  const startsAt = new Date(startsAtMs);
  if (Number.isNaN(startsAt.getTime())) return '시간 확인 필요';
  return MARKET_EVENT_START_FORMATTER.format(startsAt);
}
