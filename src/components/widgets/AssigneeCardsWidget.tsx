import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { Widget } from './Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDashboardEpisodes } from '@/hooks/useDashboardEpisodes';
import { calcDashboardStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';
import { useAssigneeFlashes } from './assigneeFlash';

export function AssigneeCardsWidget() {
  const episodes = useDashboardEpisodes();
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const isAll = dashboardFilter === 'all';
  const dept = isAll ? undefined : dashboardFilter;
  const deptConfig = !isAll ? DEPARTMENT_CONFIGS[dashboardFilter] : null;
  const stats = useMemo(() => calcDashboardStats(episodes, dept), [episodes, dept]);
  const assigneeStats = stats.assigneeStats;
  const dashboardEp = useAppStore((s) => s.episodeDashboardEp);
  // 부서 필터·EP 를 바꾸면 처음부터(바뀐 범위의 숫자 차이로 반짝이지 않게)
  const flashes = useAssigneeFlashes(assigneeStats, `${dashboardFilter}:${dashboardEp ?? 'all'}`);

  const title = deptConfig
    ? `담당자별 현황 (${deptConfig.shortLabel})`
    : '담당자별 현황 (통합)';

  return (
    <Widget title={title} icon={<Users size={16} />}>
      <div className="grid grid-cols-2 gap-2">
        {assigneeStats.map((a) => {
          const pct = Number(a.pct.toFixed(1));
          const flash = flashes.get(a.name);
          const color =
            pct >= 80
              ? 'text-status-high'
              : pct >= 50
                ? 'text-status-mid'
                : pct >= 25
                  ? 'text-status-low'
                  : 'text-status-none';

          return (
            <div
              key={a.name}
              className="relative isolate bg-bg-primary rounded-lg p-3 flex flex-col gap-1 border border-transparent hover:border-bg-border/50 hover:bg-bg-card transition-all duration-200 ease-out cursor-default"
            >
              {/* 진행률이 오른 순간 — 바탕이 보랏빛으로 한 번 반짝(글자 아래 층) */}
              {flash && <span key={flash.seq} className="assignee-flash" aria-hidden />}
              <span className="text-sm font-medium truncate">{a.name}</span>
              <div className="flex items-center justify-between">
                <span className="relative text-xs text-text-secondary">
                  {a.completedScenes}/{a.totalScenes}씬
                  {flash && flash.delta > 0 && (
                    <span key={`delta-${flash.seq}`} className="assignee-delta" aria-hidden>+{flash.delta}씬</span>
                  )}
                </span>
                <span className={`text-sm font-bold ${color}`}>{pct}%</span>
              </div>
              <div className="h-1.5 bg-bg-border rounded-full overflow-hidden">
                <div
                  className="bf-entry-fill-x h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${pct}%`,
                    backgroundColor:
                      pct >= 80 ? '#00B894' : pct >= 50 ? '#FDCB6E' : pct >= 25 ? '#E17055' : '#FF6B6B',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Widget>
  );
}
