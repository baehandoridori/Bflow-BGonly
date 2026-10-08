import { isCalendarFeedId, validateCalendarFeedRequest } from '../shared/calendarSubscription';
import type { CalendarFeedRequest, CalendarFeedResult, CalendarFeedStatus } from '../shared/calendarSubscription';

type Entry = CalendarFeedStatus & { ownerId: string; hash: string | null; token?: string | null };
const key = 'bflow-preview-calendar-feeds-v1';
interface Dependencies {
  owner(calendarId: string): string;
  canRead?(calendarId: string, actorId: string): boolean;
  actor(): { id: string; epoch: number };
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  lock<T>(run: () => Promise<T>): Promise<T>;
}
/** Preview stores only unreachable fake tokens to reproduce reopen and sharing behavior. */
export function createCalendarSubscriptionPreview(deps: Dependencies) {
  function read(): Record<string, Entry> {
    try {
      const raw = deps.storage.getItem(key);
      const rows = raw ? JSON.parse(raw) : {};
      if (!rows || typeof rows !== 'object' || Array.isArray(rows)) throw new Error();
      return rows;
    } catch { throw new Error('구독 상태를 읽지 못했습니다. 다시 확인해 주세요.'); }
  }
  function authorized(calendarId: string, managing = false) {
    if (!isCalendarFeedId(calendarId)) throw new Error('캘린더 식별자가 올바르지 않습니다.');
    const actor = { ...deps.actor() };
    if (!actor.id || (deps.owner(calendarId) !== actor.id && (managing || !deps.canRead?.(calendarId, actor.id)))) throw new Error('캘린더 소유자만 구독을 관리할 수 있습니다.');
    return actor;
  }
  function checkSession(calendarId: string, origin: { id: string; epoch: number }, managing = false) {
    const actor = authorized(calendarId, managing);
    if (actor.id !== origin.id || actor.epoch !== origin.epoch) throw new Error('로그인 세션이 변경되었습니다.');
    return actor;
  }
  // Caller holds the shared lock: observing a different owner permanently removes
  // the old binding. Source mutation handlers also call invalidate, so a transfer
  // away and back cannot resurrect a token between reads.
  function statusLocked(calendarId: string): CalendarFeedStatus {
    authorized(calendarId);
    const rows = read();
    let row: Entry | undefined = rows[calendarId];
    if (row && row.ownerId !== deps.owner(calendarId)) {
      delete rows[calendarId];
      deps.storage.setItem(key, JSON.stringify(rows));
      row = undefined;
    }
    // Upgrade older preview hash-only rows once under the shared lock. These
    // tokens are unreachable demo data; production uses a migration and Vault.
    if (row?.enabled && !row.token) {
      row.token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      deps.storage.setItem(key, JSON.stringify(rows));
    }
    return row
      ? { calendarId, enabled: row.enabled, issuedAt: row.enabled ? row.issuedAt : null, revision: row.revision, preview: true, ...(row.enabled && row.token ? { url: `https://bflow-preview.invalid/calendar-feed/${row.token}.ics` } : {}) }
      : { calendarId, enabled: false, issuedAt: null, revision: null, preview: true };
  }
  return {
    async status(calendarId: string): Promise<CalendarFeedStatus> {
      const origin = authorized(calendarId);
      const result = await deps.lock(async () => {
        checkSession(calendarId, origin);
        return statusLocked(calendarId);
      });
      checkSession(calendarId, origin);
      return result;
    },
    /** Internal source lifecycle hook; not exposed as a renderer feed command. */
    async invalidate(calendarId: string): Promise<void> {
      if (!isCalendarFeedId(calendarId)) throw new Error('캘린더 식별자가 올바르지 않습니다.');
      await deps.lock(async () => {
        const rows = read();
        if (rows[calendarId]) {
          delete rows[calendarId];
          deps.storage.setItem(key, JSON.stringify(rows));
        }
      });
    },
    async manage(request: CalendarFeedRequest): Promise<CalendarFeedResult> {
      validateCalendarFeedRequest(request);
      const origin = authorized(request.calendarId, true);
      let token: string | null = null, hash: string | null = null;
      if (request.action !== 'revoke') {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), n => n.toString(16).padStart(2, '0')).join('');
      }
      const result = await deps.lock(async () => {
        const actor = checkSession(request.calendarId, origin, true);
        const before = statusLocked(request.calendarId);
        if (request.action === 'revoke' && !before.enabled) return before;
        if (request.expectedRevision !== before.revision) throw new Error('구독 상태가 변경됐습니다. 새로고침해 주세요.');
        if (request.action === 'enable' && before.enabled) throw new Error('이미 구독 중입니다. 주소 교체를 사용해 주세요.');
        if (request.action === 'rotate' && !before.enabled) throw new Error('구독 주소를 먼저 발급해 주세요.');
        const row: Entry = {
          calendarId: request.calendarId, ownerId: actor.id, enabled: request.action !== 'revoke',
          issuedAt: request.action === 'revoke' ? null : new Date().toISOString(),
          revision: crypto.randomUUID(), hash, token, preview: true,
        };
        const rows = read();
        rows[request.calendarId] = row;
        deps.storage.setItem(key, JSON.stringify(rows));
        return { ...statusLocked(request.calendarId), ...(row.enabled ? { url: `https://bflow-preview.invalid/calendar-feed/${token}.ics` } : {}) };
      });
      // Web Locks resolves asynchronously after its callback. A session change in
      // that interval must not deliver the previous user's bearer URL.
      checkSession(request.calendarId, origin, true);
      return result;
    },
  };
}
