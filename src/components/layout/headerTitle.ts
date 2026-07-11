import type { ViewMode } from '@/stores/useAppStore';

const VIEW_TITLES: Partial<Record<ViewMode, string>> = {
  dashboard: '전체 현황 대시보드',
  episode: '에피소드별 현황',
  scenes: '씬 목록',
  assignee: '인원별 현황',
  calendar: '타임라인',
  vacation: '휴가 관리',
  playground: '배플레이그라운드',
  settings: '설정',
};

export function resolveHeaderTitle(
  activeView: ViewMode,
  episodeDashboardEp: number | null,
  episodeTitles: Record<number, string>,
): string {
  if (activeView === 'dashboard' && episodeDashboardEp !== null) {
    return `${episodeTitles[episodeDashboardEp] || `EP.${String(episodeDashboardEp).padStart(2, '0')}`} 대시보드`;
  }
  return VIEW_TITLES[activeView] ?? '';
}
