/**
 * Timeline 가로축 룰러.
 *
 * - mode='time' : 분:초 (24fps 기준 frame → seconds 환산)
 * - mode='index' : 씬 인덱스 ("Scene 1 | Scene 5 | Scene 10 ...")
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (7.3)
 */

interface TimeRulerProps {
  mode: 'time' | 'index';
  totalFrames: number;   // time 모드일 때 사용
  totalScenes: number;   // index 모드일 때 사용
  fps: number;
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TimeRuler({ mode, totalFrames, totalScenes, fps }: TimeRulerProps) {
  const ticks = mode === 'time' ? 10 : Math.min(8, Math.max(2, Math.ceil(totalScenes / 5)));

  return (
    <div
      className="relative h-7 border-b border-bg-border/45 text-[10px] text-text-secondary"
      style={{
        background: 'rgb(var(--color-bg-primary) / 0.55)',
        letterSpacing: '0.04em',
      }}
    >
      {/* Major tick + 라벨 */}
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const frac = i / ticks;
        let label = '';
        if (mode === 'time') {
          const sec = Math.round((totalFrames / fps) * frac);
          label = fmtTime(sec);
        } else {
          const idx = Math.min(totalScenes, Math.max(1, Math.round(frac * totalScenes) + (i === 0 ? 1 : 0)));
          label = `씬 ${idx}`;
        }
        const isEdge = i === 0 || i === ticks;
        return (
          <div
            key={`maj-${i}`}
            className="absolute top-0 bottom-0"
            style={{ left: `${frac * 100}%` }}
          >
            <div className="absolute left-0 bottom-0 w-px h-2 bg-text-secondary/70" />
            <span
              className="absolute font-semibold tabular-nums"
              style={{
                top: 4,
                left: isEdge && i === ticks ? 'auto' : 4,
                right: isEdge && i === ticks ? 4 : 'auto',
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
      {/* Minor tick — major 사이를 4 등분, 매 4 칸 중 3 칸이 minor (major 와 겹치지 않게) */}
      {Array.from({ length: ticks * 4 }).map((_, i) => {
        if (i % 4 === 0) return null; // major 위치 skip
        const frac = i / (ticks * 4);
        return (
          <div
            key={`min-${i}`}
            className="absolute bottom-0 w-px h-1 bg-text-secondary/30"
            style={{ left: `${frac * 100}%` }}
          />
        );
      })}
    </div>
  );
}
