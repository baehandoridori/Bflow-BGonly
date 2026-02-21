import { useMemo } from 'react';
import { PieChart } from 'lucide-react';
import { Widget } from './Widget';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { calcDashboardStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';

/* ── 퍼센티지 구간별 색상 세그먼트 ── */
const COLOR_SEGMENTS = [
  { min: 0,  max: 25,  color: '#FF6B6B' },  // 빨강 (미시작~낮음)
  { min: 25, max: 50,  color: '#E17055' },  // 주황 (낮음~중간)
  { min: 50, max: 75,  color: '#FDCB6E' },  // 노랑 (중간~높음)
  { min: 75, max: 100, color: '#00B894' },  // 초록 (높음~완료)
];

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

  // 각 색상 구간의 가시 영역 계산
  const segments = useMemo(() => {
    return COLOR_SEGMENTS.map((seg) => {
      const segStart = seg.min;
      const segEnd = Math.min(seg.max, pct);
      if (segEnd <= segStart) return null;

      const arcLength = ((segEnd - segStart) / 100) * circumference;
      const startOffset = (segStart / 100) * circumference;

      return {
        color: seg.color,
        dasharray: `${arcLength} ${circumference - arcLength}`,
        dashoffset: -startOffset,
      };
    }).filter(Boolean) as { color: string; dasharray: string; dashoffset: number }[];
  }, [pct, circumference]);

  return (
    <Widget title={title} icon={<PieChart size={16} />}>
      <div className="flex flex-col items-center justify-center h-full gap-3">
        {/* 원형 차트 */}
        <div className="relative">
          <svg width={160} height={160}>
            {/* 배경 트랙 */}
            <circle cx={80} cy={80} r={radius} fill="none" stroke="#2D3041" strokeWidth={10} />
            {/* 색상 세그먼트들 */}
            {segments.map((seg, i) => (
              <circle
                key={i}
                cx={80}
                cy={80}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={10}
                strokeDasharray={seg.dasharray}
                strokeDashoffset={seg.dashoffset}
                strokeLinecap={i === segments.length - 1 ? 'round' : 'butt'}
                transform="rotate(-90 80 80)"
                className="transition-all duration-500"
              />
            ))}
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
