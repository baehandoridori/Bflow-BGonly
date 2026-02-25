interface DonutSegment {
  label: string;
  pct: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  centerLabel?: string;
  centerValue?: string;
  size?: number;
}

export function DonutChart({
  segments,
  centerLabel,
  centerValue,
  size = 120,
}: DonutChartProps) {
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  // 누적 오프셋으로 세그먼트 배치
  let accumulatedPct = 0;
  const arcs = segments.map((seg) => {
    const arcLength = (seg.pct / 100) * circumference;
    const offset = (accumulatedPct / 100) * circumference;
    accumulatedPct += seg.pct;
    return {
      color: seg.color,
      dasharray: `${arcLength} ${circumference - arcLength}`,
      dashoffset: -offset,
      label: seg.label,
      pct: seg.pct,
    };
  });

  return (
    <div className="flex flex-col items-center justify-center h-full gap-2">
      <div className="relative">
        <svg width={size} height={size}>
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="rgb(var(--color-bg-border))"
            strokeWidth={10}
          />
          {arcs.map((arc, i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={10}
              strokeDasharray={arc.dasharray}
              strokeDashoffset={arc.dashoffset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${cx} ${cy})`}
              className="transition-all duration-700 ease-out"
            />
          ))}
        </svg>
        {(centerLabel || centerValue) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerValue && (
              <span className="text-2xl font-bold text-text-primary">{centerValue}</span>
            )}
            {centerLabel && (
              <span className="text-[11px] text-text-secondary">{centerLabel}</span>
            )}
          </div>
        )}
      </div>
      {/* 범례 */}
      <div className="flex flex-wrap justify-center gap-3">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-[11px] text-text-secondary">
              {seg.label} {seg.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
