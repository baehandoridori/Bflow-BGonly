// src/shared/sharedDrivePath.ts — 팀 공유 드라이브 경로 판정(가이드 그림 작업 폴더 제안, 설계 4.2-1).
// 메인 프로세스(폴더 목록 통로의 허용 경로)와 화면 쪽(제안 판정)이 같은 규칙을 쓴다. import 를 두지 않는다.

/** 팀 공유 드라이브의 시작 경로. 드라이브 글자 대소문자와 '/'·'\' 차이만 무시한다. */
export const SHARED_DRIVE_ROOT = 'G:\\공유 드라이브\\';

/** 앞뒤 공백을 지우고 '/'를 '\'로, 연속 '\'를 하나로, 끝 '\'를 뗀다(드라이브 루트 'G:\'는 그대로). */
export function normalizeWinPath(path: string): string {
  const slashed = (path ?? '').trim().replace(/\//g, '\\').replace(/\\{2,}/g, '\\');
  if (/^[a-z]:\\$/i.test(slashed)) return slashed;
  return slashed.replace(/\\+$/, '');
}

/** 공유 드라이브 안의 경로인가 — 루트 자체는 아니다. */
export function isSharedDrivePath(path: string): boolean {
  const normalized = normalizeWinPath(path).toLowerCase();
  const root = SHARED_DRIVE_ROOT.toLowerCase();
  return normalized.startsWith(root) && normalized.length > root.length;
}
