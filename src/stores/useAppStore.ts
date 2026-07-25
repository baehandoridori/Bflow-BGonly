import { create } from 'zustand';
import type { WidgetLayoutItem, SheetsConfig, Department, ChartType, ScenesDeptFilter, UpdateInfo } from '@/types';
import type { ThemeColors } from '@/themes';
import type { VacationConfig, VacationStatus, VacationLogEntry } from '@/types/vacation';
import {
  DEFAULT_BACKGROUND_ART,
  DEFAULT_BFLOW_STAR_NEST_SETTINGS,
  DEFAULT_DASHBOARD_STAR_NEST_BLUR_PX,
  DEFAULT_DASHBOARD_STAR_NEST_OPACITY,
  DEFAULT_STAR_NEST_SETTINGS,
  type BackgroundArt,
  type BflowStarNestSettings,
  type StarNestSettings,
} from '@/utils/starNestSettings';
import {
  appendNavigationBackSnapshot,
  createNavigationBackSnapshot,
  type NavigationBackSnapshot,
} from '@/utils/navigationBackStack';

export type ViewMode =
  | 'dashboard'
  | 'episode'
  | 'scenes'
  | 'assignee'
  | 'team'
  | 'calendar'
  | 'schedule'
  | 'vacation'
  | 'compositing'
  | 'compositing-revisions'
  | 'retake-hub'
  | 'character-board'
  | 'playground'
  | 'settings';
// v1.30.0~ : 'compositing' = 새 컴포지팅 현황 대시보드 (CompositingDashboardView)
//            'compositing-revisions' = 기존 컴포지팅 리테이크 보드 (CompositingView)
// 사이드바 라우팅 분기는 PR 3 에서 App.tsx + Sidebar.tsx 수정.
export type SortKey = 'no' | 'assignee' | 'progress' | 'incomplete';
export type SortDir = 'asc' | 'desc';
export type StatusFilter = 'all' | 'not-started' | 'in-progress' | 'done';
export type SceneViewMode = 'card' | 'sheet';
export type SceneGroupMode = 'flat' | 'layout';
export type DashboardDeptFilter = Department | 'all';

export type DataSource = 'supabase' | 'sheets' | null;

interface AppState {
  // 데이터 소스 연결 상태 (Supabase 또는 GAS)
  dataConnected: boolean;
  gasConfig: SheetsConfig | null;
  setDataConnected: (v: boolean) => void;
  setGasConfig: (config: SheetsConfig | null) => void;

  // 활성 데이터 소스 표시
  activeDataSource: DataSource;
  setActiveDataSource: (source: DataSource) => void;

  // 현재 뷰
  currentView: ViewMode;
  previousView: ViewMode | null;
  setView: (view: ViewMode) => void;

  // 알림/링크/활동 피드 점프 뒤 돌아갈 화면 위치
  navigationBackStack: NavigationBackSnapshot[];
  pushNavigationBackTarget: () => void;
  goBackNavigation: () => boolean;
  clearNavigationBackStack: () => void;

  /**
   * 다른 뷰에서 씬 모달 자동 오픈을 요청할 때 사용 (코덱스 P1 fix, 2026-05-05).
   * `setView('scenes')` + 같은 tick `dispatchEvent('bflow:open-scene-modal')` 패턴은
   * ScenesView 마운트 race로 listener 등록 전 이벤트 손실 가능. store 기반으로 전환:
   *   1. SceneJumpButton/NotificationPanel: setView('scenes') + setPendingSceneModalRequest(detail)
   *   2. ScenesView: 마운트 후 useEffect 로 request 감지 → 모달 오픈 + clear
   */
  pendingSceneModalRequest: {
    sceneUuid?: string;
    sceneName?: string;
    episodeNumber?: number;
    partId?: string;
    initialTab?: 'detail' | 'revisions' | 'files' | 'history';
    focusRevisionId?: string;
    /** v1.24.0: 모달 진입 시 자동 스크롤 + 펄스 강조할 댓글 id (알림/활동 점프용). */
    focusCommentId?: string;
    /** 리테이크 카드 내부 댓글 스레드에서 자동 스크롤 + 펄스 강조할 댓글 id. */
    focusRevisionCommentId?: string;
    /** v1.24.0: 모달 진입 시 부서 토글을 강제할 모드 (최근 작업 위젯 → 'all' 자동). */
    forceDeptFilter?: 'all' | 'bg' | 'acting';
  } | null;
  setPendingSceneModalRequest: (req: AppState['pendingSceneModalRequest']) => void;

  /**
   * Spotlight/위젯 등 외부 표면에서 캐릭터 현황판 상세 오픈을 요청할 때 사용.
   * lazy view 마운트 race를 피하기 위해 이벤트가 아니라 store 기반 요청으로 소비한다.
   */
  pendingCharacterBoardRequest: { characterId: string } | null;
  setPendingCharacterBoardRequest: (req: AppState['pendingCharacterBoardRequest']) => void;

  /**
   * #화·#파트 점프 시 열려 있는 씬 상세 모달을 강제로 닫는 신호(4c, 코덱스 4차 P2).
   * scene 점프는 pendingSceneModalRequest 로 모달을 교체하지만, part/episode 점프는
   * 모달을 열지 않으므로 기존에 떠 있던 상세 모달이 목적지를 가린다.
   * 카운터를 증가시켜 ScenesView 가 useEffect 로 감지 → detail 모달 상태를 null 로.
   */
  closeSceneModalSignal: number;
  requestCloseSceneModal: () => void;

  // 씬 하이라이트 (스포트라이트/인원별 뷰에서 씬 이동 시 글로우 리테이크)
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

  // [레거시] 글로벌 토스트 — Sonner toast()로 전환 완료, 호환용 유지
  toast: string | { message: string; type?: 'info' | 'success' | 'error' | 'warning' | 'critical' } | null;
  setToast: (msg: string | { message: string; type?: 'info' | 'success' | 'error' | 'warning' | 'critical' } | null) => void;

  // 자동 업데이트 상태 — 좌하단 버전 버튼/업데이트 센터/토스트가 공유
  updateInfo: UpdateInfo | null;
  updateCenterOpen: boolean;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setUpdateCenterOpen: (open: boolean) => void;

  // 테마
  themeId: string;
  customThemeColors: ThemeColors | null;
  customAccentHex: string | null;
  customSubHex: string | null;
  colorMode: 'dark' | 'light';
  setThemeId: (id: string) => void;
  setCustomThemeColors: (colors: ThemeColors | null) => void;
  setCustomAccentHex: (hex: string | null) => void;
  setCustomSubHex: (hex: string | null) => void;
  setColorMode: (mode: 'dark' | 'light') => void;
  toggleColorMode: () => void;

  // 플렉서스 설정
  plexusSettings: {
    backgroundArt: BackgroundArt;
    loginBackgroundArt: BackgroundArt;
    dashboardBackgroundArt: BackgroundArt;
    shareBackgroundEffectPresets: boolean;
    loginEnabled: boolean;
    loginGradientEnabled: boolean;
    loginParticleCount: number;
    dashboardEnabled: boolean;
    dashboardGradientEnabled: boolean;
    dashboardParticleCount: number;
    globalGradientEnabled: boolean;  // 전역 그라데이션 배경 (모든 뷰 뒤)
    speed: number;           // 0.5-2.0, default 1.0
    mouseRadius: number;     // 100-400, default 250
    mouseForce: number;      // 0.02-0.15, default 0.06
    glowIntensity: number;   // 0.2-2.0, default 1.0
    connectionDist: number;  // 80-250, default 160
    starNest: StarNestSettings;
    loginStarNest: StarNestSettings;
    dashboardStarNest: StarNestSettings;
    dashboardStarNestOpacity: number;
    dashboardStarNestBlurPx: number;
    bflowStarNest: BflowStarNestSettings;
    loginBflowStarNest: BflowStarNestSettings;
    dashboardBflowStarNest: BflowStarNestSettings;
  };
  setPlexusSettings: (settings: Partial<AppState['plexusSettings']>) => void;

  // 씬 뷰 완료 색상 표시
  completionTintEnabled: boolean;
  setCompletionTintEnabled: (enabled: boolean) => void;

  // 휴가 관리 연결 상태
  vacationConnected: boolean;
  vacationConfig: VacationConfig | null;
  setVacationConnected: (v: boolean) => void;
  setVacationConfig: (config: VacationConfig | null) => void;

  // 휴가 데이터 캐시
  vacationCache: { userName: string; status: VacationStatus | null; log: VacationLogEntry[]; lastFetch: number } | null;
  setVacationCache: (cache: { userName: string; status: VacationStatus | null; log: VacationLogEntry[]; lastFetch: number } | null) => void;
  invalidateVacationCache: () => void;

  // 딥링크 (bflow://scene/... → 씬 상세 모달 자동 오픈)
  pendingDeepLink: { sheetName: string; sceneId: string } | null;
  setPendingDeepLink: (link: { sheetName: string; sceneId: string } | null) => void;

  // 설정 탭 (외부에서 특정 탭으로 이동 시 사용)
  settingsTab: string | null;
  setSettingsTab: (tab: string | null) => void;

  // 사이드바 펼침/접힘
  sidebarExpanded: boolean;
  setSidebarExpanded: (v: boolean) => void;
  toggleSidebarExpanded: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  dataConnected: false,
  gasConfig: null,
  setDataConnected: (v) => set({ dataConnected: v }),
  setGasConfig: (config) => set({ gasConfig: config }),

  activeDataSource: null,
  setActiveDataSource: (source) => set({ activeDataSource: source }),

  currentView: 'dashboard',
  previousView: null,
  setView: (view) => set((s) => ({
    currentView: view,
    previousView: s.currentView,
    // 캐릭터 딥링크 요청은 현황판이 아닌 다른 뷰로 이동하는 순간 폐기 —
    //   로드 지연 중 사이드바로 이탈한 미소비 요청이 나중에 예기치 않은 모달을 열지 않게 한다.
    pendingCharacterBoardRequest: view === 'character-board' ? s.pendingCharacterBoardRequest : null,
  })),
  navigationBackStack: [],
  pushNavigationBackTarget: () => set((s) => {
    const nextStack = appendNavigationBackSnapshot(
      s.navigationBackStack,
      createNavigationBackSnapshot(s),
    );
    if (nextStack === s.navigationBackStack) return {};
    return { navigationBackStack: nextStack };
  }),
  goBackNavigation: () => {
    let restored = false;
    set((s) => {
      const target = s.navigationBackStack[s.navigationBackStack.length - 1];
      if (!target) return {};
      restored = true;
      return {
        navigationBackStack: s.navigationBackStack.slice(0, -1),
        currentView: target.currentView,
        previousView: s.currentView,
        selectedEpisode: target.selectedEpisode,
        selectedPart: target.selectedPart,
        selectedDepartment: target.selectedDepartment,
        dashboardDeptFilter: target.dashboardDeptFilter,
        episodeDashboardEp: target.episodeDashboardEp,
        selectedAssignee: target.selectedAssignee,
        searchQuery: target.searchQuery,
        sortKey: target.sortKey,
        sortDir: target.sortDir,
        statusFilter: target.statusFilter,
        sceneViewMode: target.sceneViewMode,
        sceneGroupMode: target.sceneGroupMode,
        settingsTab: target.settingsTab,
        pendingSceneModalRequest: null,
        pendingCharacterBoardRequest: null,
        highlightSceneId: null,
        selectedSceneIds: new Set<string>(),
        closeSceneModalSignal: s.closeSceneModalSignal + 1,
      };
    });
    return restored;
  },
  clearNavigationBackStack: () => set({ navigationBackStack: [] }),
  pendingSceneModalRequest: null,
  setPendingSceneModalRequest: (req) => set({ pendingSceneModalRequest: req }),
  pendingCharacterBoardRequest: null,
  setPendingCharacterBoardRequest: (req) => set({ pendingCharacterBoardRequest: req }),

  closeSceneModalSignal: 0,
  requestCloseSceneModal: () => set((s) => ({ closeSceneModalSignal: s.closeSceneModalSignal + 1 })),

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

  updateInfo: null,
  updateCenterOpen: false,
  setUpdateInfo: (info) => set({ updateInfo: info }),
  setUpdateCenterOpen: (open) => set({ updateCenterOpen: open }),

  themeId: 'violet',
  customThemeColors: null,
  customAccentHex: null,
  customSubHex: null,
  colorMode: 'dark',
  setThemeId: (id) => set({ themeId: id }),
  setCustomThemeColors: (colors) => set({ customThemeColors: colors }),
  setCustomAccentHex: (hex) => set({ customAccentHex: hex }),
  setCustomSubHex: (hex) => set({ customSubHex: hex }),
  setColorMode: (mode) => set({ colorMode: mode }),
  toggleColorMode: () => set((s) => ({ colorMode: s.colorMode === 'dark' ? 'light' : 'dark' })),

  plexusSettings: {
    backgroundArt: DEFAULT_BACKGROUND_ART,
    loginBackgroundArt: DEFAULT_BACKGROUND_ART,
    dashboardBackgroundArt: DEFAULT_BACKGROUND_ART,
    shareBackgroundEffectPresets: true,
    loginEnabled: true,
    loginGradientEnabled: true,
    loginParticleCount: 666,
    dashboardEnabled: true,
    dashboardGradientEnabled: true,
    dashboardParticleCount: 120,
    globalGradientEnabled: true,
    speed: 1.0,
    mouseRadius: 250,
    mouseForce: 0.06,
    glowIntensity: 1.0,
    connectionDist: 160,
    starNest: DEFAULT_STAR_NEST_SETTINGS,
    loginStarNest: DEFAULT_STAR_NEST_SETTINGS,
    dashboardStarNest: DEFAULT_STAR_NEST_SETTINGS,
    dashboardStarNestOpacity: DEFAULT_DASHBOARD_STAR_NEST_OPACITY,
    dashboardStarNestBlurPx: DEFAULT_DASHBOARD_STAR_NEST_BLUR_PX,
    bflowStarNest: DEFAULT_BFLOW_STAR_NEST_SETTINGS,
    loginBflowStarNest: DEFAULT_BFLOW_STAR_NEST_SETTINGS,
    dashboardBflowStarNest: DEFAULT_BFLOW_STAR_NEST_SETTINGS,
  },
  setPlexusSettings: (partial) => set((s) => ({
    plexusSettings: { ...s.plexusSettings, ...partial },
  })),

  completionTintEnabled: true,
  setCompletionTintEnabled: (enabled) => set({ completionTintEnabled: enabled }),

  vacationConnected: false,
  vacationConfig: null,
  setVacationConnected: (v) => set({ vacationConnected: v }),
  setVacationConfig: (config) => set({ vacationConfig: config }),

  vacationCache: null,
  setVacationCache: (cache) => set({ vacationCache: cache }),
  invalidateVacationCache: () => set({ vacationCache: null }),

  pendingDeepLink: null,
  setPendingDeepLink: (link) => set({ pendingDeepLink: link }),

  settingsTab: null,
  setSettingsTab: (tab) => set({ settingsTab: tab }),

  sidebarExpanded: false,
  setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
  toggleSidebarExpanded: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
}));
