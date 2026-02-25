import { useMemo } from 'react';
import { Layers } from 'lucide-react';
import { Widget } from '../Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { calcEpisodeDetailStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';
import type { Department } from '@/types';
import { HorizontalBar } from '../charts/HorizontalBar';

interface EpPartDetailWidgetProps {
  partId: string;
  dept: Department | 'all';
}

/**
 * 특정 파트의 BG/ACT/전체 진행률 위젯.
 * widgetId: ep-part-{dept}-{partId} 형태로 Dashboard에서 생성됨.
 */
export function EpPartDetailWidget({ partId, dept }: EpPartDetailWidgetProps) {
  const epNum = useAppStore((s) => s.episodeDashboardEp);
  const episodes = useDataStore((s) => s.episodes);

  const stats = useMemo(
    () => (epNum !== null ? calcEpisodeDetailStats(episodes, epNum) : null),
    [episodes, epNum],
  );

  if (!stats || epNum === null) return null;

  const partStat = stats.perPart.find((p) => p.partId === partId);
  if (!partStat) return null;

  const deptLabel = dept === 'all' ? '전체' : dept === 'bg' ? 'BG' : 'ACT';
  const title = `${partId}파트 ${deptLabel}`;

  const stages = dept === 'bg'
    ? partStat.bgStages
    : dept === 'acting'
      ? partStat.actStages
      : null;

  const pct = dept === 'bg' ? partStat.bgPct
    : dept === 'acting' ? partStat.actPct
      : partStat.combinedPct;

  if (stages) {
    const deptConfig = DEPARTMENT_CONFIGS[dept as Department];
    return (
      <Widget title={title} icon={<Layers size={16} />}>
        <div className="flex flex-col gap-3 h-full">
          <div className="flex items-center gap-2 pb-2 border-b border-bg-border/50">
            <span className="text-sm font-bold" style={{ color: deptConfig.color }}>
              {pct.toFixed(1)}%
            </span>
            <div className="flex-1 h-2 bg-bg-primary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${pct}%`, backgroundColor: deptConfig.color }}
              />
            </div>
          </div>
          <HorizontalBar
            items={stages.map((s) => ({
              label: s.label,
              value: s.done,
              total: s.total,
              pct: s.pct,
              color: s.color,
            }))}
          />
        </div>
      </Widget>
    );
  }

  // dept === 'all': BG + ACT 둘 다 표시
  return (
    <Widget title={title} icon={<Layers size={16} />}>
      <div className="flex flex-col gap-3 h-full justify-center">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium w-8" style={{ color: DEPARTMENT_CONFIGS.bg.color }}>BG</span>
          <div className="flex-1 h-4 bg-bg-primary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${partStat.bgPct}%`, backgroundColor: DEPARTMENT_CONFIGS.bg.color }}
            />
          </div>
          <span className="text-xs font-bold w-14 text-right" style={{ color: DEPARTMENT_CONFIGS.bg.color }}>
            {partStat.bgPct.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium w-8" style={{ color: DEPARTMENT_CONFIGS.acting.color }}>ACT</span>
          <div className="flex-1 h-4 bg-bg-primary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${partStat.actPct}%`, backgroundColor: DEPARTMENT_CONFIGS.acting.color }}
            />
          </div>
          <span className="text-xs font-bold w-14 text-right" style={{ color: DEPARTMENT_CONFIGS.acting.color }}>
            {partStat.actPct.toFixed(1)}%
          </span>
        </div>
        <div className="text-center text-sm font-bold text-text-primary pt-1 border-t border-bg-border/50">
          통합 {partStat.combinedPct.toFixed(1)}%
        </div>
      </div>
    </Widget>
  );
}
