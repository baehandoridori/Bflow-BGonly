import { useMemo } from 'react';
import { useDataStore } from '@/stores/useDataStore';
import { formatActivitySceneLabel } from '../feedNavigation';

interface Props {
  scenes: Array<{
    sceneId: string;
    sceneLabel: string | null;
    episodeNumber: number | null;
    total: number;
    revCount: number;
    memoCount: number;
    stageCount: number;
  }>;
}

export function TopScenesCard({ scenes }: Props) {
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const avg = useMemo(() => {
    if (scenes.length === 0) return 0;
    return scenes.reduce((s, x) => s + x.total, 0) / scenes.length;
  }, [scenes]);

  return (
    <div className="rounded-2xl border border-bg-border/60 bg-bg-primary/35 p-5">
      <div className="text-[14px] font-semibold mb-1">작업이 많이 손이 가는 씬 Top 10</div>
      <div className="text-[11px] text-text-secondary mb-4">리테이크·메모·재작업이 누적된 씬 — 병목·난항 씬 발견</div>

      <div className="space-y-1.5">
        {scenes.length === 0 && (
          <div className="text-center text-[11.5px] text-text-secondary py-6">아직 누적된 활동이 부족합니다</div>
        )}
        {scenes.map((s, i) => {
          const hot = s.total >= avg * 2;
          const display = formatActivitySceneLabel(s.sceneLabel, s.episodeNumber, episodeTitles) || '(이름 없음)';
          return (
            <div
              key={s.sceneId}
              className={`flex items-center gap-3 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                hot ? 'bg-[#FF7675]/6 border border-[#FF7675]/18' : 'hover:bg-bg-border/30'
              }`}
            >
              <span className={`font-mono text-[11.5px] w-5 text-right ${hot ? 'text-[#FF7675]' : 'text-text-secondary'}`}>
                {i + 1}
              </span>
              <span
                className="px-1.5 py-[1px] rounded text-[11.5px] font-medium"
                style={{ color: 'rgb(var(--color-accent-sub))', background: 'rgba(108, 92, 231, 0.1)' }}
              >
                {display}
              </span>
              <div className="flex-1 flex items-center gap-2 text-[10.5px] text-text-secondary ml-2">
                <span>리테이크 {s.revCount}</span><span className="opacity-30">·</span>
                <span>메모 {s.memoCount}</span><span className="opacity-30">·</span>
                <span>단계 {s.stageCount}</span>
              </div>
              <span className={`font-mono text-[12px] font-semibold ${hot ? 'text-[#FF7675]' : 'text-text-primary'}`}>
                {s.total}
              </span>
            </div>
          );
        })}
      </div>

      {scenes.length > 0 && (
        <div className="mt-3 text-[11px] text-text-secondary leading-relaxed bg-[#FF7675]/6 border border-[#FF7675]/18 rounded-lg px-3 py-2">
          <span className="text-[#FF7675] font-semibold">평균 대비 2배 이상 강조</span>
          <span className="text-text-primary"> — 빨강 표시된 씬은 우선 살펴볼 후보입니다</span>
        </div>
      )}
    </div>
  );
}
