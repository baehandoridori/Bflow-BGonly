import { create } from 'zustand';
import type { WidgetLayoutItem, SheetsConfig, Department, ChartType, ScenesDeptFilter } from '@/types';
import type { ThemeColors } from '@/themes';

export type ViewMode = 'dashboard' | 'episode' | 'scenes' | 'assignee' | 'team' | 'calendar' | 'schedule' | 'settings';
export type SortKey = 'no' | 'assignee' | 'progress' | 'incomplete';
export type SortDir = 'asc' | 'desc';
export type StatusFilter = 'all' | 'not-started' | 'in-progress' | 'done';
export type SceneViewMode = 'card' | 'table';
export type SceneGroupMode = 'flat' | 'layout';
export type DashboardDeptFilter = Department | 'all';

interface AppState {
  // Google Sheets 연결 상태
  sheetsConnected: boolean;
  sheetsConfig: SheetsConfig | null;
  setSheetsConnected: (v: boolean) => void;
  setSheetsConfig: (config: SheetsConfig | null) => void;

  // 현재 뷰
  currentView: ViewMode;
  previousView: ViewMode | null;
  setView: (view: ViewMode) => void;

  // 씬 하이라이트 (스포트라이트/인원별 뷰에서 씬 이동 시 글로우 피드백)
  highlightSceneId: string | null;
  setHighlightSceneId: (id: string | null) => void;

  // 팀원 하이라이트 (댓글 @멘션 클릭 → 팀원 뷰 글로우)
  highlightUserName: string | null;
  setHighlightUserName: (name: string | null) => void;

  // 부서 선택 (ScenesView — 'all' | 'bg' | 'acting')
  selectedDepartment: ScenesDeptFilter;
  setSelectedDepartment: (dept: ScenesDeptFilter) => void;

  // 대시보드 부서 필터 ('all' = 통합 모드)
  dashboardDeptFilter: DashboardDeptFilter;
  setDashboardDeptFilter: (f: DashboardDeptFilter) => void;

  // 에피소드 대시보드
  episodeDashboardEp: number | null;
  setEpisodeDashboardEp: (ep: number | null) => void;

  // 위젯 레이아웃
  widgetLayout: WidgetLayoutItem[] | null;
  allWidgetLayout: WidgetLayoutItem[] | null; // 통합 대시보드 전용
  episodeWidgetLayout: WidgetLayoutItem[] | null; // 에피소드 대시보드 전용
  isEditMode: boolean;
  setWidgetLayout: (layout: WidgetLayoutItem[]) => void;
  setAllWidgetLayout: (layout: WidgetLayoutItem[]) => void;
  setEpisodeWidgetLayout: (layout: WidgetLayoutItem[]) => void;
  setEditMode: (v: boolean) => void;

  // 차트 타입 (위젯별)
  chartTypes: Record<string, ChartType>;
  setChartType: (widgetId: string, type: ChartType) => void;

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

  // 씬 다중 선택 (라쏘 드래그 / Ctrl+클릭)
  selectedSceneIds: Set<string>;
  toggleSelectedScene: (id: string) => void;
  setSelectedScenes: (ids: Set<string>) => void;
  clearSelectedScenes: () => void;

  // 글로벌 토스트
  toast: string | null;
  setToast: (msg: string | null) => void;

  // 테마
  themeId: string;
  customThemeColors: ThemeColors | null;
  colorMode: 'dark' | 'light';
  setThemeId: (id: string) => void;
  setCustomThemeColors: (colors: ThemeColors | null) => void;
  setColorMode: (mode: 'dark' | 'light') => void;
  toggleColorMode: () => void;

  // 플렉서스 설정
  plexusSettings: {
    loginEnabled: boolean;
    loginParticleCount: number;
    dashboardEnabled: boolean;
    dashboardParticleCount: number;
    speed: number;           // 0.5-2.0, default 1.0
    mouseRadius: number;     // 100-400, default 250
    mouseForce: number;      // 0.02-0.15, default 0.06
    glowIntensity: number;   // 0.2-2.0, default 1.0
    connectionDist: number;  // 80-250, default 160
  };
  setPlexusSettings: (settings: Partial<AppState['plexusSettings']>) => void;

  // 사이드바 펼침/접힘
  sidebarExpanded: boolean;
  setSidebarExpanded: (v: boolean) => void;
  toggleSidebarExpanded: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  sheetsConnected: false,
  sheetsConfig: null,
  setSheetsConnected: (v) => set({ sheetsConnected: v }),
  setSheetsConfig: (config) => set({ sheetsConfig: config }),

  currentView: 'dashboard',
  previousView: null,
  setView: (view) => set((s) => ({ currentView: view, previousView: s.currentView })),

  selectedDepartment: 'all',
  setSelectedDepartment: (dept) => set({ selectedDepartment: dept }),

  highlightSceneId: null,
  setHighlightSceneId: (id) => set({ highlightSceneId: id }),

  highlightUserName: null,
  setHighlightUserName: (name) => set({ highlightUserName: name }),

  dashboardDeptFilter: 'all',
  setDashboardDeptFilter: (f) => set({ dashboardDeptFilter: f }),

  episodeDashboardEp: null,
  setEpisodeDashboardEp: (ep) => set({ episodeDashboardEp: ep }),

  widgetLayout: null,
  allWidgetLayout: null,
  episodeWidgetLayout: null,
  isEditMode: false,
  setWidgetLayout: (layout) => set({ widgetLayout: layout }),
  setAllWidgetLayout: (layout) => set({ allWidgetLayout: layout }),
  setEpisodeWidgetLayout: (layout) => set({ episodeWidgetLayout: layout }),
  setEditMode: (v) => set({ isEditMode: v }),

  chartTypes: {},
  setChartType: (widgetId, type) => set((s) => ({
    chartTypes: { ...s.chartTypes, [widgetId]: type },
  })),

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

  selectedSceneIds: new Set<string>(),
  toggleSelectedScene: (id) => set((s) => {
    const next = new Set(s.selectedSceneIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { selectedSceneIds: next };
  }),
  setSelectedScenes: (ids) => set({ selectedSceneIds: ids }),
  clearSelectedScenes: () => set({ selectedSceneIds: new Set<string>() }),

  toast: null,
  setToast: (msg) => set({ toast: msg }),

  themeId: 'violet',
  customThemeColors: null,
  colorMode: 'dark',
  setThemeId: (id) => set({ themeId: id }),
  setCustomThemeColors: (colors) => set({ customThemeColors: colors }),
  setColorMode: (mode) => set({ colorMode: mode }),
  toggleColorMode: () => set((s) => ({ colorMode: s.colorMode === 'dark' ? 'light' : 'dark' })),

  plexusSettings: {
    loginEnabled: true,
    loginParticleCount: 666,
    dashboardEnabled: true,
    dashboardParticleCount: 120,
    speed: 1.0,
    mouseRadius: 250,
    mouseForce: 0.06,
    glowIntensity: 1.0,
    connectionDist: 160,
  },
  setPlexusSettings: (partial) => set((s) => ({
    plexusSettings: { ...s.plexusSettings, ...partial },
  })),

  sidebarExpanded: false,
  setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
  toggleSidebarExpanded: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
}));
