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

/** 같은 행 배열이면 다시 세지 않는다(카드마다 렌더할 때 같은 파트를 50번 세지 않게). */
const countsByRows = new WeakMap<readonly CommentRow[], Map<string, number>>();

function countsFor(partUuid: string | undefined): Map<string, number> | undefined {
  if (!partUuid) return undefined;
  const rows = peekPartCommentRows(partUuid);
  if (!rows) return undefined;
  let counts = countsByRows.get(rows);
  if (!counts) {
    counts = countCommentRowsByScene(rows);
    countsByRows.set(rows, counts);
  }
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
    // 캐시에 없으면 읽는다(같은 파트를 여러 카드가 동시에 불러도 요청은 한 번). 실패하면 0 으로 두고
    // 다음 댓글 신호나 다시 마운트될 때 다시 읽는다.
    const ensure = () => {
      for (const uuid of uuids) {
        if (peekPartCommentRows(uuid)) continue;
        void loadPartCommentRows(uuid).then(rerender, () => { /* 0 으로 둔다 */ });
      }
    };
    ensure();
    const onInvalidated = (event: Event) => {
      // 캐릭터 댓글은 씬 카드와 무관하다.
      if ((event as CustomEvent<{ characterId?: string } | undefined>).detail?.characterId) return;
      rerender();
      ensure();
    };
    window.addEventListener('bflow:comments-invalidated', onInvalidated);
    return () => {
      disposed = true;
      window.removeEventListener('bflow:comments-invalidated', onInvalidated);
    };
  }, [bgPartUuid, actPartUuid]);

  let total = 0;
  if (bgSceneNo !== undefined) total += countsFor(bgPartUuid)?.get(String(bgSceneNo)) ?? 0;
  if (actSceneNo !== undefined) total += countsFor(actPartUuid)?.get(String(actSceneNo)) ?? 0;
  return total;
}
