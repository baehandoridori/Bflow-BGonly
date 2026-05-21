/**
 * 한 파트 (A/B/C/D) 의 카드 가로 그리드 + 호버 dock-lift.
 *
 * 마우스가 행 위에서 움직이면 가장 가까운 카드가 위로 떠오름 (LP/Dock magnification).
 * rAF throttle.
 *
 * spec: 2026-05-21-compositing-dashboard-design.md (8.1~8.5, 13.2)
 */

import { useCallback, useRef } from 'react';
import { cn } from '@/utils/cn';
import type { CompositingState } from '@/types';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import type { CardScene } from '../cardSceneHelpers';
import { PartHeader } from './PartHeader';
import { SceneCard } from './SceneCard';

const DOCK_MAX_DIST = 160; // px
const DOCK_LIFT = -14; // px
const DOCK_SCALE = 0.07; // scale = 1 + DOCK_SCALE * lift

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

  // 코덱스 1차 P2 fix: 이전엔 `|| true` 가 남아있어 항상 펼침 상태 → collapse 토글 무력화.
  // 디자인 결정 (한솔): 카드 그리드는 항상 펼침, 접힘은 다루지 않음 (Timeline 패널이 파트 단위 시각화를 대신 담당).
  // PartHeader 의 chevron 은 시각적 ornament 로만 유지. 향후 폴리시에서 토글 활성 여부 재검토.
  const effectiveExpanded = true;
  void expandedParts; // store 필드는 향후 폴리시 대비 유지 — 명시적으로 미사용 표시.

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (rafRef.current !== null) return;
    const x = e.clientX;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const row = rowRef.current;
      if (!row) return;
      const cards = row.querySelectorAll<HTMLElement>('.scene-card');
      cards.forEach((card) => {
        if (card.classList.contains('pinned')) return; // pinned 카드는 별도 transform
        const rect = card.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const distance = Math.abs(x - center);
        const lift = Math.max(0, 1 - distance / DOCK_MAX_DIST);
        const dy = lift * DOCK_LIFT;
        const scale = 1 + lift * DOCK_SCALE;
        card.style.transform = `translateY(${dy}px) scale(${scale.toFixed(3)})`;
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
        expanded={effectiveExpanded}
        onToggle={() => toggleExpand(partId)}
      />

      {effectiveExpanded && (
        <div
          ref={rowRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-visible px-1"
          style={{
            // 상부 margin — dock-lift / pinned 시 카드가 위 컨테이너에 잘리지 않도록.
            paddingTop: 28,
            paddingBottom: 12,
            scrollbarGutter: 'stable',
          }}
        >
          {scenes.map((sc, idx) => {
            const stateKey = `${sc.episodeNumber}:${sc.sceneId}`;
            const state = epStates.get(stateKey);
            const status = state?.status ?? 'batch';

            // 필터/솔로/뮤트 처리
            const matchesFilter = statusFilter === null || status === statusFilter;
            const isSoloed = soloScene === null || soloScene === sc.sceneId;
            const isMuted = mutedScenes.has(sc.sceneId);
            if (isMuted) return null;
            const dimmed = !matchesFilter || !isSoloed;

            return (
              <div key={sc.sceneId} className="shrink-0" style={{ width: 180 }}>
                <SceneCard
                  card={sc}
                  state={state}
                  staggerIndex={idx}
                  dimmed={dimmed}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
