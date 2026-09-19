import { createHash, randomBytes } from 'node:crypto';
import { isCalendarFeedId, validateCalendarFeedRequest } from '../src/shared/calendarSubscription';
import type { CalendarFeedRequest, CalendarFeedResult, CalendarFeedStatus } from '../src/shared/calendarSubscription';

interface Dependencies {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  tokenFor(actorId: string): string;
  baseUrl: string;
}
export function createCalendarSubscriptionService(deps: Dependencies) {
  async function call(name: string, args: Record<string, unknown>): Promise<CalendarFeedStatus> {
    const { data, error } = await Promise.resolve(deps.rpc(name, args)).catch(() => {
      throw new Error('구독 서버에 연결하지 못했습니다. 상태를 새로고침해 주세요.');
    });
    // Never propagate transport errors that could contain the session token or bearer URL.
    if (error) throw new Error(error.code === '42501'
      ? '캘린더 소유자만 구독을 관리할 수 있습니다. 로그인 상태를 확인해 주세요.'
      : '구독 설정을 저장하지 못했습니다. 상태를 새로고침한 뒤 다시 시도해 주세요.');
    const status = data as CalendarFeedStatus | null;
    if (!status || !isCalendarFeedId(status.calendarId) || typeof status.enabled !== 'boolean'
      || !(status.revision === null || isCalendarFeedId(status.revision))
      || !(status.issuedAt === null || typeof status.issuedAt === 'string')) throw new Error('구독 상태를 확인하지 못했습니다.');
    return { calendarId: status.calendarId, enabled: status.enabled, issuedAt: status.issuedAt, revision: status.revision };
  }
  return {
    async status(actorId: string, calendarId: string) {
      if (!isCalendarFeedId(calendarId)) throw new Error('캘린더 식별자가 올바르지 않습니다.');
      const result = await call('calendar_session_feed_status', { p_session_token: deps.tokenFor(actorId), p_calendar_id: calendarId });
      if (result.calendarId !== calendarId) throw new Error('구독 상태가 요청한 캘린더와 다릅니다.');
      return result;
    },
    async manage(actorId: string, request: CalendarFeedRequest): Promise<CalendarFeedResult> {
      validateCalendarFeedRequest(request);
      const sessionToken = deps.tokenFor(actorId);
      const token = request.action === 'revoke' ? null : randomBytes(32).toString('base64url');
      const status = await call('calendar_session_feed_manage', {
        p_session_token: sessionToken, p_calendar_id: request.calendarId, p_action: request.action,
        p_token_hash: token ? createHash('sha256').update(token).digest('hex') : null,
        p_expected_revision: request.expectedRevision,
      });
      if (status.calendarId !== request.calendarId || status.enabled !== (request.action !== 'revoke')
        || (status.enabled && (!status.revision || !status.issuedAt))) throw new Error('구독 저장 결과를 확인하지 못했습니다.');
      return token ? { ...status, url: `${deps.baseUrl.replace(/\/$/, '')}/functions/v1/calendar-feed/${token}.ics` } : status;
    },
  };
}
