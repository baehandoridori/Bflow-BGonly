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
 * 현재 실행 파일이 G드라이브 경로 하위에 있는지 추정.
 * 한글 경로 안전성 — path 모듈만 사용 (정규식 직접 비교 X).
 */
export function isRunningFromGoogleDrive(): boolean {
  const exe = process.execPath;
  const candidates = guessGoogleDriveRoots();
  for (const root of candidates) {
    if (exe.toLowerCase().startsWith(root.toLowerCase())) return true;
  }
  return false;
}

/**
 * G드라이브 desktop 동기화 루트 후보. Drive desktop은 사용자 환경에 따라 다른 drive
 * letter (다른 네트워크 드라이브가 G:~J:를 점유하면 Drive가 K: 이상에 마운트되기도)에
 * 마운트될 수 있어 모든 letter (A~Z)를 스캔. existsSync + statSync는 ms 수준이라
 * 26회 호출은 비용 무시 가능.
 *
 * 추가로 레거시 desktop sync 폴더 (~\Google Drive)도 후보에 포함.
 *
 * Codex 1차 P2: 이전엔 G~J 4개만 체크해 다른 letter 마운트 환경에서 install 감지/
 * remote update discovery 모두 실패하던 문제 수정.
 */
export function guessGoogleDriveRoots(): string[] {
  const candidates: string[] = [];
  // A~Z 전체 스캔 — Drive desktop이 어떤 letter에 마운트됐든 감지
  for (let i = 65; i <= 90; i++) { // 'A'.charCodeAt(0) = 65, 'Z' = 90
    candidates.push(`${String.fromCharCode(i)}:\\`);
  }
  // 레거시 데스크톱 sync 폴더
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'Google Drive'));
    candidates.push(path.join(process.env.USERPROFILE, 'GoogleDrive'));
  }
  return candidates.filter((c) => {
    try { return existsSync(c) && statSync(c).isDirectory(); } catch { return false; }
  });
}

/**
 * 우리 dist가 들어있는 G드라이브 경로 추정. 후보를 스캔해 manifest.json + win-unpacked가
 * 같이 있는 폴더를 찾아 그 폴더 경로 반환. 없으면 null.
 *
 * Studio JBBJ 표준 경로 (DEVLOG/DEPLOYMENT.md §2): G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\dist\
 */
export function findRemoteDistRoot(): string | null {
  const SUFFIX = path.join('공유 드라이브', 'JBBJ 자료실', '한솔이의 두근두근 실험실', 'Bflow-BGonly', 'dist');
  const drives = guessGoogleDriveRoots();
  for (const drive of drives) {
    const candidate = path.join(drive, SUFFIX);
    if (existsSync(path.join(candidate, 'manifest.json'))
        && existsSync(path.join(candidate, 'win-unpacked', 'BFLOW.exe'))) {
      return candidate;
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
