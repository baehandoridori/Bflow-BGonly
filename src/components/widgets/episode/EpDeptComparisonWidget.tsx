import { useMemo } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { Widget } from '../Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { calcEpisodeDetailStats } from '@/utils/calcStats';
import { DEPARTMENTS, DEPARTMENT_CONFIGS, STAGES } from '@/types';
import { HorizontalBar } from '../charts/HorizontalBar';
import { VerticalBar } from '../charts/VerticalBar';
import { DonutChart } from '../charts/DonutChart';
import type { Stage, ChartType } from '@/types';

const SUPPORTED_CHARTS: ChartType[] = ['horizontal-bar', 'vertical-bar', 'donut'];

export function EpDeptComparisonWidget() {
  const epNum = useAppStore((s) => s.episodeDashboardEp);
  const chartType = useAppStore((s) => s.chartTypes['ep-dept-comparison']) ?? 'horizontal-bar';
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const stats = useMemo(
    () => (epNum !== null ? calcEpisodeDetailStats(episodes, epNum) : null),
    [episodes, epNum],
  );

  if (!stats || epNum === null) return null;

  const displayName = episodeTitles[epNum] || `EP.${String(epNum).padStart(2, '0')}`;

  const deptData = DEPARTMENTS.map((dept) => ({
    dept,
    config: DEPARTMENT_CONFIGS[dept],
    pct: stats.perDept[dept].overallPct,
    totalScenes: stats.perDept[dept].totalScenes,
    stageStats: stats.perDept[dept].stageStats,
  }));

  const combinedPct = (() => {
    const withScenes = deptData.filter((d) => d.totalScenes > 0);
    if (withScenes.length === 0) return 0;
    return withScenes.reduce((sum, d) => sum + d.pct, 0) / withScenes.length;
  })();

  const activeChart = SUPPORTED_CHARTS.includes(chartType) ? chartType : 'horizontal-bar';

  // ── 세로 막대 ──
  if (activeChart === 'vertical-bar') {
    return (
      <Widget title={`${displayName} 부서별 비교`} icon={<GitCompareArrows size={16} />}>
        <div className="flex flex-col gap-4 justify-center h-full">
          <VerticalBar
            items={deptData.map((d) => ({
              label: `${d.config.shortLabel} (${d.totalScenes}씬)`,
              pct: d.pct,
              color: d.config.color,
            }))}
          />
          {/* 단계별 비교 미니 차트 */}
          <div className="grid grid-cols-4 gap-2 pt-2 border-t border-bg-border/50">
            {STAGES.map((stage: Stage) => (
              <div key={stage} className="flex flex-col items-center gap-1">
                <div className="flex gap-0.5 items-end h-10">
                  {deptData.map((d) => {
                    const stageStat = d.stageStats.find((s) => s.stage === stage);
                    const pct = stageStat?.pct ?? 0;
                    return (
                      <div
                        key={d.dept}
                        className="w-3 rounded-t transition-all duration-700 ease-out"
                        style={{
                          height: `${Math.max(pct * 0.4, 2)}px`,
                          backgroundColor: d.config.stageColors[stage],
                        }}
                        title={`${d.config.label} ${d.config.stageLabels[stage]}: ${pct.toFixed(1)}%`}
                      />
                    );
                  })}
                </div>
                <span className="text-[11px] text-text-secondary/60">
                  {DEPARTMENT_CONFIGS.bg.stageLabels[stage]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Widget>
    );
  }

  // ── 도넛 ──
  if (activeChart === 'donut') {
    return (
      <Widget title={`${displayName} 부서별 비교`} icon={<GitCompareArrows size={16} />}>
        <div className="flex flex-col gap-4 justify-center h-full">
          <DonutChart
            segments={deptData.filter((d) => d.totalScenes > 0).map((d) => ({
              label: `${d.config.shortLabel} (${d.totalScenes}씬)`,
              pct: d.pct,
              color: d.config.color,
            }))}
            centerValue={`${combinedPct.toFixed(1)}%`}
            centerLabel="통합"
          />
          {/* 단계별 비교 미니 차트 */}
          <div className="grid grid-cols-4 gap-2 pt-2 border-t border-bg-border/50">
            {STAGES.map((stage: Stage) => (
              <div key={stage} className="flex flex-col items-center gap-1">
                <div className="flex gap-0.5 items-end h-10">
                  {deptData.map((d) => {
                    const stageStat = d.stageStats.find((s) => s.stage === stage);
                    const pct = stageStat?.pct ?? 0;
                    return (
                      <div
                        key={d.dept}
                        className="w-3 rounded-t transition-all duration-700 ease-out"
                        style={{
                          height: `${Math.max(pct * 0.4, 2)}px`,
                          backgroundColor: d.config.stageColors[stage],
                        }}
                        title={`${d.config.label} ${d.config.stageLabels[stage]}: ${pct.toFixed(1)}%`}
                      />
                    );
                  })}
                </div>
                <span className="text-[11px] text-text-secondary/60">
                  {DEPARTMENT_CONFIGS.bg.stageLabels[stage]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Widget>
    );
  }

  // ── 기본: 가로 막대 ──
  return (
    <Widget title={`${displayName} 부서별 비교`} icon={<GitCompareArrows size={16} />}>
      <div className="flex flex-col gap-4 justify-center h-full">
        {/* 통합 진행률 */}
        <div className="flex items-center gap-3 pb-3 border-b border-bg-border/50">
          <span className="text-xs font-medium text-text-secondary w-10 text-right">통합</span>
          <div className="flex-1 h-6 bg-bg-primary rounded-full overflow-hidden flex">
            {deptData.map((d) => {
              if (d.totalScenes === 0) return null;
              return (
                <div
                  key={d.dept}
                  className="h-full transition-all duration-700 ease-out first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${d.pct}%`, backgroundColor: d.config.color, opacity: 0.8 }}
                  title={`${d.config.label}: ${d.pct.toFixed(1)}%`}
                />
              );
            })}
          </div>
          <span className="text-sm font-bold text-text-primary w-14 text-right">
            {combinedPct.toFixed(1)}%
          </span>
        </div>

        {/* 부서별 바 */}
        {deptData.map((d) => (
          <div key={d.dept} className="flex items-center gap-3">
            <span className="text-xs font-medium w-10 text-right" style={{ color: d.config.color }}>
              {d.config.shortLabel}
            </span>
            <div className="flex-1 h-5 bg-bg-primary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${d.pct}%`, backgroundColor: d.config.color }}
              />
            </div>
            <div className="flex flex-col items-end w-20">
              <span className="text-sm font-bold" style={{ color: d.config.color }}>
                {d.pct.toFixed(1)}%
              </span>
              <span className="text-[11px] text-text-secondary">{d.totalScenes}씬</span>
            </div>
          </div>
        ))}

        {/* 단계별 비교 미니 차트 */}
        <div className="grid grid-cols-4 gap-2 pt-2 border-t border-bg-border/50">
          {STAGES.map((stage: Stage) => (
            <div key={stage} className="flex flex-col items-center gap-1">
              <div className="flex gap-0.5 items-end h-10">
                {deptData.map((d) => {
                  const stageStat = d.stageStats.find((s) => s.stage === stage);
                  const pct = stageStat?.pct ?? 0;
                  return (
                    <div
                      key={d.dept}
                      className="w-3 rounded-t transition-all duration-700 ease-out"
                      style={{
                        height: `${Math.max(pct * 0.4, 2)}px`,
                        backgroundColor: d.config.stageColors[stage],
                      }}
                      title={`${d.config.label} ${d.config.stageLabels[stage]}: ${pct.toFixed(1)}%`}
                    />
                  );
                })}
              </div>
              <span className="text-[11px] text-text-secondary/60">
                {DEPARTMENT_CONFIGS.bg.stageLabels[stage]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Widget>
  );
}
