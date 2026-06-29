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
  /** 입력값이 이 씬을 정확히 지목(전체 sceneId 또는 0 패딩 포함 번호 일치) */
  exact: boolean;
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
  // 끝자리 번호 매칭은 '씬처럼 생긴' 순수 숫자 입력에만 적용한다(P2).
  // '회의 1차', '10시 확인'처럼 숫자가 섞인 일반 메모가 씬 끝자리와 매칭돼
  // 개인 할일 대신 씬이 추가되는 것을 막는다.
  const numericQuery = /^\d+$/.test(q) ? q.replace(/^0+/, '') : null;
  // 0 패딩 그대로의 숫자 입력('001') — 정확히 지목한 씬(a001) 판정용. 정규화('1')와 달리
  // a010/a100 으로 번지지 않는다.
  const rawDigits = /^\d+$/.test(q) ? q : null;

  const matched = candidates.filter((f) => {
    const id = f.scene.sceneId.toLowerCase();
    if (id.includes(q)) return true;
    if (numericQuery) {
      const tail = trailingNumber(f.scene.sceneId);
      if (tail && tail.startsWith(numericQuery)) return true;
    }
    return false;
  });

  const scored: SceneCandidate[] = matched.map((f) => {
    const id = f.scene.sceneId.toLowerCase();
    const rawTail = f.scene.sceneId.match(/\d+$/)?.[0] ?? '';
    // 정확 매칭: 전체 sceneId 일치 또는 0 패딩 그대로의 끝자리 번호 일치.
    const exact = id === q || (rawDigits !== null && rawTail !== '' && rawTail === rawDigits);
    return {
      flat: f,
      isMine: isAssignedToMe(f.scene.assignee, currentUserName),
      alreadyAdded: existingKeys.has(f.key),
      exact,
    };
  });

  scored.sort((a, b) => {
    // 정확히 지목한 씬을 최우선 — '001'(=a001) 입력이 a010/a100 로 대체 추가되지 않게(P2).
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    // 추가 가능한 항목을 먼저 — 내 담당 씬은 보통 이미 추가돼 있어, '추가됨' 비활성 행이
    // 상위 limit을 다 차지하면 추가 가능한 씬이 잘려나가고 Enter가 먹통이 된다(P3).
    if (a.alreadyAdded !== b.alreadyAdded) return a.alreadyAdded ? 1 : -1;
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
    if (a.flat.episodeNumber !== b.flat.episodeNumber) return a.flat.episodeNumber - b.flat.episodeNumber;
    if (a.flat.partId !== b.flat.partId) return a.flat.partId.localeCompare(b.flat.partId);
    const an = parseInt(a.flat.scene.sceneId.match(/\d+$/)?.[0] || '0', 10);
    const bn = parseInt(b.flat.scene.sceneId.match(/\d+$/)?.[0] || '0', 10);
    return an - bn;
  });

  return scored.slice(0, limit);
}
