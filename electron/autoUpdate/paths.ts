/**
 * v1.21.0 자동 업데이트 — 모든 경로 상수 + G드라이브 폴더 추정.
 * 순수 함수만. fs 사이드 이펙트 X (existsSync 같은 lookup만 허용).
 *
 * spec §3 디렉토리 레이아웃:
 *   %LOCALAPPDATA%\Bflow-BGonly\
 *     ├ app\       ← 현재 사용 중 BFLOW (win-unpacked 통째로)
 *     ├ pending\   ← 백그라운드로 받은 새 버전 (종료 시 swap 대기)
 *     └ backup\    ← 이전 버전 1개 (긴급 롤백용)
 */
import { app } from 'electron';
import { existsSync, statSync } from 'fs';
import path from 'path';

/** 로컬 본체 루트 — `%LOCALAPPDATA%\Bflow-BGonly\` */
export function localRoot(): string {
  // app.getPath('userData') = %APPDATA%\Bflow-BGonly (Roaming) — 사용자 데이터용.
  // 우리는 LocalAppData를 별도로 사용 — sync 안 됨 + Roaming보다 디스크 빠름.
  const localAppData = process.env.LOCALAPPDATA
    || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  return path.join(localAppData, 'Bflow-BGonly');
}

export const APP_DIR_NAME = 'app';
export const PENDING_DIR_NAME = 'pending';
export const BACKUP_DIR_NAME = 'backup';
export const READY_MARKER = '.ready';

export function localAppDir(): string { return path.join(localRoot(), APP_DIR_NAME); }
export function localPendingDir(): string { return path.join(localRoot(), PENDING_DIR_NAME); }
export function localBackupDir(): string { return path.join(localRoot(), BACKUP_DIR_NAME); }
export function localReadyMarker(): string { return path.join(localPendingDir(), READY_MARKER); }

/** `app/BFLOW.exe` */
export function localBflowExe(): string {
  return path.join(localAppDir(), 'BFLOW.exe');
}

/**
 * Drive desktop 가상 마운트의 표준 마커 폴더 — Drive 마운트 root에는 항상 이 중 하나가 있음.
 *  - 한국어 로케일: "공유 드라이브", "내 드라이브"
 *  - 영어 로케일:   "Shared drives", "My Drive"
 * 일반 C:, D: 같은 디스크 root에는 이 폴더가 없으므로 Drive와 일반 디스크를 정확히 구분.
 */
const DRIVE_MOUNT_MARKERS = ['공유 드라이브', '내 드라이브', 'Shared drives', 'My Drive'];

/**
 * 현재 실행 파일이 Google Drive 경로 하위에 있는지 추정.
 *
 * Codex 2차 P0: 이전엔 `guessGoogleDriveRoots()`로 받은 모든 drive root와 startsWith
 * 비교했는데, 1차 수정에서 A~Z 전체 scan으로 바뀌면서 일반 디스크(C:\, D:\) root 도
 * 후보에 포함 → 로컬 설치된 정상 PC에서도 항상 true 반환 → 무한 self-installer 루프.
 *
 * 새 휴리스틱: process.execPath에 Drive 마운트 마커("공유 드라이브" 등)가 포함됐는지
 * `includes`로 검사. drive letter 무관하게 정확히 Drive 경로만 매칭.
 */
export function isRunningFromGoogleDrive(): boolean {
  const exe = process.execPath.toLowerCase();
  return DRIVE_MOUNT_MARKERS.some(
    (marker) => exe.includes(`${path.sep}${marker}${path.sep}`.toLowerCase())
                || exe.includes(`/${marker}/`.toLowerCase()),
  );
}

/**
 * G드라이브 desktop 동기화 루트 후보. Drive desktop은 사용자 환경에 따라 다른 drive
 * letter에 마운트될 수 있어 A~Z 전체를 스캔하되, **Drive 마운트 마커 폴더가 있는 root
 * 만** 통과시켜 일반 디스크는 제외.
 *
 * 레거시 desktop sync 폴더(~\Google Drive)도 후보에 포함 — 거기는 폴더 자체가 마커.
 */
export function guessGoogleDriveRoots(): string[] {
  const candidates: string[] = [];
  // A~Z 전체 스캔, 단 Drive 마운트 마커 폴더가 있는 root만
  for (let i = 65; i <= 90; i++) { // 'A' ~ 'Z'
    const root = `${String.fromCharCode(i)}:\\`;
    try {
      if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    } catch { continue; }
    const isDriveMount = DRIVE_MOUNT_MARKERS.some((marker) => {
      try { return existsSync(path.join(root, marker)); } catch { return false; }
    });
    if (isDriveMount) candidates.push(root);
  }
  // 레거시 데스크톱 sync 폴더 (별도 마커 검사 X — 폴더 자체가 sync 루트)
  if (process.env.USERPROFILE) {
    const legacyCandidates = [
      path.join(process.env.USERPROFILE, 'Google Drive'),
      path.join(process.env.USERPROFILE, 'GoogleDrive'),
    ];
    for (const c of legacyCandidates) {
      try {
        if (existsSync(c) && statSync(c).isDirectory()) candidates.push(c);
      } catch { /* ignore */ }
    }
  }
  return candidates;
}

/**
 * 우리 dist가 들어있는 G드라이브 경로 추정. 후보를 스캔해 manifest.json + win-unpacked가
 * 같이 있는 폴더를 찾아 그 폴더 경로 반환. 없으면 null.
 *
 * Studio JBBJ 표준 경로 (DEVLOG/DEPLOYMENT.md §2):
 *   G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\dist\
 *
 * Codex 3차 P1: 영어 OS의 Drive desktop은 "Shared drives" 폴더로 노출되므로 두 prefix
 * 모두 시도해야 한국어/영어 사용자 모두 자동 업데이트 동작.
 */
export function findRemoteDistRoot(): string | null {
  const COMMON_TAIL = path.join('JBBJ 자료실', '한솔이의 두근두근 실험실', 'Bflow-BGonly', 'dist');
  const SUFFIXES = [
    path.join('공유 드라이브', COMMON_TAIL),
    path.join('Shared drives', COMMON_TAIL),
  ];
  const drives = guessGoogleDriveRoots();
  for (const drive of drives) {
    for (const suffix of SUFFIXES) {
      const candidate = path.join(drive, suffix);
      if (existsSync(path.join(candidate, 'manifest.json'))
          && existsSync(path.join(candidate, 'win-unpacked', 'BFLOW.exe'))) {
        return candidate;
      }
    }
  }
  return null;
}

/** G드라이브 dist의 win-unpacked 경로 (없으면 null) */
export function findRemoteWinUnpacked(): string | null {
  const root = findRemoteDistRoot();
  return root ? path.join(root, 'win-unpacked') : null;
}

/** G드라이브 manifest.json 경로 (없으면 null) */
export function findRemoteManifest(): string | null {
  const root = findRemoteDistRoot();
  if (!root) return null;
  const m = path.join(root, 'manifest.json');
  return existsSync(m) ? m : null;
}

/** 현재 실행 중인 BFLOW의 자기 버전 (package.json) */
export function getOwnVersion(): string {
  return app.getVersion();
}
