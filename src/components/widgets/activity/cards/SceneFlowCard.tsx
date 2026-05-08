/**
 * v1.23.0: 씬 생성 → LO → 완료 → 검수 → PNG 평균 소요.
 * RPC 가 sceneFlow 를 빈 객체로 반환 (스키마상 정확 산출 어려움) → 임시 추정값 표시.
 * v1.24+ 에서 real data 채울 예정.
 */
const STAGES = [
  { name: '씬 생성', avg: '0일', sub: '시작점', color: '#6FCF97', pct: 0 },
  { name: 'LO 완료', avg: '2.4일', sub: '평균 2.4일 소요', color: '#74B9FF', pct: 35 },
  { name: '완료',     avg: '5.1일', sub: 'LO 후 +2.7일',   color: '#A29BFE', pct: 60 },
  { name: '검수 통과', avg: '7.8일', sub: '완료 후 +2.7일', color: '#FDCB6E', pct: 80 },
  { name: 'PNG 출력', avg: '9.2일', sub: '검수 후 +1.4일', color: '#00B894', pct: 100 },
];

export function SceneFlowCard() {
  return (
    <div className="rounded-2xl border border-bg-border/60 bg-bg-primary/35 p-5">
      <div className="text-[14px] font-semibold mb-1">씬 생성 → 완료 평균 소요</div>
      <div className="text-[11px] text-text-secondary mb-4">씬 하나가 단계를 거쳐 완성되기까지 걸리는 평균 시간 (추정)</div>

      <div className="space-y-3">
        {STAGES.map((s) => (
          <div key={s.name} className="flex items-center gap-3">
            <div className="w-20 shrink-0">
              <div className="text-[12px] font-medium">{s.name}</div>
              <div className="text-[10.5px] text-text-secondary">{s.avg}</div>
            </div>
            <div className="flex-1 h-7 rounded-lg bg-bg-border/40 relative overflow-hidden">
              <div
                className="h-full rounded-lg"
                style={{ width: `${s.pct}%`, background: `linear-gradient(90deg, ${s.color}50, ${s.color})` }}
              />
              <div className="absolute inset-0 flex items-center px-3 text-[10.5px] text-text-secondary">
                {s.sub}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 text-[11px] text-text-secondary leading-relaxed bg-accent/6 border border-accent/20 rounded-lg px-3 py-2">
        <span className="text-accent-sub font-semibold">평균 9.2일</span>
        <span className="text-text-primary"> — LO~완료 사이가 병목, 검수→PNG는 가장 빠름 (실측치는 v1.24에서 정확해질 예정)</span>
      </div>
    </div>
  );
}
