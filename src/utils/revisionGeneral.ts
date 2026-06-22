/**
 * 리테이크 '전반'(set_id 있고 scene_id 없는) 항목 판정 + 번호 부여 순수 로직.
 *
 * 전반 항목 sceneKey 는 낙관 추가 시 '' 이지만 재로드 후 rowToRevision 의 정규화로 '::' 가 된다.
 * 두 표현 모두 partOf==null 이므로, "전반"은 항상 partOf 기준으로 판정한다(빈문자열 비교 금지).
 * RetakeHubItemTable 의 그룹 판정과 동일 — 이 모듈을 단일 출처로 공유한다.
 * (구조적 타입 — @/ alias 없이 node:test 가능)
 */

export interface GeneralItemLike {
  setId?: string | null;
  sceneKey: string;
  revisionNo: number;
}

/** sceneKey `EP01:A:1` → 파트 letter('A'). 전반(빈/콜론만/형식밖)은 null. */
export function revisionPartOf(sceneKey: string): string | null {
  const parts = (sceneKey || '').split(':');
  if (parts.length < 2) return null;
  const p = parts[1]?.trim();
  return p ? p.toUpperCase() : null;
}

/** 전반 항목 여부 — 대상 씬에 안 매임(partOf==null). '' 와 '::' 둘 다 true. */
export function isGeneralRevisionSceneKey(sceneKey: string): boolean {
  return revisionPartOf(sceneKey) == null;
}

/** 같은 세트의 기존 전반 항목 max(revisionNo)+1. 빈 세트면 1. */
export function nextGeneralRevisionNo(
  revisions: readonly GeneralItemLike[],
  setId: string,
): number {
  let max = 0;
  for (const r of revisions) {
    if (r.setId !== setId) continue;
    if (!isGeneralRevisionSceneKey(r.sceneKey)) continue;
    if (r.revisionNo > max) max = r.revisionNo;
  }
  return max + 1;
}
