/**
 * 씬 카드의 댓글 카운트 hook — 파트(UUID) 댓글 행은 댓글 서비스의 공용 캐시를 같이 쓴다.
 *
 * 한솔 보고 (2026-05-22): "씬 카드 미리보기에 댓글 몇 개인지 안 보임" 근본 원인 추적.
 *  - `comments.scene_id` 컬럼은 `scene.no` 의 숫자 문자열 ('2', '14' 등) 으로 저장됨
 *    (UnifiedSceneDetailModal 의 `${sheetName}:${scene.no}` sceneKey 패턴 + CommentPanel
 *    addComment 의 parseSceneKey 분해 흐름과 일치).
 *  - scene.no 기반 매칭. BG/ACT 두 시트 각각 scene.no 가 다를 수 있어 두 키 합산.
 *
 * v1.145.0(씬 댓글 B안 §7.3): 60초마다·창으로 돌아올 때마다 다시 읽던 것을 없앴다. 카드 50장이 떠 있어도
 *  파트마다 처음 한 번만 읽고(진행 중 요청 합치기), 그다음은 다른 PC·창의 댓글 변경이 캐시를 고친 신호
 *  ('bflow:comments-invalidated')에만 다시 센다 — 다시 세기는 캐시에서 끝난다.
 */

import { useEffect, useState } from 'react';
import { loadPartCommentRows, peekPartCommentRows } from '@/services/commentService';
import { countCommentRowsByScene, type CommentRow } from '@/utils/commentRowCache';

/** 읽기 실패 뒤 한 번 더 기다리는 시간. */
const COUNT_RETRY_MS = 5_000;

/** 같은 행 배열이면 다시 세지 않는다(카드마다 렌더할 때 같은 파트를 50번 세지 않게). */
const countsByRows = new WeakMap<readonly CommentRow[], Map<string, number>>();
/** 파트를 다시 읽는 동안(무효화 직후) 숫자가 0 으로 깜빡이지 않게 마지막으로 센 값을 보여 준다(로컬 리뷰). */
const lastCountsByPart = new Map<string, Map<string, number>>();

function countsFor(partUuid: string | undefined): Map<string, number> | undefined {
  if (!partUuid) return undefined;
  const rows = peekPartCommentRows(partUuid);
  if (!rows) return lastCountsByPart.get(partUuid);
  let counts = countsByRows.get(rows);
  if (!counts) {
    counts = countCommentRowsByScene(rows);
    countsByRows.set(rows, counts);
  }
  lastCountsByPart.set(partUuid, counts);
  return counts;
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
    let disposed = false;
    const rerender = () => { if (!disposed) setTick((n) => n + 1); };
    // 캐시에 없으면 읽는다(같은 파트를 여러 카드가 동시에 불러도 요청은 한 번). 실패하면 5초 뒤 한 번 더 —
    // 그래도 안 되면 다음 댓글 신호나 다시 마운트될 때 다시 읽는다(주기 조회는 하지 않는다).
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const ensure = (allowRetry = true) => {
      for (const uuid of uuids) {
        if (peekPartCommentRows(uuid)) continue;
        void loadPartCommentRows(uuid).then(rerender, () => {
          if (disposed || !allowRetry || retryTimer) return;
          retryTimer = setTimeout(() => { retryTimer = null; if (!disposed) ensure(false); }, COUNT_RETRY_MS);
        });
      }
    };
    ensure();
    const onInvalidated = (event: Event) => {
      // 캐릭터 댓글·어디 것인지 모르는 삭제(씬 캐시에 없던 댓글)는 씬 카드와 무관하다.
      const detail = (event as CustomEvent<{ characterId?: string; unresolvedDelete?: boolean } | undefined>).detail;
      if (detail?.characterId || detail?.unresolvedDelete) return;
      rerender();
      ensure();
    };
    window.addEventListener('bflow:comments-invalidated', onInvalidated);
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('bflow:comments-invalidated', onInvalidated);
    };
  }, [bgPartUuid, actPartUuid]);

  let total = 0;
  if (bgSceneNo !== undefined) total += countsFor(bgPartUuid)?.get(String(bgSceneNo)) ?? 0;
  if (actSceneNo !== undefined) total += countsFor(actPartUuid)?.get(String(actSceneNo)) ?? 0;
  return total;
}
