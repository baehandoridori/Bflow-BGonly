/**
 * AE 메타포 타임라인 패널 — 헤더 아래 큰 영역.
 *
 * v1.30.0 (Task 3.4 → 디자인 폴리시):
 *   - 핸드오프 variant-a 의 "파트 = 4 컴포지션 레이어" 패턴 채택.
 *   - 좌측 LayerPanel = 파트 4 행 (A·B·C·D). 우측 트랙 = 각 파트가 자기 시간 범위에 stacked status 분포.
 *   - 룰러는 EP 전체 (분:초 또는 씬 인덱스 fallback).
 *   - 솔로/뮤트는 카드 그리드 전용 — Timeline 에서는 안 다룸 (시각화 전용 패널).
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (7.x)
 * mock: docs/mockups/compositing-dashboard/variant-a.jsx
 */

import { useMemo } from 'react';
import type { CompositingState } from '@/types';
import { COMPOSITING_STATUS_TOKEN } from '@/utils/compositingLabels';
import { PartBadge } from '@/components/compositing-dashboard/common/PartBadge';
import { TimeRuler } from './TimeRuler';
import { CurrentPositionLine } from './CurrentPositionLine';

const FPS = 24;
const LAYER_W = 132;
const ROW_H = 44;
const PANEL_MIN_H = 220;

/** Timeline 패널이 필요로 하는 최소 씬 정보 (Scene 전체 타입 의존성 회피). */
export interface TimelineScene {
  sceneId: string;
  partId: string;
  episodeNumber: number;
  durationFrames: number | null;
  orderNo: number;
}

/** 파트 단위로 묶인 씬 그룹 — CompositingDashboardView 에서 buildCardScenes 결과를 그대로 전달. */
export interface TimelinePartGroup {
  partId: string;
  scenes: TimelineScene[];
}

interface TimelinePanelProps {
  episodeNumber: number | null;
  partGroups: TimelinePartGroup[];
  epStates: Map<string, CompositingState>;
}

export function TimelinePanel({ episodeNumber, partGroups, epStates }: TimelinePanelProps) {
  // ── 1. 시간축 모드 + 총 길이 ──
  const allScenes = useMemo(() => partGroups.flatMap((g) => g.scenes), [partGroups]);
  const hasAllDurations = useMemo(
    () => allScenes.length > 0 && allScenes.every((s) => typeof s.durationFrames === 'number' && s.durationFrames > 0),
    [allScenes],
  );
  const totalUnits = useMemo(() => {
    if (!hasAllDurations) return allScenes.length;
    let n = 0;
    for (const sc of allScenes) n += sc.durationFrames ?? 0;
    return n;
  }, [allScenes, hasAllDurations]);

  // ── 2. 파트별 위치 정보 (EP 전체 가로축 안에서 그 파트의 시간 범위) ──
  const partSlots = useMemo(() => {
    const out = new Map<string, { startFrac: number; endFrac: number; sceneFracs: Map<string, { start: number; end: number }> }>();
    if (allScenes.length === 0 || totalUnits === 0) return out;

    // 모든 씬을 orderNo 순으로 cumulative 배치 (=EP 전체 가로축)
    let cum = 0;
    const sceneStarts = new Map<string, { start: number; end: number; partId: string }>();
    const sorted = [...allScenes].sort((a, b) => a.orderNo - b.orderNo);
    for (const sc of sorted) {
      const unit = hasAllDurations ? (sc.durationFrames ?? 0) : 1;
      const start = cum / totalUnits;
      const end = (cum + unit) / totalUnits;
      sceneStarts.set(sc.sceneId, { start, end, partId: sc.partId });
      cum += unit;
    }

    // 파트별 [start, end] = 그 파트 씬들의 min/max
    for (const g of partGroups) {
      let minS = Infinity;
      let maxE = -Infinity;
      const sceneFracs = new Map<string, { start: number; end: number }>();
      for (const sc of g.scenes) {
        const f = sceneStarts.get(sc.sceneId);
        if (!f) continue;
        if (f.start < minS) minS = f.start;
        if (f.end > maxE) maxE = f.end;
        sceneFracs.set(sc.sceneId, { start: f.start, end: f.end });
      }
      if (Number.isFinite(minS) && Number.isFinite(maxE)) {
        out.set(g.partId, { startFrac: minS, endFrac: maxE, sceneFracs });
      }
    }
    return out;
  }, [partGroups, allScenes, hasAllDurations, totalUnits]);

  // ── 3. 현재 진행 위치 (CTI) — 마지막으로 단계 변경된 씬의 중심 ──
  const ctiFrac = useMemo(() => {
    if (epStates.size === 0) return null;
    let latest: { sceneId: string; updatedAt: string } | null = null;
    for (const row of epStates.values()) {
      if (!latest || row.updatedAt > latest.updatedAt) {
        latest = { sceneId: row.sceneId, updatedAt: row.updatedAt };
      }
    }
    if (!latest) return null;
    // 어느 파트에 속하든 sceneFracs 에서 찾기
    for (const slot of partSlots.values()) {
      const f = slot.sceneFracs.get(latest.sceneId);
      if (f) return (f.start + f.end) / 2;
    }
    return null;
  }, [epStates, partSlots]);

  if (episodeNumber === null) {
    return (
      <div
        className="rounded-lg overflow-hidden mt-3 border border-bg-border/45 px-6 py-6 text-center text-xs text-text-secondary"
        style={{ background: 'rgb(var(--color-bg-card) / 0.55)', minHeight: PANEL_MIN_H }}
      >
        에피소드를 선택해주세요.
      </div>
    );
  }

  return (
    <div
      className="bf-wipe-in rounded-lg overflow-hidden mt-3 border border-bg-border/45"
      style={{
        background: 'rgb(var(--color-bg-card) / 0.55)',
        minHeight: PANEL_MIN_H,
      }}
    >
      <div className="flex">
        {/* ── 좌측 LayerPanel — 파트 4 행 ── */}
        <div
          className="shrink-0 border-r border-bg-border/55 bg-bg-card/40"
          style={{ width: LAYER_W }}
        >
          <div
            className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider px-3 py-2 border-b border-bg-border/40"
            style={{ height: 28 }}
          >
            컴포지션 레이어
          </div>
          {partGroups.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-text-secondary/70">
              파트 없음
            </div>
          ) : (
            partGroups.map((g) => (
              <div
                key={g.partId}
                className="flex items-center gap-2 px-3 border-b border-bg-border/25"
                style={{ height: ROW_H }}
              >
                <PartBadge partId={g.partId as 'A' | 'B' | 'C' | 'D'} size="md" />
                <div className="flex flex-col leading-tight min-w-0">
                  <span className="text-[11px] font-semibold text-text-primary truncate">파트 {g.partId}</span>
                  <span className="text-[9px] text-text-secondary tabular-nums">{g.scenes.length}컷</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── 우측 트랙 ── */}
        <div className="relative flex-1 min-w-0">
          <TimeRuler
            mode={hasAllDurations ? 'time' : 'index'}
            totalFrames={totalUnits}
            totalScenes={allScenes.length}
            fps={FPS}
          />

          {partGroups.map((g) => {
            const slot = partSlots.get(g.partId);
            if (!slot) return <div key={g.partId} className="border-b border-bg-border/20" style={{ height: ROW_H }} />;
            return (
              <div
                key={g.partId}
                className="relative border-b border-bg-border/20"
                style={{ height: ROW_H }}
              >
                {/* 파트 범위 옅은 배경 */}
                <div
                  className="absolute inset-y-0"
                  style={{
                    left: `${slot.startFrac * 100}%`,
                    width: `${Math.max(0.5, (slot.endFrac - slot.startFrac) * 100)}%`,
                    background: 'rgb(var(--color-bg-primary) / 0.45)',
                    borderLeft: '1px solid rgb(var(--color-bg-border) / 0.45)',
                    borderRight: '1px solid rgb(var(--color-bg-border) / 0.45)',
                  }}
                />
                {/* 그 파트 씬별 status stacked bar */}
                {g.scenes.map((sc) => {
                  const f = slot.sceneFracs.get(sc.sceneId);
                  if (!f) return null;
                  const key = `${sc.episodeNumber}:${sc.sceneId}`;
                  const st = epStates.get(key);
                  const status = st?.status ?? 'batch';
                  const tokenVar = COMPOSITING_STATUS_TOKEN[status];
                  return (
                    <div
                      key={sc.sceneId}
                      className="absolute bf-wipe-in"
                      title={`${sc.sceneId} · ${status}`}
                      style={{
                        left: `${f.start * 100}%`,
                        width: `${Math.max(0.4, (f.end - f.start) * 100)}%`,
                        top: 12,
                        bottom: 12,
                        background: `rgb(var(${tokenVar}) / 0.7)`,
                        borderRadius: 2,
                        boxShadow: `0 0 4px rgb(var(${tokenVar}) / 0.35)`,
                        animationDelay: `${(sc.orderNo % 30) * 18 + 250}ms`,
                      }}
                    />
                  );
                })}
                {/* 파트 라벨 (우상단) */}
                <span
                  className="absolute right-1 top-1 text-[8px] font-bold uppercase tracking-wider pointer-events-none px-1 rounded"
                  style={{
                    color: `var(--part-${g.partId.toLowerCase()})`,
                    background: 'rgb(var(--color-bg-primary) / 0.7)',
                  }}
                >
                  {g.partId}
                </span>
              </div>
            );
          })}

          {/* 현재 진행 위치 (CTI) */}
          {ctiFrac !== null && <CurrentPositionLine frac={ctiFrac} />}
        </div>
      </div>
    </div>
  );
}
