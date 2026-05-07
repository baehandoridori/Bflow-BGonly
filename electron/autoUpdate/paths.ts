/**
 * v1.21.0 자동 업데이트 — 모든 경로 상수 + G드라이브 폴더 추정.
 * 순수 함수만. fs 사이드 이펙트 X (existsSync 같은 lookup만 허용).
 *
 * v1.22.0: NSIS 설치 도입 → process.execPath 기준 동적 경로로 전환. NSIS 설치
 * (`%LOCALAPPDATA%\Programs\BFLOW\`)와 기존 v1.21.x self-installer 설치
 * (`%LOCALAPPDATA%\Bflow-BGonly\app\`) 모두 자동 인식.
 *
 * 디렉토리 레이아웃 (실행 위치에 따라 자동):
 *   NSIS 설치:
 *     %LOCALAPPDATA%\Programs\BFLOW\          ← localAppDir (실행 중)
 *     %LOCALAPPDATA%\Programs\BFLOW-pending\  ← localPendingDir
 *     %LOCALAPPDATA%\Programs\BFLOW-backup\   ← localBackupDir
 *     %LOCALAPPDATA%\Bflow-BGonly\            ← localRoot (마커 전용)
 *
 *   v1.21.x self-installer 설치:
 *     %LOCALAPPDATA%\Bflow-BGonly\app\         ← localAppDir
 *     %LOCALAPPDATA%\Bflow-BGonly\app-pending\ ← localPendingDir
 *     %LOCALAPPDATA%\Bflow-BGonly\app-backup\  ← localBackupDir
 *     %LOCALAPPDATA%\Bflow-BGonly\            ← localRoot
 *
 * (개발 모드: process.execPath = electron.exe → 안전한 fallback 경로 사용)
 */
import { app } from 'electron';
import { existsSync, statSync } from 'fs';
import path from 'path';

/**
 * 마커 파일들이 들어가는 root — 항상 `%LOCALAPPDATA%\Bflow-BGonly\`.
 * 설치 위치(NSIS vs self-installer)와 무관하게 일관되게 마커를 한 곳에 모으기 위해 고정.
 */
export function localRoot(): string {
  const localAppData = process.env.LOCALAPPDATA
    || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  return path.join(localAppData, 'Bflow-BGonly');
}

/**
 * 현재 실행 중인 BFLOW.exe의 폴더 — swap 대상.
 * - NSIS 설치: `%LOCALAPPDATA%\Programs\BFLOW\`
 * - v1.21.x self-installer: `%LOCALAPPDATA%\Bflow-BGonly\app\`
 * - 개발 모드(process.execPath = electron.exe): 호환을 위해 v1.21.x 기본 경로 fallback
 * - G드라이브 직접 실행: G드라이브 폴더 자체를 swap target으로 잡으면 안 되므로
 *   v1.21.x self-installer 기본 경로 fallback (옛 호환성). swap은 그 dir을 대상으로
 *   하고, BFLOW.exe는 G드라이브에서 실행 중이라 swap 시 영향 없음.
 */
export function localAppDir(): string {
  if (!app.isPackaged) {
    return path.join(localRoot(), 'app');  // dev fallback
  }
  if (isRunningFromGoogleDrive()) {
    return path.join(localRoot(), 'app');  // G드라이브 직접 실행 — fallback
  }
  return path.dirname(process.execPath);
}

/** swap 대상 폴더의 형제 — pending/backup도 같은 부모 아래 형제로 둬서 atomic rename 가능. */
export function localPendingDir(): string { return localAppDir() + '-pending'; }
export function localBackupDir(): string { return localAppDir() + '-backup'; }
export function localReadyMarker(): string { return path.join(localPendingDir(), '.ready'); }

export const APP_DIR_NAME = 'app';
export const PENDING_DIR_NAME = 'pending';
export const BACKUP_DIR_NAME = 'backup';
export const READY_MARKER = '.ready';

/** `app/BFLOW.exe` */
export function localBflowExe(): string {
  return path.join(localAppDir(), 'BFLOW.exe');
}

/**
 * 설치 완료 마커 — install()이 *완전히* 성공했을 때만 작성.
 * Codex 5차 P1: 이전엔 BFLOW.exe 존재만으로 "이미 설치됨" 판단 → mid-copy 실패한
 * partial install이 무한 startup failure trap이 되던 문제. 이 마커가 있어야 진짜
 * 설치 완료로 간주.
 */
export function localInstalledMarker(): string {
  return path.join(localAppDir(), '.installed');
}

/**
 * Self-heal 시도 실패 마커 (v1.21.3). fullyInstalled 분기에서 desktop/startMenu 바로가기가
 * 모두 부재해 self-heal을 시도했으나 둘 다 실패한 경우 작성. 다음 실행부터 self-heal을
 * skip해 매 실행마다 동일 dialog 띄우는 annoyance 방지.
 *
 * 사용자가 수동으로 .lnk를 만들면 ensureShortcutsExist의 existsSync 검사가 즉시 noop이
 * 되므로 마커가 남아있어도 영향 없음.
 */
export function localSelfHealFailedMarker(): string {
  return path.join(localRoot(), '.shortcut-self-heal-failed');
}

/**
 * Swap 시도 마커 (v1.22.3) — swapper가 swap 진입 직후 작성, 정상 종료·복구 양쪽 모두에서
 * 정리. .ready만으로는 swap 실제 시도 여부를 판별 못 함(crash·kill·OS restart 시 .ready가
 * 다운로드 직후 남음 → false positive). 시작 시 .ready + .swap-attempted 둘 다 있을 때만
 * 진짜 swap 실패로 간주.
 */
export function localSwapAttemptedMarker(): string {
  return path.join(localRoot(), '.swap-attempted');
}

/**
 * Swap 실패 알림 후 자동 재시도 영구 중단 마커 (v1.22.3) — content는 own version. 같은
 * version에선 자동업데이트 cycle skip(checker가 검사)하고, 사용자가 NSIS Setup 등으로
 * 다른 version 설치 시 own이 갱신 → marker version과 다르면 자동 정리(자동업데이트 재개).
 */
export function localSwapSuppressedMarker(): string {
  return path.join(localRoot(), '.swap-suppressed');
}

/**
 * Swap 직후 첫 실행 검증 마커 — swapper가 swap 완료 후 작성, healthCheck가 해당 실행이
 * 정상 메인 창 도달하면 삭제.
 *
 * Codex 6차 P1: 이전엔 .start-attempt만으로 rollback 트리거 → 강제 종료·시스템 kill 등
 * 비손상 interruption도 bad build로 오인되어 backup 다운그레이드. 이 마커가 함께 있을
 * 때 (= swap 직후 첫 실행)만 rollback 활성화.
 */
export function localPendingVerificationMarker(): string {
  return path.join(localRoot(), '.pending-verification');
}

/**
 * Drive 가상 마운트 마커 폴더.
 *  - Drive desktop 가상 마운트(한국어): "공유 드라이브", "내 드라이브"
 *  - Drive desktop 가상 마운트(영어):   "Shared drives", "My Drive"
 *  - Legacy desktop sync:               "Google Drive", "GoogleDrive"
 *
 * Codex 7차 P1: 이전엔 legacy ~\Google Drive 마커가 누락되어 legacy 사용자는 self-installer
 * skip 됐음. legacy 마커도 추가.
 */
const DRIVE_MOUNT_MARKERS = [
  '공유 드라이브', '내 드라이브',
  'Shared drives', 'My Drive',
  'Google Drive', 'GoogleDrive',
];

/**
 * 현재 실행 *진입점* 경로 — portable 빌드 / 일반 빌드 모두 정확히 반환.
 *
 * Codex 4차 P1: electron-builder의 `win.target: "portable"`는 실행 시 process.execPath가
 * %TEMP%/<랜덤UUID>/BFLOW.exe (압축 풀린 임시 폴더)을 가리킴. 원래 launcher path
 * (사용자가 클릭한 G드라이브의 BFLOW.exe)는 `PORTABLE_EXECUTABLE_FILE` 환경변수에 있음.
 * 이 변수는 portable 모드 + 부트스트랩 시점에만 set됨 — 그 외(win-unpacked 실행 등)는 undefined.
 *
 * 따라서 Drive 감지는 PORTABLE_EXECUTABLE_FILE 우선, 없으면 process.execPath fallback.
 */
export function getLaunchExePath(): string {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

/**
 * 현재 실행 파일이 Google Drive 경로 하위에 있는지 추정.
 *
 * Codex 2차 P0: 이전엔 `guessGoogleDriveRoots()`로 받은 모든 drive root와 startsWith
 * 비교 → 일반 디스크(C:, D:)도 매치되어 무한 self-installer 루프. 마커 폴더 휴리스틱으로 수정.
 * Codex 4차 P1: process.execPath만 검사 → portable 모드에서 Temp 경로만 보고 Drive 감지 실패.
 * getLaunchExePath()로 진짜 launcher 경로 사용.
 */
export function isRunningFromGoogleDrive(): boolean {
  const exe = getLaunchExePath().toLowerCase();
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
  // Drive desktop 가상 마운트는 root 안에 "공유 드라이브"/"Shared drives" prefix 있음.
  // Legacy ~\Google Drive root는 sync root 자체이므로 prefix 없이 COMMON_TAIL만 추가.
  // Codex 7차 P1: 이전엔 legacy root에도 prefix prepend하던 문제 — null prefix 폴백 추가.
  const SUFFIXES = [
    path.join('공유 드라이브', COMMON_TAIL),
    path.join('Shared drives', COMMON_TAIL),
    COMMON_TAIL, // legacy: prefix 없음
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
