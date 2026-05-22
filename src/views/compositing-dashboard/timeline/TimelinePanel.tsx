/**
 * AE 메타포 타임라인 패널 — mock 합친 시안 (VariantHybrid) 패턴.
 *
 * 한솔 결정 (2026-05-21):
 *   - 영상 길이 (durationFrames) 비율 X — 기본 배열은 **컷 수 균등** (한 컷당 고정 width)
 *   - 너비 부족 시 가로 스크롤
 *   - hover 시 점 세개 핸들 노출, drag 로 파트 길이(컷 슬롯 너비) 시각 조정 (시각 전용, 데이터 변경 X)
 *   - 영상 길이 메타포는 주석에만 유지 — 후속 spec (Premiere 추출) 에서 부활 가능.
 *
 * spec: 2026-05-21-compositing-dashboard-design.md
 * mock: docs/mockups/compositing-dashboard/interactive.html (VariantHybrid)
 */

import { useMemo, useRef, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical, FileText } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { CompositingState, CompositingStatus } from '@/types';
import { COMPOSITING_STATUS_LABEL, COMPOSITING_STATUS_ORDER, COMPOSITING_STATUS_TOKEN, isCompletedStatus } from '@/utils/compositingLabels';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { PartBadge } from '@/components/compositing-dashboard/common/PartBadge';

const PART_BOX_H = 96;

export interface TimelineScene {
  sceneId: string;
  partId: string;
  episodeNumber: number;
  /** v1.30.0 한솔 정정: 영상 길이 비율은 시각 X — 주석으로만 유지. 후속 spec(Premiere) 에서 부활 가능. */
  durationFrames: number | null;
  orderNo: number;
}

export interface TimelinePartGroup {
  partId: string;
  scenes: TimelineScene[];
  memo?: string;
}

interface TimelinePanelProps {
  episodeNumber: number | null;
  partGroups: TimelinePartGroup[];
  epStates: Map<string, CompositingState>;
  onReorder?: (partIds: string[]) => void;
  /** isCompositor 일 때만 hover-only 리사이즈 핸들 노출. drag 결과는 컷당 픽셀 배수만 시각 변경. */
  isCompositor?: boolean;
}

export function TimelinePanel({ episodeNumber, partGroups, epStates, onReorder, isCompositor = false }: TimelinePanelProps) {
  const hoveredPart = useCompositingDashboardStore((s) => s.hoveredPart);
  const setHoveredPart = useCompositingDashboardStore((s) => s.setHoveredPart);
  const partIds = useMemo(() => partGroups.map((g) => g.partId), [partGroups]);
  const handleReorder = (next: string[]) => { onReorder?.(next); };

  // 한솔 정정 (2026-05-21): split-pane 패턴.
  //   - 각 파트는 절대 fraction 보관 (0~1, 총합 = 1).
  //   - 핸들 = 그 파트와 다음 파트 사이 경계. 드래그 시 두 파트의 fraction 만 변경 (합 고정).
  //   - 다른 파트는 가만 → "내가 잡고 끄는 부분만 변형" 직관 충족.
  //   - 컨테이너에 fit (가로 스크롤 X).
  //   - rAF throttle 로 렉 fix.
  const [overrideFractions, setOverrideFractions] = useState<Record<string, number> | null>(null);

  // 기본 fraction — 컷 수 비례. override 있으면 그것 우선.
  const baseFractions = useMemo(() => {
    const weights = partGroups.map((g) => Math.max(1, g.scenes.length));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const out: Record<string, number> = {};
    partGroups.forEach((g, i) => { out[g.partId] = weights[i] / total; });
    return out;
  }, [partGroups]);

  const partFractions = useMemo(() => {
    const out = new Map<string, number>();
    for (const g of partGroups) {
      out.set(g.partId, overrideFractions?.[g.partId] ?? baseFractions[g.partId] ?? 0);
    }
    return out;
  }, [partGroups, overrideFractions, baseFractions]);

  // 컨테이너 ref — 드래그 시 컨테이너 너비 기준으로 deltaPx → deltaFraction 변환
  const trackContainerRef = useRef<HTMLDivElement>(null);

  // 한솔 보고 (2026-05-21): rAF throttle 만으로는 렉 안 풀림 — React reconciliation 자체가 무거움
  //   (70+ 카드 / Reorder.Group 의 layout animation 등).
  // → 드래그 중에는 setState 호출 안 함. 두 파트 DOM element 의 style.width 만 직접 변경.
  //   드래그 종료 시 setOverrideFractions 1 회.
  const onResizeDown = (partId: string, partIndex: number) => (e: React.MouseEvent) => {
    if (!isCompositor) return;
    if (partIndex >= partGroups.length - 1) return;
    e.preventDefault();
    e.stopPropagation();
    const nextPartId = partGroups[partIndex + 1].partId;
    const container = trackContainerRef.current;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    const initial: Record<string, number> = { ...baseFractions, ...(overrideFractions ?? {}) };
    const startFracA = initial[partId] ?? 0;
    const startFracB = initial[nextPartId] ?? 0;
    const lockedSum = startFracA + startFracB;
    const startX = e.clientX;
    const minFrac = 0.01;

    // 두 파트 DOM element 직접 조작 — data-part-id 로 찾음
    const elA = container.querySelector<HTMLElement>(`[data-part-id="${partId}"]`);
    const elB = container.querySelector<HTMLElement>(`[data-part-id="${nextPartId}"]`);
    if (!elA || !elB) return;

    let latestA = startFracA;
    let latestB = startFracB;

    const onMove = (ev: MouseEvent) => {
      const deltaPx = ev.clientX - startX;
      const deltaFrac = deltaPx / Math.max(1, containerWidth);
      const newA = Math.max(minFrac, Math.min(lockedSum - minFrac, startFracA + deltaFrac));
      const newB = lockedSum - newA;
      latestA = newA;
      latestB = newB;
      // DOM 직접 — React 우회 (transition 도 일시 비활성)
      elA.style.width = `${newA * 100}%`;
      elB.style.width = `${newB * 100}%`;
    };
    const onUp = () => {
      // 드래그 종료 — setState 로 React state 동기화 (다음 render 부터 정상 layout 흐름)
      setOverrideFractions({ ...initial, [partId]: latestA, [nextPartId]: latestB });
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 각 파트의 [startFrac, endFrac] — 0~1 정규화 위치
  const partStarts = useMemo(() => {
    const out = new Map<string, number>();
    let cum = 0;
    for (const g of partGroups) {
      out.set(g.partId, cum);
      cum += partFractions.get(g.partId) ?? 0;
    }
    return out;
  }, [partGroups, partFractions]);

  // 파트별 status 카운트
  const partInfo = useMemo(() => {
    const out = new Map<string, {
      counts: Record<CompositingStatus, number>;
      doneCount: number;
      totalCount: number;
      donePct: number;
    }>();
    for (const g of partGroups) {
      const counts: Record<CompositingStatus, number> = {
        batch: 0, combine: 0, aggregated: 0, adjust: 0, error: 0, done: 0,
      };
      for (const sc of g.scenes) {
        const st = epStates.get(`${sc.episodeNumber}:${sc.sceneId}`);
        counts[st?.status ?? 'batch'] += 1;
      }
      const total = g.scenes.length;
      // 한솔 정의 (2026-05-22): "완료된 부분 = done + aggregated".
      const completedCount = counts.done + counts.aggregated;
      out.set(g.partId, {
        counts,
        doneCount: completedCount,
        totalCount: total,
        donePct: total > 0 ? (completedCount / total) * 100 : 0,
      });
    }
    return out;
  }, [partGroups, epStates]);

  // 각 씬의 [startFrac, endFrac] (0~1) — 파트 안에서 균등 분배
  const sceneRanges = useMemo(() => {
    const out = new Map<string, { startFrac: number; endFrac: number; status: CompositingStatus }>();
    for (const g of partGroups) {
      const partStart = partStarts.get(g.partId) ?? 0;
      const partFrac = partFractions.get(g.partId) ?? 0;
      const slice = g.scenes.length > 0 ? partFrac / g.scenes.length : 0;
      g.scenes.forEach((sc, i) => {
        const st = epStates.get(`${sc.episodeNumber}:${sc.sceneId}`);
        out.set(sc.sceneId, {
          startFrac: partStart + i * slice,
          endFrac: partStart + (i + 1) * slice,
          status: st?.status ?? 'batch',
        });
      });
    }
    return out;
  }, [partGroups, partStarts, partFractions, epStates]);

  if (episodeNumber === null) {
    return (
      <div
        className="rounded-lg overflow-hidden mt-3 border border-bg-border/45 px-6 py-6 text-center text-xs text-text-secondary"
        style={{ background: 'rgb(var(--color-bg-card) / 0.55)', minHeight: 180 }}
      >
        에피소드를 선택해주세요.
      </div>
    );
  }

  return (
    <div
      className="bf-wipe-in rounded-lg mt-3 border border-bg-border/45 overflow-hidden"
      style={{ background: 'rgb(var(--color-bg-card) / 0.45)' }}
    >
      {/* 한솔 정정: 가로 스크롤 X. 모든 파트 박스가 컨테이너 안에 fit 되어야 함.
          partFractions (0~1 비율) 로 width % 적용 → 전체 100%. */}
      {/* 룰러 */}
      <div
        className="relative h-7 text-[10px] text-text-secondary border-b border-bg-border/45"
        style={{ background: 'rgb(var(--color-bg-primary) / 0.55)' }}
      >
        {(() => {
          const totalScenes = partGroups.reduce((n, g) => n + g.scenes.length, 0);
          const ticks = 8;
          return Array.from({ length: ticks + 1 }).map((_, i) => {
            const frac = i / ticks;
            const idx = Math.max(1, Math.round(frac * totalScenes) + (i === 0 ? 1 : 0));
            return (
              <div key={i} className="absolute top-0 bottom-0" style={{ left: `${frac * 100}%` }}>
                <div className="absolute left-0 bottom-0 w-px h-1.5 bg-text-secondary/60" />
                <span
                  className="absolute font-semibold tabular-nums"
                  style={{ top: 4, left: i === ticks ? 'auto' : 4, right: i === ticks ? 4 : 'auto' }}
                >
                  씬 {Math.min(totalScenes, idx)}
                </span>
              </div>
            );
          });
        })()}
      </div>

      {/* 상단 라인 — 완료 계열 (done + aggregated) + 오류 (한솔 정의 2026-05-22: "완료는 취합 완료를 포함"). */}
      <div
        className="relative border-b border-bg-border/45"
        style={{ height: 14, background: 'rgb(var(--color-bg-primary) / 0.9)' }}
        aria-label="완료/오류"
      >
        <div
          className="absolute inset-0"
          style={{ background: 'repeating-linear-gradient(90deg, color-mix(in srgb, var(--status-done) 12%, transparent) 0 4px, transparent 4px 8px)' }}
        />
        {[...sceneRanges.entries()].map(([id, r]) => {
          if (r.status !== 'error' && !isCompletedStatus(r.status)) return null;
          const tokenVar = COMPOSITING_STATUS_TOKEN[r.status];
          return (
            <div
              key={`top-${id}`}
              className="absolute"
              style={{
                left: `${r.startFrac * 100}%`,
                width: `${Math.max(0.05, (r.endFrac - r.startFrac) * 100)}%`,
                top: 1, bottom: 1,
                background: `var(${tokenVar})`,
                boxShadow: `0 0 3px color-mix(in srgb, var(${tokenVar}) 50%, transparent)`,
              }}
            />
          );
        })}
      </div>

      {/* 하단 라인 — 작업 진행 단계 (취합중/취합완료/보정중/오류) 각 씬 위치에 status 색 */}
      <div
        className="relative border-b border-bg-border/45"
        style={{ height: 14, background: 'rgb(var(--color-bg-primary) / 0.6)' }}
        aria-label="작업 진행 단계"
      >
        {[...sceneRanges.entries()].map(([id, r]) => {
          // combine / aggregated / adjust / error 만 표시 (batch/done 제외)
          if (r.status !== 'combine' && r.status !== 'aggregated' && r.status !== 'adjust' && r.status !== 'error') return null;
          const tokenVar = COMPOSITING_STATUS_TOKEN[r.status];
          return (
            <div
              key={`bot-${id}`}
              className="absolute"
              style={{
                left: `${r.startFrac * 100}%`,
                width: `${Math.max(0.05, (r.endFrac - r.startFrac) * 100)}%`,
                top: 1, bottom: 1,
                background: `linear-gradient(180deg, color-mix(in srgb, var(${tokenVar}) 95%, transparent), color-mix(in srgb, var(${tokenVar}) 70%, transparent))`,
              }}
            />
          );
        })}
      </div>

      {/* 파트 박스 — % 기반 width, 컨테이너 안에 fit. split-pane: 핸들 = 파트 N과 N+1 사이 경계 */}
      <Reorder.Group
        ref={trackContainerRef}
        axis="x"
        values={partIds}
        onReorder={handleReorder}
        className="list-none m-0 p-0 flex w-full"
      >
        {partGroups.map((g, i) => {
          const info = partInfo.get(g.partId);
          const frac = partFractions.get(g.partId) ?? 0;
          const lower = g.partId.toLowerCase();
          const color = `var(--part-${lower})`;
          const focused = hoveredPart === g.partId;
          const isLast = i >= partGroups.length - 1;
          // 한솔 정정 (2026-05-21): 파트 박스 안 status 표시도 씬 번호 위치 기반.
          // 씬 i = i/N ~ (i+1)/N 위치, 그 칸 색 = 그 씬 status.
          const sceneStatuses = g.scenes.map((sc) => epStates.get(`${sc.episodeNumber}:${sc.sceneId}`)?.status ?? 'batch' as CompositingStatus);
          return (
            <PartBox
              key={g.partId}
              partId={g.partId}
              widthPct={frac * 100}
              height={PART_BOX_H}
              color={color}
              info={info}
              memo={g.memo ?? ''}
              totalScenes={g.scenes.length}
              sceneStatuses={sceneStatuses}
              focused={focused}
              onHoverEnter={() => setHoveredPart(g.partId)}
              onHoverLeave={() => setHoveredPart(null)}
              isCompositor={isCompositor}
              isLast={isLast}
              onResizeDown={onResizeDown(g.partId, i)}
            />
          );
        })}
      </Reorder.Group>
    </div>
  );
}

// ─── 파트 박스 — Reorder.Item (% 기반 width) ───
interface PartBoxProps {
  partId: string;
  widthPct: number;
  height: number;
  color: string;
  info: { counts: Record<CompositingStatus, number>; doneCount: number; totalCount: number; donePct: number } | undefined;
  memo: string;
  totalScenes: number;
  /** 씬 번호 순 status 배열 — 박스 안 가로 stacked 의 각 칸 색에 사용 */
  sceneStatuses: CompositingStatus[];
  focused: boolean;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  isCompositor: boolean;
  /** 마지막 파트 — 우측 인접 파트가 없어 split-pane 핸들 노출 X */
  isLast: boolean;
  onResizeDown: (e: React.MouseEvent) => void;
}

function PartBox({
  partId, widthPct, height, color, info, memo, totalScenes, sceneStatuses,
  focused, onHoverEnter, onHoverLeave, isCompositor, isLast, onResizeDown,
}: PartBoxProps) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={partId}
      dragListener={false}
      dragControls={dragControls}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      className="part-row relative cascade-in"
      data-part-id={partId}
      style={{
        width: `${widthPct}%`,
        minWidth: 60,
        height,
        background: `linear-gradient(180deg, color-mix(in srgb, ${color} 16%, transparent), color-mix(in srgb, ${color} 4%, transparent))`,
        borderLeft: `4px solid ${color}`,
        borderRight: '1px solid rgb(var(--color-bg-border) / 0.5)',
        borderTop: focused ? `1px solid ${color}` : '1px solid rgb(var(--color-bg-border) / 0.4)',
        borderBottom: '1px solid rgb(var(--color-bg-border) / 0.4)',
        boxShadow: focused ? `0 4px 14px color-mix(in srgb, ${color} 28%, transparent)` : 'none',
        listStyle: 'none',
        flexShrink: 1,
        flexGrow: 0,
      }}
    >
      <div style={{ padding: '6px 12px' }}>
        <div className="flex items-center gap-2">
          {/* drag 핸들 (Reorder) */}
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); dragControls.start(e); }}
            className="shrink-0 flex items-center justify-center rounded cursor-grab active:cursor-grabbing"
            style={{
              width: 16, height: 20,
              background: focused ? `color-mix(in srgb, ${color} 28%, transparent)` : 'transparent',
              color: focused ? '#fff' : 'var(--text-secondary)',
            }}
            title="좌우로 드래그하여 파트 순서 변경"
          >
            <GripVertical size={12} strokeWidth={2.5} />
          </button>
          <PartBadge partId={partId as 'A' | 'B' | 'C' | 'D'} size="sm" />
          <span className="text-[13px] font-extrabold" style={{ color }}>{partId}파트</span>
          <span className="ml-auto text-[10px] text-text-secondary font-mono tabular-nums shrink-0">
            {totalScenes}컷
          </span>
        </div>

        {/* 한솔 정정 (2026-05-22): 파트 박스 안 status 그래프 제거. 진행률 % 숫자만 유지 (아래 progress bar). */}

        {/* 진행률 + 메모 */}
        <div className="flex items-center gap-1.5 mt-2 text-[10px] font-mono">
          <div className="flex-1 h-1 rounded-full bg-bg-border/45 overflow-hidden">
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${info?.donePct ?? 0}%`,
                background: `linear-gradient(90deg, ${color}, var(--status-done))`,
              }}
            />
          </div>
          <span className="font-bold tabular-nums shrink-0" style={{ color: (info?.donePct ?? 0) >= 100 ? 'var(--status-done)' : color }}>
            {Math.round(info?.donePct ?? 0)}%
          </span>
        </div>
        {memo && (
          <div
            className="mt-1.5 text-[10px] text-text-secondary truncate flex items-center gap-1"
            title={memo}
          >
            <FileText size={9} strokeWidth={2} className="shrink-0 text-text-secondary/70" />
            <span className="truncate">{memo}</span>
          </div>
        )}
      </div>

      {/* hover-only split-pane 리사이즈 핸들 (우측 edge = 다음 파트와 경계) */}
      {/* 마지막 파트는 우측 인접 파트가 없으므로 핸들 숨김 */}
      {isCompositor && !isLast && (
        <div
          onMouseDown={onResizeDown}
          title="좌우로 드래그하여 이 파트와 다음 파트 사이 경계 조정"
          className="resize-handle"
          style={{
            position: 'absolute', right: -6, top: '50%', transform: 'translateY(-50%)',
            width: 14, height: 42,
            background: 'rgb(15 17 23 / 0.85)',
            border: `1.5px solid ${color}`,
            borderRadius: 6,
            cursor: 'ew-resize',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 5,
            boxShadow: '0 2px 6px rgb(0 0 0 / 0.45)',
            opacity: focused ? 1 : 0,
            transition: 'opacity 150ms ease',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, pointerEvents: 'none' }}>
            <span style={{ width: 3, height: 3, borderRadius: 999, background: color }} />
            <span style={{ width: 3, height: 3, borderRadius: 999, background: color }} />
            <span style={{ width: 3, height: 3, borderRadius: 999, background: color }} />
          </div>
        </div>
      )}
    </Reorder.Item>
  );
}
