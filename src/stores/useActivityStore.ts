import { create } from 'zustand';
import type { Activity, ActionGroup } from '@/types';
import * as supabaseService from '@/services/supabaseService';
import { useAppStore } from './useAppStore';
import { useAuthStore } from './useAuthStore';
import { buildHeatmapGrid } from '@/components/widgets/activity/utils';
import { MAX_CACHED, PAGE_SIZE } from '@/components/widgets/activity/constants';

const FILTERS_KEY = 'bflow_activity_filters';
const MODE_KEY = 'bflow_activity_golden_mode';

export type GoldenMode = 'heatmap' | 'hour' | 'day';

interface ActivityState {
  activities: Activity[];
  statsGrid: number[][];
  /** 낙관적 prepend 매핑 — localTmpId → 진짜 UUID. Realtime dedupe 보조 */
  pendingByLocalId: Map<string, string>;
  lastSeenCreatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;

  filters: { groups: Set<ActionGroup> };
  goldenMode: GoldenMode;

  loadInitial(): Promise<void>;
  loadMore(): Promise<void>;
  loadStats(): Promise<void>;
  backfillSince(): Promise<void>;
  receiveRealtime(activity: Activity): void;
  setFilter(group: ActionGroup, on: boolean): void;
  setAllFilters(on: boolean): void;
  setGoldenMode(mode: GoldenMode): void;
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

function getCurrentDepartment(): 'bg' | 'acting' | null {
  // 대시보드 부서 필터 (useAppStore.dashboardDeptFilter: 'all' | 'bg' | 'acting')
  const dept = useAppStore.getState().dashboardDeptFilter;
  if (dept === 'bg' || dept === 'acting') return dept;
  return null;
}

function getCurrentGroupsForServer(filters: Set<ActionGroup>): ActionGroup[] | undefined {
  // 4그룹 모두 ON이면 굳이 보낼 필요 없음 (서버에 array 비싸지 않지만 명시성)
  if (filters.size === 4) return undefined;
  return [...filters];
}

/** stats grid 의 해당 셀 +1 — Realtime 신규 시 즉시 반영 */
function incrementGrid(grid: number[][], createdAt: string): number[][] {
  const dt = new Date(createdAt);
  // KST 변환 — getTimezoneOffset 은 분 단위
  const kstStr = dt.toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour12: false });
  const kst = new Date(kstStr);
  if (Number.isNaN(kst.getTime())) return grid;
  const dow = kst.getDay(); // 0=일 ~ 6=토
  const displayDay = (dow + 6) % 7; // 표시 0=월 ~ 6=일
  const hour = kst.getHours();
  if (displayDay < 0 || displayDay >= 7 || hour < 0 || hour >= 24) return grid;
  const next = grid.map((row) => [...row]);
  next[displayDay][hour] += 1;
  return next;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  activities: [],
  statsGrid: Array.from({ length: 7 }, () => Array(24).fill(0)),
  pendingByLocalId: new Map(),
  lastSeenCreatedAt: null,
  isLoading: false,
  error: null,
  hasMore: true,
  filters: { groups: loadFilters() },
  goldenMode: loadMode(),

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
      const merged = [...activities, ...filtered].slice(0, MAX_CACHED);
      set({
        activities: merged,
        hasMore: rows.length === PAGE_SIZE && filtered.length === rows.length && merged.length < MAX_CACHED,
        isLoading: false,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  async loadStats() {
    try {
      const department = getCurrentDepartment();
      const groups = getCurrentGroupsForServer(get().filters.groups);
      // 그룹 필터가 켜진 상태면 서버 집계도 같은 그룹만 — 차트와 피드 일관성 유지
      const stats = await supabaseService.getActivityStats({ days: 7, department, groups });
      set({ statsGrid: buildHeatmapGrid(stats) });
    } catch (err) {
      console.warn('[activity] stats load failed:', err);
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

    set((s) => {
      // UUID 중복 → 무시
      if (s.activities.some((a) => a.id === activity.id)) return s;
      const newActs = [activity, ...s.activities].slice(0, MAX_CACHED);
      return {
        activities: newActs,
        lastSeenCreatedAt: activity.createdAt,
        statsGrid: inActiveGroup ? incrementGrid(s.statsGrid, activity.createdAt) : s.statsGrid,
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
