/**
 * 파트 표시 이름 — 내부 partId(A/B/C…)는 그대로 두고 화면에 보이는 이름만 덮어쓴다.
 *
 * 왜 별칭 방식인가:
 *   partId 는 단순 라벨이 아니라 sheetName(`EP01_A_BG`)의 한 칸이고, 그 문자열이
 *   댓글·리테이크·알림·캘린더 연동 기록에 그대로 저장돼 있다(= 주소). partId 자체를
 *   바꾸면 과거 기록이 자기 파트를 잃어버리므로, 주소는 고정한 채 이름표만 씌운다.
 *   작품마다 파트 구분 기준이 달라도(A/B, 컷 범위, 시퀀스명) 화면 이름만 맞추면 된다.
 */

export function normalizePartLabel(label: string | null | undefined): string {
  return (label ?? '').trim();
}

/** 별칭이 있으면 별칭, 없으면 기존 'A파트' 표기. */
export function formatPartDisplayName(
  partId: string,
  label?: string | null,
): string {
  return normalizePartLabel(label) || `${partId}파트`;
}

/** 별칭이 적용된 상태인지 — 원본 partId 를 보조로 함께 노출할지 판단용. */
export function hasPartLabel(label?: string | null): boolean {
  return normalizePartLabel(label).length > 0;
}

/**
 * 별칭이 붙었을 때 보조로 보여줄 원본 표기('A파트').
 * 댓글·리테이크에 남은 주소와 눈으로 맞출 수 있게 항상 원본을 곁에 둔다.
 */
export function formatPartOriginSuffix(
  partId: string,
  label?: string | null,
): string {
  return hasPartLabel(label) ? `${partId}파트` : '';
}
