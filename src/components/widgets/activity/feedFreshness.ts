/**
 * '최근 작업' — 방금 들어온 줄 고르기 (움직임 폴리싱 9번 teammate-live).
 *
 * - 처음 채울 때·기간/부서를 바꿔 다시 불러올 때·더 불러올 때(reseed)는 모두 '본 것'으로만 기록한다.
 * - 그 뒤 처음 보는 id 이면서 지금까지 본 가장 최근 항목보다 새로운 것만 '새 줄'.
 *   한꺼번에 FEED_FRESH_MAX 개를 넘게 들어오면(다시 연결 후 밀린 기록 등) 새 줄로 치지 않는다.
 * - 새 줄 표시는 FEED_FRESH_KEEP_MS 동안 남는다(바탕 물듦 1.6초가 끝까지 돌도록).
 * node --test 가 그대로 import 하도록 런타임 의존이 없다.
 */

export const FEED_FRESH_MAX = 8;
export const FEED_FRESH_KEEP_MS = 2000;

export interface FeedFreshState {
  seen: ReadonlySet<string>;
  /** 지금까지 본 가장 최근 항목 시각(ms). */
  newestMs: number;
  /** 새 줄 id → 새 줄로 정한 시각. 바뀐 게 없으면 같은 객체를 유지한다(불필요한 다시 그리기 방지). */
  fresh: ReadonlyMap<string, number>;
}

const EMPTY_FRESH: ReadonlyMap<string, number> = new Map();

function timeOf(createdAt: string): number {
  const ms = new Date(createdAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function trackFreshActivities(
  prev: FeedFreshState | null,
  activities: ReadonlyArray<{ id: string; createdAt: string }>,
  options: { reseed: boolean; now: number },
): FeedFreshState {
  const newestMs = activities.reduce((max, activity) => Math.max(max, timeOf(activity.createdAt)), prev?.newestMs ?? 0);
  if (!prev || options.reseed) {
    return {
      seen: new Set(activities.map((activity) => activity.id)),
      newestMs,
      fresh: EMPTY_FRESH,
    };
  }

  const candidates = activities.filter((activity) => !prev.seen.has(activity.id) && timeOf(activity.createdAt) > prev.newestMs);
  const accepted = candidates.length <= FEED_FRESH_MAX ? candidates : [];

  const kept = pruneFreshIds(prev.fresh, options.now);
  let fresh: Map<string, number> | null = null;
  for (const activity of accepted) {
    fresh ??= new Map(kept);
    fresh.set(activity.id, options.now);
  }

  const seen = candidates.length > 0 || activities.some((activity) => !prev.seen.has(activity.id))
    ? new Set([...prev.seen, ...activities.map((activity) => activity.id)])
    : prev.seen;
  return { seen, newestMs, fresh: fresh ?? kept };
}

/** 표시 시간이 지난 새 줄을 뺀다. 뺄 게 없으면 같은 객체. */
export function pruneFreshIds(fresh: ReadonlyMap<string, number>, now: number): ReadonlyMap<string, number> {
  let next: Map<string, number> | null = null;
  for (const [id, at] of fresh) {
    if (now - at < FEED_FRESH_KEEP_MS) continue;
    next ??= new Map(fresh);
    next.delete(id);
  }
  return next ?? fresh;
}

/** 목록을 위에서 내려오게 할 때 최대 거리(px). 그보다 많이 밀리면 이만큼만 움직인다. */
export const FEED_SLIDE_MAX_PX = 160;

/**
 * 직전에도 있던 첫 줄이 이번에 얼마나 아래로 밀렸는지(px). 맨 위에 새 줄이 생긴 만큼이다.
 * 한 줄이 묶음으로 바뀌기만 했으면(아래 줄 위치 그대로) 0. 비교할 줄이 없으면 0.
 */
export function feedAnchorShift(
  prevTops: ReadonlyMap<string, number> | null,
  tops: ReadonlyMap<string, number>,
  keys: ReadonlyArray<string>,
): number {
  if (!prevTops) return 0;
  for (const key of keys) {
    const before = prevTops.get(key);
    const after = tops.get(key);
    if (before === undefined || after === undefined) continue;
    return after - before;
  }
  return 0;
}
