import type {
  DashboardDeptFilter,
  SceneGroupMode,
  SceneViewMode,
  SortDir,
  SortKey,
  StatusFilter,
  ViewMode,
} from '../stores/useAppStore';
import type { ScenesDeptFilter } from '../types';

export const NAVIGATION_BACK_STACK_LIMIT = 8;

export interface NavigationBackSourceState {
  currentView: ViewMode;
  selectedEpisode: number | null;
  selectedPart: string | null;
  selectedDepartment: ScenesDeptFilter;
  dashboardDeptFilter: DashboardDeptFilter;
  episodeDashboardEp: number | null;
  selectedAssignee: string | null;
  searchQuery: string;
  sortKey: SortKey;
  sortDir: SortDir;
  statusFilter: StatusFilter;
  sceneViewMode: SceneViewMode;
  sceneGroupMode: SceneGroupMode;
  settingsTab: string | null;
}

export interface NavigationBackSnapshot extends NavigationBackSourceState {
  label: string;
}

const VIEW_LABELS: Record<ViewMode, string> = {
  dashboard: '대시보드',
  episode: '에피소드 현황',
  scenes: '이전 씬 위치',
  assignee: '인원별 현황',
  team: '팀원 현황',
  calendar: '타임라인',
  schedule: '일정',
  vacation: '휴가 관리',
  compositing: '컴포지팅 현황',
  'compositing-revisions': '피드백 허브',
  'retake-hub': '리테이크 허브',
  'character-board': '캐릭터 보드',
  playground: '배플레이그라운드',
  settings: '설정',
};

function formatEpisodeNumber(episodeNumber: number): string {
  return `EP${String(episodeNumber).padStart(2, '0')}`;
}

export function getNavigationBackLabel(state: NavigationBackSourceState): string {
  if (state.currentView === 'scenes') {
    if (state.selectedEpisode != null && state.selectedPart) {
      return `${formatEpisodeNumber(state.selectedEpisode)} ${state.selectedPart}파트`;
    }
    if (state.selectedEpisode != null) {
      return formatEpisodeNumber(state.selectedEpisode);
    }
    return VIEW_LABELS.scenes;
  }

  if (state.currentView === 'dashboard' && state.episodeDashboardEp != null) {
    return `${formatEpisodeNumber(state.episodeDashboardEp)} 대시보드`;
  }

  return VIEW_LABELS[state.currentView] ?? '이전 위치';
}

export function createNavigationBackSnapshot(state: NavigationBackSourceState): NavigationBackSnapshot {
  const snapshot: NavigationBackSourceState = {
    currentView: state.currentView,
    selectedEpisode: state.selectedEpisode,
    selectedPart: state.selectedPart,
    selectedDepartment: state.selectedDepartment,
    dashboardDeptFilter: state.dashboardDeptFilter,
    episodeDashboardEp: state.episodeDashboardEp,
    selectedAssignee: state.selectedAssignee,
    searchQuery: state.searchQuery,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
    statusFilter: state.statusFilter,
    sceneViewMode: state.sceneViewMode,
    sceneGroupMode: state.sceneGroupMode,
    settingsTab: state.settingsTab,
  };

  return {
    ...snapshot,
    label: getNavigationBackLabel(snapshot),
  };
}

export function areNavigationBackSnapshotsEqual(
  left: NavigationBackSnapshot,
  right: NavigationBackSnapshot,
): boolean {
  return (
    left.currentView === right.currentView
    && left.selectedEpisode === right.selectedEpisode
    && left.selectedPart === right.selectedPart
    && left.selectedDepartment === right.selectedDepartment
    && left.dashboardDeptFilter === right.dashboardDeptFilter
    && left.episodeDashboardEp === right.episodeDashboardEp
    && left.selectedAssignee === right.selectedAssignee
    && left.searchQuery === right.searchQuery
    && left.sortKey === right.sortKey
    && left.sortDir === right.sortDir
    && left.statusFilter === right.statusFilter
    && left.sceneViewMode === right.sceneViewMode
    && left.sceneGroupMode === right.sceneGroupMode
    && left.settingsTab === right.settingsTab
  );
}

export function appendNavigationBackSnapshot(
  stack: NavigationBackSnapshot[],
  snapshot: NavigationBackSnapshot,
  limit = NAVIGATION_BACK_STACK_LIMIT,
): NavigationBackSnapshot[] {
  const last = stack[stack.length - 1];
  if (last && areNavigationBackSnapshotsEqual(last, snapshot)) return stack;

  const next = [...stack, snapshot];
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
}
