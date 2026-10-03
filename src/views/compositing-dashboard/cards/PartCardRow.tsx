/**
 * 한 파트 (A/B/C/D) 의 카드 반응형 그리드 + 호버 dock-lift.
 *
 * 동작:
 * - PartHeader 클릭 = 접기/펼치기 토글 (`expandedParts` set). 누른 경우에만 서랍처럼 열리고 닫힌다
 *   (partDrawer.ts — 펼치는 동안 칸 밖으로 안 나와 아래 파트 제목줄과 겹치지 않음). EP 전환·↻ 의 펼침은 즉시.
 * - 그리드는 `flex-wrap` 으로 가로폭에 따라 자동 줄바꿈 — 가로 스크롤 X.
 * - 호버 dock-lift 는 마우스 (X, Y) 와 카드 중심 거리 (2D) 로 계산해 한 줄 안 인접 카드만 영향.
 *   여러 줄로 wrap 됐을 때 위/아래 줄 카드가 같이 들썩이는 누수 방지.
 * - 거리는 들리지 않는 원래 자리 칸([data-scene-key])으로 잰다 — 들린 카드로 재면 떨린다(dockLift.ts).
 *
 * spec: 2026-05-21-compositing-dashboard-design.md (8.1~8.5, 13.2)
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { CompositingState } from '@/types';
import { isCompletedStatus } from '@/utils/compositingLabels';
import { prefersReducedMotion } from '@/utils/motion';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { compositingKey } from '@/stores/useDataStore';
import { useMotionPref } from '@/hooks/useMotionPref';
import type { CardScene } from '../cardSceneHelpers';
import { PartHeader } from './PartHeader';
import { SceneCard } from './SceneCard';
import { dockTransform } from './dockLift';
import { runPartDrawer, settlePartDrawerOpen } from './partDrawer';

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
  const { reduce } = useMotionPref();

  // 사용자가 한 번이라도 토글한 파트는 set 에 들어있고, 그 안에 있으면 펼침.
  // (set 초기화는 CompositingDashboardView 가 마운트 시 모든 partId 를 add — 기본 펼침.)
  const expanded = expandedParts.has(partId);
  // 접히는 280ms 동안에도 그린다. 펼칠 땐 같은 렌더에서 바로 그린다(effect 를 기다리면 한 프레임 늦다).
  const [rendered, setRendered] = useState(expanded);
  if (expanded && !rendered) setRendered(true);

  // 서랍 — 머리줄을 눌러 바꾼 경우에만 움직인다. EP 전환·↻ 로 펼쳐지는 건 카드 차례 등장이 맡는다.
  const drawerRef = useRef<HTMLDivElement>(null);
  const animateNextToggleRef = useRef(false);
  const lastDrawerElRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const wrap = drawerRef.current;
    const animate = animateNextToggleRef.current && !reduce;
    animateNextToggleRef.current = false;
    if (!wrap) return; // 접힌 채 — 그릴 것 없음
    const fromZero = lastDrawerElRef.current !== wrap; // 방금 마운트된 서랍은 높이 0 에서 출발
    lastDrawerElRef.current = wrap;
    if (!animate) {
      // 동작 줄이기·누르지 않은 변화 — 즉시.
      if (expanded) settlePartDrawerOpen(wrap);
      else setRendered(false);
      return;
    }
    return runPartDrawer(wrap, expanded, {
      fromZero,
      onSettled: expanded ? undefined : () => setRendered(false),
    });
    // reduce 는 누른 순간의 값만 본다 — 바뀌었다고 서랍을 다시 돌리지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const handleToggle = () => {
    animateNextToggleRef.current = true;
    toggleExpand(partId);
  };

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
    // 머리줄과 카드 사이 8px 은 gap 이 아니라 서랍 안쪽 여백으로 둔다 — gap 이면 서랍이 생기고 사라지는 순간
    // 아래 파트 제목줄이 8px '툭' 움직인다.
    <div className="flex flex-col">
      <PartHeader
        partId={partId}
        sceneCount={scenes.length}
        doneCount={doneCount}
        expanded={expanded}
        onToggle={handleToggle}
      />

      {rendered && (
        // 높이·넘침·투명도는 partDrawer 가 인라인으로만 다룬다(React style 에 두면 다시 그릴 때 덮어쓴다).
        <div ref={drawerRef} aria-hidden={!expanded}>
          <div
            ref={rowRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="flex flex-wrap gap-3 px-1"
            style={{
              // 상부 margin — dock-lift / pinned 시 카드가 위 컨테이너 / 위 줄에 잘리지 않도록.
              //   34 + 머리줄과의 간격 8 (예전 바깥 gap-2).
              paddingTop: 42,
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
