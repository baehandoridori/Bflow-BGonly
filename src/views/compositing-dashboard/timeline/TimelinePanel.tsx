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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, FileText } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { CompositingState, CompositingStatus } from '@/types';
import { COMPOSITING_STATUS_LABEL, COMPOSITING_STATUS_ORDER, COMPOSITING_STATUS_TOKEN, isCompletedStatus, partCssColor } from '@/utils/compositingLabels';
import { getTimelineCarouselSelection } from '@/utils/compositingTimelineCarousel';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { useDataStore, compositingKey } from '@/stores/useDataStore';
import { PartBadge } from '@/components/compositing-dashboard/common/PartBadge';

const PART_BOX_H = 96;
const CAROUSEL_CARD_WIDTH = 112;
const CAROUSEL_SIDE_CARD_WIDTH = 92;
const CAROUSEL_SLOT_GAP = 78;

interface TimelineProbe {
  partId: string;
  pointerRatio: number;
  partLeft: number;
  partWidth: number;
  partTop: number;
  partHeight: number;
}

type TimelineProbeGeometry = Omit<TimelineProbe, 'partId'>;

function buildTimelineProbeGeometry(clientX: number, rect: DOMRect): TimelineProbeGeometry {
  return {
    pointerRatio: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    partLeft: rect.left,
    partWidth: rect.width,
    partTop: rect.top,
    partHeight: rect.height,
  };
}

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
  const setPinnedScene = useCompositingDashboardStore((s) => s.setPinnedScene);
  const setDetailScene = useCompositingDashboardStore((s) => s.setDetailScene);
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const getEpisodeDisplayName = useDataStore((s) => s.getEpisodeDisplayName);
  const partIds = useMemo(() => partGroups.map((g) => g.partId), [partGroups]);
  const episodeLabelByNumber = useMemo(() => {
    const labels = new Map<number, string>();
    for (const episode of episodes) {
      labels.set(episode.episodeNumber, getEpisodeDisplayName(episode));
    }
    return labels;
  }, [episodes, getEpisodeDisplayName, episodeTitles]);

  // 코덱스 4차 P1 (2026-05-22): framer-motion Reorder 제거.
  //   - 이 컴포넌트는 부모(CompositingDashboardView) 의 `overflow-y-auto` 컨테이너 안에서 렌더링됨.
  //   - framer-motion docs: Reorder 는 스크롤 컨테이너 내부에서 측정값이 흔들려 동작이 불안정 (unsupported).
  //   - 해결: native HTML5 drag-drop 으로 교체 (스크롤 컨테이너 안에서 안정적, edge auto-scroll 도 브라우저 기본).
  //   - 인터페이스(onReorder?(partIds)) 는 그대로 유지 — CompositingDashboardView 변경 X.
  const [draggingPartId, setDraggingPartId] = useState<string | null>(null);
  const [dragOverPartId, setDragOverPartId] = useState<string | null>(null);
  const [timelineProbe, setTimelineProbe] = useState<TimelineProbe | null>(null);
  const timelineProbeRef = useRef<TimelineProbe | null>(null);
  const pendingHoverPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const lastHoverKeyRef = useRef<string | null>(null);
  const actionClearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    timelineProbeRef.current = timelineProbe;
  }, [timelineProbe]);

  const handleDragStart = (partId: string) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', partId);
    setDraggingPartId(partId);
  };
  const handleDragOver = (partId: string) => (e: React.DragEvent) => {
    if (draggingPartId && draggingPartId !== partId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverPartId !== partId) setDragOverPartId(partId);
    }
  };
  const handleDrop = (targetPartId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const source = draggingPartId;
    setDraggingPartId(null);
    setDragOverPartId(null);
    if (!source || source === targetPartId) return;
    const next = [...partIds];
    const from = next.indexOf(source);
    const to = next.indexOf(targetPartId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    // 코덱스 8차 P1: splice(from, 1) 으로 source 제거 후 인덱스가 시프트 → to 가 from 보다 컸으면 -1 조정.
    //   예: [A,B,C,D] 에서 A 를 C 위치에 drop → from=0, to=2. splice 후 [B,C,D] 에서 C 는 index 1.
    //   조정 없이 splice(2, 0, A) 하면 [B,C,A,D] 가 되어 의도(C 앞에 A) 와 어긋남.
    const adjustedTo = from < to ? to - 1 : to;
    next.splice(adjustedTo, 0, source);
    onReorder?.(next);
  };
  const handleDragEnd = () => {
    setDraggingPartId(null);
    setDragOverPartId(null);
  };

  // 한솔 정정 (2026-05-21): split-pane 패턴.
  //   - 각 파트는 절대 fraction 보관 (0~1, 총합 = 1).
  //   - 핸들 = 그 파트와 다음 파트 사이 경계. 드래그 시 두 파트의 fraction 만 변경 (합 고정).
  //   - 다른 파트는 가만 → "내가 잡고 끄는 부분만 변형" 직관 충족.
  //   - 컨테이너에 fit (가로 스크롤 X).
  //   - rAF throttle 로 렉 fix.
  // 코덱스 2차 P2 (2026-05-22): EP 변경 시 overrideFractions reset — 이전 EP 에서 조정한 비율이
  //   다음 EP partId 가 같으면 stale 상태로 유지되던 문제.
  const [overrideFractions, setOverrideFractions] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    setOverrideFractions(null);
  }, [episodeNumber]);

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
  const timelineRootRef = useRef<HTMLDivElement>(null);
  const trackContainerRef = useRef<HTMLDivElement>(null);
  const clearProbeTimerRef = useRef<number | null>(null);

  const cancelProbeClear = useCallback(() => {
    if (clearProbeTimerRef.current !== null) {
      window.clearTimeout(clearProbeTimerRef.current);
      clearProbeTimerRef.current = null;
    }
  }, []);

  const scheduleProbeClear = useCallback(() => {
    cancelProbeClear();
    clearProbeTimerRef.current = window.setTimeout(() => {
      lastHoverKeyRef.current = null;
      timelineProbeRef.current = null;
      setHoveredPart(null);
      setTimelineProbe(null);
      clearProbeTimerRef.current = null;
    }, 320);
  }, [cancelProbeClear, setHoveredPart]);

  const clearProbeNow = useCallback(() => {
    cancelProbeClear();
    if (actionClearTimerRef.current !== null) {
      window.clearTimeout(actionClearTimerRef.current);
      actionClearTimerRef.current = null;
    }
    lastHoverKeyRef.current = null;
    timelineProbeRef.current = null;
    setHoveredPart(null);
    setTimelineProbe(null);
  }, [cancelProbeClear, setHoveredPart]);

  const scheduleProbeClearAfterAction = useCallback(() => {
    if (actionClearTimerRef.current !== null) {
      window.clearTimeout(actionClearTimerRef.current);
    }
    actionClearTimerRef.current = window.setTimeout(() => {
      actionClearTimerRef.current = null;
      clearProbeNow();
    }, 360);
  }, [clearProbeNow]);

  useEffect(() => () => {
    if (clearProbeTimerRef.current !== null) window.clearTimeout(clearProbeTimerRef.current);
    if (actionClearTimerRef.current !== null) window.clearTimeout(actionClearTimerRef.current);
    if (hoverFrameRef.current !== null) window.cancelAnimationFrame(hoverFrameRef.current);
  }, []);

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
        const st = epStates.get(compositingKey(sc.episodeNumber, sc.sceneId));
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
        const st = epStates.get(compositingKey(sc.episodeNumber, sc.sceneId));
        out.set(sc.sceneId, {
          startFrac: partStart + i * slice,
          endFrac: partStart + (i + 1) * slice,
          status: st?.status ?? 'batch',
        });
      });
    }
    return out;
  }, [partGroups, partStarts, partFractions, epStates]);

  const carousel = useMemo(() => {
    if (!timelineProbe) return null;
    const group = partGroups.find((g) => g.partId === timelineProbe.partId);
    if (!group || group.scenes.length === 0) return null;

    const selection = getTimelineCarouselSelection(group.scenes.length, timelineProbe.pointerRatio);
    if (selection.selectedIndex < 0) return null;

    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
    const rawAnchorX = timelineProbe.partLeft + (timelineProbe.partWidth * selection.pointerRatio);
    const safeAnchorX = Math.max(92, Math.min(viewportWidth - 92, rawAnchorX));
    const preferredTop = timelineProbe.partTop - 126;
    const fallbackTop = timelineProbe.partTop + timelineProbe.partHeight + 10;
    const top = preferredTop > 72
      ? preferredTop
      : Math.min(viewportHeight - 150, Math.max(72, fallbackTop));

    return { group, selection, anchorX: safeAnchorX, top };
  }, [partGroups, timelineProbe]);

  const handleProbeMove = useCallback((
    partId: string,
    payload: TimelineProbeGeometry,
  ) => {
    const previous = timelineProbeRef.current;
    if (
      previous?.partId === partId &&
      Math.abs(previous.pointerRatio - payload.pointerRatio) < 0.006 &&
      Math.abs(previous.partLeft - payload.partLeft) < 0.5 &&
      Math.abs(previous.partTop - payload.partTop) < 0.5
    ) {
      return;
    }

    cancelProbeClear();
    const nextProbe = { partId, ...payload };
    timelineProbeRef.current = nextProbe;
    setHoveredPart(partId);
    setTimelineProbe(nextProbe);
  }, [cancelProbeClear, setHoveredPart]);

  const handleCarouselCardHover = useCallback((partId: string, sceneIndex: number) => {
    cancelProbeClear();
    const group = partGroups.find((g) => g.partId === partId);
    if (!group || group.scenes.length === 0) return;

    const pointerRatio = group.scenes.length <= 1 ? 0 : sceneIndex / (group.scenes.length - 1);
    const currentProbe = timelineProbeRef.current;
    const previous = currentProbe?.partId === partId ? currentProbe : null;
    const progressBar = trackContainerRef.current
      ?.querySelector<HTMLElement>(`[data-part-id="${partId}"] [data-compositing-part-progress-bar="true"]`);
    const rect = progressBar?.getBoundingClientRect();
    if (!previous && !rect) return;

    const nextProbe = {
      partId,
      pointerRatio,
      partLeft: previous?.partLeft ?? rect!.left,
      partWidth: previous?.partWidth ?? rect!.width,
      partTop: previous?.partTop ?? rect!.top,
      partHeight: previous?.partHeight ?? rect!.height,
    };
    if (
      currentProbe?.partId === nextProbe.partId &&
      Math.abs(currentProbe.pointerRatio - nextProbe.pointerRatio) < 0.0001 &&
      Math.abs(currentProbe.partLeft - nextProbe.partLeft) < 0.5 &&
      Math.abs(currentProbe.partTop - nextProbe.partTop) < 0.5
    ) {
      return;
    }

    timelineProbeRef.current = nextProbe;
    setHoveredPart(partId);
    setTimelineProbe(nextProbe);
  }, [cancelProbeClear, partGroups, setHoveredPart]);

  const flushDocumentHoverPointerMove = useCallback(() => {
    hoverFrameRef.current = null;
    const pointer = pendingHoverPointerRef.current;
    if (!pointer) return;

    const { clientX, clientY } = pointer;
    const cards = document.querySelectorAll<HTMLElement>('[data-compositing-carousel-card="true"]');
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const insideCard =
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;

      if (!insideCard) continue;
      const partId = card.dataset.compositingCarouselPartId;
      const sceneIndex = Number(card.dataset.compositingCarouselSceneIndex);
      if (!partId || !Number.isInteger(sceneIndex)) return;

      const hoverKey = `card:${partId}:${sceneIndex}`;
      if (lastHoverKeyRef.current === hoverKey) return;
      lastHoverKeyRef.current = hoverKey;
      handleCarouselCardHover(partId, sceneIndex);
      return;
    }

    const track = trackContainerRef.current;
    if (!track) return;

    const progressBars = track.querySelectorAll<HTMLElement>('[data-compositing-part-progress-bar="true"]');
    for (const progressBar of progressBars) {
      const rect = progressBar.getBoundingClientRect();
      const insideBar =
        rect.width > 0 &&
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;

      if (!insideBar) continue;
      const partId = progressBar.closest<HTMLElement>('[data-part-id]')?.dataset.partId;
      if (!partId) return;

      const payload = buildTimelineProbeGeometry(clientX, rect);
      const hoverKey = `bar:${partId}:${Math.round(payload.pointerRatio * 160)}`;
      if (lastHoverKeyRef.current === hoverKey) return;
      lastHoverKeyRef.current = hoverKey;
      handleProbeMove(partId, payload);
      return;
    }

    lastHoverKeyRef.current = null;
  }, [handleCarouselCardHover, handleProbeMove]);

  useEffect(() => {
    const handleDocumentHoverPointerMove = (event: PointerEvent) => {
      pendingHoverPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      if (hoverFrameRef.current !== null) return;
      hoverFrameRef.current = window.requestAnimationFrame(flushDocumentHoverPointerMove);
    };

    window.addEventListener('pointermove', handleDocumentHoverPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handleDocumentHoverPointerMove);
      if (hoverFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverFrameRef.current);
        hoverFrameRef.current = null;
      }
    };
  }, [flushDocumentHoverPointerMove]);

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
      ref={timelineRootRef}
      className="bf-wipe-in rounded-lg mt-3 border border-bg-border/45 overflow-visible relative"
      style={{ background: 'rgb(var(--color-bg-card) / 0.45)' }}
      onMouseEnter={cancelProbeClear}
      onMouseLeave={scheduleProbeClear}
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
      {/* 코덱스 4차 P1: Reorder.Group 제거, native HTML5 drag-drop 으로 대체 (scroll 컨테이너 안전). */}
      <div
        ref={trackContainerRef}
        className="list-none m-0 p-0 flex w-full"
      >
        {partGroups.map((g, i) => {
          const info = partInfo.get(g.partId);
          const frac = partFractions.get(g.partId) ?? 0;
          // 코덱스 6차 P3: partCssColor 헬퍼 사용 — A~G 외 partId (H 이상) 에서 빈 CSS var 로 떨어지지 않게 액센트 폴백.
          const color = partCssColor(g.partId);
          const focused = hoveredPart === g.partId;
          const isLast = i >= partGroups.length - 1;
          // 한솔 정정 (2026-05-21): 파트 박스 안 status 표시도 씬 번호 위치 기반.
          // 씬 i = i/N ~ (i+1)/N 위치, 그 칸 색 = 그 씬 status.
          const sceneStatuses = g.scenes.map((sc) => epStates.get(compositingKey(sc.episodeNumber, sc.sceneId))?.status ?? 'batch' as CompositingStatus);
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
              onProbeMove={handleProbeMove}
              isCompositor={isCompositor}
              isLast={isLast}
              onResizeDown={onResizeDown(g.partId, i)}
              isDragging={draggingPartId === g.partId}
              isDropTarget={dragOverPartId === g.partId && draggingPartId !== g.partId}
              onDragStart={handleDragStart(g.partId)}
              onDragOver={handleDragOver(g.partId)}
              onDrop={handleDrop(g.partId)}
              onDragEnd={handleDragEnd}
            />
          );
        })}
      </div>

      {carousel && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed left-0 pointer-events-none"
          style={{ top: carousel.top, width: '100vw', height: 150, zIndex: 90 }}
          aria-hidden={false}
        >
          {carousel.selection.visibleIndices.map((sceneIndex) => {
            const scene = carousel.group.scenes[sceneIndex];
            const sceneKey = compositingKey(scene.episodeNumber, scene.sceneId);
            const status = epStates.get(sceneKey)?.status ?? 'batch';
            const tokenVar = COMPOSITING_STATUS_TOKEN[status];
            const episodeLabel = episodeLabelByNumber.get(scene.episodeNumber)
              ?? `EP.${String(scene.episodeNumber).padStart(2, '0')}`;
            const offset = sceneIndex - carousel.selection.floatingIndex;
            const distance = Math.abs(offset);
            const centerAmount = Math.max(0, 1 - Math.min(distance, 1));
            const visibleAmount = Math.max(0, 1 - Math.min(distance, 2.25) / 2.25);
            const isCenter = sceneIndex === carousel.selection.selectedIndex;
            const width = CAROUSEL_SIDE_CARD_WIDTH + ((CAROUSEL_CARD_WIDTH - CAROUSEL_SIDE_CARD_WIDTH) * centerAmount);
            const x = carousel.anchorX + (offset * CAROUSEL_SLOT_GAP) - (width / 2);
            const y = 18 - (18 * centerAmount) + Math.min(distance, 2) * 3;
            const scale = 0.82 + (0.18 * centerAmount);
            const height = 98 + (22 * centerAmount);
            const opacity = 0.12 + (0.88 * visibleAmount);

            return (
              <button
                key={`${scene.partId}-${scene.sceneId}`}
                data-compositing-carousel-card="true"
                data-compositing-carousel-part-id={carousel.group.partId}
                data-compositing-carousel-scene-index={sceneIndex}
                type="button"
                onPointerEnter={() => handleCarouselCardHover(carousel.group.partId, sceneIndex)}
                onMouseEnter={() => handleCarouselCardHover(carousel.group.partId, sceneIndex)}
                onMouseLeave={scheduleProbeClear}
                onClick={() => {
                  setPinnedScene(sceneKey);
                  scheduleProbeClearAfterAction();
                }}
                onDoubleClick={() => {
                  clearProbeNow();
                  setDetailScene(sceneKey);
                }}
                aria-label={`${scene.sceneId} 핀, 더블클릭으로 상세 열기`}
                className={cn(
                  'absolute rounded-xl border text-left overflow-hidden backdrop-blur-md',
                  'transition-[transform,width,height,opacity,filter,background,border-color,box-shadow] duration-150 ease-out cursor-pointer',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
                )}
                style={{
                  pointerEvents: 'auto',
                  width,
                  height,
                  transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`,
                  transformOrigin: 'center top',
                  opacity,
                  filter: isCenter ? 'saturate(1) brightness(1)' : `saturate(${0.72 + centerAmount * 0.18}) brightness(${0.82 + centerAmount * 0.12})`,
                  borderColor: isCenter
                    ? `color-mix(in srgb, var(${tokenVar}) 62%, rgb(var(--color-bg-border)))`
                    : 'rgb(var(--color-bg-border) / 0.42)',
                  background: isCenter
                    ? `linear-gradient(145deg, color-mix(in srgb, var(${tokenVar}) 14%, rgb(var(--color-bg-card))), rgb(var(--color-bg-card) / 0.94))`
                    : 'rgb(var(--color-bg-card) / 0.74)',
                  boxShadow: isCenter
                    ? `0 14px 28px rgb(0 0 0 / 0.32), 0 0 16px color-mix(in srgb, var(${tokenVar}) 18%, transparent)`
                    : '0 8px 18px rgb(0 0 0 / 0.22)',
                }}
              >
                <div
                  className="absolute left-0 right-0 top-0 h-0.5"
                  style={{ background: `linear-gradient(90deg, transparent, var(${tokenVar}), transparent)` }}
                />
                <div className="relative h-[44px] border-b border-bg-border/35 overflow-hidden">
                  <div
                    className="absolute inset-0 opacity-42"
                    style={{
                      background:
                        'linear-gradient(90deg, rgb(var(--color-bg-primary) / 0.72) 0 48%, rgb(var(--color-bg-border) / 0.48) 48% 49%, rgb(var(--color-bg-primary) / 0.32) 49%)',
                    }}
                  />
                  <span className="absolute left-3 top-2.5 text-[12px] font-black text-text-primary tracking-normal">
                    {scene.sceneId}
                  </span>
                  <span
                    className="absolute right-3 top-3 w-2.5 h-2.5 rounded-full"
                    style={{
                      background: `var(${tokenVar})`,
                      boxShadow: `0 0 10px color-mix(in srgb, var(${tokenVar}) 76%, transparent)`,
                    }}
                  />
                </div>
                <div className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[9px] font-bold text-text-secondary" title={`${episodeLabel} · ${scene.partId}`}>
                      {episodeLabel} · {scene.partId}
                    </span>
                    <span className="text-[9px] font-extrabold" style={{ color: `var(${tokenVar})` }}>
                      {COMPOSITING_STATUS_LABEL[status]}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[9px] text-text-secondary/70">
                    <span>위치</span>
                    <span className="font-mono font-bold text-text-primary/85">
                      {sceneIndex + 1} / {carousel.group.scenes.length}
                    </span>
                  </div>
                  {isCenter && (
                    <div className="mt-1 text-[9px] font-semibold text-accent/90 truncate">
                      클릭 핀 · 더블클릭 상세
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── 파트 박스 — % 기반 width, native HTML5 drag-drop ───
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
  onProbeMove: (partId: string, payload: TimelineProbeGeometry) => void;
  isCompositor: boolean;
  /** 마지막 파트 — 우측 인접 파트가 없어 split-pane 핸들 노출 X */
  isLast: boolean;
  onResizeDown: (e: React.MouseEvent) => void;
  /** 코덱스 4차 P1: native HTML5 drag-drop 으로 교체. */
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

function PartBox({
  partId, widthPct, height, color, info, memo, totalScenes, sceneStatuses,
  focused, onHoverEnter, onHoverLeave, isCompositor, isLast, onResizeDown,
  onProbeMove, isDragging, isDropTarget, onDragStart, onDragOver, onDrop, onDragEnd,
}: PartBoxProps) {
  const handleProbeMove = (e: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    onProbeMove(partId, buildTimelineProbeGeometry(e.clientX, rect));
  };

  return (
    <div
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="part-row relative cascade-in"
      data-part-id={partId}
      style={{
        width: `${widthPct}%`,
        minWidth: 60,
        height,
        background: `linear-gradient(180deg, color-mix(in srgb, ${color} 16%, transparent), color-mix(in srgb, ${color} 4%, transparent))`,
        borderLeft: isDropTarget ? `4px dashed ${color}` : `4px solid ${color}`,
        borderRight: '1px solid rgb(var(--color-bg-border) / 0.5)',
        borderTop: focused ? `1px solid ${color}` : '1px solid rgb(var(--color-bg-border) / 0.4)',
        borderBottom: '1px solid rgb(var(--color-bg-border) / 0.4)',
        boxShadow: isDropTarget
          ? `0 0 0 2px color-mix(in srgb, ${color} 55%, transparent) inset, 0 4px 14px color-mix(in srgb, ${color} 35%, transparent)`
          : (focused ? `0 4px 14px color-mix(in srgb, ${color} 28%, transparent)` : 'none'),
        opacity: isDragging ? 0.45 : 1,
        transition: 'opacity 120ms ease, box-shadow 120ms ease',
        listStyle: 'none',
        flexShrink: 1,
        flexGrow: 0,
      }}
    >
      <div style={{ padding: '6px 12px' }}>
        <div className="flex items-center gap-2">
          {/* drag 핸들 — native HTML5 draggable. div 로 사용 (button 은 일부 브라우저에서 drag source 동작 불안정). */}
          <div
            role="button"
            tabIndex={-1}
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className="shrink-0 flex items-center justify-center rounded cursor-grab active:cursor-grabbing select-none"
            style={{
              width: 16, height: 20,
              background: focused ? `color-mix(in srgb, ${color} 28%, transparent)` : 'transparent',
              color: focused ? '#fff' : 'var(--text-secondary)',
            }}
            title="좌우로 드래그하여 파트 순서 변경"
          >
            <GripVertical size={12} strokeWidth={2.5} />
          </div>
          <PartBadge partId={partId as 'A' | 'B' | 'C' | 'D'} size="sm" />
          <span className="text-[13px] font-extrabold" style={{ color }}>{partId}파트</span>
          <span className="ml-auto text-[10px] text-text-secondary font-mono tabular-nums shrink-0">
            {totalScenes}컷
          </span>
        </div>

        {/* 한솔 정정 (2026-05-22): 파트 박스 안 status 그래프 제거. 진행률 % 숫자만 유지 (아래 progress bar). */}

        {/* 진행률 + 메모 */}
        <div className="flex items-center gap-1.5 mt-2 text-[10px] font-mono">
          <div
            data-compositing-part-progress-bar="true"
            className="flex-1 h-2 rounded-full bg-bg-border/45 overflow-hidden cursor-ew-resize"
            title={`${partId}파트 진행률 기준으로 씬 카드 미리보기`}
            onPointerEnter={(e) => {
              onHoverEnter();
              handleProbeMove(e);
            }}
            onPointerMove={handleProbeMove}
            onMouseEnter={(e) => {
              onHoverEnter();
              handleProbeMove(e);
            }}
            onMouseMove={handleProbeMove}
          >
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
    </div>
  );
}
