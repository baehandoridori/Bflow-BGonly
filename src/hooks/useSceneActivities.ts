import { useEffect, useMemo, useState } from 'react';
import * as supabaseService from '@/services/supabaseService';
import { subscribeToActivityRealtime } from '@/services/supabaseService';
import { useActivityStore } from '@/stores/useActivityStore';
import type { Activity } from '@/types';

/**
 * 씬 상세 모달 전용 — 해당 씬(들) 의 activity_log 활동 목록.
 *
 * 전략 (Phase B): cache + IPC fallback
 *   1. `useActivityStore.activities` (최근 500개 cache) 에서 해당 씬 ID 로 client-side filter — 즉시 반환
 *   2. mount 시 IPC 로 한 번 더 fetch (인덱스 idx_activity_log_scene 활용, 빠름) — 오래된 활동 보충
 *   3. Realtime: cache 가 자동 갱신되므로 단계 토글 등이 즉시 반영
 *
 * sceneIds 가 모두 null/undefined 이면 빈 배열 반환.
 *
 * @param sceneIds  Supabase scenes.id (UUID) 배열 — 통합 모달이면 [bgUuid, actUuid] 등
 * @param limit     IPC fallback 최대 fetch 개수 (default: 100)
 */
export function useSceneActivities(
  sceneIds: Array<string | undefined | null>,
  limit = 100,
): Activity[] {
  // store cache subscribe — 단계 토글/댓글/메모 변경이 Realtime 으로 들어오면 자동 rerender
  const cached = useActivityStore((s) => s.activities);

  // mount/sceneIds 변경 시 IPC 로 보충 fetch
  const [extra, setExtra] = useState<Activity[]>([]);

  // 안정적 dep 키 — 정렬된 sceneIds.join
  const validIds = useMemo(
    () => sceneIds.filter((id): id is string => !!id).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneIds.join('|')],
  );

  useEffect(() => {
    if (validIds.length === 0) {
      setExtra([]);
      return;
    }
    let cancelled = false;
    supabaseService.listActivities({ sceneIds: validIds, limit })
      .then((rows) => {
        if (cancelled) return;
        // Codex R2 P1 (2026-05-03): IPC 응답을 wholesale 로 덮으면 그 사이 Realtime 으로 들어온 항목이 사라짐.
        // race 시나리오: Realtime callback 이 setExtra(prev=>[a, ...prev]) 로 새 row 추가 →
        // 늦게 도착한 IPC 가 setExtra(rows) 로 덮어쓰는데, replication lag 으로 rows 에 그 새 row 없으면 누락.
        // 해결: id 기준 merge. IPC 결과 + 기존 prev 의 fresh items.
        setExtra((prev) => {
          const map = new Map<string, Activity>();
          for (const r of rows) map.set(r.id, r);
          for (const a of prev) if (!map.has(a.id)) map.set(a.id, a);
          return [...map.values()];
        });
      })
      .catch((err) => {
        console.warn('[useSceneActivities] IPC fetch 실패 — cache 만 사용:', err);
        // 실패 시 prev 보존 (Realtime 항목 유지) — 빈 배열로 wipe 하지 않음
      });
    return () => { cancelled = true; };
  }, [validIds, limit]);

  // Realtime — 자체 구독 (한솔 피드백 2026-05-02).
  // useActivityStore.receiveRealtime 은 dashboardDeptFilter 가 'bg' 또는 'acting' 이면
  // 다른 부서 활동을 cache 에서 drop. 모달은 BG+ACT 통합이라 cache 만 의존하면 한쪽 부서 audit 누락.
  // → hook 자체에서 sceneId 매칭만으로 직접 구독, 부서 필터 우회.
  useEffect(() => {
    if (validIds.length === 0) return;
    const validSet = new Set(validIds);
    // unmount 후에 도착한 Realtime 이벤트가 setExtra 호출 안 하도록 guard
    // (self-review fix 2026-05-02 — 빠른 씬 navigation 시 unmounted setState 경고 방지).
    let active = true;
    const unsub = subscribeToActivityRealtime((activity) => {
      if (!active) return;
      if (activity.sceneId && validSet.has(activity.sceneId)) {
        setExtra((prev) => {
          if (prev.some((a) => a.id === activity.id)) return prev;
          return [activity, ...prev];
        });
      }
    });
    return () => { active = false; unsub(); };
  }, [validIds]);

  // cache + IPC 결과를 id 기준 dedup → 시간순 정렬 (최신 → 오래된)
  return useMemo(() => {
    if (validIds.length === 0) return [];
    const validSet = new Set(validIds);
    const map = new Map<string, Activity>();
    // cache 먼저 (Realtime 으로 가장 최신 보유)
    for (const a of cached) {
      if (a.sceneId && validSet.has(a.sceneId)) map.set(a.id, a);
    }
    // IPC fallback 보충 (cache 에 없던 옛날 activity)
    for (const a of extra) {
      if (a.sceneId && validSet.has(a.sceneId) && !map.has(a.id)) map.set(a.id, a);
    }
    return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [cached, extra, validIds]);
}
