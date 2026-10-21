/**
 * 서버 업체(Supabase)가 사용량 한도로 프로젝트를 막았는지 가린다.
 *
 * 2026-10-21 아침 데이터 전송 한도를 넘자 모든 요청이 402 와 아래 본문으로 거절됐다.
 *   {"message":"Service for this project is restricted due to the following violations: exceed_egress_quota. …"}
 * 그때 로그인 화면은 '인터넷 연결을 확인', 켜 둔 앱은 상단에 'sheets' 를 띄워 원인을 알기 어려웠다.
 * 402 이거나 본문이 한도 위반(exceed_…_quota)·'project is restricted' 를 말하면 막힌 것으로 본다.
 */
export function isServerQuotaBlocked(status: number | null | undefined, message: unknown): boolean {
  if (status === 402) return true;
  return typeof message === 'string' && /exceed_[a-z_]*quota|project is restricted/i.test(message);
}
