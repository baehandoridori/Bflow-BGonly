import { useMemo } from 'react';
import { Film } from 'lucide-react';
import { Widget } from './Widget';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { calcDashboardStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS, DEPARTMENTS } from '@/types';

export function EpisodeSummaryWidget() {
  const episodes = useDataStore((s) => s.episodes);
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const isAll = dashboardFilter === 'all';
  const dept = isAll ? undefined : dashboardFilter;
  const stats = useMemo(() => calcDashboardStats(episodes, dept), [episodes, dept]);
  const episodeStats = stats.episodeStats;

  // 통합 모드: 부서별 에피소드 통계
  const deptEpisodeStats = useMemo(() => {
    if (!isAll) return null;
    return DEPARTMENTS.map((d) => ({
      dept: d,
      config: DEPARTMENT_CONFIGS[d],
      stats: calcDashboardStats(episodes, d),
    }));
  }, [episodes, isAll]);

  const title = isAll
    ? '에피소드 요약 (통합)'
    : `에피소드 요약 (${DEPARTMENT_CONFIGS[dashboardFilter].shortLabel})`;

  return (
    <Widget title={title} icon={<Film size={16} />}>
      <div className="flex flex-col gap-3">
        {episodeStats.map((ep) => {
          // 통합 모드: 에피소드별 부서 진행률
          const deptBreakdown = deptEpisodeStats?.map((d) => {
            const deptEpStat = d.stats.episodeStats.find(
              (e) => e.episodeNumber === ep.episodeNumber
            );
            return {
              dept: d.dept,
              config: d.config,
              pct: deptEpStat?.overallPct ?? 0,
              totalScenes: deptEpStat?.parts.reduce((s, p) => s + p.totalScenes, 0) ?? 0,
            };
          });

          return (
            <div key={ep.episodeNumber} className="bg-bg-primary rounded-lg p-3">
              {/* 에피소드 헤더 */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{ep.title}</span>
                <span className="text-xs text-accent font-bold">
                  {ep.overallPct.toFixed(1)}%
                </span>
              </div>

              {isAll && deptBreakdown ? (
                /* ── 통합 모드: 부서별 바 ── */
                <div className="flex flex-col gap-2">
                  {deptBreakdown.map((d) => (
                    <div key={d.dept} className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-medium w-6"
                        style={{ color: d.config.color }}
                      >
                        {d.config.shortLabel}
                      </span>
                      <div className="flex-1 h-2 bg-bg-border rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${d.pct}%`,
                            backgroundColor: d.config.color,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-text-secondary w-16 text-right">
                        {d.pct.toFixed(1)}% ({d.totalScenes})
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                /* ── 단일 부서 모드: 파트별 바 ── */
                <div className="flex flex-col gap-1.5">
                  {ep.parts.map((part) => (
                    <div key={part.part} className="flex items-center gap-2">
                      <span className="text-xs text-text-secondary w-8">
                        {part.part}파트
                      </span>
                      <div className="flex-1 h-2 bg-bg-border rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full transition-all duration-500"
                          style={{ width: `${part.pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-text-secondary w-12 text-right">
                        {part.pct.toFixed(1)}% ({part.totalScenes})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Widget>
  );
}
