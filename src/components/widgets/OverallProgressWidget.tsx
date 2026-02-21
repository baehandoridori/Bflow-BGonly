import { useMemo } from 'react';
import { PieChart } from 'lucide-react';
import { Widget } from './Widget';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { calcDashboardStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';

export function OverallProgressWidget() {
  const episodes = useDataStore((s) => s.episodes);
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const isAll = dashboardFilter === 'all';
  const dept = isAll ? undefined : dashboardFilter;
  const deptConfig = !isAll ? DEPARTMENT_CONFIGS[dashboardFilter] : null;
  const stats = useMemo(() => calcDashboardStats(episodes, dept), [episodes, dept]);
  const pctRaw = stats.overallPct;
  const pct = Number(pctRaw.toFixed(1));

  const title = deptConfig
    ? `전체 진행률 (${deptConfig.shortLabel})`
    : '전체 진행률 (통합)';

  // SVG 원형 진행률
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  const strokeColor = pct >= 80 ? '#00B894' : pct >= 50 ? '#FDCB6E' : pct >= 25 ? '#E17055' : '#FF6B6B';

  return (
    <Widget title={title} icon={<PieChart size={16} />}>
      <div className="flex flex-col items-center justify-center h-full gap-3">
        {/* 원형 차트 */}
        <div className="relative">
          <svg width={160} height={160}>
            <circle cx={80} cy={80} r={radius} fill="none" stroke="#2D3041" strokeWidth={10} />
            <circle
              cx={80}
              cy={80}
              r={radius}
              fill="none"
              stroke={strokeColor}
              strokeWidth={10}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 80 80)"
              className="transition-all duration-500"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-3xl font-bold">{pct}%</span>
          </div>
        </div>

        {/* 요약 숫자 */}
        <div className="flex gap-4 text-xs text-text-secondary">
          <span>전체 {stats.totalScenes}씬</span>
          <span className="text-stage-png">완료 {stats.fullyDone}</span>
          <span className="text-status-none">미시작 {stats.notStarted}</span>
        </div>
      </div>
    </Widget>
  );
}
