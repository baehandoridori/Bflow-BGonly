/**
 * 캐릭터 키 유효값 (피드백 47) — 복장 오버라이드(heightPx)가 있으면 그 값, 없으면 캐릭터 대표 키.
 * 키 비교 보기·에디터 현재값 표기·미설정 배지가 전부 이 함수를 공유한다(정렬·표시 불일치 방지).
 * 순수 함수 — node:test 직접 import 대상이라 '@/' alias·외부 import 금지.
 */
export function effectiveHeightPx(
  character: { referenceHeightPx: number | null },
  costume: { heightPx: number | null } | null | undefined,
): number | null {
  return costume?.heightPx ?? character.referenceHeightPx ?? null;
}
