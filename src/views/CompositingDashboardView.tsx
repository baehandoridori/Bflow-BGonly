/**
 * 컴포지팅 현황 대시보드 — 메인 컨테이너.
 *
 * v1.30.0: 6 단계 워크플로 (배치 → 취합중 → 취합 완료 → 보정 중 → 오류 → 완료) 를
 * EP 별로 실시간 시각화하는 새 뷰. Realtime 으로 협업.
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md
 * plan: docs/superpowers/plans/2026-05-21-compositing-dashboard.md
 *
 * 진입 흐름:
 *   1. mount → preferences.lastCompositingEpisode (없으면 가장 큰 활성 EP) 복원
 *   2. EP 변경 시: loadCompositingForEpisode + Realtime 구독 + preferences 디바운스 저장
 *   3. 카드 cascade 시작 (CSS animation)
 *
 * 다른 사용자의 단계 변경은 Realtime 으로 자동 수신 → updatedBy 본인 아니면
 * transientHighlight 트리거 (카드 색 펄스 + 보낸 사람 아바타 배지 2.5초).
 *
 * Presence (보는 사람 칩) / Broadcast 채널은 후속 polish — MVP 는 Realtime UPDATE 기반.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast as sonnerToast } from 'sonner';
import { useDataStore, compositingKey } from '@/stores/useDataStore';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useTransientHighlightStore } from '@/stores/transientHighlightStore';
import { subscribeCompositingStatesRealtime, updateSceneFieldInSupabase } from '@/services/supabaseService';
import { isCompositorForCompositing } from '@/utils/compositingLabels';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { DashHeader } from './compositing-dashboard/DashHeader';
import { GuideStrip } from './compositing-dashboard/GuideStrip';
import { StatusLegend } from './compositing-dashboard/StatusLegend';
import { TimelinePanel } from './compositing-dashboard/timeline/TimelinePanel';
import { PartCardRow } from './compositing-dashboard/cards/PartCardRow';
import { CompositingSceneModal } from './compositing-dashboard/modal/CompositingSceneModal';
import { BulkActionBar } from './compositing-dashboard/BulkActionBar';
import { buildCardScenes } from './compositing-dashboard/cardSceneHelpers';

export function CompositingDashboardView() {
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const getEpisodeDisplayName = useDataStore((s) => s.getEpisodeDisplayName);
  const compositingStates = useDataStore((s) => s.compositingStates);
  const loadCompositingForEpisode = useDataStore((s) => s.loadCompositingForEpisode);
  const setCompositingStateInStore = useDataStore((s) => s.setCompositingState);
  const deleteCompositingState = useDataStore((s) => s.deleteCompositingState);

  const episodeNumber = useCompositingDashboardStore((s) => s.episodeNumber);
  const setEpisode = useCompositingDashboardStore((s) => s.setEpisode);
  const detailScene = useCompositingDashboardStore((s) => s.detailScene);
  const setDetailScene = useCompositingDashboardStore((s) => s.setDetailScene);
  const pinnedScene = useCompositingDashboardStore((s) => s.pinnedScene);
  const setPinnedScene = useCompositingDashboardStore((s) => s.setPinnedScene);
  const expandedParts = useCompositingDashboardStore((s) => s.expandedParts);
  const toggleExpand = useCompositingDashboardStore((s) => s.toggleExpand);
  const partsOrderByEpisode = useCompositingDashboardStore((s) => s.partsOrderByEpisode);
  const setPartsOrder = useCompositingDashboardStore((s) => s.setPartsOrder);
  const selectedSceneKeys = useCompositingDashboardStore((s) => s.selectedSceneKeys);
  const clearSelectedScenes = useCompositingDashboardStore((s) => s.clearSelectedScenes);
  const setSelectedSceneKeys = useCompositingDashboardStore((s) => s.setSelectedSceneKeys);
  const addSelectedSceneKeys = useCompositingDashboardStore((s) => s.addSelectedSceneKeys);
  const resetExpandedParts = useCompositingDashboardStore((s) => s.resetExpandedParts);

  const currentUser = useAuthStore((s) => s.currentUser);
  // 한솔 정정 (2026-05-21): 배한솔은 언제나 컴포지터, admin role 도 자동 권한.
  const isCompositor = isCompositorForCompositing(currentUser);

  const addHighlight = useTransientHighlightStore((s) => s.add);
  const clearAllHighlight = useTransientHighlightStore((s) => s.clearAll);

  // ↻ 버튼용 — cascade 재생 트리거
  const [cascadeKey, setCascadeKey] = useState(0);

  // ── 1. 마지막 본 EP 복원 ──
  useEffect(() => {
    if (episodeNumber !== null) return;
    let cancelled = false;
    (async () => {
      const prefs = await loadPreferences();
      const last = prefs?.lastCompositingEpisode;
      const active = episodes.map((e) => e.episodeNumber);
      const fallback = active.length > 0 ? Math.max(...active) : null;
      const target = typeof last === 'number' && active.includes(last) ? last : fallback;
      if (!cancelled && target !== null) {
        setEpisode(target);
      }
    })();
    return () => { cancelled = true; };
  }, [episodes, episodeNumber, setEpisode]);

  // ── 2. EP 변경 시: 데이터 로드 + Realtime 구독 + preferences 저장 ──
  useEffect(() => {
    if (episodeNumber === null) return;
    loadCompositingForEpisode(episodeNumber).catch(() => {/* supabaseService 내부에서 에러 처리 */});

    // preferences 디바운스 500ms 저장 (Task 3.8)
    const prefsTimer = window.setTimeout(async () => {
      try {
        const prefs = await loadPreferences() ?? {};
        await savePreferences({ ...prefs, lastCompositingEpisode: episodeNumber });
      } catch { /* preferences 저장 실패는 silent */ }
    }, 500);

    // Realtime 구독 — 다른 사용자/창의 단계 변경 수신
    const unsubscribe = subscribeCompositingStatesRealtime((row, eventType) => {
      if (row.episodeNumber !== episodeNumber) return;
      const key = compositingKey(row.episodeNumber, row.sceneId);
      if (eventType === 'DELETE') {
        deleteCompositingState(key);
        return;
      }
      setCompositingStateInStore(key, row);
      // 본인이 아닐 때만 highlight 트리거 (색 펄스 + 아바타 배지)
      if (row.updatedBy && currentUser?.id && row.updatedBy !== currentUser.id) {
        addHighlight(key, row.updatedBy);
      }
    });

    return () => {
      window.clearTimeout(prefsTimer);
      try { unsubscribe(); } catch { /* noop */ }
      // EP 떠날 때 잔여 highlight 정리
      clearAllHighlight();
    };
  }, [episodeNumber, currentUser, loadCompositingForEpisode, setCompositingStateInStore, deleteCompositingState, addHighlight, clearAllHighlight]);

  // ── 카드 데이터 변환 (+ 사용자 지정 파트 순서 반영) ──
  const partGroups = useMemo(() => {
    const ep = episodes.find((e) => e.episodeNumber === episodeNumber);
    const groups = buildCardScenes(ep);
    const order = episodeNumber !== null ? partsOrderByEpisode[episodeNumber] : undefined;
    if (!order || order.length === 0) return groups;
    // 사용자 지정 순서 우선 → 그 안에 없는 신규 partId 는 뒤에 알파벳 순.
    const indexOf = (pid: string) => {
      const i = order.indexOf(pid);
      return i < 0 ? order.length + pid.charCodeAt(0) : i;
    };
    return [...groups].sort((a, b) => indexOf(a.partId) - indexOf(b.partId));
  }, [episodes, episodeNumber, partsOrderByEpisode]);

  const handlePartsReorder = (partIds: string[]) => {
    if (episodeNumber === null) return;
    setPartsOrder(episodeNumber, partIds);
  };

  // 한솔 정정 (2026-05-21): 파트 막대 가로 리사이즈로 씬 durationFrames 일괄 변경하던 로직 제거.
  //   이유: "이 컴포지션의 타임라인에서 실제 영상 길이에 맞게 이렇게 저렇게 하는건 그냥 주석으로만 하고,
  //   기본은 기본으로 배열하고, 스크롤 같은걸로 이렇게 길이 조정"
  //   → TimelinePanel 안에서 시각 전용 (컷당 픽셀 배수) 으로 처리. 데이터 변경 X.

  // ── EP 변경 시 — expandedParts 를 새 EP partId 로 초기화 + 일괄 선택 클리어
  // 코덱스 P2 fix (2026-05-22):
  //   - 이전엔 deps 가 partGroups partIds join 만이라 EP 가 같은 partId set 을 공유하면 (예: 둘 다 A,B,C,D)
  //     effect 재실행 안 됨 → 한 EP 에서 접은 partId 가 다음 EP 까지 따라감.
  //   - 일괄 선택도 글로벌 set 이라 EP 전환 후에도 카운트 남아 floating bar 가 어색하게 떠있음.
  // 코덱스 5차 P2 fix (2026-05-22):
  //   - partGroups.map(...).join(',') deps 추가했더니 파트 재정렬(같은 set 다른 순서) 에도 effect 가 fire.
  //   - 결과: 드래그로 파트 재배치 시 접힌 파트가 다시 펼쳐지고 일괄 선택이 사라지는 버그.
  //   - 해결: deps 를 [episodeNumber] 만으로 축소. episodeNumber 가 바뀌면 partGroups 도 같은 render 에서
  //     이미 새 값 (useMemo deps 에 episodeNumber 들어있음) → effect 안 closure 가 최신 partIds 읽음.
  //     순수한 EP 전환에만 reset 발생.
  // 코덱스 6차 P2 fix (2026-05-22):
  //   - pinnedScene/detailScene 이 EP 전환 후에도 stale 상태로 남아 다른 EP 카드가 otherPinned 로 처리됨
  //     → 모든 카드가 opacity-55 로 dim 되어 EP 가 부분 비활성 상태처럼 보이는 버그.
  //   - 해결: EP 전환 시 pinnedScene/detailScene 도 null 로 클리어.
  const seenPartIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (episodeNumber === null) return;
    // EP 변경 시 expandedParts 강제 reset — 새 EP 의 모든 partId 를 펼침 set 으로.
    const partIds = partGroups.map((g) => g.partId);
    resetExpandedParts(partIds);
    // ref 도 reset — 새 EP 컨텍스트로 신규 partId 추적 재시작.
    seenPartIdsRef.current = new Set(partIds);
    // 일괄 선택도 EP 전환 시 클리어 — 다른 EP 카드 stale 표시 방지.
    clearSelectedScenes();
    // 핀/모달도 EP 전환 시 클리어 — 다른 EP 의 sceneKey 가 남아있으면 새 EP 카드가
    //   otherPinned 로 처리되어 dim 되거나, 닫히지 않은 모달이 다른 씬을 보여줌.
    setPinnedScene(null);
    setDetailScene(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeNumber]);
  void expandedParts; void toggleExpand; // store 필드/액션 유지 — 사용자가 토글로 접는 동작은 그대로 동작.

  // 현재 EP 의 상태 row 만 슬라이스 — StatusLegend / Timeline / SceneCard 가 사용
  const epStates = useMemo(() => {
    const m = new Map<string, typeof compositingStates extends Map<string, infer V> ? V : never>();
    if (episodeNumber === null) return m;
    const prefix = `${episodeNumber}:`;
    for (const [key, row] of compositingStates) {
      if (key.startsWith(prefix)) m.set(key, row);
    }
    return m;
  }, [compositingStates, episodeNumber]);

  const currentEpisodeDisplayName = useMemo(() => {
    if (episodeNumber === null) return '';
    const episode = episodes.find((e) => e.episodeNumber === episodeNumber);
    return episode ? getEpisodeDisplayName(episode) : `EP${String(episodeNumber).padStart(2, '0')}`;
  }, [episodeNumber, episodes, getEpisodeDisplayName, episodeTitles]);

  // ── Esc 로 pinnedScene / detailScene / 일괄 선택 해제 ──
  useEffect(() => {
    if (pinnedScene === null && detailScene === null && selectedSceneKeys.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 우선순위: 모달 > 일괄 선택 > 핀
        if (detailScene !== null) return; // 모달의 자체 Esc 핸들러가 처리
        if (selectedSceneKeys.size > 0) {
          clearSelectedScenes();
          return;
        }
        setPinnedScene(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinnedScene, detailScene, selectedSceneKeys.size, setPinnedScene, clearSelectedScenes]);

  // ── 드래그 박스 selection ──
  // 빈 영역에서 mousedown → 드래그 → mouseup 사이에 박스 안에 들어온 [data-scene-key] element 를 selection 에 add.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dragBoxRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ startX: number; startY: number; addMode: boolean } | null>(null);
  const handleDragSelectStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // v1.30.2 (한솔 보고 2026-05-24): 모달 열려있을 때 뒤 카드 drag-select 작동하던 버그.
    //   상세 모달은 overlay z-index 위지만 그 너머 mousedown 이 부모로 전파되어 drag-select 시작.
    //   detailScene 활성화 시 즉시 skip.
    if (detailScene !== null) return;
    // 카드/모달/핸들 클릭은 건너뜀
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.scene-card')) return;
    if (target.closest('[role="dialog"]')) return;
    if (target.closest('.part-row')) return;
    if (target.closest('button')) return;
    // Cmd/Ctrl 누르고 시작 시 = 기존 선택에 추가, 아니면 = 새로 시작
    const addMode = e.metaKey || e.ctrlKey || e.shiftKey;
    dragStateRef.current = { startX: e.clientX, startY: e.clientY, addMode };
    if (!addMode) clearSelectedScenes();

    const box = dragBoxRef.current;
    if (!box) return;
    box.style.display = 'block';
    box.style.left = `${e.clientX}px`;
    box.style.top = `${e.clientY}px`;
    box.style.width = '0px';
    box.style.height = '0px';

    const onMove = (ev: MouseEvent) => {
      const s = dragStateRef.current;
      if (!s || !box) return;
      const x = Math.min(s.startX, ev.clientX);
      const y = Math.min(s.startY, ev.clientY);
      const w = Math.abs(ev.clientX - s.startX);
      const h = Math.abs(ev.clientY - s.startY);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
    };
    const onUp = (ev: MouseEvent) => {
      const s = dragStateRef.current;
      dragStateRef.current = null;
      if (box) box.style.display = 'none';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!s) return;
      const moved = Math.abs(ev.clientX - s.startX) + Math.abs(ev.clientY - s.startY);
      if (moved < 4) return; // 단순 클릭 → selection 변경 없음
      // 박스 안 카드들 수집
      const rect = {
        left: Math.min(s.startX, ev.clientX),
        top: Math.min(s.startY, ev.clientY),
        right: Math.max(s.startX, ev.clientX),
        bottom: Math.max(s.startY, ev.clientY),
      };
      const cards = document.querySelectorAll<HTMLElement>('[data-scene-key]');
      const newKeys: string[] = [];
      cards.forEach((el) => {
        const r = el.getBoundingClientRect();
        const intersects = !(r.right < rect.left || r.left > rect.right || r.bottom < rect.top || r.top > rect.bottom);
        if (intersects) {
          const k = el.dataset.sceneKey;
          if (k) newKeys.push(k);
        }
      });
      if (newKeys.length === 0) return;
      if (s.addMode) addSelectedSceneKeys(newKeys);
      else setSelectedSceneKeys(new Set(newKeys));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── 배경 클릭 시 핀 해제 — 컨테이너 전체 onMouseDown 사용 ──
  // 카드 클릭은 SceneCard 의 onClick 이 먼저 처리하고 (button 의 onClick 은 mouseup 이후 firing), 그 안에서 setPinnedScene 호출.
  // 우리는 mouseDown 단계에서 "카드가 아닌 곳을 누른 경우" 만 핀 해제.
  // 헤더 / 안내 띠 / 상태 칩 / Timeline 등 카드 외 모든 영역을 자연스럽게 cover.
  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    if (pinnedScene === null) return;
    if (detailScene !== null) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // 카드 안 (또는 모달 안) 인지 검사
    if (target.closest('.scene-card') || target.closest('[role="dialog"]')) return;
    setPinnedScene(null);
  };

  return (
    <div
      className="flex flex-col h-full bg-bg-primary text-text-primary overflow-hidden"
      onMouseDown={(e) => { handleBackgroundMouseDown(e); handleDragSelectStart(e); }}
    >
      {/* 드래그 박스 selection 시각 */}
      <div
        ref={dragBoxRef}
        className="fixed pointer-events-none z-50"
        style={{
          display: 'none',
          border: '1.5px dashed rgb(var(--color-accent))',
          background: 'rgb(var(--color-accent) / 0.12)',
          borderRadius: 4,
        }}
      />
      <DashHeader
        episodeNumber={episodeNumber}
        onCascadeReplay={() => setCascadeKey((k) => k + 1)}
      />
      <GuideStrip />
      <StatusLegend epStates={epStates} totalSceneCount={partGroups.reduce((n, g) => n + g.scenes.length, 0)} />

      <div className="flex-1 overflow-y-auto px-6 pb-12 pt-2">
        <div key={`cascade-${cascadeKey}`}>
          <TimelinePanel
            episodeNumber={episodeNumber}
            partGroups={partGroups.map((g) => {
              // 파트 메모 — episode.parts 안에서 BG 또는 ACT 파트의 메모 (실 데이터엔 보통 part-level memo 없으니 placeholder)
              const ep = episodes.find((e) => e.episodeNumber === episodeNumber);
              const partForMemo = ep?.parts.find((p) => p.partId.trim().slice(0, 1).toUpperCase() === g.partId);
              const memo = (partForMemo as { memo?: string } | undefined)?.memo ?? '';
              return {
                partId: g.partId,
                memo,
                scenes: g.scenes.map((cs) => ({
                  sceneId: cs.sceneId,
                  partId: cs.partId,
                  episodeNumber: cs.episodeNumber,
                  durationFrames: cs.durationFrames ?? null,
                  orderNo: cs.orderNo,
                })),
              };
            })}
            epStates={epStates}
            onReorder={handlePartsReorder}
            isCompositor={isCompositor}
          />

          <div className="mt-6 flex flex-col gap-5">
            {partGroups.map((g) => (
              <PartCardRow
                key={g.partId}
                partId={g.partId}
                scenes={g.scenes}
                epStates={epStates}
              />
            ))}

            {partGroups.length === 0 && episodeNumber !== null && (
              <div className="text-center py-12 text-text-secondary/70 text-sm">
                {currentEpisodeDisplayName}에 등록된 씬이 없습니다.
              </div>
            )}
          </div>
        </div>
      </div>

      {detailScene !== null && episodeNumber !== null && (
        <CompositingSceneModal
          sceneKey={detailScene}
          episodeNumber={episodeNumber}
          isCompositor={isCompositor}
        />
      )}

      {/* 일괄 작업 floating bar (선택 1개 이상일 때만 노출) */}
      <BulkActionBar episodeNumber={episodeNumber} isCompositor={isCompositor} />
    </div>
  );
}

export default CompositingDashboardView;
