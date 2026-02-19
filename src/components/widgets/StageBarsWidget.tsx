import { BarChart3 } from 'lucide-react';
import { Widget } from './Widget';
import { useDataStore } from '@/stores/useDataStore';
import { STAGE_COLORS } from '@/types';

export function StageBarsWidget() {
  const stageStats = useDataStore((s) => s.stats.stageStats);

  return (
    <Widget title="단계별 진행률" icon={<BarChart3 size={16} />}>
      <div className="flex flex-col gap-4 justify-center h-full">
        {stageStats.map((stat) => (
          <div key={stat.stage} className="flex items-center gap-3">
            {/* 라벨 */}
            <span
              className="text-xs font-medium w-10 text-right"
              style={{ color: STAGE_COLORS[stat.stage] }}
            >
              {stat.label}
            </span>
            {/* 바 */}
            <div className="flex-1 h-5 bg-bg-primary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${stat.pct}%`,
                  backgroundColor: STAGE_COLORS[stat.stage],
                }}
              />
            </div>
            {/* 수치 */}
            <span className="text-xs text-text-secondary w-20 text-right">
              {stat.done}/{stat.total} ({Math.round(stat.pct)}%)
            </span>
          </div>
        ))}
      </div>
    </Widget>
  );
}
