/**
 * sceneId 정규화 유틸 — 전체 뷰 병합 전용
 *
 * BG 와 ACT 는 각각의 시트에서 독립적으로 sceneId 를 부여한다
 * (예: BG "ac001", ACT "a001"). 사용자 입장에서는 같은 "1번 씬" 으로
 * 보이지만 현재 mergedScenes 빌더는 sceneId 완전 일치만 병합한다.
 *
 * 정규화 키는 **마지막 숫자 그룹** 을 추출해 반환한다.
 *   "ac001" → "001"
 *   "a001"  → "001"
 *   "001"   → "001"
 *   "bg3-001" → "001" (마지막 숫자 그룹 우선)
 *   "ending" → "ending" (숫자가 없으면 원본 — 안전한 fallback)
 *
 * 설계 결정: 접두사에 숫자가 섞인 `v2a001` 같은 ID 가 있어도 실제 씬번호는
 * 마지막 숫자 그룹인 경우가 많다. 접두사 숫자에 흔들리지 않도록 끝자리 숫자만 본다.
 */

const TRAILING_DIGIT_GROUP_RE = /\d+$/;

export function normalizeSceneIdKey(sceneId: string | null | undefined): string {
  if (!sceneId) return '';
  const m = sceneId.match(TRAILING_DIGIT_GROUP_RE);
  if (!m) return sceneId;
  // 선행 0 제거로 "001" / "01" / "1" 을 동일 키로 취급
  return String(Number(m[0]));
}
