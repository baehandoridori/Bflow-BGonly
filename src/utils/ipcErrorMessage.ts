/**
 * Electron IPC를 건너온 오류는 메인이 던진 문구 앞에
 * `Error invoking remote method 'ics:add': Error: ` 같은 껍데기가 붙는다.
 * 사용자에게는 메인이 쓴 한국어 문구만 보여 준다.
 */
const IPC_WRAPPER = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/;

export function cleanIpcErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const cleaned = raw.replace(IPC_WRAPPER, '').trim();
  return cleaned !== '' ? cleaned : fallback;
}
