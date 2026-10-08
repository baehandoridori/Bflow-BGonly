import { useMemo, useRef, useCallback } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { Widget } from './Widget';
import { ChartHoverTooltip, type ChartHoverTooltipHandle } from './ChartHoverTooltip';
import { useAppStore } from '@/stores/useAppStore';
import { useDashboardEpisodes } from '@/hooks/useDashboardEpisodes';
import { useDashboardRollKey } from '@/hooks/useDashboardRollKey';
import { calcDashboardStats } from '@/utils/calcStats';
import { DEPARTMENTS, DEPARTMENT_CONFIGS } from '@/types';
import { VerticalBar } from './charts/VerticalBar';
import { DonutChart } from './charts/DonutChart';
import { RollingNumber } from '@/components/ui/RollingNumber';
import type { Stage, ChartType } from '@/types';
import { tooltipGlassStyle } from '@/utils/glassStyles';

const SUPPORTED_CHARTS: ChartType[] = ['horizontal-bar', 'vertical-bar', 'donut'];

interface TooltipInfo {
  label: string;
  stageLabel: string;
  done: number;
  total: number;
  pct: number;
  color: string;
}

function StageTooltipContent({ info }: { info: TooltipInfo }) {
  return (
    <>
      <div className="flex items-center gap-2 font-semibold text-[13px] mb-1.5">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: info.color }}
        />
        <span className="text-text-primary">{info.label}</span>
        <span className="text-text-secondary/50">·</span>
        <span style={{ color: info.color }}>{info.stageLabel}</span>
      </div>
      <div className="text-[12px] text-text-secondary/85">
        {info.total}씬 중 <span className="text-text-primary font-semibold">{info.done}씬</span> 완료 ({info.pct.toFixed(1)}%)
      </div>
    </>
  );
}

export function DepartmentComparisonWidget() {
  const episodes = useDashboardEpisodes();
  const chartType = useAppStore((s) => s.chartTypes['dept-comparison']) ?? 'horizontal-bar';
  // 막대 말풍선은 따로 그려진다 — 마우스를 올리고 옮길 때 위젯 전체가 다시 그려지지 않게 show/hide 만 부른다.
  const tooltipRef = useRef<ChartHoverTooltipHandle>(null);

  const deptStats = useMemo(
    () =>
      DEPARTMENTS.map((dept) => ({
        dept,
        config: DEPARTMENT_CONFIGS[dept],
        stats: calcDashboardStats(episodes, dept),
      })),
    [episodes]
  );

  // 말풍선은 막대 바로 위 가운데에 고정한다(마우스를 따라다니지 않는다).
  const handleBarEnter = useCallback(
    (e: React.MouseEvent<HTMLElement>, info: TooltipInfo) => {
      const rect = e.currentTarget.getBoundingClientRect();
      tooltipRef.current?.show(
        `${info.label}:${info.stageLabel}`,
        `${info.done}/${info.total}`,
        <StageTooltipContent info={info} />,
        { x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom },
      );
    },
    []
  );

  const handleBarLeave = useCallback(() => tooltipRef.current?.hide(), []);

  // 통합 진행률 (부서별 평균)
  const combinedPct = useMemo(() => {
    const withScenes = deptStats.filter((d) => d.stats.totalScenes > 0);
    if (withScenes.length === 0) return 0;
    return withScenes.reduce((sum, d) => sum + d.stats.overallPct, 0) / withScenes.length;
  }, [deptStats]);
  // 탭·에피소드를 바꾼 직후, 데이터가 처음 도착한 순간에는 숫자를 굴리지 않는다.
  const rollKey = `${useDashboardRollKey()}|${deptStats.some((d) => d.stats.totalScenes > 0) ? 'ready' : 'empty'}`;

  const activeChart = SUPPORTED_CHARTS.includes(chartType) ? chartType : 'horizontal-bar';

  // ── 세로 막대 ──
  if (activeChart === 'vertical-bar') {
    return (
      <Widget title="부서별 비교" icon={<GitCompareArrows size={16} />}>
        <div className="flex flex-col gap-4 justify-center h-full">
          <VerticalBar
            items={deptStats.map((d) => ({
              label: `${d.config.shortLabel} (${d.stats.totalScenes}씬)`,
              pct: d.stats.overallPct,
              color: d.config.color,
            }))}
          />
          <div className="grid grid-cols-4 gap-2 pt-2 border-t border-bg-border/50">
            {(['lo', 'done', 'review', 'png'] as const).map((stage: Stage) => (
              <div key={stage} className="flex flex-col items-center gap-1">
                <div className="flex gap-0.5 items-end h-10">
                  {deptStats.map((d) => {
                    const stageStat = d.stats.stageStats.find((s) => s.stage === stage);
                    const pct = stageStat?.pct ?? 0;
                    return (
                      <div
                        key={d.dept}
                        className="bf-entry-fill-y w-3 rounded-t transition-all duration-700 ease-out"
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
      <Widget title="부서별 비교" icon={<GitCompareArrows size={16} />}>
        <div className="flex flex-col gap-4 justify-center h-full">
          <DonutChart
            segments={deptStats.filter((d) => d.stats.totalScenes > 0).map((d) => ({
              label: `${d.config.shortLabel} (${d.stats.totalScenes}씬)`,
              pct: d.stats.overallPct,
              color: d.config.color,
            }))}
            centerValue={<RollingNumber value={combinedPct} decimals={1} suffix="%" resetKey={rollKey} />}
            centerLabel="통합"
          />
          <div className="grid grid-cols-4 gap-2 pt-2 border-t border-bg-border/50">
            {(['lo', 'done', 'review', 'png'] as const).map((stage: Stage) => (
              <div key={stage} className="flex flex-col items-center gap-1">
                <div className="flex gap-0.5 items-end h-10">
                  {deptStats.map((d) => {
                    const stageStat = d.stats.stageStats.find((s) => s.stage === stage);
                    const pct = stageStat?.pct ?? 0;
                    return (
                      <div
                        key={d.dept}
                        className="bf-entry-fill-y w-3 rounded-t transition-all duration-700 ease-out"
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
    <Widget title="부서별 비교" icon={<GitCompareArrows size={16} />}>
      <div className="relative flex flex-col gap-4 justify-center h-full">
        {/* 통합 진행률 */}
        <div className="flex items-center gap-3 pb-3 border-b border-bg-border/50">
          <span className="text-xs font-medium text-text-secondary w-10 text-right">통합</span>
          <div className="flex-1 h-6 bg-bg-primary rounded-full overflow-hidden flex">
            {/* 이어 붙은 칸 묶음 — 첫 진입 때 묶음째 왼쪽에서 늘어난다(움직임 폴리싱 13번) */}
            <div className="bf-entry-fill-sx flex h-full w-full">
              {deptStats.map((d) => {
                if (d.stats.totalScenes === 0) return null;
                const width = d.stats.overallPct;
                return (
                  <div
                    key={d.dept}
                    className="bf-progress-bar h-full first:rounded-l-full last:rounded-r-full"
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
          </div>
          <span className="text-sm font-bold text-text-primary w-14 text-right">
            <RollingNumber value={combinedPct} decimals={1} suffix="%" resetKey={rollKey} />
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
                  className="bf-progress-bar bf-entry-fill-x h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: d.config.color,
                  }}
                />
              </div>
              <div className="flex flex-col items-end w-20">
                <span className="text-sm font-bold" style={{ color: d.config.color }}>
                  <RollingNumber value={pct} decimals={1} suffix="%" resetKey={rollKey} />
                </span>
                <span className="text-[11px] text-text-secondary">
                  {d.stats.fullyDone}/{d.stats.totalScenes}씬
                </span>
              </div>
            </div>
          );
        })}

        {/* 단계별 비교 미니 차트 */}
        <div className="grid grid-cols-4 gap-2 pt-2 border-t border-bg-border/50">
          {(['lo', 'done', 'review', 'png'] as const).map((stage: Stage) => {
            return (
              <div key={stage} className="flex flex-col items-center gap-1">
                <div className="flex gap-0.5 items-end h-10">
                  {deptStats.map((d) => {
                    const stageStat = d.stats.stageStats.find((s) => s.stage === stage);
                    const pct = stageStat?.pct ?? 0;
                    const done = stageStat?.done ?? 0;
                    const total = stageStat?.total ?? 0;
                    return (
                      <div
                        key={d.dept}
                        className="bf-entry-fill-y w-3 rounded-t transition-all duration-700 ease-out cursor-pointer"
                        style={{
                          height: `${Math.max(pct * 0.4, 2)}px`,
                          backgroundColor: d.config.stageColors[stage],
                        }}
                        onMouseEnter={(e) =>
                          handleBarEnter(e, {
                            label: d.config.label,
                            stageLabel: d.config.stageLabels[stage],
                            done,
                            total,
                            pct,
                            color: d.config.stageColors[stage],
                          })
                        }
                        onMouseLeave={handleBarLeave}
                      />
                    );
                  })}
                </div>
                <span className="text-[11px] text-text-secondary/60">
                  {DEPARTMENT_CONFIGS.bg.stageLabels[stage]}
                </span>
              </div>
            );
          })}
        </div>

        {/* 단계 막대 말풍선 — Portal, 막대 바로 위 가운데 */}
        <ChartHoverTooltip
          ref={tooltipRef}
          className="px-4 py-3 rounded-2xl whitespace-nowrap"
          style={tooltipGlassStyle}
        />
      </div>
    </Widget>
  );
}
