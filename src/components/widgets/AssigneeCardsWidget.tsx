import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { Widget } from './Widget';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { calcDashboardStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';

export function AssigneeCardsWidget() {
  const episodes = useDataStore((s) => s.episodes);
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const dept = dashboardFilter === 'all' ? undefined : dashboardFilter;
  const stats = useMemo(() => calcDashboardStats(episodes, dept), [episodes, dept]);
  const assigneeStats = stats.assigneeStats;

  const title = dashboardFilter === 'all'
    ? '담당자별 현황 (통합)'
    : `담당자별 현황 (${DEPARTMENT_CONFIGS[dashboardFilter].shortLabel})`;

  return (
    <Widget title={title} icon={<Users size={16} />}>
      <div className="grid grid-cols-2 gap-2">
        {assigneeStats.map((a) => {
          const pct = Number(a.pct.toFixed(1));
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
              className="bg-bg-primary rounded-lg p-3 flex flex-col gap-1"
            >
              <span className="text-sm font-medium truncate">{a.name}</span>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">
                  {a.completedScenes}/{a.totalScenes}씬
                </span>
                <span className={`text-sm font-bold ${color}`}>{pct}%</span>
              </div>
              <div className="h-1.5 bg-bg-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
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
