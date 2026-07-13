// 헤더 포인트 배지 표시 문자열. 로딩·오류·미로딩 시 '— P'.
export function formatHeaderPoints(points: number | null): string {
  if (points === null || !Number.isFinite(points)) return '— P';
  return `${Math.round(points).toLocaleString('ko-KR')} P`;
}
