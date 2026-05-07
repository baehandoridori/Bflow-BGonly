/**
 * v1.21.0 self-installer — 첫 실행 시 G드라이브 BFLOW.exe가 자기 자신을
 * `%LOCALAPPDATA%\Bflow-BGonly\app\` 로 복사하고 바로가기 + Defender 옵션.
 *
 * spec §4.3 (첫 실행), §4.4 (옛 바로가기 폴백) 참조.
 */
import { app, dialog, shell } from 'electron';
import { promises as fsp, existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import {
  isRunningFromGoogleDrive,
  findRemoteWinUnpacked,
  localRoot,
  localAppDir,
  localPendingDir,
  localBflowExe,
  localInstalledMarker,
  localSelfHealFailedMarker,
} from './paths';
import { copyDirMirror } from './copy';

export interface InstallResult {
  /** 호출자가 자기 종료해야 하는지 (self-installer가 새 위치에서 spawn 했음) */
  exited: boolean;
}

/**
 * NSIS 설치 PC 감지 — electron-builder의 oneClick + perMachine: false 기본 install dir은
 * `%LOCALAPPDATA%\Programs\${name}\` (package.json의 `name` 필드, 소문자 'bflow'). 그 안에
 * `Uninstall ${productName}.exe` ('BFLOW' 대문자)가 NSIS uninstaller 파일명.
 *
 * v1.22.0+ 부터 NSIS가 첫 설치를 담당하므로 NSIS 흔적이 있으면 self-installer 흐름은
 * 무관 — 사용자가 잘못된 경로(G드라이브 win-unpacked)를 클릭한 상황으로 안내만.
 *
 * Codex 1차 P1: 이전엔 'Programs/BFLOW/' (대문자) 검사 → electron-builder는 'name' 필드를
 * 폴더명으로 쓰므로 실제 install dir은 'Programs/bflow/' (소문자). 검사 miss → NSIS 설치
 * PC가 G드라이브 win-unpacked 클릭 시 안내 dialog 없이 옛 self-installer 흐름 진입.
 */
function isNsisInstalled(): boolean {
  const localAppData = process.env.LOCALAPPDATA
    || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  return existsSync(path.join(localAppData, 'Programs', 'bflow', 'Uninstall BFLOW.exe'));
}

/**
 * main.ts의 app.whenReady 진입 직후 한 번 호출.
 * - 로컬에서 실행됐으면 → 그냥 정상 진행 (return { exited: false }).
 * - G드라이브에서 실행됐고 NSIS로 이미 설치돼 있으면 → 안내 dialog + 종료
 *   (사용자가 잘못된 경로를 클릭한 경우. v1.22.0+ NSIS Setup이 정식 첫 설치).
 * - G드라이브에서 실행됐고 v1.21.x self-installer로 설치돼 있으면 → 즉시 로컬 spawn (옛 바로가기 폴백).
 * - G드라이브에서 실행됐고 미설치 + NSIS 없음 → 옛 self-installer 첫 설치 흐름 (호환).
 *   (정상 경로는 BFLOW-Setup.exe 클릭이지만 사용자가 win-unpacked\BFLOW.exe를 클릭한
 *    edge case 호환 — 매우 느리지만 동작은 함.)
 */
export async function runFirstInstallIfNeeded(): Promise<InstallResult> {
  if (!isRunningFromGoogleDrive()) {
    return { exited: false };
  }

  // v1.22.0: NSIS 설치 PC면 안내 dialog만 띄우고 종료. 자동업데이트는 데스크톱 바로가기로
  // 시작된 BFLOW가 백그라운드에서 처리하므로 G드라이브 직접 실행 자체가 불필요.
  if (isNsisInstalled()) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'B flow — 잘못된 실행 경로',
      message: '데스크톱의 "B flow" 바로가기를 사용해주세요',
      detail:
        'G드라이브에서 직접 실행하면 매우 느립니다.\n\n'
        + '이미 PC에 설치되어 있으니 바탕화면 또는 시작 메뉴의 "B flow" 바로가기를 사용하세요.\n\n'
        + '(자동 업데이트는 백그라운드에서 처리되므로 G드라이브 직접 실행은 불필요합니다.)',
      buttons: ['확인'],
    });
    app.exit(0);
    return { exited: true };
  }

  const localExe = localBflowExe();
  // Codex 5차 P1: existsSync(BFLOW.exe)만으로 "이미 설치됨" 판단하면 mid-copy 실패한
  // partial install이 무한 startup failure trap이 됨. .installed 마커가 *함께* 있을 때만
  // 진짜 설치 완료로 간주. partial install 감지 시 깨끗이 정리 후 새 설치 흐름 진입.
  const installedMarker = localInstalledMarker();
  const fullyInstalled = existsSync(localExe) && existsSync(installedMarker);
  const partialInstall = existsSync(localExe) && !existsSync(installedMarker);

  if (fullyInstalled) {
    // v1.21.3 self-heal: desktop/startMenu 바로가기 둘 다 부재 시 보충 시도.
    // v1.21.1 install이 shell.writeShortcutLink silent fail로 바로가기 없이
    // 끝난 PC를 위한 안전망 — v1.21.2 PowerShell COM 폴백을 활용해 보충.
    // 실패해도 relaunch는 막지 않음 (.shortcut-self-heal-failed 마커로 재시도 억제).
    await ensureShortcutsExist();
    // spec §4.4: 옛 바로가기 폴백. 로컬 본체로 spawn하고 자기는 종료.
    relaunchAndExit(localExe);
    return { exited: true };
  }

  if (partialInstall) {
    console.warn('[installer] partial install 감지 (BFLOW.exe 있으나 .installed 마커 없음) → 정리 후 재설치');
    try {
      await fsp.rm(localAppDir(), { recursive: true, force: true });
    } catch (err) {
      console.warn('[installer] partial install 정리 실패 (무시, install이 mirror로 덮어씀):', err);
    }
  }

  // 첫 설치 dialog (BrowserWindow 없이 standalone modal — 첫 실행이라 창 없음)
  const choice = await dialog.showMessageBox({
    type: 'info',
    title: 'B flow 첫 실행',
    message: 'B flow 를 PC에 설치합니다 (한 번만, ~5초)',
    detail:
      '실행 속도를 위해 B flow 본체를 사용자 PC 폴더로 복사합니다.\n'
      + '설치 후 자동으로 새 위치에서 실행됩니다. 다음부터는 바탕화면 바로가기를 사용해주세요.\n'
      + '\n'
      + '설치 경로: ' + localAppDir(),
    buttons: ['설치', '취소'],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice.response !== 0) {
    app.exit(0);
    return { exited: true };
  }

  try {
    await install();
  } catch (err) {
    console.error('[installer] 설치 실패:', err);
    await dialog.showMessageBox({
      type: 'error',
      title: 'B flow 설치 실패',
      message: '설치 중 오류가 발생했습니다',
      detail: String((err as Error).message ?? err),
      buttons: ['확인'],
    });
    app.exit(1);
    return { exited: true };
  }

  // Defender 제외 등록 (옵션, UAC 동의)
  await offerDefenderExclusion();

  // 새 위치에서 spawn + 자기 종료
  relaunchAndExit(localExe);
  return { exited: true };
}

async function install(): Promise<void> {
  const remote = findRemoteWinUnpacked();
  if (!remote) {
    throw new Error(
      'G드라이브 폴더에서 B flow 빌드를 찾을 수 없습니다. '
      + 'Google Drive desktop이 켜져있는지, sync가 끝났는지 확인해주세요.',
    );
  }
  await fsp.mkdir(localRoot(), { recursive: true });
  await fsp.mkdir(localAppDir(), { recursive: true });
  await copyDirMirror(remote, localAppDir());

  // Codex 5차 P1: 모든 파일 mirror copy 완료 후에만 .installed 마커 작성. mid-copy 실패
  // 시 throw로 빠져나가서 마커는 안 만들어짐 → 다음 실행 시 partial install로 인식.
  await fsp.writeFile(
    localInstalledMarker(),
    new Date().toISOString() + '\n',
    'utf-8',
  );

  // 바로가기 자동 생성 — 실패해도 설치는 성공(마커 위에서 작성). 단 desktop+startMenu
  // 둘 다 실패하면 사용자에게 수동 안내 dialog 띄움 (v1.21.2: 한솔 PC 케이스).
  const desktopOk = await createDesktopShortcut();
  const startMenuOk = await createStartMenuShortcut();
  if (!desktopOk && !startMenuOk) {
    await notifyShortcutFailure();
  }
}

/**
 * v1.21.3 self-heal — fullyInstalled 분기에서 호출. desktop OR startMenu .lnk 중
 * 하나라도 있으면 noop. 둘 다 부재 시 보충 시도하되, 이전에 실패한 적 있으면
 * (.shortcut-self-heal-failed 마커) skip해 매 실행 dialog spam 방지.
 */
async function ensureShortcutsExist(): Promise<void> {
  const desktopLnk = path.join(process.env.USERPROFILE || '', 'Desktop', 'B flow.lnk');
  const startMenuLnk = path.join(
    process.env.APPDATA || '',
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'B flow.lnk',
  );
  if (existsSync(desktopLnk) || existsSync(startMenuLnk)) return;

  const failedMarker = localSelfHealFailedMarker();
  if (existsSync(failedMarker)) return;

  const desktopOk = await createDesktopShortcut();
  const startMenuOk = await createStartMenuShortcut();
  if (!desktopOk && !startMenuOk) {
    try {
      await fsp.writeFile(failedMarker, new Date().toISOString() + '\n', 'utf-8');
    } catch (err) {
      console.warn('[installer] self-heal failed marker 작성 실패 (무시):', err);
    }
    await notifyShortcutFailure();
  }
}

async function createDesktopShortcut(): Promise<boolean> {
  const desktop = path.join(process.env.USERPROFILE || '', 'Desktop');
  if (!existsSync(desktop)) return false;
  return createShortcut(path.join(desktop, 'B flow.lnk'));
}

async function createStartMenuShortcut(): Promise<boolean> {
  const startMenu = path.join(
    process.env.APPDATA || '',
    'Microsoft', 'Windows', 'Start Menu', 'Programs',
  );
  if (!existsSync(startMenu)) return false;
  return createShortcut(path.join(startMenu, 'B flow.lnk'));
}

/**
 * 1차: Electron `shell.writeShortcutLink`. Windows에서만 작동. 일부 환경(한국어 OS,
 * 막 mirror copy 끝난 BFLOW.exe를 icon으로 지정 등)에서 silent하게 false 반환하는
 * 케이스가 v1.21.1 한솔 PC에서 재현됨 → PowerShell COM fallback 필요.
 *
 * 2차: PowerShell `WScript.Shell` COM. `shell.writeShortcutLink` 실패 시 폴백.
 *      이전 한솔 PC에서 수동으로 통한 경로.
 *
 * 둘 다 실패 → 호출자가 사용자에게 안내 dialog (notifyShortcutFailure).
 */
async function createShortcut(lnkPath: string): Promise<boolean> {
  const exe = localBflowExe();
  // 1차 시도: Electron 내장
  try {
    const ok = shell.writeShortcutLink(lnkPath, 'create', {
      target: exe,
      icon: exe,
      iconIndex: 0,
      description: 'B flow — Studio JBBJ 워크플로우 대시보드',
    });
    if (ok && existsSync(lnkPath)) return true;
    console.warn('[installer] shell.writeShortcutLink false 반환:', lnkPath);
  } catch (err) {
    console.warn('[installer] shell.writeShortcutLink 예외:', lnkPath, err);
  }
  // 2차 폴백: PowerShell WScript.Shell COM
  try {
    const ok = await createShortcutPowerShell(lnkPath, exe);
    if (ok && existsSync(lnkPath)) return true;
    console.warn('[installer] PowerShell COM fallback 실패:', lnkPath);
  } catch (err) {
    console.warn('[installer] PowerShell COM 예외:', lnkPath, err);
  }
  return false;
}

/**
 * PowerShell 자식 프로세스에서 WScript.Shell COM으로 .lnk 작성. 외부 프로세스라
 * Electron 내부 COM 호환성 문제(electron 33 + 한국어 OS quirk 등)를 회피한다.
 *
 * 보안: 사용자 입력이 들어가는 경로(lnkPath, exe)는 PowerShell single-quoted string에
 * 넣되 single quote(')는 ''로 escape — `'` 문자가 path에 있으면 (이론상 가능) 그대로
 * 안전하게 처리됨. spawn argv 분리 + -EncodedCommand로 quoting 이중 방어.
 */
async function createShortcutPowerShell(lnkPath: string, exe: string): Promise<boolean> {
  const escLnk = lnkPath.replace(/'/g, "''");
  const escExe = exe.replace(/'/g, "''");
  const escWorkDir = path.dirname(exe).replace(/'/g, "''");
  const psScript = [
    `$ErrorActionPreference = 'Stop'`,
    `$wsh = New-Object -ComObject WScript.Shell`,
    `$sc = $wsh.CreateShortcut('${escLnk}')`,
    `$sc.TargetPath = '${escExe}'`,
    `$sc.IconLocation = '${escExe},0'`,
    `$sc.WorkingDirectory = '${escWorkDir}'`,
    `$sc.Description = 'B flow - Studio JBBJ workflow dashboard'`,
    `$sc.Save()`,
  ].join('; ');
  // -EncodedCommand: PowerShell이 base64(UTF-16LE) 디코드 후 실행 → shell quoting/escaping
  // 이슈 회피. PowerShell이 -EncodedCommand 파라미터를 표준 base64로 받기 때문에 안전.
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  return new Promise<boolean>((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { stdio: 'ignore', windowsHide: true },
    );
    child.once('exit', (code) => resolve(code === 0));
    child.once('error', (err) => {
      console.warn('[installer] PowerShell spawn 오류:', err);
      resolve(false);
    });
  });
}

/**
 * 자동 바로가기 생성이 desktop + startMenu 둘 다 실패한 케이스. 사용자가 다음번에 또
 * G드라이브 BFLOW.exe를 찾아 클릭(매번 14초+ Defender 검사)하지 않도록 로컬 exe 경로를
 * 명시 안내한다.
 */
async function notifyShortcutFailure(): Promise<void> {
  await dialog.showMessageBox({
    type: 'warning',
    title: 'B flow — 바로가기 자동 생성 실패',
    message: '바로가기를 자동으로 만들지 못했습니다',
    detail:
      '아래 경로의 BFLOW.exe로 직접 바로가기를 만들어주세요 — '
      + '앞으로는 G드라이브 대신 그 바로가기를 사용하면 1~2초 안에 시작됩니다.\n\n'
      + localBflowExe(),
    buttons: ['확인'],
  });
}

/**
 * Defender 제외 등록 옵션 dialog. 사용자가 허용하면 elevated PowerShell로 Add-MpPreference.
 * 거부 시 그냥 진행 (정상 동작, 새 빌드 직후 첫 실행만 약간 느림).
 */
async function offerDefenderExclusion(): Promise<void> {
  const choice = await dialog.showMessageBox({
    type: 'question',
    title: 'B flow — 빠른 시작 옵션',
    message: 'Windows 보안에 검사 제외 등록 (선택)',
    detail:
      'B flow 폴더를 Windows Defender 검사 제외로 등록하면 새 빌드를 받은 직후 첫 실행도 빠릅니다.\n'
      + '(허용 시 관리자 권한 한 번 요청)\n'
      + '\n'
      + '제외 폴더: ' + localRoot(),
    buttons: ['허용', '나중에'],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice.response !== 0) return;

  // PowerShell elevated — UAC 자동. 실패 시 그냥 진행.
  const appExclusion = localAppDir();
  const pendingExclusion = localPendingDir();
  // single quote escape: PowerShell single-quoted string은 ''로 single quote 표현
  const escAppPath = appExclusion.replace(/'/g, "''");
  const escPendingPath = pendingExclusion.replace(/'/g, "''");
  const innerCommand =
    `Add-MpPreference -ExclusionPath '${escAppPath}'; `
    + `Add-MpPreference -ExclusionPath '${escPendingPath}'`;
  // -Verb RunAs로 UAC. 부모 BFLOW가 종료돼도 detached로 살아남음.
  const psArgs = [
    '-NoProfile', '-Command',
    `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command',"${innerCommand}"`,
  ];
  try {
    spawn('powershell.exe', psArgs, { detached: true, stdio: 'ignore' }).unref();
  } catch (err) {
    console.warn('[installer] Defender 제외 등록 실패:', err);
  }
}

/**
 * 자식 BFLOW.exe spawn → single-instance lock release → self 종료.
 *
 * Codex 1차 P1: process.argv를 forward — Windows에서 bflow:// 프로토콜 링크는 launch
 * arguments로 전달되므로, 옛 G드라이브 바로가기로 슬랙 딥링크 클릭 시(spec §13 폴백)
 * deep-link payload가 손실되지 않도록 사용자가 넘긴 args를 그대로 전달한다.
 *
 * Codex 3차 P2: app.releaseSingleInstanceLock() 호출 — 자식 process가 시작 시
 * requestSingleInstanceLock()이 false 반환받아 "second instance"로 거부되는 상황 방지.
 * parent가 아직 완전 exit 전이라도 lock은 명시적으로 해제하면 자식이 정상 lock 획득.
 *
 * process.argv[0] = self exe path, process.argv[1..] = 사용자 인자.
 */
function relaunchAndExit(exe: string): void {
  const args = process.argv.slice(1);
  spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
  try { app.releaseSingleInstanceLock(); } catch { /* noop — lock 없을 수도 있음 */ }
  app.exit(0);
}
