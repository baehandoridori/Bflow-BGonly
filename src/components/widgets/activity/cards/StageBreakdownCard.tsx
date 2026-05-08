import { useMemo } from 'react';

interface Props {
  data: { lo: number; done: number; review: number; png: number };
}

const STAGE_COLORS = { lo: '#74B9FF', done: '#A29BFE', review: '#FDCB6E', png: '#00B894' };
const STAGE_LABELS = { lo: 'LO', done: '완료', review: '검수', png: 'PNG' };

export function StageBreakdownCard({ data }: Props) {
  const total = data.lo + data.done + data.review + data.png;
  const segments = useMemo(() => {
    const stages: Array<keyof typeof STAGE_COLORS> = ['lo', 'done', 'review', 'png'];
    const C = 2 * Math.PI * 55; // 원주
    let offset = 0;
    return stages.map((s) => {
      const value = data[s];
      const ratio = total > 0 ? value / total : 0;
      const dash = ratio * C;
      const node = {
        stage: s,
        ratio,
        value,
        dash,
        offset,
        color: STAGE_COLORS[s],
      };
      offset -= dash;
      return node;
    });
  }, [data, total]);

  const dominantPair = (data.lo + data.done) / Math.max(1, total) * 100;

  return (
    <div className="rounded-2xl border border-bg-border/60 bg-bg-primary/35 p-5">
      <div className="text-[14px] font-semibold mb-1">단계별 작업 비중</div>
      <div className="text-[11px] text-text-secondary mb-4">전체 토글 활동 중 LO/완료/검수/PNG 각 비율</div>

      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="55" fill="none" stroke="rgba(45,48,65,0.4)" strokeWidth="22" />
            {segments.map((s) => (
              <circle
                key={s.stage}
                cx="70" cy="70" r="55"
                fill="none"
                stroke={s.color}
                strokeWidth="22"
                strokeDasharray={`${s.dash} ${2 * Math.PI * 55}`}
                strokeDashoffset={s.offset}
                transform="rotate(-90 70 70)"
              />
            ))}
            <text x="70" y="68" textAnchor="middle" fill="#E8E8EE" fontSize="20" fontWeight="700">{total}</text>
            <text x="70" y="86" textAnchor="middle" fill="#8B8DA3" fontSize="10">총 단계 활동</text>
          </svg>
        </div>
        <div className="flex-1 space-y-2">
          {segments.map((s) => (
            <div key={s.stage} className="flex items-center gap-2 text-[12px]">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="flex-1">{STAGE_LABELS[s.stage]}</span>
              <span className="font-mono text-text-secondary">{Math.round(s.ratio * 100)}%</span>
              <span className="font-mono text-[10.5px] text-text-secondary/70 w-12 text-right">{s.value}건</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 text-[11px] text-text-secondary leading-relaxed bg-accent/6 border border-accent/20 rounded-lg px-3 py-2">
        <span className="text-accent-sub font-semibold">LO·완료가 {Math.round(dominantPair)}%</span>
        <span className="text-text-primary"> — 초중반 단계가 대부분, PNG까지 가는 비중은 작음</span>
      </div>
    </div>
  );
}
