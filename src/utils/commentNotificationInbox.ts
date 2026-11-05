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
/** 이어 읽기 안전 상한(쪽 크기 200 × 쪽 5 × 20번 = 2만 줄). */
const MAX_ROUNDS = 20;
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

  /** 한 번에 읽는 쪽 수 한도로 멈췄으면 남은 줄을 이어서 읽는다(코덱스 2차 — 꺼져 있던 동안 1,000줄이 넘게 쌓여도 최근 줄까지).
   *  이어 읽는 몫은 늘 조용히 넣는다(한꺼번에 많이 온 것). 안전 상한 MAX_ROUNDS 번. */
  async function run(mode: CommentNotificationPullMode, initial: CommentNotificationCursor | null, options: CommentNotificationPullOptions): Promise<CommentNotificationPullResult> {
    let presented = 0;
    let quieted = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const result = await runOnce(mode, initial, options, round > 0);
      if (result.status !== 'done') {
        return round === 0 ? { status: result.status, presented: 0, quieted: false } : { status: 'done', presented, quieted };
      }
      presented += result.presented;
      quieted = quieted || result.quieted || (round > 0 && result.presented > 0 && mode === 'live');
      if (!result.more) break;
    }
    return { status: 'done', presented, quieted };
  }

  async function runOnce(
    mode: CommentNotificationPullMode,
    initial: CommentNotificationCursor | null,
    options: CommentNotificationPullOptions,
    continuation: boolean,
  ): Promise<CommentNotificationPullResult & { more: boolean }> {
    if (disposed) return { status: 'failed', presented: 0, quieted: false, more: false };
    const st = current(initial);
    const start = st.cursor;
    const seen = new Set(st.seen);
    const fresh: CommentNotificationRow[] = [];
    let next: CommentNotificationCursor | null = start
      ? { at: new Date(timeOf(start.at) - overlapMs).toISOString(), id: null }
      : null;
    let newest = start;
    let more = false;
    try {
      // 쪽 수 한도는 커서를 넘어선 쪽만 센다 — 겹쳐 다시 읽는 쪽이 한도를 다 써서 새 줄에 못 닿는 일이 없게(안전 상한은 따로).
      let newPages = 0;
      for (let total = 0; total < maxPages + 50; total++) {
        const result = await deps.list(next, pageSize);
        if (disposed) return { status: 'failed', presented: 0, quieted: false, more: false };
        if (!result.available) return { status: 'unavailable', presented: 0, quieted: false, more: false };
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
        // 한도에 닿았는데 쪽이 꽉 찼다 — 남은 줄이 있을 수 있으니 저장한 뒤 이어서 읽는다(run).
        if (newPages >= maxPages) { more = true; break; }
      }
    } catch {
      return { status: 'failed', presented: 0, quieted: false, more: false };
    }
    const shown = options.show ? fresh.filter((row) => { try { return options.show!(row); } catch { return false; } }) : fresh;
    const quiet = mode === 'catchup' || continuation || more || shown.length > liveBurst;
    let presented = 0;
    if (shown.length > 0) {
      try { presented = deps.present(shown, quiet); } catch { /* 화면 오류가 커서를 막지 않는다 — 다시 읽어도 본 줄로 거른다 */ }
    }
    // 본 줄: 다음 읽기가 다시 읽는 구간(새 커서 − OVERLAP 이후)의 줄은 개수와 상관없이 모두 남긴다 — 잘라 내면 다시 켰을 때
    //   그 줄이 새 줄로 보여 지운 알림이 되살아난다(코덱스 2차). 그보다 오래된(OVERLAP 두 배 안쪽) 줄은 seenLimit 개까지만.
    const newestAt = newest ? timeOf(newest.at) : Infinity;
    const keepAll: string[] = [];
    const older: string[] = [];
    for (const key of seen) {
      const at = Number(key.slice(key.lastIndexOf('@') + 1));
      if (at >= newestAt - overlapMs) keepAll.push(key);
      else if (at >= newestAt - overlapMs * 2) older.push(key);
    }
    state = { cursor: newest, seen: [...older.slice(-seenLimit), ...keepAll] };
    if (newest) {
      try { deps.saveState(state); } catch { /* 저장소가 막혀도 이 세션은 메모리로 계속 */ }
    }
    return { status: 'done', presented, quieted: quiet && mode === 'live', more };
  }

  /** 아직 시작하지 않은 다음 읽기 — 그사이 온 요청은 여기에 합친다(서버 비용 점검: 재연결 때 신호·놓친 알림 모으기가 겹쳐 두 번 읽던 것). */
  let queued: { mode: CommentNotificationPullMode; initial: CommentNotificationCursor | null; promise: Promise<CommentNotificationPullResult> } | null = null;

  return {
    /**
     * 한 줄로 세워 읽는다. initial 은 저장된 커서가 없을 때 시작점(예전 놓친 알림 기준 시각에서).
     * 아직 시작하지 않은 읽기가 있으면 새로 줄 세우지 않고 그 읽기에 합친다 — 그 읽기는 이 요청보다 늦게 서버를 읽으므로
     * 놓치는 줄이 없다. 하나라도 catchup 이면 합친 읽기는 catchup(조용히). show 로 줄을 고르는 요청(첫 실행)은 합치지 않는다.
     */
    pull(mode: CommentNotificationPullMode, initial: CommentNotificationCursor | null = null, options: CommentNotificationPullOptions = {}): Promise<CommentNotificationPullResult> {
      if (queued && !options.show) {
        if (mode === 'catchup') queued.mode = 'catchup';
        queued.initial ??= initial;
        return queued.promise;
      }
      const entry: { mode: CommentNotificationPullMode; initial: CommentNotificationCursor | null; promise: Promise<CommentNotificationPullResult> } = {
        mode, initial, promise: Promise.resolve({ status: 'failed', presented: 0, quieted: false }),
      };
      const start = () => {
        if (queued === entry) queued = null;
        return run(entry.mode, entry.initial, options);
      };
      entry.promise = tail.then(start, start);
      tail = entry.promise.catch(() => undefined);
      if (!options.show) queued = entry;
      return entry.promise;
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
