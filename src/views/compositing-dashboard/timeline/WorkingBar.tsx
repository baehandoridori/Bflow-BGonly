/**
 * Timeline "작업 중 구간" — status in (combine, aggregated, adjust) 씬들의 가로축 범위.
 * AE 의 Work Area 막대 재라벨. 파란 12px + opacity 0.5.
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (7.4)
 */

import type { CompositingState } from '@/types';
import type { TimelineScene } from './TimelinePanel';

const WORKING: ReadonlySet<CompositingState['status']> = new Set(['combine', 'aggregated', 'adjust']);

interface WorkingBarProps {
  scenes: TimelineScene[];
  epStates: Map<string, CompositingState>;
  sceneFracs: Map<string, { start: number; end: number; index: number }>;
}

export function WorkingBar({ scenes, epStates, sceneFracs }: WorkingBarProps) {
  // 작업 중 씬들의 최소 start ~ 최대 end 범위 (단일 막대 — spec 시각화)
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const sc of scenes) {
    const key = `${sc.episodeNumber}:${sc.sceneId}`;
    const st = epStates.get(key);
    if (!st || !WORKING.has(st.status)) continue;
    const f = sceneFracs.get(sc.sceneId);
    if (!f) continue;
    if (f.start < minStart) minStart = f.start;
    if (f.end > maxEnd) maxEnd = f.end;
  }

  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return null;

  return (
    <div
      className="absolute left-0 right-0 pointer-events-none"
      style={{ bottom: 12, height: 12 }}
      aria-label="작업 중 구간"
    >
      <div
        className="absolute inset-y-0 bf-wipe-in rounded-sm"
        style={{
          left: `${minStart * 100}%`,
          width: `${Math.max(0.5, (maxEnd - minStart) * 100)}%`,
          background: 'rgb(var(--color-bg-primary) / 0.6)',
          border: '1px solid rgb(116 185 255 / 0.7)',
          boxShadow: '0 0 6px rgb(116 185 255 / 0.35)',
          animationDelay: '400ms',
        }}
      >
        <div
          className="absolute inset-0 rounded-sm"
          style={{ background: 'rgb(116 185 255 / 0.35)' }}
        />
        <div className="absolute left-0 inset-y-0 w-1" style={{ background: 'var(--status-combine)' }} />
        <div className="absolute right-0 inset-y-0 w-1" style={{ background: 'var(--status-combine)' }} />
      </div>
      <span
        className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] font-bold tracking-widest pointer-events-none px-1"
        style={{
          color: 'var(--status-combine)',
          background: 'rgb(var(--color-bg-primary) / 0.85)',
        }}
      >
        작업 중 구간
      </span>
    </div>
  );
}
