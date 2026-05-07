/**
 * v1.22.4 자동 업데이트 swap helper — detached PowerShell process로 BFLOW.exe 완전
 * 종료 후 swap. file lock 회피.
 *
 * 배경: v1.22.3까지 swap을 main process before-quit hook 안에서 in-process 실행.
 * Windows에서 실행 중인 .exe(또는 메모리 매핑된 .dll/.pak)가 들어있는 부모 디렉토리는
 * EBUSY로 rename/rmdir 실패. v1.22.2 retry + copy fallback도 같은 EBUSY로 막힘.
 *
 * Fix: helper를 detached로 spawn → BFLOW.exe 모두 죽기까지 wait → 그 후 swap. main
 * process가 종료된 시점엔 file handle release되어 lock 없음 → rename 정상 작동.
 *
 * 흐름:
 *   1. main process가 spawnSwapHelper() 호출 → PowerShell helper detached spawn
 *   2. main process 종료 (app.quit/exit)
 *   3. helper가 부모 BFLOW pid + 모든 BFLOW process가 죽기까지 wait
 *   4. helper가 directory swap (app→backup, pending→app)
 *   5. helper가 .installed/.pending-verification 마커 작성, .swap-attempted 정리
 *   6. (옵션) helper가 새 BFLOW.exe spawn
 */
import { spawn } from 'child_process';
import {
  localAppDir, localPendingDir, localBackupDir, localRoot, localBflowExe,
} from './paths';

export interface SwapHelperOptions {
  /** swap 후 새 BFLOW.exe spawn 여부. true: apply-now(재시작), false: 사용자 종료(swap만). */
  relaunch: boolean;
}

function escapePs(s: string): string {
  // PowerShell single-quoted string 안에서 single quote는 ''로 escape.
  return s.replace(/'/g, "''");
}

export function spawnSwapHelper(opts: SwapHelperOptions): void {
  const appDir = escapePs(localAppDir());
  const pendingDir = escapePs(localPendingDir());
  const backupDir = escapePs(localBackupDir());
  const root = escapePs(localRoot());
  const bflowExe = escapePs(localBflowExe());
  const myPid = process.pid;
  const relaunchFlag = opts.relaunch ? '$true' : '$false';

  // PowerShell script — multi-line. -EncodedCommand로 base64(UTF-16LE) 전달해 quoting 회피.
  const psScript = `
$ErrorActionPreference = 'Continue'
$root = '${root}'
$appDir = '${appDir}'
$pendingDir = '${pendingDir}'
$backupDir = '${backupDir}'
$bflowExe = '${bflowExe}'

function Write-SwapLog($msg) {
  try {
    if (-not (Test-Path $root)) { New-Item -ItemType Directory -Force -Path $root | Out-Null }
    Add-Content -Path (Join-Path $root 'swap.log') -Value "$(Get-Date -Format 'o') [helper] $msg"
  } catch {}
}

Write-SwapLog "waiting for parent pid=${myPid}"
try {
  $p = Get-Process -Id ${myPid} -ErrorAction SilentlyContinue
  if ($p) { $p.WaitForExit(30000) | Out-Null }
} catch {}

# 다른 BFLOW 인스턴스도 모두 죽기 대기 (최대 15초)
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  $alive = Get-Process -Name BFLOW -ErrorAction SilentlyContinue
  if (-not $alive) { break }
  Start-Sleep -Milliseconds 500
}

# 추가 안전 delay — Windows file handle release 타이밍 보정
Start-Sleep -Milliseconds 1000
Write-SwapLog "process all dead, swap start"

# 1. 이전 backup 정리
if (Test-Path $backupDir) {
  Remove-Item -Path $backupDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-SwapLog "old backup cleaned"
}

# NSIS Uninstall.exe 보존 (swap 후에도 "프로그램 추가/제거" 항목 유지)
$oldUninstall = Join-Path $appDir 'Uninstall BFLOW.exe'
$newUninstall = Join-Path $pendingDir 'Uninstall BFLOW.exe'
if ((Test-Path $oldUninstall) -and (-not (Test-Path $newUninstall))) {
  try {
    Copy-Item -Path $oldUninstall -Destination $newUninstall -ErrorAction Stop
    Write-SwapLog "Uninstall.exe preserved"
  } catch {
    Write-SwapLog "Uninstall.exe 보존 실패 (무시): $($_.Exception.Message)"
  }
}

# 2. app -> backup
try {
  if (Test-Path $appDir) {
    Move-Item -Path $appDir -Destination $backupDir -Force -ErrorAction Stop
    Write-SwapLog "step2 app->backup OK"
  }
} catch {
  Write-SwapLog "step2 FAIL: $($_.Exception.Message)"
  exit 1
}

# 3. pending -> app
try {
  Move-Item -Path $pendingDir -Destination $appDir -Force -ErrorAction Stop
  Write-SwapLog "step3 pending->app OK"
} catch {
  Write-SwapLog "step3 FAIL: $($_.Exception.Message)"
  # 복구 시도
  try {
    Move-Item -Path $backupDir -Destination $appDir -Force -ErrorAction Stop
    Write-SwapLog "recover backup->app OK"
  } catch {
    Write-SwapLog "recover FAIL: $($_.Exception.Message) — app/ 부재 가능성"
  }
  exit 1
}

# 4. .ready 정리 (swap된 새 app 안에 .ready가 있을 수 있음)
$stale = Join-Path $appDir '.ready'
if (Test-Path $stale) { Remove-Item $stale -Force -ErrorAction SilentlyContinue }

# 5. .installed 마커
try {
  Set-Content -Path (Join-Path $appDir '.installed') -Value (Get-Date -Format 'o') -Force -ErrorAction Stop
} catch {
  Write-SwapLog ".installed 마커 작성 실패 (무시): $($_.Exception.Message)"
}

# 6. .pending-verification 마커
try {
  Set-Content -Path (Join-Path $root '.pending-verification') -Value (Get-Date -Format 'o') -Force -ErrorAction Stop
} catch {
  Write-SwapLog ".pending-verification 작성 실패 (무시): $($_.Exception.Message)"
}

# 7. .swap-attempted 정리 (성공 → 다음 시작 시 dialog 안 띄움)
$attempted = Join-Path $root '.swap-attempted'
if (Test-Path $attempted) { Remove-Item $attempted -Force -ErrorAction SilentlyContinue }

Write-SwapLog "swap OK"

# 8. (옵션) 재시작
if (${relaunchFlag}) {
  try {
    Start-Process -FilePath $bflowExe
    Write-SwapLog "new BFLOW spawned"
  } catch {
    Write-SwapLog "spawn FAIL: $($_.Exception.Message)"
  }
}
`;

  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-EncodedCommand', encoded,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}
