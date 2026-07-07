/**
 * 복장 이름 생성 규칙 — store(첫 복장 자동 생성)와 상세 모달(복장 추가)이 공유.
 *
 * - 캐릭터의 첫(기본) 복장은 번호가 아닌 명명형 `기본 복장`.
 * - 이후 추가 복장은 `복장 1`, `복장 2` … (기존 `복장 N` 중 최대 N + 1).
 *   구멍(삭제로 비는 번호)은 채우지 않아 예측 가능한 증가만 한다.
 */

/** 캐릭터의 첫(기본) 복장 이름. */
export const DEFAULT_COSTUME_NAME = '기본 복장';

const NUMBERED_COSTUME_RE = /^복장\s+(\d+)$/;

/** 기존 `복장 N` 중 최대 N + 1 을 붙인 다음 복장 이름. 없으면 `복장 1`. */
export function nextCostumeName(costumes: ReadonlyArray<{ name: string }>): string {
  let maxN = 0;
  for (const c of costumes) {
    const m = NUMBERED_COSTUME_RE.exec(c.name.trim());
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }
  return `복장 ${maxN + 1}`;
}

/** 새 복장 이름 — 복장이 하나도 없으면 `기본 복장`, 있으면 `복장 N`. */
export function costumeNameForNew(costumes: ReadonlyArray<{ name: string }>): string {
  return costumes.length === 0 ? DEFAULT_COSTUME_NAME : nextCostumeName(costumes);
}
