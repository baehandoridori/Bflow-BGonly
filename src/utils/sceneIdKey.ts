/**
 * sceneId 정규화 유틸 — 전체 뷰 병합 전용
 *
 * BG 와 ACT 는 각각의 시트에서 독립적으로 sceneId 를 부여한다
 * (예: BG "ac001", ACT "a001"). 사용자 입장에서는 같은 "1번 씬" 으로
 * 보이지만 현재 mergedScenes 빌더는 sceneId 완전 일치만 병합한다.
 *
 * 정규화 키는 **첫 숫자 그룹** 을 추출해 반환한다.
 *   "ac001" → "001"
 *   "a001"  → "001"
 *   "001"   → "001"
 *   "bg3-001" → "3"   (첫 숫자 그룹 우선)
 *   "ending" → "ending" (숫자가 없으면 원본 — 안전한 fallback)
 *
 * 설계 결정: 문자 접두사 변형은 극복하되, "3-001" 과 "001" 이 섞여서 엉뚱하게
 * 병합되지 않도록 첫 숫자 그룹만 본다. 완전한 매칭이 아닐 뿐, 대부분의 현실
 * 데이터(접두사만 다른 경우) 를 극복한다.
 */

const FIRST_DIGIT_GROUP_RE = /\d+/;

export function normalizeSceneIdKey(sceneId: string | null | undefined): string {
  if (!sceneId) return '';
  const m = sceneId.match(FIRST_DIGIT_GROUP_RE);
  if (!m) return sceneId;
  // 선행 0 제거로 "001" / "01" / "1" 을 동일 키로 취급
  return String(Number(m[0]));
}
