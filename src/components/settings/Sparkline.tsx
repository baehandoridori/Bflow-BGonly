interface SparklineProps {
  /** 일별 값 배열 (최신이 오른쪽). 빈 배열이면 placeholder '—' 렌더. */
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({ data, width = 100, height = 24, color = 'rgb(var(--color-accent))' }: SparklineProps) {
  if (data.length === 0 || data.every((v) => v === 0)) {
    return <span className="text-text-secondary/40 text-xs font-mono">—</span>;
  }
  const max = Math.max(...data, 1);
  const min = 0;
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const pad = 2; // 상하 여유
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** ISO 타임스탬프 배열에서 최근 N일 일별 카운트를 계산 (가장 오래된 → 최신 순). */
export function buildDailyActivity(timestamps: (string | undefined | null)[], days = 7): number[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = new Array(days).fill(0);
  for (const ts of timestamps) {
    if (!ts) continue;
    const t = new Date(ts).getTime();
    if (isNaN(t)) continue;
    const diffDays = Math.floor((now - t) / dayMs);
    if (diffDays < 0 || diffDays >= days) continue;
    // diffDays = 0 → 오늘 → 마지막 버킷(days-1)
    buckets[days - 1 - diffDays] += 1;
  }
  return buckets;
}
