import { useMemo } from 'react';
import { PieChart } from 'lucide-react';
import { Widget } from '../Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { calcEpisodeDetailStats } from '@/utils/calcStats';
import { HorizontalBar } from '../charts/HorizontalBar';
import { DonutChart } from '../charts/DonutChart';
import { StatCard } from '../charts/StatCard';
import type { ChartType } from '@/types';

const SUPPORTED_CHARTS: ChartType[] = ['donut', 'horizontal-bar', 'stat-card'];

export function EpOverallProgressWidget() {
  const epNum = useAppStore((s) => s.episodeDashboardEp);
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const chartType = useAppStore((s) => s.chartTypes['ep-overall-progress']) ?? 'donut';
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const stats = useMemo(
    () => (epNum !== null ? calcEpisodeDetailStats(episodes, epNum) : null),
    [episodes, epNum],
  );

  if (!stats || epNum === null) return null;

  const isAll = dashboardFilter === 'all';
  const displayName = episodeTitles[epNum] || `EP.${String(epNum).padStart(2, '0')}`;

  // 부서별 또는 통합 진행률 선택
  const pct = isAll
    ? stats.overallPct
    : stats.perDept[dashboardFilter]?.overallPct ?? 0;
  const totalScenes = isAll
    ? stats.totalScenes
    : stats.perDept[dashboardFilter]?.totalScenes ?? 0;

  const title = isAll
    ? `${displayName} 통합 진행률`
    : `${displayName} ${dashboardFilter === 'bg' ? 'BG' : 'ACT'} 진행률`;

  const renderChart = () => {
    const activeChart = SUPPORTED_CHARTS.includes(chartType) ? chartType : 'donut';

    if (activeChart === 'horizontal-bar') {
      if (isAll) {
        // 부서별 비교 바
        return (
          <HorizontalBar
            items={[
              { label: 'BG', value: 0, total: stats.perDept.bg.totalScenes, pct: stats.perDept.bg.overallPct, color: '#6C5CE7' },
              { label: 'ACT', value: 0, total: stats.perDept.acting.totalScenes, pct: stats.perDept.acting.overallPct, color: '#E17055' },
            ]}
            showValues={false}
          />
        );
      }
      // 단계별 바
      const deptStats = stats.perDept[dashboardFilter]?.stageStats ?? [];
      return (
        <HorizontalBar
          items={deptStats.map((s) => ({
            label: s.label,
            value: s.done,
            total: s.total,
            pct: s.pct,
            color: '#6C5CE7',
          }))}
        />
      );
    }

    if (activeChart === 'stat-card') {
      return (
        <StatCard
          value={`${pct.toFixed(1)}%`}
          label={title}
          subValue={`${totalScenes}씬`}
          pct={pct}
        />
      );
    }

    // 기본: 도넛
    const segments = isAll
      ? [
          { label: 'BG', pct: stats.perDept.bg.overallPct, color: '#6C5CE7' },
          { label: 'ACT', pct: stats.perDept.acting.overallPct, color: '#E17055' },
        ]
      : [{ label: dashboardFilter === 'bg' ? 'BG' : 'ACT', pct, color: dashboardFilter === 'bg' ? '#6C5CE7' : '#E17055' }];

    return (
      <DonutChart
        segments={segments}
        centerValue={`${pct.toFixed(1)}%`}
        centerLabel={`${totalScenes}씬`}
      />
    );
  };

  return (
    <Widget title={title} icon={<PieChart size={16} />}>
      {renderChart()}
    </Widget>
  );
}
