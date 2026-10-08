import type { ViewMode } from '@/stores/useAppStore';

/*
 * 화면별 지연 로드 함수 (움직임 폴리싱 12번).
 * App.tsx 의 lazy() 와 사이드바 hover 미리 준비가 같은 함수를 쓴다 — import() 는 한 번만 받아 오고
 * 같은 약속을 돌려주므로, 메뉴에 마우스를 올리는 순간 받아 두면 누를 때 로딩 동그라미 없이 바로 그린다.
 * 14개 화면을 한꺼번에 미리 받지 않는다(큰 모듈 평가가 입력을 막는다) — 마우스를 올린 항목만.
 * 배플레이그라운드는 자체 진입 연출이 있어 여기서 다루지 않는다(App.tsx 에서 직접 lazy).
 */
export const loadDashboardView = () => import('@/views/Dashboard');
export const loadScenesView = () => import('@/views/ScenesView');
export const loadEpisodeView = () => import('@/views/EpisodeView');
export const loadAssigneeView = () => import('@/views/AssigneeView');
export const loadTeamView = () => import('@/views/TeamView');
export const loadGanttView = () => import('@/features/gantt/GanttView');
export const loadScheduleView = () => import('@/views/ScheduleView');
export const loadVacationView = () => import('@/views/VacationView');
export const loadCompositingView = () => import('@/views/CompositingView');
export const loadCompositingDashboardView = () => import('@/views/CompositingDashboardView');
export const loadRetakeHubView = () => import('@/views/RetakeHubView');
export const loadCharacterBoardView = () => import('@/views/CharacterBoardView');
export const loadBackgroundLibraryView = () => import('@/features/backgrounds/BackgroundLibraryView');
export const loadSettingsView = () => import('@/views/SettingsView');

const VIEW_LOADERS: Partial<Record<ViewMode, () => Promise<unknown>>> = {
  dashboard: loadDashboardView,
  scenes: loadScenesView,
  episode: loadEpisodeView,
  assignee: loadAssigneeView,
  team: loadTeamView,
  calendar: loadGanttView,
  schedule: loadScheduleView,
  vacation: loadVacationView,
  compositing: loadCompositingDashboardView,
  'compositing-revisions': loadCompositingView,
  'retake-hub': loadRetakeHubView,
  'character-board': loadCharacterBoardView,
  'background-library': loadBackgroundLibraryView,
  settings: loadSettingsView,
};

/** 메뉴에 마우스를 올렸을 때 그 화면 코드를 미리 받아 둔다. 실패는 무시(누를 때 다시 시도·오류 경계가 처리). */
export function prefetchView(view: ViewMode): void {
  const load = VIEW_LOADERS[view];
  if (!load) return;
  load().catch(() => { /* 누를 때 lazy() 가 다시 시도한다 */ });
}
