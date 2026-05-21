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
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { DashHeader } from './compositing-dashboard/DashHeader';
import { GuideStrip } from './compositing-dashboard/GuideStrip';
import { StatusLegend } from './compositing-dashboard/StatusLegend';
import { TimelinePanel } from './compositing-dashboard/timeline/TimelinePanel';
import { PartCardRow } from './compositing-dashboard/cards/PartCardRow';
import { CompositingSceneModal } from './compositing-dashboard/modal/CompositingSceneModal';
import { buildCardScenes } from './compositing-dashboard/cardSceneHelpers';

export function CompositingDashboardView() {
  const episodes = useDataStore((s) => s.episodes);
  const compositingStates = useDataStore((s) => s.compositingStates);
  const loadCompositingForEpisode = useDataStore((s) => s.loadCompositingForEpisode);
  const setCompositingStateInStore = useDataStore((s) => s.setCompositingState);
  const deleteCompositingState = useDataStore((s) => s.deleteCompositingState);

  const episodeNumber = useCompositingDashboardStore((s) => s.episodeNumber);
  const setEpisode = useCompositingDashboardStore((s) => s.setEpisode);
  const detailScene = useCompositingDashboardStore((s) => s.detailScene);
  const pinnedScene = useCompositingDashboardStore((s) => s.pinnedScene);
  const setPinnedScene = useCompositingDashboardStore((s) => s.setPinnedScene);
  const expandedParts = useCompositingDashboardStore((s) => s.expandedParts);
  const toggleExpand = useCompositingDashboardStore((s) => s.toggleExpand);
  const partsOrderByEpisode = useCompositingDashboardStore((s) => s.partsOrderByEpisode);
  const setPartsOrder = useCompositingDashboardStore((s) => s.setPartsOrder);

  const currentUser = useAuthStore((s) => s.currentUser);
  const isCompositor = currentUser?.isCompositor === true;

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

  /**
   * 파트 막대 우측 edge 드래그 종료 시 호출 — 그 파트 안 모든 씬의 durationFrames *= scale.
   *
   * 흐름:
   *  1. 낙관적: useDataStore.episodes 의 그 파트 씬들 durationFrames 즉시 변경
   *  2. Supabase: 각 씬마다 updateSceneFieldInSupabase 단건 호출 (Promise.all 병렬)
   *  3. 실패 시: prev 값으로 롤백 + sonner.error
   */
  const handlePartResize = useCallback(async (partId: string, scale: number) => {
    if (episodeNumber === null || !currentUser) return;
    if (!isCompositor) {
      sonnerToast.warning('컴포지터만 파트 길이를 조절할 수 있어요');
      return;
    }
    const ep = useDataStore.getState().episodes.find((e) => e.episodeNumber === episodeNumber);
    if (!ep) return;

    // 대상 씬 수집 — 같은 partId 의 모든 part (BG / ACT) × scenes
    const targets: { sheetName: string; sceneId: string; sceneUuid?: string; prevFrames: number | null; nextFrames: number }[] = [];
    const normPart = (p: string) => p.trim().slice(0, 1).toUpperCase();
    for (const part of ep.parts) {
      if (normPart(part.partId) !== normPart(partId)) continue;
      for (const sc of part.scenes) {
        const prev = sc.durationFrames ?? null;
        const base = prev && prev > 0 ? prev : 24 * 4; // 데이터 없으면 4초 디폴트 base 로 scale 적용
        const next = Math.max(1, Math.round(base * scale));
        targets.push({
          sheetName: part.sheetName,
          sceneId: sc.sceneId,
          sceneUuid: sc.id,
          prevFrames: prev,
          nextFrames: next,
        });
      }
    }
    if (targets.length === 0) return;

    // 1. 낙관적 — episodes 안 씬 직접 변경
    const setEpisodes = useDataStore.getState().setEpisodes;
    const prevEpisodes = useDataStore.getState().episodes;
    const nextEpisodes = prevEpisodes.map((e) => {
      if (e.episodeNumber !== episodeNumber) return e;
      return {
        ...e,
        parts: e.parts.map((part) => {
          if (normPart(part.partId) !== normPart(partId)) return part;
          return {
            ...part,
            scenes: part.scenes.map((sc) => {
              const t = targets.find((x) => x.sceneId === sc.sceneId && x.sheetName === part.sheetName);
              if (!t) return sc;
              return { ...sc, durationFrames: t.nextFrames };
            }),
          };
        }),
      };
    });
    setEpisodes(nextEpisodes);

    // 2. Supabase 단건 N 회 (병렬). sceneUuid 가 없는 mock 환경은 skip.
    try {
      await Promise.all(targets.map((t) => {
        if (!t.sceneUuid) return Promise.resolve();
        return updateSceneFieldInSupabase(t.sceneUuid, 'durationFrames', String(t.nextFrames));
      }));
    } catch (err) {
      // 3. 실패 → 롤백
      setEpisodes(prevEpisodes);
      const msg = err instanceof Error ? err.message : String(err);
      sonnerToast.error('파트 길이 저장 실패', { description: msg });
    }
  }, [episodeNumber, currentUser, isCompositor]);

  // ── 모든 partId 를 기본 펼침 — EP 진입 시 1 회만 실행 ──
  // 이전 버그: deps 가 `[partGroups]` 였는데 useMemo 결과가 매 렌더 새 객체 → effect 매 렌더 실행 →
  // 사용자가 접은 partId 가 다시 add 되어 "잠시 후 자동 펼쳐짐" 현상.
  // 해결: 처음 본 partId set 을 ref 로 추적, 신규 partId 만 한 번씩 add.
  const seenPartIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const seen = seenPartIdsRef.current;
    for (const g of partGroups) {
      if (seen.has(g.partId)) continue;
      seen.add(g.partId);
      // 이 partId 가 expandedParts 에 아직 없으면 (= store 가 초기 상태) 자동 펼침.
      if (!expandedParts.has(g.partId)) toggleExpand(g.partId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partGroups.map((g) => g.partId).join(',')]);
  // EP 전환 시 ref reset — 새 EP 의 partId 는 다시 기본 펼침.
  useEffect(() => {
    seenPartIdsRef.current = new Set();
  }, [episodeNumber]);

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

  // ── Esc 로 pinnedScene / detailScene 해제 ──
  useEffect(() => {
    if (pinnedScene === null && detailScene === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 모달이 열려있으면 모달의 자체 Esc 핸들러가 detailScene 만 닫고, pinnedScene 은 유지.
        // 모달 없을 때만 pinnedScene 해제.
        if (detailScene === null) setPinnedScene(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinnedScene, detailScene, setPinnedScene]);

  // ── 배경 클릭 시 핀 해제 — 컨테이너 전체 onMouseDown 사용 ──
  // 카드 클릭은 SceneCard 의 onClick 이 먼저 처리하고 (button 의 onClick 은 mouseup 이후 firing), 그 안에서 setPinnedScene 호출.
  // 우리는 mouseDown 단계에서 "카드가 아닌 곳을 누른 경우" 만 핀 해제.
  // 헤더 / 안내 띠 / 상태 칩 / Timeline 등 카드 외 모든 영역을 자연스럽게 cover.
  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    if (pinnedScene === null) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // 카드 안 (또는 모달 안) 인지 검사
    if (target.closest('.scene-card') || target.closest('[role="dialog"]')) return;
    setPinnedScene(null);
  };

  return (
    <div
      className="flex flex-col h-full bg-bg-primary text-text-primary overflow-hidden"
      onMouseDown={handleBackgroundMouseDown}
    >
      <DashHeader
        episodeNumber={episodeNumber}
        onCascadeReplay={() => setCascadeKey((k) => k + 1)}
      />
      <GuideStrip />
      <StatusLegend epStates={epStates} />

      <div className="flex-1 overflow-y-auto px-6 pb-12 pt-2">
        <div key={`cascade-${cascadeKey}`}>
          <TimelinePanel
            episodeNumber={episodeNumber}
            partGroups={partGroups.map((g) => ({
              partId: g.partId,
              scenes: g.scenes.map((cs) => ({
                sceneId: cs.sceneId,
                partId: cs.partId,
                episodeNumber: cs.episodeNumber,
                durationFrames: cs.durationFrames ?? null,
                orderNo: cs.orderNo,
              })),
            }))}
            epStates={epStates}
            onReorder={handlePartsReorder}
            onResizePart={handlePartResize}
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
                EP{String(episodeNumber).padStart(2, '0')} 에 등록된 씬이 없습니다.
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
    </div>
  );
}

export default CompositingDashboardView;
