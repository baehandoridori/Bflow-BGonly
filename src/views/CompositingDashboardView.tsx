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

import { useEffect, useMemo, useState } from 'react';
import { useDataStore, compositingKey } from '@/stores/useDataStore';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useTransientHighlightStore } from '@/stores/transientHighlightStore';
import { subscribeCompositingStatesRealtime } from '@/services/supabaseService';
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

  // ── 카드 데이터 변환 ──
  const partGroups = useMemo(() => {
    const ep = episodes.find((e) => e.episodeNumber === episodeNumber);
    return buildCardScenes(ep);
  }, [episodes, episodeNumber]);

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

  // 첫 클릭 외부 (배경) → pinnedScene 해제
  const setPinnedScene = useCompositingDashboardStore((s) => s.setPinnedScene);

  return (
    <div className="flex flex-col h-full bg-bg-primary text-text-primary overflow-hidden">
      <DashHeader
        episodeNumber={episodeNumber}
        onCascadeReplay={() => setCascadeKey((k) => k + 1)}
      />
      <GuideStrip />
      <StatusLegend epStates={epStates} />

      <div
        className="flex-1 overflow-y-auto px-6 pb-12 pt-2"
        onClick={(e) => {
          // 배경 영역 클릭 시 pinnedScene 해제 (카드 onClick 은 stopPropagation 안 함 — pinnedScene set 후 동작)
          if (e.target === e.currentTarget) setPinnedScene(null);
        }}
      >
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
