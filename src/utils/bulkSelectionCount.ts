/**
 * v1.25.12 — 사용자 눈에 보이는 단위(머지드 카드)로 선택 항목 카운트.
 *
 * 통합 모드에서 한 카드(머지드 키)는 1로 센다 — bg:KEY 와 act:KEY 둘 다
 * 들어있어도 1. 사용자 멘탈 모델 = "씬 카드 1장 = 1개".
 *
 * 개별 모드(plain sceneId)는 unique sceneId 카운트.
 *
 * 사용처: ConfirmDialog 문구의 N (예: "씬 N개를 삭제하시겠습니까?").
 *
 * 격리:
 *  - bulkOperations.ts 의 alias 의존성과 분리해, 순수 함수만 별도 파일에 둔다.
 *    (테스트 격리 + Node 22 native TS 실행 지원)
 */

const MERGED_KEY_PREFIX_BG = 'bg:';
const MERGED_KEY_PREFIX_ACT = 'act:';

export function countSelectedScenes(
  selectedIds: Set<string> | Iterable<string>,
  _allMergedScenes: unknown[],
  _fallbackPart: unknown,
): number {
  const mergedKeys = new Set<string>();
  const plainSceneIds = new Set<string>();
  for (const id of selectedIds) {
    if (id.startsWith(MERGED_KEY_PREFIX_BG)) {
      mergedKeys.add(id.slice(MERGED_KEY_PREFIX_BG.length));
    } else if (id.startsWith(MERGED_KEY_PREFIX_ACT)) {
      mergedKeys.add(id.slice(MERGED_KEY_PREFIX_ACT.length));
    } else {
      plainSceneIds.add(id);
    }
  }
  return mergedKeys.size + plainSceneIds.size;
}
