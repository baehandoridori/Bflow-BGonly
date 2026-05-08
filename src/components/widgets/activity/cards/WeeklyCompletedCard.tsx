import { useMemo } from 'react';

interface Props {
  data: Array<{ weekStart: string; completedSceneCount: number }>;
}

export function WeeklyCompletedCard({ data }: Props) {
  // 최근 12주를 채우기 (빈 주는 0)
  const weeks = useMemo(() => {
    const KST = 9 * 3_600_000;
    const now = new Date();
    const kstNow = new Date(now.getTime() + KST);
    const dow = kstNow.getUTCDay() === 0 ? 7 : kstNow.getUTCDay(); // 일=7
    const monKst = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() - (dow - 1)));
    const map = new Map<string, number>();
    for (const r of data) {
      const key = r.weekStart.slice(0, 10);
      map.set(key, r.completedSceneCount);
    }
    const result: Array<{ label: string; count: number; current: boolean }> = [];
    for (let i = 11; i >= 0; i--) {
      const wkStart = new Date(Date.UTC(monKst.getUTCFullYear(), monKst.getUTCMonth(), monKst.getUTCDate() - i * 7));
      const key = wkStart.toISOString().slice(0, 10);
      const count = map.get(key) ?? 0;
      const current = i === 0;
      const label = current ? '이번 주' : i === 1 ? '지난 주' : `-${i}w`;
      result.push({ label, count, current });
    }
    return result;
  }, [data]);

  const max = Math.max(1, ...weeks.map((w) => w.count));
  const recent4Avg = weeks.slice(-5, -1).reduce((s, w) => s + w.count, 0) / 4;
  const current = weeks[weeks.length - 1].count;
  const pct = recent4Avg > 0 ? Math.round((current / recent4Avg - 1) * 100) : 0;

  return (
    <div className="rounded-2xl border border-bg-border/60 bg-bg-primary/35 p-5">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="text-[14px] font-semibold">주별 완료 씬 수 트렌드</div>
          <div className="text-[11px] text-text-secondary mt-0.5">최근 12주 동안 PNG까지 완성된 씬 개수 — 팀 처리 속도 추이</div>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-text-secondary">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'linear-gradient(180deg,#A29BFE,#6C5CE7)' }} />완료 씬</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-px" style={{ background: '#FDCB6E' }} />4주 평균</span>
        </div>
      </div>

      <div className="mt-4 relative" style={{ height: 160 }}>
        <div className="absolute left-0 right-0 border-t border-dashed border-[#FDCB6E]/55"
             style={{ bottom: `${(recent4Avg / max) * 100}%` }} />
        <div
          className="absolute right-0 text-[9.5px] text-[#FDCB6E]/85 font-mono"
          style={{ bottom: `calc(${(recent4Avg / max) * 100}% + 2px)` }}
        >
          평균 {recent4Avg.toFixed(1)}
        </div>
        <div className="grid items-end gap-2 h-full" style={{ gridTemplateColumns: `repeat(${weeks.length}, 1fr)`, paddingBottom: 18 }}>
          {weeks.map((w, i) => {
            const h = (w.count / max) * 100;
            const bg = w.current
              ? 'linear-gradient(to top, #FDCB6E, #FFE5A0)'
              : 'linear-gradient(to top, #6C5CE7, #A29BFE)';
            return (
              <div key={i} className="rounded-t-md relative" style={{ height: `${Math.max(h, 2)}%`, background: bg }}>
                <span className={`absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-mono ${w.current ? 'text-[#FDCB6E] font-semibold' : 'text-text-secondary'}`}>
                  {w.count}
                </span>
                <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[9.5px] text-text-secondary whitespace-nowrap">
                  {w.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 text-[11px] text-text-secondary leading-relaxed bg-accent/6 border border-accent/20 rounded-lg px-3 py-2">
        <span className="text-accent-sub font-semibold">이번 주 {current}개</span>
        <span className="text-text-primary"> — 최근 4주 평균({recent4Avg.toFixed(1)}개) 대비 <b className={pct >= 0 ? 'text-[#6FCF97]' : 'text-[#FF7675]'}>{pct >= 0 ? '+' : ''}{pct}%</b></span>
      </div>
    </div>
  );
}
