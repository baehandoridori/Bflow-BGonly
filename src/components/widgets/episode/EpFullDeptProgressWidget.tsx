import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { Widget } from '../Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { calcEpisodeDetailStats } from '@/utils/calcStats';
import { HorizontalBar } from '../charts/HorizontalBar';
import { DonutChart } from '../charts/DonutChart';
import { DEPARTMENT_CONFIGS, STAGES } from '@/types';
import type { ChartType, Department } from '@/types';

/** EP 전체 BG/ACT 진행률 위젯 — 모든 파트 합산 */
export function EpFullDeptProgressWidget({ dept }: { dept: Department }) {
  const epNum = useAppStore((s) => s.episodeDashboardEp);
  const widgetId = dept === 'bg' ? 'ep-full-bg-progress' : 'ep-full-act-progress';
  const chartType = useAppStore((s) => s.chartTypes[widgetId]) as ChartType | undefined;
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const stats = useMemo(
    () => (epNum !== null ? calcEpisodeDetailStats(episodes, epNum) : null),
    [episodes, epNum],
  );

  if (!stats || epNum === null) return null;

  const cfg = DEPARTMENT_CONFIGS[dept];
  const deptStats = stats.perDept[dept];
  if (!deptStats) return null;

  const pct = deptStats.overallPct;
  const displayName = episodeTitles[epNum] || `EP.${String(epNum).padStart(2, '0')}`;
  const title = `${displayName} 전체 ${cfg.shortLabel} 진행률`;

  const isSimple = chartType === 'donut';

  // 심플 모드: 도넛만
  if (isSimple) {
    return (
      <Widget title={title} icon={<BarChart3 size={16} />}>
        <DonutChart
          segments={[{ label: cfg.shortLabel, pct, color: cfg.color }]}
          centerValue={`${pct.toFixed(1)}%`}
          centerLabel={`${deptStats.totalScenes}씬`}
        />
      </Widget>
    );
  }

  // 디테일 모드 (기본): 도넛 + 단계별 바
  return (
    <Widget title={title} icon={<BarChart3 size={16} />}>
      <div className="flex gap-3 items-center h-full px-2">
        <div className="shrink-0">
          <DonutChart
            segments={[{ label: cfg.shortLabel, pct, color: cfg.color }]}
            centerValue={`${pct.toFixed(1)}%`}
            size={72}
          />
        </div>
        <div className="flex-1 min-w-0">
          <HorizontalBar
            items={STAGES.map((stage) => {
              const ss = deptStats.stageStats.find((s) => s.stage === stage);
              return {
                label: cfg.stageLabels[stage],
                value: ss?.done ?? 0,
                total: ss?.total ?? 0,
                pct: ss?.pct ?? 0,
                color: cfg.stageColors[stage],
              };
            })}
          />
        </div>
      </div>
    </Widget>
  );
}
