/**
 * 저장 실패 문구에 붙이는 HTTP 상태 표시 — 메인 프로세스와 렌더러가 같이 쓴다(움직임 폴리싱 20번 safety-net).
 *
 * 메인의 IPC 래퍼(wrapIpc)는 오류를 문구 하나로 다시 던져서 HTTP 상태가 렌더러까지 오지 않는다.
 * 그래서 Supabase 응답이 HTTP 오류(400~599)면 문구 끝에 ' [HTTP 503]' 처럼 붙여 보내고,
 * 렌더러(src/utils/saveRetry.ts)가 이 표시로 '다시 보내 볼 만한 실패(5xx·408)'인지 가린다.
 */

const HTTP_STATUS_MARK = /\[HTTP (\d{3})\]/;

export function withHttpStatusMark(message: string, status: number | null | undefined): string {
  if (typeof status !== 'number' || status < 400 || status > 599) return message;
  if (HTTP_STATUS_MARK.test(message)) return message;
  return `${message} [HTTP ${status}]`;
}

/** 문구에 붙은 HTTP 상태. 없으면 null. */
export function readHttpStatusMark(text: string): number | null {
  const match = text.match(HTTP_STATUS_MARK);
  return match ? Number(match[1]) : null;
}
