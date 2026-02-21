import { useMemo, useState, useRef, useCallback } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { Widget } from './Widget';
import { useDataStore } from '@/stores/useDataStore';
import { calcDashboardStats } from '@/utils/calcStats';
import { DEPARTMENTS, DEPARTMENT_CONFIGS } from '@/types';
import type { Stage } from '@/types';

interface TooltipInfo {
  x: number;
  y: number;
  label: string;
  stageLabel: string;
  done: number;
  total: number;
  pct: number;
  color: string;
}

export function DepartmentComparisonWidget() {
  const episodes = useDataStore((s) => s.episodes);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const deptStats = useMemo(
    () =>
      DEPARTMENTS.map((dept) => ({
        dept,
        config: DEPARTMENT_CONFIGS[dept],
        stats: calcDashboardStats(episodes, dept),
      })),
    [episodes]
  );

  const handleBarEnter = useCallback(
    (e: React.MouseEvent, info: Omit<TooltipInfo, 'x' | 'y'>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setTooltip({
        ...info,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top - 8,
      });
    },
    []
  );

  const handleBarLeave = useCallback(() => setTooltip(null), []);

  // 통합 진행률 (부서별 평균)
  const combinedPct = useMemo(() => {
    const withScenes = deptStats.filter((d) => d.stats.totalScenes > 0);
    if (withScenes.length === 0) return 0;
    return withScenes.reduce((sum, d) => sum + d.stats.overallPct, 0) / withScenes.length;
  }, [deptStats]);

  return (
    <Widget title="부서별 비교" icon={<GitCompareArrows size={16} />}>
      <div ref={containerRef} className="relative flex flex-col gap-4 justify-center h-full">
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
                        className="w-3 rounded-t transition-all duration-500 cursor-pointer"
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
                <span className="text-[9px] text-text-secondary/60">
                  {DEPARTMENT_CONFIGS.bg.stageLabels[stage]}
                </span>
              </div>
            );
          })}
        </div>

        {/* 커스텀 툴팁 */}
        {tooltip && (
          <div
            className="absolute z-50 pointer-events-none px-3 py-2 rounded-lg shadow-lg border border-bg-border/60 text-xs whitespace-nowrap"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translate(-50%, -100%)',
              backgroundColor: 'rgba(26, 29, 39, 0.95)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <div className="flex items-center gap-1.5 font-semibold mb-1">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: tooltip.color }}
              />
              <span>{tooltip.label}</span>
              <span className="text-text-secondary">·</span>
              <span style={{ color: tooltip.color }}>{tooltip.stageLabel}</span>
            </div>
            <div className="text-text-secondary">
              {tooltip.total}씬 중 <span className="text-text-primary font-medium">{tooltip.done}씬</span> 완료 ({tooltip.pct.toFixed(1)}%)
            </div>
          </div>
        )}
      </div>
    </Widget>
  );
}
