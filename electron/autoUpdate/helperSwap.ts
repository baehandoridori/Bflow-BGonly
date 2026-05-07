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
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
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

# v1.22.6: helper script 시작 시점 즉시 ping. 이 로그가 swap.log에 안 보이면 PowerShell
# 자체 실행이 실패한 것. 보이면 PowerShell은 시작됐고 다음 단계에서 fail.
Write-SwapLog "[start] PowerShell helper alive — pid=$PID parent=${myPid}"

# v1.22.6: helper 동시 실행 race 방지 (direct spawn + cmd wrapper 둘 다 발화 가능).
#
# Codex 2차 P1: atomic acquire — Test-Path + Out-File는 race 가능. [System.IO.File]::Open
# 'CreateNew' + 'None' share는 OS-level atomic — file 존재 시 IOException throw.
# Codex 3차 P2: PID + mtime 둘 다 검사 (단일 mtime 5분은 slow copy fallback에서 active
# lock을 stale로 오인). PID 죽었으면 확실 stale (PID 재사용은 mtime으로 방어).
# mtime 30분 fallback — slow AV 환경에서 swap이 분 단위 걸려도 안전 마진.
$lockPath = Join-Path $root 'swap.lock'
$lockHandle = $null

# 1. stale lock 사전 정리: PID 죽음 (확실) 또는 mtime > 30분 (PID 재사용 방어)
if (Test-Path $lockPath) {
  $isStale = $false
  try {
    $oldContent = (Get-Content $lockPath -Raw -ErrorAction SilentlyContinue)
    if ($oldContent) { $oldContent = $oldContent.Trim() }
    if ($oldContent -match '^\d+$') {
      $oldPid = [int]$oldContent
      $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
      if (-not $oldProc) {
        $isStale = $true
        Write-SwapLog "stale lock (PID $oldPid dead) — cleared"
      } else {
        $age = (Get-Date) - (Get-Item $lockPath).LastWriteTime
        if ($age.TotalMinutes -gt 30) {
          $isStale = $true
          Write-SwapLog "stale lock (PID $oldPid alive but age=$([int]$age.TotalMinutes)min > 30 — likely PID reuse) — cleared"
        }
      }
    } else {
      $isStale = $true
      Write-SwapLog "stale lock (invalid PID content) — cleared"
    }
  } catch {
    $isStale = $true
  }
  if ($isStale) {
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
  }
}

# 2. atomic acquire + PID 기록
try {
  $lockHandle = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $pidBytes = [System.Text.Encoding]::ASCII.GetBytes("$PID")
  $lockHandle.Write($pidBytes, 0, $pidBytes.Length)
  $lockHandle.Flush()
  Write-SwapLog "lock acquired by PID $PID (atomic CreateNew)"
} catch [System.IO.IOException] {
  Write-SwapLog "another helper holding lock — exiting"
  exit 0
} catch {
  Write-SwapLog "lock 획득 예외 (계속 진행): $($_.Exception.Message)"
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

# Codex 2차 P1: rename + retry + copy fallback (이전 swapIfPending의 moveDirRobust 패턴
# 복원). BFLOW 종료 후라 EBUSY 자체는 거의 없어야 하지만 AV 검사·Windows search indexer
# 등 transient lock에 대비. retry → copy fallback 으로 safety net.
function Move-DirRobust([string]$src, [string]$dst, [string]$stepName) {
  $maxRetries = 3
  for ($i = 0; $i -lt $maxRetries; $i++) {
    try {
      Move-Item -Path $src -Destination $dst -Force -ErrorAction Stop
      Write-SwapLog "$stepName: rename try $($i+1) OK"
      return $true
    } catch {
      Write-SwapLog "$stepName: rename try $($i+1) 실패 — $($_.Exception.Message)"
      if ($i -lt ($maxRetries - 1)) { Start-Sleep -Milliseconds 500 }
    }
  }
  # rename 모두 실패 → copy fallback (느리지만 락에 robust)
  Write-SwapLog "$stepName: copy fallback 시작"
  try {
    Copy-Item -Path $src -Destination $dst -Recurse -Force -ErrorAction Stop
    Remove-Item -Path $src -Recurse -Force -ErrorAction Stop
    Write-SwapLog "$stepName: copy fallback OK"
    return $true
  } catch {
    Write-SwapLog "$stepName: copy fallback 실패 — $($_.Exception.Message)"
    return $false
  }
}

# 2. app -> backup
$movedToBackup = $false
if (Test-Path $appDir) {
  if (-not (Move-DirRobust $appDir $backupDir 'step2 app->backup')) {
    Write-SwapLog "swap end: FAIL (step2)"
    if ($lockHandle) { try { $lockHandle.Close() } catch {} }
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
    exit 1
  }
  $movedToBackup = $true
}

# 3. pending -> app
if (-not (Move-DirRobust $pendingDir $appDir 'step3 pending->app')) {
  Write-SwapLog "swap end: FAIL (step3)"
  # 복구 시도
  if ($movedToBackup) {
    if (Move-DirRobust $backupDir $appDir 'recover backup->app') {
      Write-SwapLog "recover OK — 옛 버전 그대로 유지"
    } else {
      Write-SwapLog "recover FAIL — app/ 부재 가능성"
    }
  }
  if ($lockHandle) { try { $lockHandle.Close() } catch {}; Remove-Item $lockPath -Force -ErrorAction SilentlyContinue }
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

# 9. lock file 정리 (success path) — handle close + file delete
if ($lockHandle) { try { $lockHandle.Close() } catch {} }
if (Test-Path $lockPath) {
  Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
  Write-SwapLog "lock released"
}
`;

  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

  // v1.22.6: spawn 자체가 실패하는 케이스 진단 + cmd.exe wrapper fallback.
  //
  // v1.22.4의 detached spawn이 한솔 PC에서 [helper] 로그를 단 한 번도 남기지 못함 →
  // PowerShell 자체는 정상 동작 확인됐고 helper script도 정상이지만, Node child_process
  // .spawn detached + windowsHide + stdio:'ignore' 조합이 어떤 이유로 실제 process를
  // 띄우지 못하는 듯. 'spawn' event listener로 실제 spawn 여부 확인 + cmd /c start 패턴
  // 으로 fallback.
  const psArgs = [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-EncodedCommand', encoded,
  ];

  // 즉시 진단 — main process가 빠르게 종료되기 전에 swap.log에 spawn 시도 기록
  const earlyLog = (msg: string) => {
    try {
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const { localRoot } = require('./paths') as typeof import('./paths');
      const root = localRoot();
      if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
      fs.appendFileSync(
        path.join(root, 'swap.log'),
        `${new Date().toISOString()} [main] ${msg}\n`,
        'utf-8',
      );
    } catch { /* best effort */ }
  };

  earlyLog(`spawnSwapHelper start — relaunch=${opts.relaunch}`);

  // 1차 시도: 직접 powershell spawn (기존 방식)
  let directOk = false;
  try {
    const child = spawn('powershell.exe', psArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('spawn', () => {
      earlyLog(`direct spawn OK — child pid=${child.pid}`);
      directOk = true;
    });
    child.once('error', (err) => {
      earlyLog(`direct spawn ERROR — ${err.message}`);
    });
    child.unref();
  } catch (err) {
    earlyLog(`direct spawn 예외 — ${(err as Error).message}`);
  }

  // 2차 fallback: cmd /c start /B powershell ... — Node spawn detached의 quirky 케이스
  // (Windows에서 stdio:'ignore' + 빠른 main exit 시 자식 spawn 실패) 우회. cmd.exe가
  // 중간 wrapper로 PowerShell을 띄움 → cmd 자체는 짧게 살고 PowerShell은 fully detached.
  // 1차가 정상 작동하면 2차는 redundant이지만 안전망 — helper script lock으로 race 방지.
  //
  // Codex 1차 P1: cmd.exe command line 길이 제한 8191자. helper script base64 (~15K)는
  // EncodedCommand로 직접 넘기면 cmd 한계 초과 → cmd wrapper deterministic fail. 해결:
  // helper script를 임시 .ps1 파일로 작성하고 cmd가 그 짧은 path만 인자로 받음.
  try {
    const tempDir = os.tmpdir();
    const helperPs1 = path.join(tempDir, `bflow-helper-${process.pid}-${Date.now()}.ps1`);
    writeFileSync(helperPs1, psScript, 'utf-8');
    earlyLog(`helper .ps1 written to ${helperPs1}`);

    // Codex 2차 P1: -File 모드는 execution policy 영향. Restricted/AllSigned 환경에서
    // 스크립트 실행 차단 → fallback 무력화. -ExecutionPolicy Bypass로 우회.
    // (-EncodedCommand 모드는 in-memory script라 정책 영향 없음 — direct spawn은 OK)
    const cmdArgs = [
      '/c', 'start', '/B', '""',  // start /B = window 없이 background, "" = title
      'powershell.exe',
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', helperPs1,
    ];
    const cmdChild = spawn('cmd.exe', cmdArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    cmdChild.once('spawn', () => {
      earlyLog(`cmd wrapper spawn OK — child pid=${cmdChild.pid}, helper file=${helperPs1}`);
    });
    cmdChild.once('error', (err) => {
      earlyLog(`cmd wrapper spawn ERROR — ${err.message}`);
    });
    cmdChild.unref();
  } catch (err) {
    earlyLog(`cmd wrapper 예외 — ${(err as Error).message}`);
  }
}
