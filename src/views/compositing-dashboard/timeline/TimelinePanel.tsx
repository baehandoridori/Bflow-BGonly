/**
 * AE 메타포 타임라인 패널 — 헤더 아래 큰 영역.
 *
 * 구조:
 *   ┌─ 좌측 LayerPanel  ─┬─ 우측 (룰러 + CompletedBar + WorkingBar + 현재 위치)
 *   │  씬 1 [S][👁]      │  Scene 1 | Scene 5 | Scene 10 ...      ← 룰러
 *   │  씬 2 [S][👁]      │  ━━━━━━━━━ (완료 구간, 초록 8px)
 *   │  ...               │  ░░░░░ (작업 중 구간, 파랑 12px)
 *   │                    │  |←── 현재 진행 위치 (빨간 세로선)
 *
 * 룰러 모드:
 *   - 모든 씬의 durationFrames 가 채워졌으면 "분:초" (24fps 기준)
 *   - 아니면 "씬 인덱스" fallback ("Scene 1, 5, 10, ...")
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (7.x)
 */

import { useMemo, useRef } from 'react';
import { cn } from '@/utils/cn';
import type { CompositingState } from '@/types';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { LayerPanel } from './LayerPanel';
import { TimeRuler } from './TimeRuler';
import { CompletedBar } from './CompletedBar';
import { WorkingBar } from './WorkingBar';
import { CurrentPositionLine } from './CurrentPositionLine';

const FPS = 24;
const LAYER_W = 168;
const ROW_H = 30;
const PANEL_MIN_H = 180;

/** Timeline 패널이 필요로 하는 최소 씬 정보 (Scene 전체 타입 의존성 회피). */
export interface TimelineScene {
  sceneId: string;
  episodeNumber: number;
  durationFrames: number | null;
}

interface TimelinePanelProps {
  episodeNumber: number | null;
  scenes: TimelineScene[];
  epStates: Map<string, CompositingState>;
}

export function TimelinePanel({ episodeNumber, scenes, epStates }: TimelinePanelProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const mutedScenes = useCompositingDashboardStore((s) => s.mutedScenes);

  // 모든 씬에 duration 이 있으면 분:초 룰러, 없으면 씬 인덱스
  const hasAllDurations = useMemo(
    () => scenes.length > 0 && scenes.every((s) => typeof s.durationFrames === 'number' && s.durationFrames > 0),
    [scenes],
  );

  const totalFrames = useMemo(() => {
    if (!hasAllDurations) return scenes.length; // fallback: 씬 인덱스 비율
    let n = 0;
    for (const sc of scenes) n += sc.durationFrames ?? 0;
    return n;
  }, [scenes, hasAllDurations]);

  /** 각 씬의 [startFrac, endFrac] 비율 (0~1) — 룰러 기준. */
  const sceneFracs = useMemo(() => {
    const out = new Map<string, { start: number; end: number; index: number }>();
    if (scenes.length === 0) return out;
    if (hasAllDurations && totalFrames > 0) {
      let cum = 0;
      scenes.forEach((sc, i) => {
        const dur = sc.durationFrames ?? 0;
        out.set(sc.sceneId, { start: cum / totalFrames, end: (cum + dur) / totalFrames, index: i });
        cum += dur;
      });
    } else {
      // 균등 분포
      const slice = 1 / Math.max(1, scenes.length);
      scenes.forEach((sc, i) => {
        out.set(sc.sceneId, { start: i * slice, end: (i + 1) * slice, index: i });
      });
    }
    return out;
  }, [scenes, hasAllDurations, totalFrames]);

  /** 마지막 단계 변경된 씬의 위치 (가운데). */
  const ctiFrac = useMemo(() => {
    if (epStates.size === 0) return null;
    let latest: { sceneId: string; updatedAt: string } | null = null;
    for (const row of epStates.values()) {
      if (!latest || row.updatedAt > latest.updatedAt) {
        latest = { sceneId: row.sceneId, updatedAt: row.updatedAt };
      }
    }
    if (!latest) return null;
    const f = sceneFracs.get(latest.sceneId);
    if (!f) return null;
    return (f.start + f.end) / 2;
  }, [epStates, sceneFracs]);

  const visibleScenes = scenes.filter((sc) => !mutedScenes.has(sc.sceneId));

  return (
    <div
      className="bf-wipe-in rounded-lg overflow-hidden mt-3 border border-bg-border/45"
      style={{
        background: 'rgb(var(--color-bg-card) / 0.55)',
        minHeight: PANEL_MIN_H,
      }}
    >
      <div className="flex">
        {/* ── 좌측 LayerPanel ── */}
        <div
          className="shrink-0 border-r border-bg-border/55 bg-bg-card/40"
          style={{ width: LAYER_W }}
        >
          <div
            className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider px-3 py-2 border-b border-bg-border/40"
          >
            레이어 ({visibleScenes.length}/{scenes.length})
          </div>
          <LayerPanel scenes={scenes} rowHeight={ROW_H} />
        </div>

        {/* ── 우측 트랙 ── */}
        <div ref={trackRef} className="relative flex-1 min-w-0">
          <TimeRuler
            mode={hasAllDurations ? 'time' : 'index'}
            totalFrames={totalFrames}
            totalScenes={scenes.length}
            fps={FPS}
          />

          {/* 각 씬 행 (LayerPanel 의 row 와 정렬) */}
          <div className="relative">
            {scenes.map((sc) => {
              const f = sceneFracs.get(sc.sceneId);
              if (!f) return null;
              const muted = mutedScenes.has(sc.sceneId);
              return (
                <div
                  key={sc.sceneId}
                  className={cn(
                    'relative border-b border-bg-border/20 transition-opacity',
                    muted && 'opacity-30',
                  )}
                  style={{ height: ROW_H }}
                >
                  {/* 행 안에 그 씬 위치만 그리는 트랙 슬라이스 */}
                  <div
                    className="absolute inset-y-0"
                    style={{
                      left: `${f.start * 100}%`,
                      width: `${Math.max(0.5, (f.end - f.start) * 100)}%`,
                    }}
                  >
                    {/* 씬 슬롯 약간 표시 (옅은 보더) */}
                    <div className="absolute inset-y-1 left-0 right-0 rounded-sm border border-bg-border/35" />
                  </div>
                </div>
              );
            })}

            {/* 완료 구간 (status='done' 들의 합집합) */}
            <CompletedBar scenes={scenes} epStates={epStates} sceneFracs={sceneFracs} />

            {/* 작업 중 구간 (combine/aggregated/adjust) */}
            <WorkingBar scenes={scenes} epStates={epStates} sceneFracs={sceneFracs} />

            {/* 현재 진행 위치 (CTI) */}
            {ctiFrac !== null && <CurrentPositionLine frac={ctiFrac} />}
          </div>
        </div>
      </div>

      {episodeNumber === null && (
        <div className="px-6 py-6 text-center text-xs text-text-secondary">
          에피소드를 선택해주세요.
        </div>
      )}
    </div>
  );
}
