/**
 * 씬 카드의 댓글 카운트 hook — partUuid 단위 fetch + cache.
 *
 * 한솔 보고 (2026-05-22): "씬 카드 미리보기에 댓글 몇 개인지 안 보임" 근본 원인 추적.
 *  - `comments.scene_id` 컬럼은 `scene.no` 의 숫자 문자열 ('2', '14' 등) 으로 저장됨
 *    (UnifiedSceneDetailModal 의 `${sheetName}:${scene.no}` sceneKey 패턴 + CommentPanel
 *    addComment 의 parseSceneKey 분해 흐름과 일치).
 *  - 이전 구현은 `scene.sceneId` ('a002') 와 매칭 → 항상 0.
 *  - 이번 fix: scene.no 기반 매칭으로 변경. BG/ACT 두 시트 각각 scene.no 가 다를 수 있어 두 키 합산.
 */

import { useEffect, useState } from 'react';
import { readCommentsFromSupabase } from '@/services/supabaseService';

interface PartCache {
  status: 'pending' | 'done' | 'error';
  /** scene_id (= scene.no 문자열) → count */
  counts: Map<string, number>;
  /** 마지막 fetch 완료 시각 (ms). stale 판정 + 자동 재시도용. */
  fetchedAt: number;
}

const cache = new Map<string, PartCache>();
const listeners = new Map<string, Set<() => void>>();

/** 'done' 캐시의 stale 시간 — 이 시간 지나면 다음 mount 시 자동 재fetch (수동 invalidate 안 거쳐도 갱신). */
const DONE_STALE_MS = 60_000;
/** 'error' 캐시의 retry 간격 — transient error 일 가능성에 한 번 더 시도. */
const ERROR_RETRY_MS = 5_000;

function notify(partUuid: string) {
  const set = listeners.get(partUuid);
  if (!set) return;
  for (const fn of set) {
    try { fn(); } catch { /* noop */ }
  }
}

function shouldRefetch(entry: PartCache | undefined, now: number): boolean {
  if (!entry) return true;
  if (entry.status === 'pending') return false;
  if (entry.status === 'error' && (now - entry.fetchedAt) >= ERROR_RETRY_MS) return true;
  if (entry.status === 'done' && (now - entry.fetchedAt) >= DONE_STALE_MS) return true;
  return false;
}

async function fetchPartComments(partUuid: string): Promise<void> {
  const now = Date.now();
  // 코덱스 3차 P2 (2026-05-22): 'error' 후 5s 재시도, 'done' 후 60s stale 갱신 허용.
  const existing = cache.get(partUuid);
  if (!shouldRefetch(existing, now)) return;
  // pending 표시 — 다만 기존 counts 는 유지해서 화면 깜빡임 방지
  cache.set(partUuid, {
    status: 'pending',
    counts: existing?.counts ?? new Map(),
    fetchedAt: existing?.fetchedAt ?? 0,
  });
  try {
    const rows = await readCommentsFromSupabase(partUuid) as Array<Record<string, unknown>>;
    const counts = new Map<string, number>();
    for (const r of rows) {
      // comments.scene_id 는 scene.no 의 문자열. fallback 으로 scene_no / sceneId 도 검사.
      const raw = (r.sceneId ?? r.scene_id ?? r.sceneNo ?? r.scene_no ?? '') as string | number;
      const key = String(raw).trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    cache.set(partUuid, { status: 'done', counts, fetchedAt: Date.now() });
  } catch {
    cache.set(partUuid, {
      status: 'error',
      counts: existing?.counts ?? new Map(),
      fetchedAt: Date.now(),
    });
  } finally {
    notify(partUuid);
  }
}

/** 특정 partUuid 캐시만 무효화 (댓글 추가/삭제 broadcast 받았을 때 호출). */
export function invalidateCommentCountForPart(partUuid: string): void {
  cache.delete(partUuid);
  notify(partUuid);
}

/** 캐시 무효화 — EP 전환 / 댓글 추가 시 호출 가능. */
export function invalidateCommentCountCache(): void {
  cache.clear();
  for (const set of listeners.values()) {
    for (const fn of set) { try { fn(); } catch { /* noop */ } }
  }
}

/**
 * BG/ACT 두 시트의 그 씬 댓글 카운트 합산.
 * - bgPartUuid + bgSceneNo : BG 시트의 그 씬 scene.no
 * - actPartUuid + actSceneNo : ACT 시트의 그 씬 scene.no
 * BG/ACT 두 시트의 scene.no 는 다를 수 있어 (같은 sceneId 라도) 각자 lookup.
 */
export function useCommentCount(
  bgPartUuid: string | undefined,
  bgSceneNo: number | undefined,
  actPartUuid: string | undefined,
  actSceneNo: number | undefined,
): number {
  const [, setTick] = useState(0);

  useEffect(() => {
    const uuids = [bgPartUuid, actPartUuid].filter((u): u is string => !!u);
    if (uuids.length === 0) return;
    const registered: { uuid: string; fn: () => void }[] = [];
    uuids.forEach((uuid) => {
      // fetchPartComments 가 내부에서 shouldRefetch 판정 — stale/error 면 자동 재fetch.
      void fetchPartComments(uuid);
      let set = listeners.get(uuid);
      if (!set) { set = new Set(); listeners.set(uuid, set); }
      const fn = () => setTick((n) => n + 1);
      set.add(fn);
      registered.push({ uuid, fn });
    });
    return () => {
      for (const { uuid, fn } of registered) {
        listeners.get(uuid)?.delete(fn);
      }
    };
  }, [bgPartUuid, actPartUuid]);

  let total = 0;
  if (bgPartUuid && bgSceneNo !== undefined) {
    const entry = cache.get(bgPartUuid);
    if (entry?.status === 'done') total += entry.counts.get(String(bgSceneNo)) ?? 0;
  }
  if (actPartUuid && actSceneNo !== undefined) {
    const entry = cache.get(actPartUuid);
    if (entry?.status === 'done') total += entry.counts.get(String(actSceneNo)) ?? 0;
  }
  return total;
}
