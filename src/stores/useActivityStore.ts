import { create } from 'zustand';
import type { Activity, ActionGroup, TimeUnit, CellFilter, ActivityInsightsRaw } from '@/types';
import * as supabaseService from '@/services/supabaseService';
import { useAppStore } from './useAppStore';
import { useAuthStore } from './useAuthStore';
import { buildHeatmapGrid, buildHeatmapGridV2, EMPTY_GROUPED_COUNT, type GroupedCount } from '@/components/widgets/activity/utils';
import { MAX_CACHED, PAGE_SIZE } from '@/components/widgets/activity/constants';
import { getRangeBoundary, granularityFor } from '@/components/widgets/activity/timeRange';

const FILTERS_KEY = 'bflow_activity_filters';
const MODE_KEY = 'bflow_activity_golden_mode';
const TIME_UNIT_KEY = 'bflow_activity_time_unit';

export type GoldenMode = 'heatmap' | 'hour' | 'day';
export type InsightsRange = 'year' | 'half' | 'quarter';

interface ActivityState {
  activities: Activity[];
  /** 24x7 그룹별 카운트 격자 — 히트맵 셀 호버 툴팁이 progress/memo/scene/etc 분해 표시 */
  statsGrid: GroupedCount[][];
  /** 낙관적 prepend 매핑 — localTmpId → 진짜 UUID. Realtime dedupe 보조 */
  pendingByLocalId: Map<string, string>;
  lastSeenCreatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;

  filters: { groups: Set<ActionGroup> };
  goldenMode: GoldenMode;

  // v1.23.0: 시간 단위 + 기간 + 셀 필터
  timeUnit: TimeUnit;
  rangeIdx: number;
  cellFilter: CellFilter | null;

  // v1.23.0: 분석 모달 캐시
  insights: ActivityInsightsRaw | null;
  insightsLoading: boolean;
  insightsRange: InsightsRange;

  loadInitial(): Promise<void>;
  loadMore(): Promise<void>;
  loadStats(): Promise<void>;
  backfillSince(): Promise<void>;
  receiveRealtime(activity: Activity): void;
  setFilter(group: ActionGroup, on: boolean): void;
  setAllFilters(on: boolean): void;
  setGoldenMode(mode: GoldenMode): void;

  // v1.23.0
  setTimeUnit(unit: TimeUnit): void;
  setRangeIdx(idx: number): void;
  goToCurrentRange(): void;
  applyCellFilter(filter: CellFilter): void;
  clearCellFilter(): void;
  loadInsights(range: InsightsRange): Promise<void>;
  setInsightsRange(range: InsightsRange): void;
}

function loadFilters(): Set<ActionGroup> {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set<ActionGroup>(['progress', 'memo', 'scene', 'etc']);
}
function saveFilters(set: Set<ActionGroup>) {
  try { localStorage.setItem(FILTERS_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}
function loadMode(): GoldenMode {
  try {
    const v = localStorage.getItem(MODE_KEY) as GoldenMode | null;
    if (v === 'heatmap' || v === 'hour' || v === 'day') return v;
  } catch { /* ignore */ }
  return 'heatmap';
}
function loadTimeUnit(): TimeUnit {
  try {
    const v = localStorage.getItem(TIME_UNIT_KEY) as TimeUnit | null;
    if (v === 'week' || v === 'month' || v === 'year') return v;
  } catch { /* ignore */ }
  return 'week';
}

function getCurrentDepartment(): 'bg' | 'acting' | null {
  // 대시보드 부서 필터 (useAppStore.dashboardDeptFilter: 'all' | 'bg' | 'acting')
  const dept = useAppStore.getState().dashboardDeptFilter;
  if (dept === 'bg' || dept === 'acting') return dept;
  return null;
}

// v1.23.0 codex 3차 P2: stale insights 응답 차단 토큰
let insightsRequestId = 0;
// v1.23.0 codex 3차 P1: 캐시한 insights 의 dept 추적 (dept 변경 시 invalidate)
let cachedInsightsDept: 'bg' | 'acting' | null | undefined = undefined;
// v1.23.0 codex 4차 P1: stale stats 응답 차단 토큰 (빠른 단위/range 전환)
let statsRequestId = 0;

function getCurrentGroupsForServer(filters: Set<ActionGroup>): ActionGroup[] | undefined {
  // 4그룹 모두 ON이면 굳이 보낼 필요 없음 (서버에 array 비싸지 않지만 명시성)
  if (filters.size === 4) return undefined;
  return [...filters];
}

/**
 * stats grid 의 해당 셀 +1 — Realtime 신규 시 즉시 반영 (총합 + 그룹별 둘 다 갱신).
 * v1.23.0: timeUnit 별로 grid 모양이 다름 (week/month: 7×24, year: 12×7).
 * 잘못된 인덱싱 시 grid 그대로 반환 + 호출자가 loadStats 로 서버 truth 재요청.
 */
function incrementGrid(
  grid: GroupedCount[][],
  createdAt: string,
  group: ActionGroup,
  timeUnit: TimeUnit,
): GroupedCount[][] {
  const dt = new Date(createdAt);
  const kstStr = dt.toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour12: false });
  const kst = new Date(kstStr);
  if (Number.isNaN(kst.getTime())) return grid;
  const dow = kst.getDay();
  const displayDay = (dow + 6) % 7;
  const hour = kst.getHours();
  const month = kst.getMonth(); // 0-based

  if (timeUnit === 'year') {
    // grid: 12 × 7 (month × dow)
    if (month < 0 || month >= 12 || displayDay < 0 || displayDay >= 7) return grid;
    const next = grid.map((row) => row.map((c) => ({ ...c })));
    const cell = next[month]?.[displayDay];
    if (!cell) return grid;
    cell.total += 1;
    cell[group] += 1;
    return next;
  }
  // week / month: 7 × 24
  if (displayDay < 0 || displayDay >= 7 || hour < 0 || hour >= 24) return grid;
  const next = grid.map((row) => row.map((c) => ({ ...c })));
  const cell = next[displayDay][hour];
  cell.total += 1;
  cell[group] += 1;
  return next;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  activities: [],
  statsGrid: Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ ...EMPTY_GROUPED_COUNT })),
  ),
  pendingByLocalId: new Map(),
  lastSeenCreatedAt: null,
  isLoading: false,
  error: null,
  hasMore: true,
  filters: { groups: loadFilters() },
  goldenMode: loadMode(),
  timeUnit: loadTimeUnit(),
  rangeIdx: 0,
  cellFilter: null,
  insights: null,
  insightsLoading: false,
  insightsRange: 'year',
  // codex 3차 P1: dept 변경 감지용 캐시 키
  // codex 3차 P2: 빠른 range 전환 시 stale 응답 차단용 토큰
  // (둘 다 closure 변수로 보관, store 상태에는 노출 X)

  async loadInitial() {
    set({ isLoading: true, error: null });
    try {
      const department = getCurrentDepartment();
      // group 필터는 client-side (ActivityFeed) — hidden group 활동도 store 에 보존 (Codex P1)
      const rows = await supabaseService.listActivities({ limit: PAGE_SIZE, department });
      // 1) 기존 store 에서 현재 부서와 일치하지 않는 활동 제거 — 부서 필터 변경 시 옛 부서 row 제거
      //    (department === null 이면 'all' 모드라 모든 활동 유지)
      // 2) 그 후 fetch 결과와 UUID dedupe merge — realtime 으로 들어온 활동 보존 (race 방지, Codex P2)
      // 3) createdAt 역순 정렬 후 MAX_CACHED 만큼 슬라이스
      set((s) => {
        const validExisting = department === null
          ? s.activities
          : s.activities.filter((a) => a.department === department);
        const existingIds = new Set(validExisting.map((a) => a.id));
        const fresh = rows.filter((r) => !existingIds.has(r.id));
        const merged = [...validExisting, ...fresh]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, MAX_CACHED);
        return {
          activities: merged,
          lastSeenCreatedAt: merged[0]?.createdAt ?? null,
          hasMore: rows.length === PAGE_SIZE,
          isLoading: false,
        };
      });
      await get().loadStats();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  async loadMore() {
    const { activities, hasMore, isLoading } = get();
    if (!hasMore || isLoading) return;
    const last = activities[activities.length - 1];
    if (!last) return;
    set({ isLoading: true });
    try {
      const department = getCurrentDepartment();
      // (createdAt, id) tuple cursor — 같은 timestamp row 누락 방지 (Codex P1)
      const cursor = `${last.createdAt}|${last.id}`;
      const rows = await supabaseService.listActivities({
        before: cursor, limit: PAGE_SIZE, department,
      });
      const sevenDaysAgo = Date.now() - 7 * 86_400_000;
      const filtered = rows.filter((r) => new Date(r.createdAt).getTime() >= sevenDaysAgo);
      // functional set — fetch in-flight 중에 들어온 realtime/loadInitial 업데이트를 덮어쓰지 않음 (Codex P2)
      // closure 가 캡처한 activities 가 아닌 최신 store state(s.activities) 와 UUID dedupe merge.
      set((s) => {
        const existingIds = new Set(s.activities.map((a) => a.id));
        const fresh = filtered.filter((r) => !existingIds.has(r.id));
        const merged = [...s.activities, ...fresh]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, MAX_CACHED);
        return {
          activities: merged,
          hasMore: rows.length === PAGE_SIZE && filtered.length === rows.length && merged.length < MAX_CACHED,
          isLoading: false,
        };
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  async loadStats() {
    // v1.23.0: 시간 단위/기간에 따라 v2 RPC 호출
    // codex 4차 P1: 빠른 단위/range 전환 시 stale 응답이 최신 grid 덮어쓰는 race 차단
    const myRequestId = ++statsRequestId;
    try {
      const { timeUnit, rangeIdx, filters } = get();
      const department = getCurrentDepartment();
      const groups = getCurrentGroupsForServer(filters.groups);
      const { startISO, endISO } = getRangeBoundary(timeUnit, rangeIdx);
      const granularity = granularityFor(timeUnit);
      const stats = await supabaseService.getActivityStatsV2({
        rangeStart: startISO,
        rangeEnd: endISO,
        granularity,
        department,
        groups,
      });
      if (myRequestId !== statsRequestId) return;
      set({ statsGrid: buildHeatmapGridV2(stats, granularity) });
    } catch (err) {
      if (myRequestId !== statsRequestId) return;
      console.warn('[activity] stats v2 load failed:', err);
    }
  },

  async backfillSince() {
    const since = get().lastSeenCreatedAt;
    if (!since) { await get().loadInitial(); return; }
    try {
      const rows = await supabaseService.backfillActivities(since);
      for (const r of rows) get().receiveRealtime(r);
      await get().loadStats();
    } catch (err) {
      console.warn('[activity] backfill failed:', err);
    }
  },

  receiveRealtime(activity) {
    // 부서 필터: BG-only 또는 ACT-only 모드면 다른 부서 + null 부서 모두 skip
    // (서버 측 listActivities 도 department=eq 로 null 활동을 제외하므로 일관성 유지)
    const currentDept = getCurrentDepartment();
    if (currentDept && activity.department !== currentDept) {
      return;
    }
    // 그룹 필터는 client-side (ActivityFeed) — store 에는 모든 그룹 활동 보존.
    // 비활성 그룹 활동을 여기서 drop 하면 그룹 다시 켰을 때 그동안의 활동이 영구 누락됨 (Codex P1).
    // 단, statsGrid 는 server 측 group 필터 결과와 일관되도록 활성 그룹일 때만 +1.
    const activeGroups = get().filters.groups;
    const inActiveGroup = activeGroups.size === 4 || activeGroups.has(activity.actionGroup);

    // v1.23.0 (codex 1차 P1, 2차 P2): 현재 시간 범위(timeUnit + rangeIdx) 밖의
    // realtime 활동을 incrementGrid 로 적용하면 과거 view 가 오염됨.
    // 문자열 비교는 ISO variant(+00:00 vs .000Z)에 취약하니 epoch ms 로 비교.
    const { timeUnit, rangeIdx } = get();
    const { startISO, endISO } = getRangeBoundary(timeUnit, rangeIdx);
    const createdAtMs = new Date(activity.createdAt).getTime();
    const startMs = new Date(startISO).getTime();
    const endMs = new Date(endISO).getTime();
    const inRange = Number.isFinite(createdAtMs)
      && createdAtMs >= startMs
      && createdAtMs < endMs;

    set((s) => {
      // UUID 중복 → 무시
      if (s.activities.some((a) => a.id === activity.id)) return s;
      const newActs = [activity, ...s.activities].slice(0, MAX_CACHED);
      return {
        activities: newActs,
        lastSeenCreatedAt: activity.createdAt,
        statsGrid: (inActiveGroup && inRange)
          ? incrementGrid(s.statsGrid, activity.createdAt, activity.actionGroup, s.timeUnit)
          : s.statsGrid,
      };
    });
  },

  setFilter(group, on) {
    const next = new Set(get().filters.groups);
    if (on) next.add(group); else next.delete(group);
    saveFilters(next);
    set({ filters: { groups: next } });
    // group 필터는 client-side — 활동은 이미 store 에 보존되어 있으니 reload 불필요.
    // statsGrid 만 server 측 group 필터로 재집계 (히트맵/막대 정확성).
    void get().loadStats();
  },

  setAllFilters(on) {
    const next: Set<ActionGroup> = on
      ? new Set(['progress', 'memo', 'scene', 'etc'])
      : new Set();
    saveFilters(next);
    set({ filters: { groups: next } });
    void get().loadStats();
  },

  setGoldenMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
    set({ goldenMode: mode });
  },

  // ─── v1.23.0: 시간 단위 / 기간 / 셀 필터 ───
  setTimeUnit(unit) {
    try { localStorage.setItem(TIME_UNIT_KEY, unit); } catch { /* ignore */ }
    set({ timeUnit: unit, rangeIdx: 0, cellFilter: null });
    void get().loadStats();
  },
  setRangeIdx(idx) {
    set({ rangeIdx: Math.max(0, idx), cellFilter: null });
    void get().loadStats();
  },
  goToCurrentRange() {
    set({ rangeIdx: 0, cellFilter: null });
    void get().loadStats();
  },
  applyCellFilter(filter) {
    set({ cellFilter: filter });
  },
  clearCellFilter() {
    set({ cellFilter: null });
  },

  // ─── v1.23.0: 분석 모달 ───
  setInsightsRange(range) {
    set({ insightsRange: range, insights: null });
    void get().loadInsights(range);
  },
  async loadInsights(range) {
    // codex 5차 P2: rolling N개월로 — UI 라벨 "최근 1년"과 일치.
    //   year(12개월): 같은 month가 시작·끝에 1번 overlap → minor distortion 1개월분.
    //   사양서 의도("최근 N개월")가 우선이라 수용.
    // codex 5차 P2: KST 기준으로 경계 계산 — SQL 의 AT TIME ZONE 'Asia/Seoul' 과 정확히 매칭.
    //   다른 타임존 클라이언트에서 day/month 경계가 어긋나는 문제 방지.
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const months = range === 'year' ? 12 : range === 'half' ? 6 : 3;
    const nowKst = new Date(Date.now() + KST_OFFSET_MS);
    const y = nowKst.getUTCFullYear();
    const m = nowKst.getUTCMonth();
    const d = nowKst.getUTCDate();
    // KST 의 다음 날 자정 (= 오늘 끝, 미래 0건 month 미포함)
    const endKst = new Date(Date.UTC(y, m, d + 1));
    // codex 6차 P1: month subtraction overflow 방지 (5/31 - 3개월 = 3/3 같은 rollover).
    // 시작 month 의 마지막 날로 clamp 해서 의도한 N개월 윈도우 보존.
    const targetMonthRaw = m - months;
    const targetYear = y + Math.floor(targetMonthRaw / 12);
    const targetMonth = ((targetMonthRaw % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const safeDay = Math.min(d, lastDay);
    const startKst = new Date(Date.UTC(targetYear, targetMonth, safeDay));
    const start = new Date(startKst.getTime() - KST_OFFSET_MS).toISOString();
    const end = new Date(endKst.getTime() - KST_OFFSET_MS).toISOString();
    const department = getCurrentDepartment();
    // codex 3차 P1: dept 변경 시 캐시 무효화 (다른 dept 데이터 노출 방지)
    if (cachedInsightsDept !== undefined && cachedInsightsDept !== department) {
      set({ insights: null });
    }
    // codex 3차 P2: 요청 토큰 — stale 응답이 최신 덮어쓰는 race 차단
    const myRequestId = ++insightsRequestId;
    set({ insightsLoading: true });
    try {
      const data = await supabaseService.getActivityInsights({ rangeStart: start, rangeEnd: end, department });
      // 더 최신 요청이 이미 있다면 이 응답은 버림
      if (myRequestId !== insightsRequestId) return;
      cachedInsightsDept = department;
      set({ insights: data as ActivityInsightsRaw, insightsLoading: false });
    } catch (err) {
      if (myRequestId !== insightsRequestId) return;
      console.warn('[activity] insights load failed:', err);
      set({ insightsLoading: false });
    }
  },
}));

/**
 * useAuthStore 의 currentUser 가 hot-swap 되어도 활동 기록이 정상 작동하도록 사이드 이펙트 등록.
 * App.tsx 에서 한 번만 호출.
 */
export function bindActivityStoreToAuth() {
  // 현재 user 즉시 한 번 동기화
  const user = useAuthStore.getState().currentUser;
  if (user) {
    window.electronAPI?.authSetCurrentUser?.({ id: user.id, name: user.name });
  }
}
