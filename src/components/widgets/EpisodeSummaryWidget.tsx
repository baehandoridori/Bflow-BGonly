import { useMemo } from 'react';
import { Film } from 'lucide-react';
import { Widget } from './Widget';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { calcDashboardStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';

export function EpisodeSummaryWidget() {
  const episodes = useDataStore((s) => s.episodes);
  const selectedDepartment = useAppStore((s) => s.selectedDepartment);
  const deptConfig = DEPARTMENT_CONFIGS[selectedDepartment];
  const stats = useMemo(() => calcDashboardStats(episodes, selectedDepartment), [episodes, selectedDepartment]);
  const episodeStats = stats.episodeStats;

  return (
    <Widget title={`에피소드 요약 (${deptConfig.shortLabel})`} icon={<Film size={16} />}>
      <div className="flex flex-col gap-3">
        {episodeStats.map((ep) => (
          <div key={ep.episodeNumber} className="bg-bg-primary rounded-lg p-3">
            {/* 에피소드 헤더 */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{ep.title}</span>
              <span className="text-xs text-accent font-bold">
                {Math.round(ep.overallPct)}%
              </span>
            </div>

            {/* 파트별 바 */}
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
                    {Math.round(part.pct)}% ({part.totalScenes})
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
}
