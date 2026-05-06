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
} from './paths';
import { copyDirMirror } from './copy';

export interface InstallResult {
  /** 호출자가 자기 종료해야 하는지 (self-installer가 새 위치에서 spawn 했음) */
  exited: boolean;
}

/**
 * main.ts의 app.whenReady 진입 직후 한 번 호출.
 * - G드라이브에서 실행됐고 로컬 본체 없으면 → 첫 설치 (dialog → 복사 → spawn).
 * - G드라이브에서 실행됐고 로컬 본체 있으면 → 즉시 로컬 spawn (옛 바로가기 폴백).
 * - 로컬에서 실행됐으면 → 그냥 정상 진행 (return { exited: false }).
 */
export async function runFirstInstallIfNeeded(): Promise<InstallResult> {
  if (!isRunningFromGoogleDrive()) {
    return { exited: false };
  }

  const localExe = localBflowExe();
  const alreadyInstalled = existsSync(localExe);

  if (alreadyInstalled) {
    // spec §4.4: 옛 바로가기 폴백. 로컬 본체로 spawn하고 자기는 종료.
    spawnDetached(localExe);
    app.exit(0);
    return { exited: true };
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
  spawnDetached(localExe);
  app.exit(0);
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

  // 바로가기 자동 생성 (실패해도 설치는 성공으로 간주)
  await createDesktopShortcut();
  await createStartMenuShortcut();
}

async function createDesktopShortcut(): Promise<void> {
  const desktop = path.join(process.env.USERPROFILE || '', 'Desktop');
  if (!existsSync(desktop)) return;
  await createShortcut(path.join(desktop, 'B flow.lnk'));
}

async function createStartMenuShortcut(): Promise<void> {
  const startMenu = path.join(
    process.env.APPDATA || '',
    'Microsoft', 'Windows', 'Start Menu', 'Programs',
  );
  if (!existsSync(startMenu)) return;
  await createShortcut(path.join(startMenu, 'B flow.lnk'));
}

/**
 * Electron의 shell.writeShortcutLink는 Windows에서만 작동. iconPath를 BFLOW.exe로 설정해
 * BFLOW 자체 아이콘 사용.
 */
async function createShortcut(lnkPath: string): Promise<void> {
  const exe = localBflowExe();
  try {
    const ok = shell.writeShortcutLink(lnkPath, 'create', {
      target: exe,
      icon: exe,
      iconIndex: 0,
      description: 'B flow — Studio JBBJ 워크플로우 대시보드',
    });
    if (!ok) console.warn('[installer] 바로가기 생성 실패:', lnkPath);
  } catch (err) {
    console.warn('[installer] 바로가기 예외:', lnkPath, err);
  }
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
 * Codex 1차 P1: process.argv 전체를 forward.
 * Windows에서 bflow:// 프로토콜 링크는 launch arguments로 전달되므로, 옛 G드라이브
 * 바로가기로 슬랙 딥링크 클릭 시(spec §13 폴백) deep-link payload가 손실되지 않도록
 * 사용자가 넘긴 args를 그대로 전달한다.
 *
 * process.argv[0] = self exe path, process.argv[1..] = 사용자 인자.
 * 내부 Electron 플래그는 그대로 둬도 BFLOW가 무시 (electron-builder portable이 알아서).
 */
function spawnDetached(exe: string): void {
  const args = process.argv.slice(1);
  spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
}
