/**
 * v1.23.0: 에피소드별 PNG 진행률 + 누적 활동량.
 * RPC 가 episodeProgress 를 빈 배열로 반환 → useDataStore 의 episodes 에서 직접 계산.
 */
import { useMemo } from 'react';
import { useDataStore } from '@/stores/useDataStore';

export function EpisodeProgressCard() {
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const rows = useMemo(() => {
    return episodes
      .map((ep) => {
        let total = 0;
        let pngDone = 0;
        for (const part of ep.parts) {
          for (const scene of part.scenes) {
            total++;
            if (scene.png) pngDone++;
          }
        }
        const pct = total > 0 ? Math.round((pngDone / total) * 100) : 0;
        const title = episodeTitles[ep.episodeNumber] ?? `EP${String(ep.episodeNumber).padStart(2, '0')}`;
        const sub = pct >= 90 ? '마무리 단계'
                  : pct >= 60 ? '활발 진행'
                  : pct >= 30 ? '중반'
                  : pct > 0 ? '초반'
                  : '착수';
        return { ep: title, pct, total, pngDone, sub };
      })
      .sort((a, b) => a.ep.localeCompare(b.ep))
      .slice(0, 8);
  }, [episodes, episodeTitles]);

  // 가장 활발한 EP — 진행 중(0<pct<100) 인 것 중 PNG 미달 씬 수가 많은 (=총 활동량 추정 큼)
  const topActive = useMemo(() => {
    const cands = rows.filter((r) => r.pct > 0 && r.pct < 100);
    if (cands.length === 0) return rows[0];
    return cands.reduce((best, r) => (r.total - r.pngDone > best.total - best.pngDone ? r : best), cands[0]);
  }, [rows]);

  return (
    <div className="rounded-2xl border border-bg-border/60 bg-bg-primary/35 p-5">
      <div className="text-[14px] font-semibold mb-1">에피소드별 완성도 + 활동량</div>
      <div className="text-[11px] text-text-secondary mb-4">각 EP의 PNG 진행률(=완성도) — 활발히 진행 중인 EP 식별</div>

      <div className="space-y-3">
        {rows.length === 0 && (
          <div className="text-center text-[11.5px] text-text-secondary py-4">에피소드가 아직 없습니다</div>
        )}
        {rows.map((e) => (
          <div key={e.ep}>
            <div className="flex items-center justify-between text-[12px] mb-1">
              <span className="font-medium truncate">{e.ep}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-[10.5px] text-text-secondary">{e.sub}</span>
                <span className="font-mono text-text-secondary">{e.pngDone}/{e.total}</span>
                <span className="font-mono font-semibold text-accent-sub w-9 text-right">{e.pct}%</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-bg-border/40 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${e.pct}%`, background: 'linear-gradient(90deg, #A29BFE, #6C5CE7)' }} />
            </div>
          </div>
        ))}
      </div>

      {topActive && (
        <div className="mt-3 text-[11px] text-text-secondary leading-relaxed bg-accent/6 border border-accent/20 rounded-lg px-3 py-2">
          <span className="text-accent-sub font-semibold">{topActive.ep}이(가) 가장 활발</span>
          <span className="text-text-primary"> — 미완 씬 {topActive.total - topActive.pngDone}개 진행 중</span>
        </div>
      )}
    </div>
  );
}
