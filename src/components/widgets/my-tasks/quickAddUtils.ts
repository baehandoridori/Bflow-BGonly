/**
 * QuickAdd 씬 자동완성 순수 로직.
 *
 * UI 없이 매칭/정렬/'내 담당' 판정을 단위 테스트로 회귀 보호한다.
 * ⚠️ 타입만 import(`import type`) — node:test(type-strip)에서 `@/` alias 없이 실행.
 */
import type { FlatScene, SceneKey } from './types';

export interface SceneCandidate {
  flat: FlatScene;
  /** 현재 사용자가 담당(콤마 분리 매칭) */
  isMine: boolean;
  /** 이미 내 할일 목록에 있음(비활성 + '추가됨') */
  alreadyAdded: boolean;
}

/**
 * '내 담당' 판정 — useMyTasksData.ts:548-552 와 동일하게 콤마 분리 후 trim 매칭.
 * 2인 이상 담당("배한솔, 이혜민") 씬에서도 누락 없이 매칭한다.
 */
export function isAssignedToMe(assignee: string | undefined | null, userName: string): boolean {
  if (!assignee || !userName) return false;
  return assignee.split(',').some((s) => s.trim() === userName);
}

/** sceneId 끝자리 숫자(선행 0 제거). 예: 'a001' → '1', 'sc010b' → '10' */
function trailingNumber(sceneId: string): string {
  return sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || '';
}

/**
 * 입력값으로 씬 후보를 필터·정렬한다.
 *
 * 매칭: sceneId 부분일치(소문자) 또는 입력 숫자가 끝자리 번호의 접두.
 * 정렬: 내 담당 우선 → 에피소드 → 파트 → 씬 번호.
 *
 * @param limit 최대 후보 수(기본 8).
 */
export function filterSceneCandidates(
  candidates: FlatScene[],
  query: string,
  currentUserName: string,
  existingKeys: Set<SceneKey>,
  limit = 8,
): SceneCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qDigits = q.replace(/\D/g, '');

  const matched = candidates.filter((f) => {
    const id = f.scene.sceneId.toLowerCase();
    if (id.includes(q)) return true;
    if (qDigits) {
      const tail = trailingNumber(f.scene.sceneId);
      if (tail && tail.startsWith(qDigits)) return true;
    }
    return false;
  });

  const scored: SceneCandidate[] = matched.map((f) => ({
    flat: f,
    isMine: isAssignedToMe(f.scene.assignee, currentUserName),
    alreadyAdded: existingKeys.has(f.key),
  }));

  scored.sort((a, b) => {
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
    if (a.flat.episodeNumber !== b.flat.episodeNumber) return a.flat.episodeNumber - b.flat.episodeNumber;
    if (a.flat.partId !== b.flat.partId) return a.flat.partId.localeCompare(b.flat.partId);
    const an = parseInt(a.flat.scene.sceneId.match(/\d+$/)?.[0] || '0', 10);
    const bn = parseInt(b.flat.scene.sceneId.match(/\d+$/)?.[0] || '0', 10);
    return an - bn;
  });

  return scored.slice(0, limit);
}
