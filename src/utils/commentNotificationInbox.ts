/**
 * 씬 댓글 서버 알림 받기함(씬 댓글 B안 PR 6) — '내 줄'을 커서 뒤로 읽어 화면 알림으로 넘긴다.
 *
 *  - 로그인·재연결(catchup): 조용히 목록에만 넣고 '놓친 알림 N개' 요약 한 번(예전 놓친 멘션 모으기 자리).
 *  - 서버 신호(live): 새 줄을 실시간 알림처럼 띄운다. 한 번에 여러 줄(끊겼다 붙은 직후 등)이면 catchup 처럼 조용히.
 *  - 커서는 (서버 시각, 줄 id). 읽을 때 OVERLAP 만큼 앞당겨 다시 읽는다 — 먼저 시작해 늦게 커밋된 줄을 건너뛰지 않게.
 *    다시 읽은 줄은 '본 줄'(줄 id@시각) 기억으로 거른다. 본 줄은 커서와 같이 이 PC 에 저장해, 앱을 다시 켜도
 *    지운 알림이 되살아나지 않는다(수정으로 다시 고쳐진 줄은 시각이 바뀌어 새 줄로 본다).
 *  - 요청은 한 줄로 세운다(겹쳐 읽지 않게). 서버에 래퍼가 없으면(DB 적용 전) 'unavailable' — 호출자가 예전 길로 간다.
 *  - show 로 이번 읽기에서 화면에 넘길 줄을 고를 수 있다(업데이트 뒤 첫 실행 — 예전 버전이 이미 보여 준 줄). 고르지 않은 줄도
 *    본 줄·커서에는 넣는다(다음 읽기에서 다시 나오지 않게).
 * 런타임 import 가 없어 node --test 가 바로 불러 쓴다.
 */

import type { CommentNotificationCursor, CommentNotificationListResult, CommentNotificationRow } from '../shared/commentNotification.ts';

export type CommentNotificationPullMode = 'catchup' | 'live';
export type CommentNotificationPullStatus = 'done' | 'unavailable' | 'failed';

export interface CommentNotificationInboxState {
  cursor: CommentNotificationCursor | null;
  /** 커서 근처에서 이미 본 줄('줄 id@서버 시각'). */
  seen: string[];
}

export interface CommentNotificationInboxDeps {
  list(cursor: CommentNotificationCursor | null, limit: number): Promise<CommentNotificationListResult>;
  /** 새 줄을 화면에 넘긴다. 'quiet' 면 목록에만. 새로 알린(목록에 없던 안 읽은) 수를 돌려준다. */
  present(rows: readonly CommentNotificationRow[], quiet: boolean): number;
  loadState(): CommentNotificationInboxState | null;
  saveState(state: CommentNotificationInboxState): void;
}

export interface CommentNotificationInboxOptions {
  overlapMs?: number;
  pageSize?: number;
  maxPages?: number;
  /** live 한 번에 이보다 많으면 조용히(요약은 호출자 몫). */
  liveBurst?: number;
  seenLimit?: number;
}

export interface CommentNotificationPullOptions {
  /** 화면에 넘길 줄만 참. 없으면 모두. */
  show?: (row: CommentNotificationRow) => boolean;
}

export interface CommentNotificationPullResult {
  status: CommentNotificationPullStatus;
  /** 새로 알린 수(catchup 요약, live 가 조용히 넣었을 때 요약). */
  presented: number;
  /** live 가 여러 줄이라 조용히 넣었는가. */
  quieted: boolean;
}

const rowKey = (row: Pick<CommentNotificationRow, 'id' | 'eventAt'>) => `${row.id}@${Date.parse(row.eventAt)}`;
const timeOf = (iso: string) => Date.parse(iso);
const later = (a: CommentNotificationCursor, b: CommentNotificationRow) => {
  const at = timeOf(a.at), bt = timeOf(b.eventAt);
  if (bt !== at) return bt > at;
  return (b.id > (a.id ?? ''));
};

export function createCommentNotificationInbox(deps: CommentNotificationInboxDeps, options: CommentNotificationInboxOptions = {}) {
  const overlapMs = options.overlapMs ?? 2 * 60 * 1000;
  const pageSize = options.pageSize ?? 200;
  const maxPages = options.maxPages ?? 5;
  const liveBurst = options.liveBurst ?? 3;
  const seenLimit = options.seenLimit ?? 300;
  let state: CommentNotificationInboxState | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let disposed = false;

  function current(initial: CommentNotificationCursor | null): CommentNotificationInboxState {
    if (!state) {
      const saved = deps.loadState();
      state = saved && saved.cursor ? { cursor: saved.cursor, seen: [...saved.seen] } : { cursor: initial, seen: [] };
    }
    if (!state.cursor && initial) state.cursor = initial;
    return state;
  }

  async function run(mode: CommentNotificationPullMode, initial: CommentNotificationCursor | null, options: CommentNotificationPullOptions): Promise<CommentNotificationPullResult> {
    if (disposed) return { status: 'failed', presented: 0, quieted: false };
    const st = current(initial);
    const start = st.cursor;
    const seen = new Set(st.seen);
    const fresh: CommentNotificationRow[] = [];
    let next: CommentNotificationCursor | null = start
      ? { at: new Date(timeOf(start.at) - overlapMs).toISOString(), id: null }
      : null;
    let newest = start;
    try {
      // 쪽 수 한도는 커서를 넘어선 쪽만 센다 — 겹쳐 다시 읽는 쪽이 한도를 다 써서 새 줄에 못 닿는 일이 없게(안전 상한은 따로).
      let newPages = 0;
      for (let total = 0; newPages < maxPages && total < maxPages + 50; total++) {
        const result = await deps.list(next, pageSize);
        if (disposed) return { status: 'failed', presented: 0, quieted: false };
        if (!result.available) return { status: 'unavailable', presented: 0, quieted: false };
        for (const row of result.rows) {
          const key = rowKey(row);
          if (!seen.has(key)) { seen.add(key); fresh.push(row); }
          if (!newest || later(newest, row)) newest = { at: row.eventAt, id: row.id };
        }
        if (result.rows.length === 0) break;
        const last = result.rows[result.rows.length - 1]!;
        if (!start || later(start, last)) newPages += 1;
        if (result.rows.length < pageSize) break;
        next = { at: last.eventAt, id: last.id };
      }
    } catch {
      return { status: 'failed', presented: 0, quieted: false };
    }
    const shown = options.show ? fresh.filter((row) => { try { return options.show!(row); } catch { return false; } }) : fresh;
    const quiet = mode === 'catchup' || shown.length > liveBurst;
    let presented = 0;
    if (shown.length > 0) {
      try { presented = deps.present(shown, quiet); } catch { /* 화면 오류가 커서를 막지 않는다 — 다시 읽어도 본 줄로 거른다 */ }
    }
    // 본 줄은 새 커서에서 OVERLAP 의 두 배 안쪽 것만 남긴다(그보다 오래된 줄은 다시 읽히지 않는다).
    const floor = newest ? timeOf(newest.at) - overlapMs * 2 : -Infinity;
    const keep = [...seen].filter((key) => Number(key.slice(key.lastIndexOf('@') + 1)) >= floor).slice(-seenLimit);
    state = { cursor: newest, seen: keep };
    if (newest) {
      try { deps.saveState(state); } catch { /* 저장소가 막혀도 이 세션은 메모리로 계속 */ }
    }
    return { status: 'done', presented, quieted: quiet && mode === 'live' };
  }

  return {
    /** 한 줄로 세워 읽는다. initial 은 저장된 커서가 없을 때 시작점(예전 놓친 알림 기준 시각에서). */
    pull(mode: CommentNotificationPullMode, initial: CommentNotificationCursor | null = null, options: CommentNotificationPullOptions = {}): Promise<CommentNotificationPullResult> {
      const job = tail.then(() => run(mode, initial, options), () => run(mode, initial, options));
      tail = job.catch(() => undefined);
      return job;
    },
    /** 저장된 커서가 있는가(첫 실행 판단). */
    hasCursor(): boolean {
      return !!current(null).cursor;
    },
    /** 로그아웃·계정 전환 — 진행 중이던 응답은 버린다. */
    dispose(): void {
      disposed = true;
      state = null;
    },
  };
}
export type CommentNotificationInbox = ReturnType<typeof createCommentNotificationInbox>;
