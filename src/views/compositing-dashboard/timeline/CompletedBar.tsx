/**
 * Timeline "완료 구간" — status='done' 씬들의 가로축 범위.
 * AE 의 RAM Preview 막대 재라벨. 초록 8px 실선.
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (7.4)
 */

import type { CompositingState } from '@/types';
import type { TimelineScene } from './TimelinePanel';

interface CompletedBarProps {
  scenes: TimelineScene[];
  epStates: Map<string, CompositingState>;
  sceneFracs: Map<string, { start: number; end: number; index: number }>;
}

export function CompletedBar({ scenes, epStates, sceneFracs }: CompletedBarProps) {
  // 씬별로 done 인지 체크 → 그 씬의 [start, end] 비율을 segment 로 누적
  const segments: { left: number; width: number }[] = [];
  for (const sc of scenes) {
    const epNum = sc.episodeNumber;
    const key = `${epNum}:${sc.sceneId}`;
    const st = epStates.get(key);
    if (st?.status !== 'done') continue;
    const f = sceneFracs.get(sc.sceneId);
    if (!f) continue;
    segments.push({ left: f.start * 100, width: Math.max(0.5, (f.end - f.start) * 100) });
  }

  if (segments.length === 0) return null;

  return (
    <div
      className="absolute left-0 right-0 pointer-events-none"
      style={{ bottom: 28, height: 8 }}
      aria-label="완료 구간"
    >
      {segments.map((seg, i) => (
        <div
          key={i}
          className="absolute inset-y-0 bf-wipe-in"
          style={{
            left: `${seg.left}%`,
            width: `${seg.width}%`,
            background: 'var(--status-done)',
            boxShadow: '0 0 6px rgb(var(--color-shadow) / var(--shadow-alpha)), 0 0 4px var(--status-done)',
            animationDelay: `${i * 18 + 250}ms`,
          }}
        />
      ))}
      <span
        className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] font-bold tracking-widest pointer-events-none px-1"
        style={{
          color: 'var(--status-done)',
          background: 'rgb(var(--color-bg-primary) / 0.85)',
        }}
      >
        완료 구간
      </span>
    </div>
  );
}
