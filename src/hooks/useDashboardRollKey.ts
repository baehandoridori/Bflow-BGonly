import { useAppStore } from '@/stores/useAppStore';

/**
 * 대시보드 숫자 굴림을 쉬게 하는 열쇠 (움직임 폴리싱 10번).
 * 통합/배경/액팅 탭이나 에피소드를 바꾸면 값이 바뀌어, 그 직후의 숫자는 굴리지 않고 바로 보여 준다
 * (탭을 바꿀 때마다 모든 숫자가 굴러가면 오히려 산만하다). `<RollingNumber resetKey={...} />` 에 넘긴다.
 * 데이터가 처음 도착한 순간도 굴리지 않으려면 위젯이 `${key}|${hasData}` 처럼 덧붙인다.
 */
export function useDashboardRollKey(): string {
  return useAppStore((s) => `${s.dashboardDeptFilter}|${s.episodeDashboardEp ?? 'all'}`);
}
