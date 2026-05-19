/**
 * v1.26.0 — 이미지 버전 관리 헬퍼.
 *
 * - pickLatestVersion: 가장 최신 버전 (max versionNo) 선택
 * - nextVersionNo: 새 버전 추가 시 다음 번호 계산
 * - canDeleteVersion: 삭제 권한 체크 (본인 OR 관리자, 마지막 1개는 불가)
 * - generateImageFileName: 다운로드 파일명 자동 생성
 *
 * 격리: React/Electron 의존성 없는 순수 함수.
 */

interface VersionLike {
  versionNo: number;
  createdBy: string;
}

export function pickLatestVersion<T extends VersionLike>(versions: T[]): T | null {
  if (versions.length === 0) return null;
  return versions.reduce((max, v) => (v.versionNo > max.versionNo ? v : max));
}

export function nextVersionNo(versions: VersionLike[]): number {
  if (versions.length === 0) return 1;
  return Math.max(...versions.map((v) => v.versionNo)) + 1;
}

/**
 * 삭제 가능 여부.
 * - 마지막 1개(onlyOne=true)는 누구든 삭제 불가
 * - 비로그인은 불가
 * - 본인 또는 관리자만 가능
 */
export function canDeleteVersion(
  version: VersionLike,
  currentUserId: string | null,
  isAdmin: boolean,
  onlyOne: boolean = false,
): boolean {
  if (onlyOne) return false;
  if (!currentUserId) return false;
  return version.createdBy === currentUserId || isAdmin;
}

/**
 * 다운로드 파일명 자동 생성.
 * 예: EP03_A_BG_a007_storyboard_v2.jpg
 */
export function generateImageFileName(
  sheetName: string,
  sceneId: string,
  imageType: 'storyboard' | 'guide',
  versionNo: number,
): string {
  return `${sheetName}_${sceneId}_${imageType}_v${versionNo}.jpg`;
}
