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
  // useAppStore.activeDepartment 가 있으면 사용. 없으면 통합 (null)
  const dept = (useAppStore.getState() as { activeDepartment?: string }).activeDepartment;
  if (dept === 'bg' || dept === 'acting') return dept;
  return null;
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
      const rows = await supabaseService.listActivities({ limit: PAGE_SIZE, department });
      set({
        activities: rows,
        lastSeenCreatedAt: rows[0]?.createdAt ?? null,
        hasMore: rows.length === PAGE_SIZE,
        isLoading: false,
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
      const rows = await supabaseService.listActivities({
        before: last.createdAt, limit: PAGE_SIZE, department,
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
      const stats = await supabaseService.getActivityStats({ days: 7, department });
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
    set((s) => {
      // 1) UUID 중복 → 무시
      if (s.activities.some((a) => a.id === activity.id)) return s;
      // 2) (옵션) 본인 활동 자기 변경 dedupe — Realtime + 자동 INSERT 동시 발생할 일은 적음
      const newActs = [activity, ...s.activities].slice(0, MAX_CACHED);
      return {
        activities: newActs,
        lastSeenCreatedAt: activity.createdAt,
        statsGrid: incrementGrid(s.statsGrid, activity.createdAt),
      };
    });
  },

  setFilter(group, on) {
    const next = new Set(get().filters.groups);
    if (on) next.add(group); else next.delete(group);
    saveFilters(next);
    set({ filters: { groups: next } });
  },

  setAllFilters(on) {
    const next: Set<ActionGroup> = on
      ? new Set(['progress', 'memo', 'scene', 'etc'])
      : new Set();
    saveFilters(next);
    set({ filters: { groups: next } });
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
