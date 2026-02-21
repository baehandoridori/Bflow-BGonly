import { create } from 'zustand';
import type { WidgetLayoutItem, SheetsConfig, Department } from '@/types';

export type ViewMode = 'dashboard' | 'episode' | 'scenes' | 'assignee' | 'calendar' | 'settings';
export type SortKey = 'no' | 'assignee' | 'progress' | 'incomplete';
export type SortDir = 'asc' | 'desc';
export type StatusFilter = 'all' | 'not-started' | 'in-progress' | 'done';
export type SceneViewMode = 'card' | 'table';
export type SceneGroupMode = 'flat' | 'layout';
export type DashboardDeptFilter = Department | 'all';

interface AppState {
  // 앱 모드
  isTestMode: boolean;
  setTestMode: (v: boolean) => void;

  // Google Sheets 연결 상태
  sheetsConnected: boolean;
  sheetsConfig: SheetsConfig | null;
  setSheetsConnected: (v: boolean) => void;
  setSheetsConfig: (config: SheetsConfig | null) => void;

  // 현재 뷰
  currentView: ViewMode;
  setView: (view: ViewMode) => void;

  // 부서 선택 (ScenesView — 항상 'bg' | 'acting')
  selectedDepartment: Department;
  setSelectedDepartment: (dept: Department) => void;

  // 대시보드 부서 필터 ('all' = 통합 모드)
  dashboardDeptFilter: DashboardDeptFilter;
  setDashboardDeptFilter: (f: DashboardDeptFilter) => void;

  // 위젯 레이아웃
  widgetLayout: WidgetLayoutItem[] | null;
  isEditMode: boolean;
  setWidgetLayout: (layout: WidgetLayoutItem[]) => void;
  setEditMode: (v: boolean) => void;

  // 필터/정렬 상태
  selectedEpisode: number | null;
  selectedPart: string | null;
  selectedAssignee: string | null;
  searchQuery: string;
  sortKey: SortKey;
  sortDir: SortDir;
  statusFilter: StatusFilter;
  sceneViewMode: SceneViewMode;
  sceneGroupMode: SceneGroupMode;
  setSelectedEpisode: (ep: number | null) => void;
  setSelectedPart: (part: string | null) => void;
  setSelectedAssignee: (name: string | null) => void;
  setSearchQuery: (q: string) => void;
  setSortKey: (key: SortKey) => void;
  setSortDir: (dir: SortDir) => void;
  setStatusFilter: (f: StatusFilter) => void;
  setSceneViewMode: (mode: SceneViewMode) => void;
  setSceneGroupMode: (mode: SceneGroupMode) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isTestMode: false,
  setTestMode: (v) => set({ isTestMode: v }),

  sheetsConnected: false,
  sheetsConfig: null,
  setSheetsConnected: (v) => set({ sheetsConnected: v }),
  setSheetsConfig: (config) => set({ sheetsConfig: config }),

  currentView: 'dashboard',
  setView: (view) => set({ currentView: view }),

  selectedDepartment: 'bg',
  setSelectedDepartment: (dept) => set({ selectedDepartment: dept }),

  dashboardDeptFilter: 'all',
  setDashboardDeptFilter: (f) => set({ dashboardDeptFilter: f }),

  widgetLayout: null,
  isEditMode: false,
  setWidgetLayout: (layout) => set({ widgetLayout: layout }),
  setEditMode: (v) => set({ isEditMode: v }),

  selectedEpisode: null,
  selectedPart: null,
  selectedAssignee: null,
  searchQuery: '',
  sortKey: 'no',
  sortDir: 'asc',
  statusFilter: 'all',
  sceneViewMode: 'card',
  sceneGroupMode: 'flat',
  setSelectedEpisode: (ep) => set({ selectedEpisode: ep }),
  setSelectedPart: (part) => set({ selectedPart: part }),
  setSelectedAssignee: (name) => set({ selectedAssignee: name }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSortKey: (key) => set({ sortKey: key }),
  setSortDir: (dir) => set({ sortDir: dir }),
  setStatusFilter: (f) => set({ statusFilter: f }),
  setSceneViewMode: (mode) => set({ sceneViewMode: mode }),
  setSceneGroupMode: (mode) => set({ sceneGroupMode: mode }),
}));
