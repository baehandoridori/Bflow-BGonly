import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { Widget } from '../Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { calcEpisodeDetailStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';
import { HorizontalBar } from '../charts/HorizontalBar';
import { VerticalBar } from '../charts/VerticalBar';
import type { ChartType } from '@/types';

const SUPPORTED_CHARTS: ChartType[] = ['horizontal-bar', 'vertical-bar'];

export function EpStageBarsWidget() {
  const epNum = useAppStore((s) => s.episodeDashboardEp);
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const chartType = useAppStore((s) => s.chartTypes['ep-stage-bars']) ?? 'horizontal-bar';
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const stats = useMemo(
    () => (epNum !== null ? calcEpisodeDetailStats(episodes, epNum) : null),
    [episodes, epNum],
  );

  if (!stats || epNum === null) return null;

  const isAll = dashboardFilter === 'all';
  const displayName = episodeTitles[epNum] || `EP.${String(epNum).padStart(2, '0')}`;
  const deptConfig = isAll ? DEPARTMENT_CONFIGS.bg : DEPARTMENT_CONFIGS[dashboardFilter];

  // 통합 모드: BG 기준 단계 라벨 사용, 부서별 모드: 해당 부서 라벨
  const stageStats = isAll
    ? stats.perDept.bg.stageStats.map((bgStat, idx) => ({
        ...bgStat,
        // 통합 시 양쪽 부서의 평균
        done: bgStat.done + (stats.perDept.acting.stageStats[idx]?.done ?? 0),
        total: bgStat.total + (stats.perDept.acting.stageStats[idx]?.total ?? 0),
        pct: (() => {
          const totalDone = bgStat.done + (stats.perDept.acting.stageStats[idx]?.done ?? 0);
          const totalAll = bgStat.total + (stats.perDept.acting.stageStats[idx]?.total ?? 0);
          return totalAll > 0 ? (totalDone / totalAll) * 100 : 0;
        })(),
      }))
    : stats.perDept[dashboardFilter]?.stageStats ?? [];

  const title = isAll
    ? `${displayName} 단계별 진행률`
    : `${displayName} ${deptConfig.shortLabel} 단계별`;

  const activeChart = SUPPORTED_CHARTS.includes(chartType) ? chartType : 'horizontal-bar';

  if (activeChart === 'vertical-bar') {
    return (
      <Widget title={title} icon={<BarChart3 size={16} />}>
        <VerticalBar
          items={stageStats.map((s) => ({
            label: s.label,
            pct: s.pct,
            color: deptConfig.stageColors[s.stage],
          }))}
        />
      </Widget>
    );
  }

  return (
    <Widget title={title} icon={<BarChart3 size={16} />}>
      <HorizontalBar
        items={stageStats.map((s) => ({
          label: s.label,
          value: s.done,
          total: s.total,
          pct: s.pct,
          color: deptConfig.stageColors[s.stage],
        }))}
      />
    </Widget>
  );
}
