import { useMemo } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { Widget } from './Widget';
import { useDataStore } from '@/stores/useDataStore';
import { calcDashboardStats } from '@/utils/calcStats';
import { DEPARTMENTS, DEPARTMENT_CONFIGS } from '@/types';

export function DepartmentComparisonWidget() {
  const episodes = useDataStore((s) => s.episodes);

  const deptStats = useMemo(
    () =>
      DEPARTMENTS.map((dept) => ({
        dept,
        config: DEPARTMENT_CONFIGS[dept],
        stats: calcDashboardStats(episodes, dept),
      })),
    [episodes]
  );

  // 통합 진행률 (부서별 평균)
  const combinedPct = useMemo(() => {
    const withScenes = deptStats.filter((d) => d.stats.totalScenes > 0);
    if (withScenes.length === 0) return 0;
    return withScenes.reduce((sum, d) => sum + d.stats.overallPct, 0) / withScenes.length;
  }, [deptStats]);

  return (
    <Widget title="부서별 비교" icon={<GitCompareArrows size={16} />}>
      <div className="flex flex-col gap-4 justify-center h-full">
        {/* 통합 진행률 */}
        <div className="flex items-center gap-3 pb-3 border-b border-bg-border/50">
          <span className="text-xs font-medium text-text-secondary w-10 text-right">통합</span>
          <div className="flex-1 h-6 bg-bg-primary rounded-full overflow-hidden flex">
            {deptStats.map((d) => {
              if (d.stats.totalScenes === 0) return null;
              const width = d.stats.overallPct;
              return (
                <div
                  key={d.dept}
                  className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
                  style={{
                    width: `${width}%`,
                    backgroundColor: d.config.color,
                    opacity: 0.8,
                  }}
                  title={`${d.config.label}: ${width.toFixed(1)}%`}
                />
              );
            })}
          </div>
          <span className="text-sm font-bold text-text-primary w-14 text-right">
            {combinedPct.toFixed(1)}%
          </span>
        </div>

        {/* 부서별 진행률 바 */}
        {deptStats.map((d) => {
          const pct = d.stats.overallPct;
          return (
            <div key={d.dept} className="flex items-center gap-3">
              <span
                className="text-xs font-medium w-10 text-right"
                style={{ color: d.config.color }}
              >
                {d.config.shortLabel}
              </span>
              <div className="flex-1 h-5 bg-bg-primary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: d.config.color,
                  }}
                />
              </div>
              <div className="flex flex-col items-end w-20">
                <span className="text-sm font-bold" style={{ color: d.config.color }}>
                  {pct.toFixed(1)}%
                </span>
                <span className="text-[10px] text-text-secondary">
                  {d.stats.fullyDone}/{d.stats.totalScenes}씬
                </span>
              </div>
            </div>
          );
        })}

        {/* 단계별 비교 미니 차트 */}
        <div className="grid grid-cols-4 gap-2 pt-2 border-t border-bg-border/50">
          {(['lo', 'done', 'review', 'png'] as const).map((stage) => {
            return (
              <div key={stage} className="flex flex-col items-center gap-1">
                <div className="flex gap-0.5 items-end h-10">
                  {deptStats.map((d) => {
                    const stageStat = d.stats.stageStats.find((s) => s.stage === stage);
                    const pct = stageStat?.pct ?? 0;
                    return (
                      <div
                        key={d.dept}
                        className="w-3 rounded-t transition-all duration-500"
                        style={{
                          height: `${Math.max(pct * 0.4, 2)}px`,
                          backgroundColor: d.config.stageColors[stage],
                        }}
                        title={`${d.config.label} ${d.config.stageLabels[stage]}: ${pct.toFixed(0)}%`}
                      />
                    );
                  })}
                </div>
                <span className="text-[9px] text-text-secondary/60">
                  {DEPARTMENT_CONFIGS.bg.stageLabels[stage]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Widget>
  );
}
