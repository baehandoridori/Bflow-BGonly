/**
 * AE 메타포 타임라인 패널 — 핸드오프 variant-a 시안에 맞춘 풀 구현.
 *
 * 시안 mock: docs/mockups/compositing-dashboard/variant-a.jsx
 *
 * 구조:
 *   ┌─ LayerPanel (좌측) ─┬─ TimeRuler ─────────────────────────────────────┐
 *   │ COMP NAME           │ 0:00 ─ 1:53 ─ 3:45 ─ ...                       │
 *   │                     │ RAM 프리뷰 (완료 segments)                       │
 *   │                     │ WORK AREA (작업 중 union 막대)                    │
 *   ├─ A 파트 14컷 64% ──┼─ ┃ [컬러 stacked bar w/ counts] · A파트 5:30 64% ┃─
 *   ├─ B 파트 22컷 86% ──┼─ ─── ┃ [stacked] · B파트 8:30 86% ┃ ─────────────
 *   │ ...                 │ ...                                            │
 *   └─────────────────────┴─────────────────────────────────────────────────┘
 *
 * 핵심 차이 (이전 구현 vs 시안):
 *   - 파트 막대 안에 6 상태 stacked bar (씬별이 아닌 status 단위 분포 + 카운트)
 *   - 좌측 LayerPanel 의 각 파트 행에 미니 progress bar
 *   - 호버시 파트 막대가 위로 들리고 글로우
 *   - 좌측 파트 색 strip (4px)
 */

import { useMemo, useRef, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { CompositingState, CompositingStatus } from '@/types';
import { COMPOSITING_STATUS_LABEL, COMPOSITING_STATUS_ORDER, COMPOSITING_STATUS_TOKEN } from '@/utils/compositingLabels';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { TimeRuler } from './TimeRuler';
import { CurrentPositionLine } from './CurrentPositionLine';

const FPS = 24;
const LAYER_W = 168;
const ROW_H = 56;
const RULER_H = 28;
const SUMMARY_H = 14;
const WORKAREA_H = 14;
const HEADER_TOP_H = RULER_H + SUMMARY_H + WORKAREA_H;
const PANEL_MIN_H = HEADER_TOP_H + ROW_H * 3;

export interface TimelineScene {
  sceneId: string;
  partId: string;
  episodeNumber: number;
  durationFrames: number | null;
  orderNo: number;
}

export interface TimelinePartGroup {
  partId: string;
  scenes: TimelineScene[];
}

interface TimelinePanelProps {
  episodeNumber: number | null;
  partGroups: TimelinePartGroup[];
  epStates: Map<string, CompositingState>;
  /** 파트 행이 드래그로 재배치됐을 때 호출. 새 partId 순서. */
  onReorder?: (partIds: string[]) => void;
  /** 파트 막대 우측 edge 드래그로 그 파트 길이 비율을 변경했을 때 호출 (drag 종료 시점).
   *  scale > 1 = 늘이기, < 1 = 줄이기. 호스트가 Supabase 에 commit. */
  onResizePart?: (partId: string, scale: number) => Promise<void>;
  /** 현재 사용자가 컴포지터인지 — 리사이즈 핸들 노출 분기. */
  isCompositor?: boolean;
}

export function TimelinePanel({
  episodeNumber, partGroups, epStates, onReorder, onResizePart, isCompositor = false,
}: TimelinePanelProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const hoveredPart = useCompositingDashboardStore((s) => s.hoveredPart);
  const setHoveredPart = useCompositingDashboardStore((s) => s.setHoveredPart);

  // framer-motion Reorder 가 동작하려면 values 배열이 안정적이어야 함 — partId list 추출
  const partIds = useMemo(() => partGroups.map((g) => g.partId), [partGroups]);
  const handleReorder = (next: string[]) => {
    onReorder?.(next);
  };

  // ── 파트 막대 리사이즈 (drag 중 시각 미리보기) ──
  // drag 중에는 store 를 건드리지 않고 이 state 로만 시각 표시 → pointerup 시 commit.
  // resizing.scale = 그 파트의 현재 width 대비 multiplier (1.0 = 변경 없음)
  const [resizing, setResizing] = useState<{ partId: string; scale: number } | null>(null);
  const resizeStartRef = useRef<{ partId: string; startX: number; basePxWidth: number; trackWidthPx: number } | null>(null);

  const handleResizePointerDown = (partId: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onResizePart || !isCompositor) return;
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current;
    const partBar = (e.currentTarget.parentElement as HTMLElement | null);
    if (!track || !partBar) return;
    const partRect = partBar.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    resizeStartRef.current = {
      partId,
      startX: e.clientX,
      basePxWidth: partRect.width,
      trackWidthPx: trackRect.width,
    };
    setResizing({ partId, scale: 1 });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current;
    if (!start) return;
    const deltaX = e.clientX - start.startX;
    const nextWidth = Math.max(20, start.basePxWidth + deltaX);
    const scale = nextWidth / start.basePxWidth;
    // 0.2 ~ 5x 사이 clamp — 극단적 값 방지
    setResizing({ partId: start.partId, scale: Math.max(0.2, Math.min(5, scale)) });
  };

  const handleResizePointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current;
    resizeStartRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!start || !resizing) {
      setResizing(null);
      return;
    }
    const finalScale = resizing.scale;
    setResizing(null);
    // scale 이 거의 1 이면 commit skip — 의도치 않은 호출 방지
    if (Math.abs(finalScale - 1) < 0.02) return;
    try {
      await onResizePart?.(start.partId, finalScale);
    } catch {
      // 호스트가 sonner 토스트 처리 — 여기는 추가 작업 없음
    }
  };

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

  // ── 2. 파트별 위치 + 상태 카운트 ──
  const partInfo = useMemo(() => {
    interface Info {
      startFrac: number;
      endFrac: number;
      counts: Record<CompositingStatus, number>;
      doneCount: number;
      totalCount: number;
      donePct: number;
      durationFrames: number;
    }
    const out = new Map<string, Info>();
    if (allScenes.length === 0 || totalUnits === 0) return out;

    // EP 전체 가로축 위치 (orderNo 누적)
    let cum = 0;
    const sceneStarts = new Map<string, { start: number; end: number }>();
    const sorted = [...allScenes].sort((a, b) => a.orderNo - b.orderNo);
    for (const sc of sorted) {
      const unit = hasAllDurations ? (sc.durationFrames ?? 0) : 1;
      sceneStarts.set(sc.sceneId, { start: cum / totalUnits, end: (cum + unit) / totalUnits });
      cum += unit;
    }

    for (const g of partGroups) {
      let minS = Infinity;
      let maxE = -Infinity;
      let partFrames = 0;
      const counts: Record<CompositingStatus, number> = {
        batch: 0, combine: 0, aggregated: 0, adjust: 0, error: 0, done: 0,
      };
      for (const sc of g.scenes) {
        const f = sceneStarts.get(sc.sceneId);
        if (!f) continue;
        if (f.start < minS) minS = f.start;
        if (f.end > maxE) maxE = f.end;
        partFrames += sc.durationFrames ?? 0;
        const st = epStates.get(`${sc.episodeNumber}:${sc.sceneId}`);
        counts[st?.status ?? 'batch'] += 1;
      }
      if (!Number.isFinite(minS) || !Number.isFinite(maxE)) continue;
      const total = g.scenes.length;
      out.set(g.partId, {
        startFrac: minS,
        endFrac: maxE,
        counts,
        doneCount: counts.done,
        totalCount: total,
        donePct: total > 0 ? (counts.done / total) * 100 : 0,
        durationFrames: partFrames,
      });
    }
    return out;
  }, [partGroups, allScenes, hasAllDurations, totalUnits, epStates]);

  // ── 3. 현재 진행 위치 (CTI) — 마지막 단계 변경된 씬 ──
  const ctiFrac = useMemo(() => {
    if (epStates.size === 0) return null;
    let latest: { sceneId: string; updatedAt: string } | null = null;
    for (const row of epStates.values()) {
      if (!latest || row.updatedAt > latest.updatedAt) {
        latest = { sceneId: row.sceneId, updatedAt: row.updatedAt };
      }
    }
    if (!latest) return null;
    // sceneStarts 다시 계산해 그 씬의 중심점 찾기
    let cum = 0;
    const sorted = [...allScenes].sort((a, b) => a.orderNo - b.orderNo);
    for (const sc of sorted) {
      const unit = hasAllDurations ? (sc.durationFrames ?? 0) : 1;
      if (sc.sceneId === latest.sceneId) {
        return (cum + unit / 2) / totalUnits;
      }
      cum += unit;
    }
    return null;
  }, [epStates, allScenes, hasAllDurations, totalUnits]);

  // ── RAM 프리뷰 segments (done 씬들의 가로축 union) ──
  const ramSegments = useMemo(() => {
    const segs: { left: number; width: number }[] = [];
    let cum = 0;
    const sorted = [...allScenes].sort((a, b) => a.orderNo - b.orderNo);
    for (const sc of sorted) {
      const unit = hasAllDurations ? (sc.durationFrames ?? 0) : 1;
      const st = epStates.get(`${sc.episodeNumber}:${sc.sceneId}`);
      if (st?.status === 'done') {
        segs.push({ left: (cum / totalUnits) * 100, width: (unit / totalUnits) * 100 });
      }
      cum += unit;
    }
    return segs;
  }, [allScenes, hasAllDurations, totalUnits, epStates]);

  // ── WORK AREA (각 씬의 가로축 위치에 status 별 색 — done 제외) ──
  // 한솔 정의:
  //   - RAM 라인 (위) = done 만 초록 (실제 완료된 부분)
  //   - WORK AREA 라인 (아래) = 작업 진행 단계들 색 분포 (combine 옅은 파랑 / aggregated 파랑 /
  //     adjust 노랑 / error 빨강). batch 는 표시 X (작업 시작 전).
  // AE 의 RAM/Work Area 메타포를 진행 상황 시각화로 활용.
  const workSegments = useMemo(() => {
    const out: { left: number; width: number; status: CompositingStatus }[] = [];
    let cum = 0;
    const sorted = [...allScenes].sort((a, b) => a.orderNo - b.orderNo);
    for (const sc of sorted) {
      const unit = hasAllDurations ? (sc.durationFrames ?? 0) : 1;
      const st = epStates.get(`${sc.episodeNumber}:${sc.sceneId}`);
      const status = st?.status ?? 'batch';
      // done 은 위 RAM 라인에서 표시, batch 는 작업 시작 전이라 둘 다 skip
      if (status !== 'batch' && status !== 'done') {
        out.push({
          left: (cum / totalUnits) * 100,
          width: (unit / totalUnits) * 100,
          status,
        });
      }
      cum += unit;
    }
    return out;
  }, [allScenes, hasAllDurations, totalUnits, epStates]);

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

  const totalSec = hasAllDurations ? totalUnits / FPS : 0;
  const fmtTime = (sec: number) => {
    if (!Number.isFinite(sec) || sec <= 0) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

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
          className="shrink-0 border-r border-bg-border/55"
          style={{ width: LAYER_W, background: 'rgb(var(--color-bg-card) / 0.7)' }}
        >
          {/* 좌측 헤더 (룰러+RAM+WORK 높이만큼) */}
          <div
            className="flex items-end px-3 pb-1 border-b border-bg-border/55 text-[9px] font-bold text-text-secondary tracking-widest"
            style={{ height: HEADER_TOP_H, background: 'rgb(var(--color-bg-primary) / 0.8)' }}
          >
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: 'rgb(var(--color-text-secondary) / 0.3)' }} />
              COMP NAME
            </div>
          </div>
          {/* 파트 행 (좌측 라벨) — framer-motion Reorder 로 드래그 reorder 지원 */}
          {partGroups.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-text-secondary/70">파트 없음</div>
          ) : (
            <Reorder.Group axis="y" values={partIds} onReorder={handleReorder} className="list-none m-0 p-0">
              {partGroups.map((g) => (
                <LayerPanelRow
                  key={g.partId}
                  group={g}
                  info={partInfo.get(g.partId)}
                  focused={hoveredPart === g.partId}
                  onHoverEnter={() => setHoveredPart(g.partId)}
                  onHoverLeave={() => setHoveredPart(null)}
                  rowHeight={ROW_H}
                />
              ))}
            </Reorder.Group>
          )}
        </div>

        {/* ── 우측 트랙 ── */}
        <div ref={trackRef} className="relative flex-1 min-w-0">
          <TimeRuler
            mode={hasAllDurations ? 'time' : 'index'}
            totalFrames={totalUnits}
            totalScenes={allScenes.length}
            fps={FPS}
          />

          {/* RAM 프리뷰 — done 씬들의 가로축 union segments */}
          <div
            className="relative border-b border-bg-border/45"
            style={{
              height: SUMMARY_H,
              background: 'rgb(var(--color-bg-primary) / 0.9)',
            }}
            aria-label="완료 segments"
          >
            <div
              className="absolute inset-0"
              style={{
                background: 'repeating-linear-gradient(90deg, color-mix(in srgb, var(--status-done) 15%, transparent) 0 4px, transparent 4px 8px)',
              }}
            />
            {ramSegments.map((seg, i) => (
              <div
                key={i}
                className="absolute bf-wipe-in"
                style={{
                  left: `${seg.left}%`,
                  width: `${seg.width}%`,
                  top: 1,
                  bottom: 1,
                  background: 'var(--status-done)',
                  boxShadow: '0 0 6px color-mix(in srgb, var(--status-done) 55%, transparent)',
                  animationDelay: `${i * 18 + 400}ms`,
                }}
              />
            ))}
            <span
              className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] font-extrabold tracking-widest pointer-events-none px-1"
              style={{
                color: 'var(--status-done)',
                background: 'rgb(var(--color-bg-primary) / 0.92)',
                letterSpacing: '0.12em',
              }}
            >
              RAM
            </span>
          </div>

          {/* WORK AREA — 작업 진행 단계별 status 색 segments
              (combine 옅은 파랑 / aggregated 파랑 / adjust 노랑 / error 빨강) */}
          <div
            className="relative border-b border-bg-border/45"
            style={{
              height: WORKAREA_H,
              background: 'rgb(var(--color-bg-primary) / 0.6)',
            }}
            aria-label="작업 중 영역"
          >
            {workSegments.map((seg, i) => {
              const tokenVar = COMPOSITING_STATUS_TOKEN[seg.status];
              return (
                <div
                  key={i}
                  className="absolute bf-wipe-in"
                  title={`${COMPOSITING_STATUS_LABEL[seg.status]}`}
                  style={{
                    left: `${seg.left}%`,
                    width: `${Math.max(0.3, seg.width)}%`,
                    top: 1,
                    bottom: 1,
                    background: `linear-gradient(180deg, color-mix(in srgb, var(${tokenVar}) 95%, transparent), color-mix(in srgb, var(${tokenVar}) 70%, transparent))`,
                    boxShadow: `0 0 4px color-mix(in srgb, var(${tokenVar}) 45%, transparent)`,
                    animationDelay: `${i * 14 + 500}ms`,
                  }}
                />
              );
            })}
            <span
              className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] font-extrabold tracking-widest pointer-events-none px-1"
              style={{
                color: 'var(--status-combine)',
                background: 'rgb(var(--color-bg-primary) / 0.92)',
                letterSpacing: '0.12em',
              }}
            >
              WORK AREA
            </span>
          </div>

          {/* 파트 컴포지션 레이어 행들 */}
          {partGroups.map((g, idx) => {
            const info = partInfo.get(g.partId);
            if (!info) return <div key={g.partId} style={{ height: ROW_H }} />;
            const focused = hoveredPart === g.partId;
            const lower = g.partId.toLowerCase();
            const partColor = `var(--part-${lower})`;
            return (
              <div
                key={g.partId}
                onMouseEnter={() => setHoveredPart(g.partId)}
                onMouseLeave={() => setHoveredPart(null)}
                className={cn('relative border-b border-bg-border/30 transition-all duration-200 cursor-pointer bf-wipe-in')}
                style={{
                  height: ROW_H,
                  background: focused
                    ? `linear-gradient(90deg, color-mix(in srgb, ${partColor} 7%, transparent), transparent 80%)`
                    : idx % 2 === 0 ? 'transparent' : 'rgb(var(--color-bg-primary) / 0.25)',
                  animationDelay: `${300 + idx * 80}ms`,
                }}
              >
                {/* 파트 막대 본체 — 리사이즈 drag 중이면 시각 width 즉시 반영 */}
                <div
                  className="absolute"
                  style={{
                    left: `${info.startFrac * 100}%`,
                    width: resizing?.partId === g.partId
                      ? `${Math.max(2, (info.endFrac - info.startFrac) * 100 * resizing.scale)}%`
                      : `${Math.max(2, (info.endFrac - info.startFrac) * 100)}%`,
                    top: 6,
                    bottom: 6,
                    background: 'rgb(var(--color-bg-primary) / 0.55)',
                    border: `1.5px solid ${(focused || resizing?.partId === g.partId) ? partColor : `color-mix(in srgb, ${partColor} 55%, transparent)`}`,
                    borderRadius: 5,
                    overflow: 'visible',
                    transform: focused ? 'translateY(-1px) scaleY(1.06)' : 'none',
                    transition: resizing?.partId === g.partId
                      ? 'none'
                      : 'all 220ms cubic-bezier(0.2, 0.7, 0.2, 1)',
                    boxShadow: focused || resizing?.partId === g.partId
                      ? `0 6px 18px rgb(var(--color-shadow) / 0.4), 0 0 18px color-mix(in srgb, ${partColor} 55%, transparent)`
                      : '0 1px 4px rgb(var(--color-shadow) / 0.25)',
                  }}
                >
                  {/* 좌측 파트 색 strip 4px */}
                  <div
                    className="absolute left-0 top-0 bottom-0"
                    style={{ width: 4, background: partColor }}
                  />

                  {/* 상단 stacked status bar */}
                  <div
                    className="absolute flex"
                    style={{
                      left: 4,
                      right: 4,
                      top: 4,
                      bottom: 16,
                      gap: 0,
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    {COMPOSITING_STATUS_ORDER.map((st) => {
                      const c = info.counts[st];
                      if (c === 0) return null;
                      const w = (c / info.totalCount) * 100;
                      const tokenVar = COMPOSITING_STATUS_TOKEN[st];
                      return (
                        <div
                          key={st}
                          title={`${COMPOSITING_STATUS_LABEL[st]} ${c}컷`}
                          className="relative flex items-center justify-center"
                          style={{
                            width: `${w}%`,
                            background: `linear-gradient(180deg, color-mix(in srgb, var(${tokenVar}) 95%, transparent), color-mix(in srgb, var(${tokenVar}) 70%, transparent))`,
                            borderRight: '1px solid rgb(var(--color-bg-primary) / 0.5)',
                          }}
                        >
                          {w > 6 && (
                            <span
                              className="font-extrabold tabular-nums"
                              style={{
                                fontSize: 8,
                                color: '#fff',
                                textShadow: '0 1px 2px rgb(0 0 0 / 0.6)',
                              }}
                            >
                              {c}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 하단 라벨 */}
                  <div
                    className="absolute flex items-center justify-between font-mono pointer-events-none"
                    style={{
                      bottom: 1,
                      left: 6,
                      right: 6,
                      fontSize: 9,
                      color: 'rgb(var(--color-text-secondary))',
                      letterSpacing: '0.02em',
                    }}
                  >
                    <span className="font-bold" style={{ color: partColor }}>
                      {g.partId}파트 · {info.totalCount}컷
                    </span>
                    <span className="tabular-nums">
                      {totalSec > 0 && fmtTime((info.durationFrames * (resizing?.partId === g.partId ? resizing.scale : 1)) / FPS)}
                      {totalSec > 0 && ' · '}
                      완료 {Math.round(info.donePct)}%
                    </span>
                  </div>

                  {/* 우측 edge resize 핸들 — 컴포지터만 노출 */}
                  {isCompositor && onResizePart && (
                    <div
                      onPointerDown={handleResizePointerDown(g.partId)}
                      onPointerMove={handleResizePointerMove}
                      onPointerUp={handleResizePointerUp}
                      onPointerCancel={handleResizePointerUp}
                      role="separator"
                      aria-label={`${g.partId} 파트 길이 조절 — 좌우로 드래그`}
                      title="좌우로 드래그하여 파트 길이 조절 (씬 길이 일괄 조정)"
                      className="absolute"
                      style={{
                        right: -4,
                        top: -4,
                        bottom: -4,
                        width: 10,
                        cursor: 'ew-resize',
                        // hover/active 시 강조 — 평소엔 약하게 보임
                        background: resizing?.partId === g.partId
                          ? partColor
                          : 'color-mix(in srgb, var(--color-accent) 35%, transparent)',
                        borderRadius: 3,
                        boxShadow: resizing?.partId === g.partId
                          ? `0 0 12px ${partColor}`
                          : '0 0 0 transparent',
                        zIndex: 2,
                        transition: 'background 150ms ease, box-shadow 150ms ease',
                      }}
                    >
                      <div
                        className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex flex-col gap-px pointer-events-none"
                        aria-hidden="true"
                      >
                        <span className="block w-0.5 h-2.5 rounded-full" style={{ background: 'rgb(255 255 255 / 0.85)' }} />
                        <span className="block w-0.5 h-2.5 rounded-full" style={{ background: 'rgb(255 255 255 / 0.85)' }} />
                      </div>
                    </div>
                  )}
                </div>
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

// ── 좌측 LayerPanel 한 행 — drag 가능한 Reorder.Item ────────────────────

interface LayerPanelRowProps {
  group: TimelinePartGroup;
  info: {
    startFrac: number;
    endFrac: number;
    counts: Record<CompositingStatus, number>;
    doneCount: number;
    totalCount: number;
    donePct: number;
    durationFrames: number;
  } | undefined;
  focused: boolean;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  rowHeight: number;
}

function LayerPanelRow({ group, info, focused, onHoverEnter, onHoverLeave, rowHeight }: LayerPanelRowProps) {
  const dragControls = useDragControls();
  const lower = group.partId.toLowerCase();
  const partColor = `var(--part-${lower})`;

  return (
    <Reorder.Item
      value={group.partId}
      dragListener={false}
      dragControls={dragControls}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      className="relative block border-b border-bg-border/40 transition-colors duration-200 list-none"
      style={{
        height: rowHeight,
        padding: '6px 10px 6px 14px',
        background: focused
          ? `linear-gradient(90deg, color-mix(in srgb, ${partColor} 18%, transparent), transparent 90%)`
          : 'transparent',
        cursor: 'default',
      }}
    >
      {/* 좌측 파트 색 strip */}
      <span
        className="absolute left-0 rounded-r"
        style={{
          top: 4,
          bottom: 4,
          width: 4,
          background: partColor,
          boxShadow: focused ? `0 0 10px color-mix(in srgb, ${partColor} 70%, transparent)` : 'none',
        }}
      />
      <div className="flex items-center gap-1.5">
        {/* drag 핸들 — 이곳에서만 reorder drag 시작 */}
        <button
          type="button"
          aria-label={`${group.partId} 파트 순서 변경 — 위/아래로 드래그`}
          onPointerDown={(e) => {
            e.preventDefault();
            dragControls.start(e);
          }}
          className={cn(
            'shrink-0 flex items-center justify-center rounded transition-all duration-150',
            'cursor-grab active:cursor-grabbing',
            focused ? 'text-text-primary' : 'text-text-secondary',
          )}
          style={{
            width: 18,
            height: 22,
            background: focused
              ? `color-mix(in srgb, ${partColor} 22%, transparent)`
              : 'rgb(var(--color-bg-border) / 0.35)',
          }}
          title="드래그하여 파트 순서 변경"
        >
          <GripVertical size={14} strokeWidth={2.5} />
        </button>
        <span
          className="text-[13px] font-extrabold tracking-wide"
          style={{ color: partColor }}
        >
          {group.partId}파트
        </span>
        <span className="text-[10px] font-mono text-text-secondary ml-auto tabular-nums">
          {info?.totalCount ?? 0}컷
        </span>
      </div>
      {/* 미니 progress + 퍼센트 */}
      <div className="mt-1.5 ml-4 flex items-center gap-1.5">
        <div
          className="flex-1 h-[3px] rounded-full overflow-hidden"
          style={{ background: 'rgb(var(--color-bg-border) / 0.45)' }}
        >
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${info?.donePct ?? 0}%`,
              background: `linear-gradient(90deg, ${partColor}, var(--status-done))`,
              boxShadow: `0 0 4px color-mix(in srgb, var(--status-done) 55%, transparent)`,
            }}
          />
        </div>
        <span
          className="text-[9px] font-bold font-mono tabular-nums shrink-0"
          style={{ color: (info?.donePct ?? 0) >= 100 ? 'var(--status-done)' : partColor }}
        >
          {Math.round(info?.donePct ?? 0)}%
        </span>
      </div>
    </Reorder.Item>
  );
}
