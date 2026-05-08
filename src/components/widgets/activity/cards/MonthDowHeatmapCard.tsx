import { useMemo } from 'react';
import { intensityLevel, intensityBg } from '../utils';

interface Props {
  data: Array<{ month: number; dow: number; count: number }>;
}

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const DAYS = ['월','화','수','목','금','토','일'];

export function MonthDowHeatmapCard({ data }: Props) {
  // grid[dow=0=월][month=0=1월]
  const grid = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 12 }, () => 0));
    for (const r of data) {
      const monthIdx = r.month - 1;
      const dowIdx = (r.dow + 6) % 7; // 표시 월=0
      if (monthIdx >= 0 && monthIdx < 12 && dowIdx >= 0 && dowIdx < 7) {
        g[dowIdx][monthIdx] = r.count;
      }
    }
    return g;
  }, [data]);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const row of grid) for (const v of row) if (v > max) max = v;
    return max;
  }, [grid]);

  const hottest = useMemo(() => {
    let best = { dow: 0, month: 0, count: 0 };
    for (let d = 0; d < 7; d++) for (let m = 0; m < 12; m++) {
      if (grid[d][m] > best.count) best = { dow: d, month: m, count: grid[d][m] };
    }
    return best;
  }, [grid]);

  const total = useMemo(() => data.reduce((s, r) => s + r.count, 0), [data]);

  return (
    <div className="rounded-2xl border border-bg-border/60 bg-bg-primary/35 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[14px] font-semibold">요일×월 종합 히트맵</div>
          <div className="text-[11px] text-text-secondary mt-0.5">
            최근 12개월 활동 분포 — 같은 월은 합산해서 표시 (예: 작년 5월 + 올해 5월).
            정확한 연도별 비교는 v1.24 분석 페이지에서 제공 예정.
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-text-secondary">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: intensityBg(1) }} />적음</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: intensityBg(2) }} /></span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: intensityBg(3) }} /></span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: intensityBg(4) }} />많음</span>
        </div>
      </div>

      <div className="grid gap-[3px]" style={{ gridTemplateColumns: '36px repeat(12, 1fr)' }}>
        <div></div>
        {MONTHS.map((m) => <div key={m} className="text-[9.5px] text-text-secondary text-center">{m}</div>)}
        {grid.map((row, d) => (
          <Row key={d} dayLabel={DAYS[d]} row={row} maxCount={maxCount} />
        ))}
      </div>

      <div className="mt-3 text-[11px] text-text-secondary leading-relaxed bg-accent/6 border border-accent/20 rounded-lg px-3 py-2">
        <span className="text-accent-sub font-semibold">자동 인사이트:</span>
        <span className="text-text-primary"> {hottest.count > 0
          ? `${MONTHS[hottest.month]} ${DAYS[hottest.dow]}요일이 가장 활발 (${hottest.count}건, 전체의 ${Math.round(hottest.count / Math.max(1, total) * 100)}%)`
          : '아직 분석할 활동이 부족합니다'}</span>
      </div>
    </div>
  );
}

function Row({ dayLabel, row, maxCount }: { dayLabel: string; row: number[]; maxCount: number }) {
  return (
    <>
      <div className="text-[10px] text-text-secondary text-right pr-1">{dayLabel}</div>
      {row.map((v, i) => {
        // intensityLevel은 절대값 기반인데, 분석 모달은 상대값(maxCount 대비) 기반이 더 정확
        const ratio = maxCount > 0 ? v / maxCount : 0;
        const lv = ratio === 0 ? 0 : ratio < 0.2 ? 1 : ratio < 0.45 ? 2 : ratio < 0.75 ? 3 : 4;
        return (
          <div
            key={i}
            className="aspect-square rounded-sm"
            style={{ background: intensityBg(lv as 0 | 1 | 2 | 3 | 4) }}
            title={`${MONTHS[i]} ${dayLabel}요일 — ${v}건`}
          />
        );
      })}
    </>
  );
}
