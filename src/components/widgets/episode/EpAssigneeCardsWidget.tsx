import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { Widget } from '../Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { calcEpisodeDetailStats } from '@/utils/calcStats';

export function EpAssigneeCardsWidget() {
  const epNum = useAppStore((s) => s.episodeDashboardEp);
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const stats = useMemo(
    () => (epNum !== null ? calcEpisodeDetailStats(episodes, epNum) : null),
    [episodes, epNum],
  );

  if (!stats || epNum === null) return null;

  const displayName = episodeTitles[epNum] || `EP.${String(epNum).padStart(2, '0')}`;
  const assignees = stats.perAssignee;

  return (
    <Widget title={`${displayName} 담당자별 현황`} icon={<Users size={16} />}>
      <div className="grid grid-cols-2 gap-2">
        {assignees.map((a) => {
          const pct = Number(a.pct.toFixed(1));
          const color =
            pct >= 80 ? 'text-status-high'
              : pct >= 50 ? 'text-status-mid'
                : pct >= 25 ? 'text-status-low'
                  : 'text-status-none';

          return (
            <div
              key={a.name}
              className="bg-bg-primary rounded-lg p-3 flex flex-col gap-1 border border-transparent hover:border-bg-border/50 hover:bg-bg-card transition-all duration-200 ease-out cursor-default"
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
                  className="h-full rounded-full transition-all duration-700 ease-out"
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
