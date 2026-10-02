/**
 * 컴포지팅 대시보드 일괄 작업 floating bar.
 *
 * 한솔 요구 (2026-05-22): "카드 뷰처럼 드래그해서 일괄적으로 처리"
 *  → 선택된 씬이 있을 때 화면 하단 중앙에 떠서 일괄 단계 변경 + 선택 해제 제공.
 *
 * 동작:
 *  - 선택 N개 표시 + 선택 해제 버튼
 *  - 컴포지팅 6 단계 칩 — 클릭 시 선택된 모든 씬에 그 단계 일괄 적용
 *  - isCompositor === false 면 단계 변경 disabled (선택은 가능)
 *
 * 움직임(움직임 폴리싱 8번 popup-rhythm):
 *  - 처음 뜰 때만 아래에서 살짝 올라온다(.bf-bulk-in, 180ms). 떠 있는 동안 다른 카드를 연달아 눌러도
 *    바는 그대로라 다시 튀어 오르지 않는다. 사라질 때는 바로.
 *  - 선택 개수가 바뀌면 숫자만 '톡'(WAAPI 140ms). 동작 줄이기면 opacity 만 100ms.
 *  - 가운데 정렬은 바깥 래퍼가 맡는다 — 안쪽 바가 transform 으로 올라오는 동안 -translate-x-1/2 를 덮지 않게.
 */

import { useCallback, useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';
import type { CompositingStatus } from '@/types';
import {
  COMPOSITING_STATUS_LABEL,
  COMPOSITING_STATUS_ORDER,
  COMPOSITING_STATUS_TOKEN,
} from '@/utils/compositingLabels';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDataStore } from '@/stores/useDataStore';
import { toggleCompositingStatus } from './compositingActions';
import { buildCardScenes, flattenCardScenes } from './cardSceneHelpers';
import { useMotionPref } from '@/hooks/useMotionPref';
import { animateEl, EASE_CSS } from '@/utils/motion';
import { COUNT_TICK_KEYFRAMES, POPUP_MS } from '@/utils/popupMotion';

interface BulkActionBarProps {
  episodeNumber: number | null;
  isCompositor: boolean;
}

export function BulkActionBar({ episodeNumber, isCompositor }: BulkActionBarProps) {
  const selectedSceneKeys = useCompositingDashboardStore((s) => s.selectedSceneKeys);
  const clearSelectedScenes = useCompositingDashboardStore((s) => s.clearSelectedScenes);
  const currentUser = useAuthStore((s) => s.currentUser);
  const { reduce } = useMotionPref();
  const selectedCount = selectedSceneKeys.size;
  const countRef = useRef<HTMLSpanElement>(null);
  const previousCountRef = useRef(selectedCount);

  // 선택 개수가 바뀔 때만 숫자 '톡'. 처음 뜰 때(0→N)는 바 자체가 올라오니 숫자는 가만히 둔다.
  useLayoutEffect(() => {
    const previous = previousCountRef.current;
    previousCountRef.current = selectedCount;
    if (previous === 0 || selectedCount === 0 || previous === selectedCount) return undefined;
    const animation = animateEl(
      countRef.current,
      COUNT_TICK_KEYFRAMES,
      { duration: reduce ? POPUP_MS.reduced : POPUP_MS.tick, easing: EASE_CSS.out },
      reduce,
    );
    return () => animation?.cancel();
  }, [selectedCount, reduce]);

  const handleBulkStatus = useCallback((next: CompositingStatus) => {
    if (!isCompositor || !currentUser || episodeNumber === null) return;
    const ep = useDataStore.getState().episodes.find((e) => e.episodeNumber === episodeNumber);
    if (!ep) return;
    const allCards = flattenCardScenes(buildCardScenes(ep));
    const targets = allCards.filter((c) => selectedSceneKeys.has(`${c.episodeNumber}:${c.sceneId}`));
    // 병렬 호출 — 단계 토글
    Promise.all(targets.map((card) => toggleCompositingStatus({
      episodeNumber,
      sceneId: card.sceneId,
      partId: card.partId,
      next,
      currentUserId: currentUser.id,
    }))).catch(() => { /* 실패는 개별 함수가 sonner.error 표시 */ });
    // 일괄 처리 후 선택 유지 — 한솔이 정리하고 싶으면 ✕ 버튼
  }, [isCompositor, currentUser, episodeNumber, selectedSceneKeys]);

  if (selectedCount === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center" style={{ bottom: 28 }}>
      <div
        className="bf-bulk-in pointer-events-auto flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 overflow-x-auto px-3 py-2 rounded-xl shadow-2xl border"
        style={{
          // 배경이 97% 불투명이라 흐림은 눈에 거의 안 보이고, 올라오는 동안 매 프레임 다시 계산만 하게 된다 — 뺐다.
          background: 'rgb(var(--color-bg-card) / 0.97)',
          borderColor: 'rgb(var(--color-bg-border))',
          boxShadow: '0 12px 36px rgb(0 0 0 / 0.55), 0 0 24px rgb(var(--color-accent) / 0.18)',
        }}
      >
        {/* 선택 N개 + 닫기 */}
        <div className="flex items-center gap-2 pr-3 border-r border-bg-border/70">
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded-full"
            style={{
              background: 'rgb(var(--color-accent) / 0.22)',
              color: 'rgb(var(--color-accent))',
            }}
          >
            <span ref={countRef} className="inline-block tabular-nums">{selectedCount}</span>개 선택
          </span>
          <button
            type="button"
            onClick={clearSelectedScenes}
            className="w-6 h-6 rounded flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-border/40 transition-colors"
            title="선택 해제 (Esc)"
          >
            <X size={13} />
          </button>
        </div>

        {/* 컴포지팅 단계 일괄 변경 */}
        <div
          className={cn(
            'flex min-w-0 flex-wrap items-center gap-1.5',
            !isCompositor && 'opacity-50 cursor-not-allowed',
          )}
          title={!isCompositor ? '컴포지터만 단계 일괄 변경 가능' : undefined}
        >
          <span className="text-[10px] font-bold text-text-secondary tracking-wider uppercase mr-1">
            일괄 변경
          </span>
          {COMPOSITING_STATUS_ORDER.map((st) => {
            const tv = COMPOSITING_STATUS_TOKEN[st];
            return (
              <button
                key={st}
                type="button"
                disabled={!isCompositor}
                onClick={() => handleBulkStatus(st)}
                className="compact-label-container inline-flex min-w-0 shrink items-center px-2.5 py-1 text-[11px] font-bold rounded-full border transition-all duration-150"
                style={{
                  background: 'transparent',
                  color: `var(${tv})`,
                  borderColor: `color-mix(in srgb, var(${tv}) 50%, transparent)`,
                  borderWidth: 1.5,
                }}
                onMouseEnter={(e) => {
                  if (!isCompositor) return;
                  e.currentTarget.style.background = `var(${tv})`;
                  e.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = `var(${tv})`;
                }}
              >
                <CompactIconLabel
                  icon={
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full"
                      style={{ background: `var(${tv})` }}
                    />
                  }
                  label={COMPOSITING_STATUS_LABEL[st]}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
