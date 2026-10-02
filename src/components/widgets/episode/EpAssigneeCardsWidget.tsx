import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { Widget } from '../Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { calcEpisodeDetailStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';
import type { AssigneeStats } from '@/types';
import { useAssigneeFlashes } from '../assigneeFlash';

const EMPTY_ASSIGNEES: AssigneeStats[] = [];

export function EpAssigneeCardsWidget() {
  const epNum = useAppStore((s) => s.episodeDashboardEp);
  const deptFilter = useAppStore((s) => s.dashboardDeptFilter);
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const stats = useMemo(
    () => (epNum !== null ? calcEpisodeDetailStats(episodes, epNum) : null),
    [episodes, epNum],
  );

  const assignees = useMemo(
    () => (stats ? (deptFilter !== 'all' ? stats.perDeptAssignee[deptFilter] : stats.perAssignee) : EMPTY_ASSIGNEES),
    [stats, deptFilter],
  );
  const flashes = useAssigneeFlashes(assignees, `${epNum}:${deptFilter}`);

  if (!stats || epNum === null) return null;

  const displayName = episodeTitles[epNum] || `EP.${String(epNum).padStart(2, '0')}`;
  const deptLabel = deptFilter !== 'all' ? ` ${DEPARTMENT_CONFIGS[deptFilter].shortLabel}` : '';

  return (
    <Widget title={`${displayName}${deptLabel} 담당자별 현황`} icon={<Users size={16} />}>
      <div className="grid grid-cols-2 gap-2">
        {assignees.map((a) => {
          const pct = Number(a.pct.toFixed(1));
          const flash = flashes.get(a.name);
          const color =
            pct >= 80 ? 'text-status-high'
              : pct >= 50 ? 'text-status-mid'
                : pct >= 25 ? 'text-status-low'
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
