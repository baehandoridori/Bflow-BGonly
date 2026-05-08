/**
 * 레거시 directory swap helper.
 *
 * v1.22.14 이후 현재 자동 업데이트 적용 경로는 installerApply.ts다.
 * 이 파일은 v1.21~v1.22.13 실패 상태 진단/호환용으로 남아있으며 새 적용 경로로
 * 되살리면 안 된다.
 *
 * v1.22.4 당시에는 detached PowerShell process로 BFLOW.exe 완전 종료 후 swap을 시도했다.
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
import { writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
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
# Codex 4차 P2: live PID + age check도 race 위험 (active helper의 slow copy가 mtime
# 임계 초과 시 정리 → race). PID + 시작 timestamp(Ticks)로 정확 검증 — process가
# StartTime까지 일치해야 active. PID 재사용 시 StartTime 다름 → stale 판정.
$lockPath = Join-Path $root 'swap.lock'
$lockHandle = $null

# 우리 PID의 StartTime을 lock에 기록할 준비
try {
  $myStartTicks = (Get-Process -Id $PID).StartTime.Ticks
} catch {
  $myStartTicks = 0
}

# 1. stale lock 사전 정리: PID 죽었거나 StartTime 불일치(PID 재사용)면 stale
if (Test-Path $lockPath) {
  $isStale = $true
  try {
    $oldContent = (Get-Content $lockPath -Raw -ErrorAction SilentlyContinue)
    if ($oldContent) { $oldContent = $oldContent.Trim() }
    # format: "PID|StartTimeTicks"
    if ($oldContent -match '^([0-9]+)[|]([0-9]+)$') {
      $oldPid = [int]$Matches[1]
      $oldStartTicks = [long]$Matches[2]
      $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
      if ($oldProc) {
        try {
          if ($oldProc.StartTime.Ticks -eq $oldStartTicks) {
            $isStale = $false  # 진짜 active
            Write-SwapLog "active helper (PID $oldPid, start match) — exiting"
          } else {
            Write-SwapLog "stale lock (PID $oldPid reused — StartTime mismatch) — cleared"
          }
        } catch {
          # StartTime 접근 실패 (권한 등) → 보수적으로 active로 간주
          $isStale = $false
          Write-SwapLog "PID $oldPid alive but StartTime unreadable — assuming active (exit)"
        }
      } else {
        Write-SwapLog "stale lock (PID $oldPid dead) — cleared"
      }
    } else {
      Write-SwapLog "stale lock (invalid format) — cleared"
    }
  } catch {}
  if (-not $isStale) {
    # active helper 진행 중 — 우리는 lock 안 잡고 종료. .ps1 self cleanup만.
    if ($PSCommandPath) { try { Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue } catch {} }
    exit 0
  }
  Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
}

# 2. atomic acquire + PID|StartTime 기록
try {
  $lockHandle = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $payload = "$PID|$myStartTicks"
  $payloadBytes = [System.Text.Encoding]::ASCII.GetBytes($payload)
  $lockHandle.Write($payloadBytes, 0, $payloadBytes.Length)
  $lockHandle.Flush()
  Write-SwapLog "lock acquired by PID $PID (atomic CreateNew)"
} catch [System.IO.IOException] {
  Write-SwapLog "another helper holding lock — exiting"
  if ($PSCommandPath) { try { Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue } catch {} }
  exit 0
} catch {
  Write-SwapLog "lock 획득 예외 (계속 진행): $($_.Exception.Message)"
}

Write-SwapLog "waiting for parent pid=${myPid}"
try {
  $p = Get-Process -Id ${myPid} -ErrorAction SilentlyContinue
  # v1.22.7: 30s → 60s. slow shutdown(supabase realtime cleanup, watchCleanup 등 비동기
  # chain 수십 초 가능)에서 30s 부족 → helper가 EBUSY swap 진행. 60s 안전 마진.
  if ($p) { $p.WaitForExit(60000) | Out-Null }
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
      Write-SwapLog "$($stepName): rename try $($i+1) OK"
      return $true
    } catch {
      Write-SwapLog "$($stepName): rename try $($i+1) 실패 — $($_.Exception.Message)"
      if ($i -lt ($maxRetries - 1)) { Start-Sleep -Milliseconds 500 }
    }
  }
  # rename 모두 실패 → copy fallback (느리지만 락에 robust)
  Write-SwapLog "$($stepName): copy fallback 시작"
  try {
    Copy-Item -Path $src -Destination $dst -Recurse -Force -ErrorAction Stop
    Remove-Item -Path $src -Recurse -Force -ErrorAction Stop
    Write-SwapLog "$($stepName): copy fallback OK"
    return $true
  } catch {
    Write-SwapLog "$($stepName): copy fallback 실패 — $($_.Exception.Message)"
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
    if ($PSCommandPath) { try { Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue } catch {} }
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

# 10. Codex 4차 P3: temp .ps1 self-cleanup. cmd wrapper가 helper를 -File 모드로 실행한
# 케이스에서 %TEMP%\bflow-helper-{pid}-{ts}.ps1이 누적됨. PowerShell -File 모드는 시작
# 시 file 내용 read 후 메모리 script로 보유 → file lock 안 잡으므로 자기 자신 삭제 가능.
# (-EncodedCommand 모드는 $PSCommandPath null이라 Remove-Item noop)
if ($PSCommandPath) {
  try { Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue } catch {}
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
      const logRoot = localRoot();
      if (!existsSync(logRoot)) mkdirSync(logRoot, { recursive: true });
      appendFileSync(
        path.join(logRoot, 'swap.log'),
        `${new Date().toISOString()} [main] ${msg}\n`,
        'utf-8',
      );
    } catch { /* best effort */ }
  };

  earlyLog(`spawnSwapHelper start — relaunch=${opts.relaunch}`);

  // 1차 시도: 직접 powershell spawn (기존 방식)
  try {
    const child = spawn('powershell.exe', psArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('spawn', () => {
      earlyLog(`direct spawn OK — child pid=${child.pid}`);
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
    // v1.22.8: UTF-8 BOM 추가. PowerShell 5.1 + 일부 환경에서 BOM 없는 UTF-8을 ANSI로
    // 해석 → script 안의 한글이 깨져 syntax 에러. BOM(﻿)을 prepend하면 PowerShell이
    // UTF-8로 명시 인식.
    writeFileSync(helperPs1, '﻿' + psScript, 'utf-8');
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
