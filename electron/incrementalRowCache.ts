/**
 * '바뀐 것만 받기' 캐시 (v1.144.0, 2026-10-21 서버 전송 한도 초과 뒤 근본 대책).
 *
 * 예전에는 받을 때마다 씬 전체(약 1.7MB)와 메타데이터 전체(약 0.4MB)를 처음부터 다시 받았다. 그래서 데이터가 쌓일수록
 * 매번 주고받는 양이 커졌고(4월 375씬 → 10월 2,908씬), 켜 둔 PC 가 많던 10월에 서버 업체의 전송 한도를 넘어 접속이 막혔다.
 *
 * 이제 메인 프로세스가 마지막으로 받은 행을 기억해 두고, 다음부터는 수정 시각(updated_at)이 최근인 행만 받아 덧붙인다.
 * - 지운 행은 수정 시각이 남지 않는다 → 서버의 행 개수와 맞춰 보고, 다르면 그때만 전부 다시 받는다.
 * - 수정 시각은 각 PC 의 시계로 적힌다 → 마지막으로 받기 시작한 때보다 overlapMs(기본 10분) 앞부터 다시 받아 시계 차이를 견딘다.
 * - 그래도 놓친 행이 있을 수 있으니 fullEveryMs(기본 1시간)마다, 그리고 직접 새로고침 때는 전부 다시 받는다.
 * - 범위(scope)는 씬이라면 '보관하지 않은 에피소드의 파트'다. 범위에 새로 들어온 묶음(새 파트, 보관 해제)은 그 묶음만 전부 받는다.
 * - 같은 때 여러 창이 부르면 한 번만 받고 결과를 나눠 준다(본 창·위젯 창이 같은 메인 프로세스를 쓴다).
 *
 * node --test 가 그대로 import 하도록 런타임 의존이 없다.
 */

export interface IncrementalRowCacheDeps<Row> {
  /** 행의 고유 키 */
  keyOf(row: Row): string;
  /** 행이 속한 범위 묶음(씬이면 part_id). 범위가 하나뿐이면 상수를 돌려준다. */
  groupOf(row: Row): string;
  /** 주어진 묶음의 행을 전부 받는다(쪽 나누기는 호출한 쪽이 맡는다). */
  fetchAll(groups: string[]): Promise<Row[]>;
  /** 주어진 묶음에서 sinceIso 보다 나중에 고쳐진 행만 받는다. */
  fetchChangedSince(groups: string[], sinceIso: string): Promise<Row[]>;
  /** 주어진 묶음의 서버 행 개수 */
  count(groups: string[]): Promise<number>;
  now?: () => number;
  fullEveryMs?: number;
  overlapMs?: number;
}

export type IncrementalSyncMode = 'full' | 'delta';

export interface IncrementalSyncResult<Row> {
  rows: Row[];
  mode: IncrementalSyncMode;
  /** 이번에 서버에서 실제로 받은 행 수(전송량 확인용) */
  fetched: number;
}

export interface IncrementalRowCache<Row> {
  sync(groups: string[], options?: { force?: boolean }): Promise<IncrementalSyncResult<Row>>;
  /** 기억한 행을 버린다(다음 받기는 전부) */
  reset(): void;
}

export const DEFAULT_FULL_EVERY_MS = 60 * 60_000;
export const DEFAULT_OVERLAP_MS = 10 * 60_000;

export function createIncrementalRowCache<Row>(deps: IncrementalRowCacheDeps<Row>): IncrementalRowCache<Row> {
  const now = deps.now ?? (() => Date.now());
  const fullEveryMs = deps.fullEveryMs ?? DEFAULT_FULL_EVERY_MS;
  const overlapMs = deps.overlapMs ?? DEFAULT_OVERLAP_MS;

  let rows = new Map<string, Row>();
  let knownGroups = new Set<string>();
  let lastFullAt: number | null = null;
  /** 마지막으로 성공한 받기를 시작한 때(이 PC 시계). 다음 받기는 여기서 overlapMs 앞부터. */
  let lastSyncStartedAt: number | null = null;
  let generation = 0;
  let inFlight: { key: string; promise: Promise<IncrementalSyncResult<Row>> } | null = null;

  const commit = (next: Map<string, Row>, groups: string[], startedAt: number, full: boolean) => {
    rows = next;
    knownGroups = new Set(groups);
    lastSyncStartedAt = startedAt;
    if (full) lastFullAt = startedAt;
  };

  const runFull = async (groups: string[], startedAt: number, gen: number): Promise<IncrementalSyncResult<Row>> => {
    const all = groups.length > 0 ? await deps.fetchAll(groups) : [];
    const next = new Map<string, Row>();
    for (const row of all) next.set(deps.keyOf(row), row);
    if (gen === generation) commit(next, groups, startedAt, true);
    return { rows: [...next.values()], mode: 'full', fetched: all.length };
  };

  const runDelta = async (groups: string[], startedAt: number, gen: number): Promise<IncrementalSyncResult<Row>> => {
    const scope = new Set(groups);
    const fresh = groups.filter((group) => !knownGroups.has(group));
    const known = groups.filter((group) => knownGroups.has(group));
    const sinceIso = new Date((lastSyncStartedAt ?? 0) - overlapMs).toISOString();
    const [freshRows, changedRows, serverCount] = await Promise.all([
      fresh.length > 0 ? deps.fetchAll(fresh) : Promise.resolve([] as Row[]),
      known.length > 0 ? deps.fetchChangedSince(known, sinceIso) : Promise.resolve([] as Row[]),
      groups.length > 0 ? deps.count(groups) : Promise.resolve(0),
    ]);
    const next = new Map<string, Row>();
    for (const [key, row] of rows) {
      if (scope.has(deps.groupOf(row))) next.set(key, row);
    }
    for (const row of freshRows) next.set(deps.keyOf(row), row);
    for (const row of changedRows) next.set(deps.keyOf(row), row);
    if (next.size !== serverCount) {
      // 지운 행이 있거나(수정 시각이 남지 않는다) 받는 사이에 행이 늘었다 → 이번만 전부 다시 받는다.
      const result = await runFull(groups, startedAt, gen);
      return { ...result, fetched: result.fetched + freshRows.length + changedRows.length };
    }
    if (gen === generation) commit(next, groups, startedAt, false);
    return { rows: [...next.values()], mode: 'delta', fetched: freshRows.length + changedRows.length };
  };

  const run = (groups: string[], force: boolean): Promise<IncrementalSyncResult<Row>> => {
    const startedAt = now();
    const gen = generation;
    const needFull = force
      || lastFullAt === null
      || lastSyncStartedAt === null
      || startedAt - lastFullAt >= fullEveryMs;
    return needFull ? runFull(groups, startedAt, gen) : runDelta(groups, startedAt, gen);
  };

  return {
    sync(groups, options = {}) {
      const force = options.force === true;
      const key = `${force ? 'F' : 'D'}|${[...groups].sort().join(',')}`;
      // 같은 범위를 이미 받는 중이면 그 결과를 나눠 쓴다(전부 받기 요청은 진행 중인 '바뀐 것만'에 묻어가지 않는다).
      if (inFlight && inFlight.key === key) return inFlight.promise;
      const previous = inFlight?.promise ?? Promise.resolve();
      const promise = previous
        .catch(() => undefined)
        .then(() => run(groups, force));
      const entry = { key, promise };
      inFlight = entry;
      const clear = () => { if (inFlight === entry) inFlight = null; };
      promise.then(clear, clear);
      return promise;
    },
    reset() {
      generation += 1;
      rows = new Map();
      knownGroups = new Set();
      lastFullAt = null;
      lastSyncStartedAt = null;
    },
  };
}
