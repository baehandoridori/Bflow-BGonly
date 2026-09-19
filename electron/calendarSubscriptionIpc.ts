import { ipcMain } from 'electron';
import { isCalendarFeedId, validateCalendarFeedRequest } from '../src/shared/calendarSubscription';
import type { CalendarFeedRequest, CalendarFeedResult, CalendarFeedStatus } from '../src/shared/calendarSubscription';

interface Dependencies {
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  service: { status(actorId: string, calendarId: string): Promise<CalendarFeedStatus>; manage(actorId: string, request: CalendarFeedRequest): Promise<CalendarFeedResult> };
  ipc?: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void };
}
export function registerCalendarSubscriptionIpc(deps: Dependencies): void {
  const ipc = deps.ipc ?? ipcMain;
  for (const action of ['status', 'manage'] as const) {
    ipc.handle(`calendar-feed:${action}`, async (_event, input, requestEpoch) => {
      const origin = { ...deps.getSessionOriginOrThrow() };
      if (!Number.isSafeInteger(requestEpoch) || origin.epoch !== requestEpoch) throw new Error('로그인 세션이 변경되었습니다.');
      let result: CalendarFeedResult;
      if (action === 'status') {
        if (!isCalendarFeedId(input)) throw new Error('캘린더 식별자가 올바르지 않습니다.');
        result = await deps.service.status(origin.userId, input);
      } else {
        validateCalendarFeedRequest(input);
        result = await deps.service.manage(origin.userId, input);
      }
      const current = deps.getSessionOriginOrThrow();
      if (origin.userId !== current.userId || origin.epoch !== current.epoch) throw new Error('로그인 세션이 변경되어 구독 응답을 폐기했습니다.');
      return result;
    });
  }
}
