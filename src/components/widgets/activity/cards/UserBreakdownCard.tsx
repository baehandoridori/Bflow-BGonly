interface Props {
  breakdown: Array<{ userId: string; userName: string; count: number }>;
  total: number;
}

const COLORS = ['#A29BFE', '#74B9FF', '#6FCF97', '#FDCB6E', '#FF8FA3'];

export function UserBreakdownCard({ breakdown, total }: Props) {
  const sumTop = breakdown.reduce((s, u) => s + u.count, 0);
  const others = Math.max(0, total - sumTop);
  const max = breakdown[0]?.count ?? 1;

  // Top 2 비중
  const topTwoPct = breakdown.slice(0, 2).reduce((s, u) => s + u.count, 0) / Math.max(1, total) * 100;

  return (
    <div className="rounded-2xl border border-bg-border/60 bg-bg-primary/35 p-5">
      <div className="text-[14px] font-semibold mb-1">담당자별 활동 비중</div>
      <div className="text-[11px] text-text-secondary mb-4">상위 5명 + 기타 — 1년 누적 활동 건수</div>

      <div className="space-y-2">
        {breakdown.map((u, i) => (
          <div key={u.userId} className="flex items-center gap-3">
            <div className="w-16 shrink-0 text-[12px] font-medium truncate">{u.userName}</div>
            <div className="flex-1 h-6 rounded-md bg-bg-border/40 overflow-hidden">
              <div
                className="h-full rounded-md"
                style={{
                  width: `${(u.count / max) * 100}%`,
                  background: `linear-gradient(90deg, ${COLORS[i % COLORS.length]}40, ${COLORS[i % COLORS.length]})`,
                }}
              />
            </div>
            <div className="w-12 shrink-0 text-right text-[11.5px] font-mono text-text-secondary">{u.count}건</div>
          </div>
        ))}
        {others > 0 && (
          <div className="flex items-center gap-3 opacity-70">
            <div className="w-16 shrink-0 text-[12px] font-medium truncate">기타</div>
            <div className="flex-1 h-6 rounded-md bg-bg-border/40 overflow-hidden">
              <div className="h-full rounded-md" style={{ width: `${(others / max) * 100}%`, background: '#95A5A6' }} />
            </div>
            <div className="w-12 shrink-0 text-right text-[11.5px] font-mono text-text-secondary">{others}건</div>
          </div>
        )}
      </div>

      <div className="mt-3 text-[11px] text-text-secondary leading-relaxed bg-accent/6 border border-accent/20 rounded-lg px-3 py-2">
        <span className="text-accent-sub font-semibold">총 {total.toLocaleString()}건</span>
        <span className="text-text-primary"> — 상위 2명이 전체의 {Math.round(topTwoPct)}%</span>
      </div>
    </div>
  );
}
