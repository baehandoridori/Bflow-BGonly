/**
 * 한 파트 (A/B/C/D) 의 카드 반응형 그리드 + 호버 dock-lift.
 *
 * 동작:
 * - PartHeader 클릭 = 접기/펼치기 토글 (`expandedParts` set).
 * - 그리드는 `flex-wrap` 으로 가로폭에 따라 자동 줄바꿈 — 가로 스크롤 X.
 * - 호버 dock-lift 는 마우스 (X, Y) 와 카드 중심 거리 (2D) 로 계산해 한 줄 안 인접 카드만 영향.
 *   여러 줄로 wrap 됐을 때 위/아래 줄 카드가 같이 들썩이는 누수 방지.
 * - 거리는 들리지 않는 원래 자리 칸([data-scene-key])으로 잰다 — 들린 카드로 재면 떨린다(dockLift.ts).
 *
 * spec: 2026-05-21-compositing-dashboard-design.md (8.1~8.5, 13.2)
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CompositingState } from '@/types';
import { isCompletedStatus } from '@/utils/compositingLabels';
import { prefersReducedMotion } from '@/utils/motion';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { compositingKey } from '@/stores/useDataStore';
import type { CardScene } from '../cardSceneHelpers';
import { PartHeader } from './PartHeader';
import { SceneCard } from './SceneCard';
import { dockTransform } from './dockLift';

interface PartCardRowProps {
  partId: string;
  scenes: CardScene[];
  epStates: Map<string, CompositingState>;
}

export function PartCardRow({ partId, scenes, epStates }: PartCardRowProps) {
  const expandedParts = useCompositingDashboardStore((s) => s.expandedParts);
  const toggleExpand = useCompositingDashboardStore((s) => s.toggleExpand);
  const statusFilter = useCompositingDashboardStore((s) => s.statusFilter);
  const soloScene = useCompositingDashboardStore((s) => s.soloScene);
  const mutedScenes = useCompositingDashboardStore((s) => s.mutedScenes);

  const rowRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [contentHeight, setContentHeight] = useState(0);

  // 사용자가 한 번이라도 토글한 파트는 set 에 들어있고, 그 안에 있으면 펼침.
  // (set 초기화는 CompositingDashboardView 가 마운트 시 모든 partId 를 add — 기본 펼침.)
  const expanded = expandedParts.has(partId);
  const [rendered, setRendered] = useState(expanded);

  useEffect(() => {
    if (expanded) {
      setRendered(true);
      return;
    }
    const t = window.setTimeout(() => setRendered(false), 280);
    return () => window.clearTimeout(t);
  }, [expanded]);

  useLayoutEffect(() => {
    if (!rendered) {
      setContentHeight(0);
      return;
    }

    const row = rowRef.current;
    if (!row) return;

    const updateHeight = () => {
      setContentHeight(row.scrollHeight);
    };

    updateHeight();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeight) : null;
    resizeObserver?.observe(row);
    window.addEventListener('resize', updateHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, [rendered, scenes.length, mutedScenes]);

  // 완료 씬 카운트 — 한솔 정의 (2026-05-22): "완료 = done + aggregated".
  let doneCount = 0;
  for (const sc of scenes) {
    const st = epStates.get(compositingKey(sc.episodeNumber, sc.sceneId));
    if (isCompletedStatus(st?.status)) doneCount += 1;
  }

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (rafRef.current !== null) return;
    // 동작 줄이기: 카드가 커서를 따라 들썩이지 않게 dock-lift 자체를 쓰지 않는다.
    if (prefersReducedMotion()) return;
    const x = e.clientX;
    const y = e.clientY;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const row = rowRef.current;
      if (!row) return;
      const cards = row.querySelectorAll<HTMLElement>('.scene-card');
      cards.forEach((card) => {
        if (card.classList.contains('pinned')) return; // pinned 카드는 별도 transform
        // 판정은 들리지 않는 원래 자리 칸으로 — 들린 카드 자신을 재면 오를수록 중심이 옮겨 가 떨린다.
        const slot = card.closest<HTMLElement>('[data-scene-key]') ?? card;
        card.style.transform = dockTransform(slot.getBoundingClientRect(), x, y);
      });
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const row = rowRef.current;
    if (!row) return;
    const cards = row.querySelectorAll<HTMLElement>('.scene-card');
    cards.forEach((card) => {
      if (card.classList.contains('pinned')) return;
      card.style.transform = '';
    });
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <PartHeader
        partId={partId}
        sceneCount={scenes.length}
        doneCount={doneCount}
        expanded={expanded}
        onToggle={() => toggleExpand(partId)}
      />

      {rendered && (
        <div
          aria-hidden={!expanded}
          style={{
            overflow: expanded ? 'visible' : 'hidden',
            maxHeight: expanded ? Math.max(320, contentHeight) : 0,
            opacity: expanded ? 1 : 0,
            transform: expanded ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'max-height 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease, transform 220ms ease',
          }}
        >
          <div
            ref={rowRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="flex flex-wrap gap-3 px-1"
            style={{
              // 상부 margin — dock-lift / pinned 시 카드가 위 컨테이너 / 위 줄에 잘리지 않도록.
              paddingTop: 34,
              paddingBottom: 16,
            }}
          >
            {scenes.map((sc, idx) => {
              const stateKey = compositingKey(sc.episodeNumber, sc.sceneId);
              const state = epStates.get(stateKey);
              const status = state?.status ?? 'batch';

              // 필터/솔로/뮤트 처리
              const matchesFilter = statusFilter === null || status === statusFilter;
              const isSoloed = soloScene === null || soloScene === sc.sceneId;
              const isMuted = mutedScenes.has(sc.sceneId);
              if (isMuted) return null;
              const dimmed = !matchesFilter || !isSoloed;

              return (
                <div
                  key={sc.sceneId}
                  className="shrink-0"
                  style={{ width: 180 }}
                  data-scene-key={`${sc.episodeNumber}:${sc.sceneId}`}
                >
                  <SceneCard
                    card={sc}
                    state={state}
                    staggerIndex={idx}
                    dimmed={dimmed}
                    partSceneIds={scenes.map((s) => s.sceneId)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
